//! HTTP contract for private timeline updates and recorded-day questions.
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn timeline_updates_and_questions_are_workspace_scoped_and_preserve_recordings() {
    std::env::set_current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
    let requests=Arc::new(Mutex::new(Vec::<Value>::new()));let seen=requests.clone();
    let fixture=axum::Router::new().route("/v1/systemone",axum::routing::post(move |axum::Json(body):axum::Json<Value>| {
        let seen=seen.clone();async move {
            seen.lock().unwrap().push(body.clone());
            let answers:serde_json::Map<String,Value>=body["questions"].as_object().unwrap().iter().map(|(key,q)|{
                let choices=q["criteria"].as_object().unwrap();
                let selected=if choices.contains_key("dining") {"dining"} else if choices.contains_key("yes") {"yes"} else {"same"};
                let probabilities:serde_json::Map<String,Value>=choices.keys().map(|k|(k.clone(),json!(if k==selected {1.0}else{0.0}))).collect();
                (key.clone(),json!({"type":"choice","choice":selected,"probabilities":probabilities,"confidence":1.0}))
            }).collect();axum::Json(json!({"model":"jev-1.13.0","answers":answers}))
        }
    }));
    let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    std::env::set_var("TYPESAFE_BASE_URL",format!("http://{}",listener.local_addr().unwrap()));
    std::env::set_var("TYPESAFE_API_KEY","local-evolution-fixture");std::env::set_var("MODEL_OFFLINE","0");
    for key in ["NEO4J_URI","HYDRA_DB_KEY","HYDRA_DB_API_KEY","INSFORGE_API_KEY","INSFORGE_ADMIN_KEY","SF_PUMS_PATH","JEV_MODEL"] {std::env::remove_var(key);}
    let provider=tokio::spawn(async move{axum::serve(listener,fixture).await.unwrap();});
    let dir=tempfile::tempdir().unwrap();
    let mut state=simfrancisco::api::build_state("tiles.db",Some(dir.path().join("cache.db").to_str().unwrap()),dir.path().join("state.db").to_str().unwrap()).unwrap();
    state.hydra=None;state.engine.hydra=None;state.insforge=None;
    let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let base=format!("http://{}",listener.local_addr().unwrap());
    let server=tokio::spawn(async move{axum::serve(listener,simfrancisco::api::router(state)).await.unwrap();});
    let http=reqwest::Client::new();
    let sim:Value=http.post(format!("{base}/simulations")).header("x-simtra-workspace","owner").json(&json!({"city":"sf","n":24,"seed":42})).send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    let branch=sim["main_branch"].as_str().unwrap();
    let pinned_news=simfrancisco::news::prompt_block_at("sf","2026-09-19");
    assert!(!pinned_news.is_empty());
    for (input,status) in [
        (json!({"scenario":"Chipotle raises bowl prices by 10%","as_of_date":"2026-09-19","pinned_news":"CLIENT_FORGED_NEWS"}),409),
        (json!({"scenario":"Chipotle raises bowl prices by 10%","as_of_date":"2026-02-30","pinned_news":pinned_news}),400),
    ] {
        let rejected=http.post(format!("{base}/branches/{branch}/evolution")).header("x-simtra-workspace","owner").json(&input).send().await.unwrap();
        assert_eq!(rejected.status().as_u16(),status);
    }
    assert!(requests.lock().unwrap().is_empty(),"Invalid news/date must not spend provider calls");
    let response=http.post(format!("{base}/branches/{branch}/evolution")).header("x-simtra-workspace","owner").json(&json!({"scenario":"Chipotle raises bowl prices by 10%","as_of_date":"2026-09-19","pinned_news":pinned_news})).send().await.unwrap();
    assert_eq!(response.status(),201);let original:Value=response.json().await.unwrap();let id=original["id"].as_str().unwrap();
    assert_eq!(original["frames"].as_array().unwrap().len(),1);assert_eq!(original["events"],json!([]));assert_eq!(original["questions"],json!([]));
    let event=json!({"text":"A competitor cuts bowl prices by 10%","expected_tick":0});
    let question=json!({"question":"Would residents keep buying bowls?","tick":0});
    let count=requests.lock().unwrap().len();
    // Neither reads nor writes expose a run to a different workspace.
    assert_eq!(http.get(format!("{base}/evolution/{id}")).header("x-simtra-workspace","other").send().await.unwrap().status(),404);
    for (path,body) in [("event",event.clone()),("question",question.clone()),("step",json!({"expected_tick":0}))] {
        assert_eq!(http.post(format!("{base}/evolution/{id}/{path}")).header("x-simtra-workspace","other").json(&body).send().await.unwrap().status(),404);
    }
    // Required request fields fail extraction before any provider work.
    for path in ["event","question"] {
        assert_eq!(http.post(format!("{base}/evolution/{id}/{path}")).header("x-simtra-workspace","owner").json(&json!({})).send().await.unwrap().status(),422);
    }
    let bad=http.post(format!("{base}/evolution/{id}/event")).header("x-simtra-workspace","owner").json(&json!({"text":"A competitor cuts bowl prices","expected_tick":3})).send().await.unwrap();
    assert_eq!(bad.status(),400);assert!(bad.json::<Value>().await.unwrap()["error"].as_str().unwrap().contains("latest unfinished"));
    for invalid in [json!({"question":"Why do residents buy bowls?","tick":0}),json!({"question":"Would residents buy bowls?","tick":8})] {
        assert_eq!(http.post(format!("{base}/evolution/{id}/question")).header("x-simtra-workspace","owner").json(&invalid).send().await.unwrap().status(),400);
    }
    assert_eq!(requests.lock().unwrap().len(),count);
    let response=http.post(format!("{base}/evolution/{id}/event")).header("x-simtra-workspace","owner").json(&event).send().await.unwrap();
    assert_eq!(response.status(),201);let posted:Value=response.json().await.unwrap();
    assert_eq!(posted,json!({"text":"A competitor cuts bowl prices by 10%","effective_day":1}));
    let answer:Value=http.post(format!("{base}/evolution/{id}/question")).header("x-simtra-workspace","owner").json(&question).send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    assert_eq!(answer["question"],question["question"]);assert_eq!(answer["tick"],0);assert!((answer["shares"]["yes"].as_f64().unwrap()-1.0).abs()<1e-9);
    let recorded:Value=http.get(format!("{base}/evolution/{id}")).header("x-simtra-workspace","owner").send().await.unwrap().json().await.unwrap();
    assert_eq!(recorded["frames"],original["frames"]);assert_eq!(recorded["events"],json!([posted]));assert_eq!(recorded["questions"],json!([answer]));
    let question_request=requests.lock().unwrap().last().unwrap().clone();let context:Value=serde_json::from_str(question_request["state"].as_str().unwrap()).unwrap();
    assert_eq!(context["day"],0);assert_eq!(context["updates"],json!([]));
    let frozen:Value=serde_json::from_str(context["frozen_research_context"].as_str().unwrap()).unwrap();
    assert_eq!(frozen["verified_news_background"],pinned_news);
    let stepped:Value=http.post(format!("{base}/evolution/{id}/step")).header("x-simtra-workspace","owner").json(&json!({"expected_tick":0})).send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    assert_eq!(stepped["frame"]["tick"],1);
    let step_request=requests.lock().unwrap().last().unwrap().clone();let context:Value=serde_json::from_str(step_request["state"].as_str().unwrap()).unwrap();assert_eq!(context["updates"],json!([posted]));
    let frozen:Value=serde_json::from_str(context["frozen_research_context"].as_str().unwrap()).unwrap();
    assert_eq!(frozen["verified_news_background"],pinned_news,"Timeline keeps exact research news background");
    let stale=http.post(format!("{base}/evolution/{id}/event")).header("x-simtra-workspace","owner").json(&json!({"text":"Another shop introduces a discount","expected_tick":0})).send().await.unwrap();assert_eq!(stale.status(),400);
    server.abort();provider.abort();
}
