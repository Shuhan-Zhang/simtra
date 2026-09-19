//! Resident narrative uses sparse Gemini batches; quantitative models stay Jev.
use serde_json::{json,Value};
use std::sync::{Arc,Mutex};
#[tokio::test]
async fn gemini_voices_are_batched_grounded_cached_and_never_template_fallbacks() {
    std::env::set_current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
    let seen=Arc::new(Mutex::new(Vec::<Value>::new()));let captured=seen.clone();
    let fixture=axum::Router::new().route("/v1beta/models/voice-fixture:generateContent",axum::routing::post(move |headers:axum::http::HeaderMap,axum::Json(body):axum::Json<Value>| {
        let captured=captured.clone();async move {
            assert_eq!(headers["x-goog-api-key"],"fixture-secret");
            assert!(headers.get("authorization").is_none());
            captured.lock().unwrap().push(body);
            axum::Json(json!({"candidates":[{"content":{"parts":[{"thought":true,"text":"hidden"},{"text":"[{\"i\":1,\"t\":\"Need an affordable lunch today.\",\"s\":\"worried\"},{\"i\":0,\"t\":\"The bus should arrive soon.\",\"s\":\"neutral\"},{\"i\":1,\"t\":\"duplicate\"},{\"i\":99,\"t\":\"unknown\"}]"}]}}]}))
        }
    }));
    let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    std::env::set_var("GEMINI_VOICE_API_URL",format!("http://{}/v1beta/models/voice-fixture:generateContent",listener.local_addr().unwrap()));
    std::env::set_var("GEMINI_API_KEY","fixture-secret");std::env::set_var("GEMINI_MODEL","gemini-3.5-flash-lite");std::env::set_var("MODEL_OFFLINE","0");
    let provider=tokio::spawn(async move{axum::serve(listener,fixture).await.unwrap();});
    let dir=tempfile::tempdir().unwrap();
    let cache=Arc::new(simfrancisco::model::Cache::open(dir.path().join("cache.db").to_str().unwrap()).unwrap());
    let client=simfrancisco::ModelClient::from_env(Some(cache)).unwrap();
    assert!(client.has_voice_provider());
    assert!(simfrancisco::predict::default_live_model().is_jev());
    let engine=simfrancisco::predict::Engine::new(client);
    let pop=simfrancisco::persona::build_population(&simfrancisco::pums::load_sf().unwrap(),24,42,None);
    let ids=vec![9,3,9];
    let first=engine.chatter(&pop,&ids).await;
    assert_eq!(first,vec![(9,"Need an affordable lunch today.".into()),(3,"The bus should arrive soon.".into())]);
    assert_eq!(engine.chatter(&pop,&ids).await,first);
    assert_eq!(seen.lock().unwrap().len(),1);
    let reactions=engine.react_to_event(&pop,"Bowl prices rise","2026-09-19",&ids).await;
    assert_eq!(reactions.len(),2);assert_eq!(reactions[0].0,9);assert_eq!(reactions[1].0,3);
    assert_eq!(engine.react_to_event(&pop,"Bowl prices rise","2026-09-19",&ids).await,reactions);
    assert_eq!(seen.lock().unwrap().len(),2);
    let many:Vec<_>=(0..24).collect();engine.chatter(&pop,&many).await;
    let requests=seen.lock().unwrap();assert_eq!(requests.len(),3);
    for req in requests.iter(){
        assert_eq!(req["generationConfig"]["responseMimeType"],"application/json");
        assert!(req["generationConfig"]["maxOutputTokens"].as_u64().unwrap()<=4096);
        assert!(req["system_instruction"]["parts"][0]["text"].as_str().unwrap().contains("synthetic"));
        assert!(!req.to_string().contains("fixture-secret"));
    }
    let context=requests[1]["contents"][0]["parts"][0]["text"].as_str().unwrap();
    assert!(context.contains(&pop.agents[3].persona));assert!(context.contains(&pop.agents[9].persona));
    assert!(context.contains("2026-09-18"));assert!(context.contains("https://www.sfchronicle.com/"));
    let context=requests[2]["contents"][0]["parts"][0]["text"].as_str().unwrap();
    assert!(context.contains("15. "));assert!(!context.contains("16. "));
    drop(requests);
    std::env::remove_var("GEMINI_API_KEY");
    let no_voice=simfrancisco::predict::Engine::new(simfrancisco::ModelClient::from_env(None).unwrap());
    assert!(no_voice.chatter(&pop,&ids).await.is_empty());
    assert!(no_voice.react_to_event(&pop,"Bowl prices rise","2026-09-19",&ids).await.is_empty());
    assert_eq!(seen.lock().unwrap().len(),3);
    provider.abort();
}
