//! HTTP-to-model integration using only a local mock; no keys or paid calls.
use axum::{routing::post, Json, Router};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn location_reaches_model_and_invalid_context_stops_before_model() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::env::set_current_dir(root).unwrap();
    let bodies = Arc::new(Mutex::new(Vec::<String>::new()));
    let captured = bodies.clone();
    let fixture = Router::new().route("/v1/systemone", post(move |Json(body): Json<Value>| {
        let captured = captured.clone();
        async move {
            captured.lock().unwrap().push(body.to_string());
            let mut answers = serde_json::Map::new();
            for (id, q) in body["questions"].as_object().unwrap() {
                let answer = match q["type"].as_str().unwrap() {
                    "noul" => json!({"type":"noul","noul":0.6}),
                    "choice" => {
                        let criteria = q["criteria"].as_object().unwrap();
                        let choice = criteria.keys().next().unwrap();
                        let probabilities: serde_json::Map<String,Value> = criteria.keys().map(|k| (k.clone(),json!(if k == choice {1.0} else {0.0}))).collect();
                        json!({"type":"choice","choice":choice,"probabilities":probabilities,"confidence":1.0})
                    },
                    "score" => {
                        let criteria = q["criteria"].as_array().unwrap();
                        let probabilities: serde_json::Map<String,Value> = (0..criteria.len()).map(|i| (i.to_string(),json!(if i == 0 {1.0} else {0.0}))).collect();
                        let legend: serde_json::Map<String,Value> = (0..criteria.len()).map(|i| (i.to_string(),criteria[i].clone())).collect();
                        json!({"type":"score","score":0.0,"probabilities":probabilities,"legend":legend,"confidence":1.0})
                    },
                    other => panic!("unexpected Jev type {other}"),
                };
                answers.insert(id.clone(),answer);
            }
            Json(json!({"model":"jev-1.13.0","answers":answers,"usage":{"input_tokens":20,"output_tokens":0}}))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let model_url = format!("http://{}",listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap(); });
    std::env::set_var("MODEL_OFFLINE","0");
    std::env::set_var("TYPESAFE_API_KEY","local-fixture-only");
    std::env::set_var("TYPESAFE_BASE_URL",model_url);
    std::env::set_var("MAX_CLUSTERS","2");
    for key in ["NEO4J_URI","HYDRA_DB_KEY","HYDRA_DB_API_KEY","ROCKETRIDE_URL","ROCKETRIDE_WEBHOOK_URL","SF_PUMS_PATH"] {
        std::env::remove_var(key);
    }
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("LOCATION_DATA_DIR",dir.path());
    let source = json!({"status":"cached","retrieved_at":"2026-09-19T23:59:00Z","url":"https://example.invalid/test"});
    let area = |id: &str, name: &str, food: u64| json!({"id":id,"properties":{
        "name":name,"mapped_poi_count":food+2,"category_counts":{"food":food,"amenity":0,"shop":2,"office":0,"leisure":0,"tourism":0,"transit":0}}});
    let mut snapshot = json!({"schema_version":1,"city":"sf","sources":{"datasf":source,"osm":source},
        "areas":{"features":[area("a","Fixture Mission",3),area("b","Fixture Richmond",8)]},"food_pois":{"features":[]}});
    let path = dir.path().join("sf.json");
    std::fs::write(&path,snapshot.to_string()).unwrap();
    let mut state = simfrancisco::api::build_state("tiles.db",Some(dir.path().join("cache.db").to_str().unwrap()),dir.path().join("state.db").to_str().unwrap()).unwrap();
    state.hydra=None; state.engine.hydra=None; state.memory=None; state.engine.memory=None; state.insforge=None; state.rocketride=None;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}",listener.local_addr().unwrap());
    tokio::spawn(async move {axum::serve(listener,simfrancisco::api::router(state)).await.unwrap();});
    let client=reqwest::Client::new();
    let summary: Value = client.get(format!("{base}/cities/sf/locations/areas"))
        .send().await.unwrap().json().await.unwrap();
    assert_eq!(summary["areas"]["features"].as_array().unwrap().len(), 2);
    assert!(summary.get("pois").is_none());
    assert!(summary.get("food_pois").is_none());
    assert!(summary["areas"]["features"][0].get("geometry").is_none());
    let response=client.post(format!("{base}/simulations")).json(&json!({"n":30,"seed":42,"city":"sf","start_datetime":"2026-09-19T08:00:00Z"})).send().await.unwrap();
    assert_eq!(response.status(),201);
    let sim: Value=response.json().await.unwrap();
    let url=format!("{base}/branches/{}/poll",sim["main_branch"].as_str().unwrap());
    let request=|id:&str,date:&str|json!({"question":"Should we launch?","description":"Original strategy","framing":"belief","as_of_date":date,"model":"jev-1.13.0","location_area_id":id});
    for (id,name,total) in [("a","Fixture Mission",5),("b","Fixture Richmond",10)] {
        bodies.lock().unwrap().clear();
        let response=client.post(&url).json(&request(id,"2026-09-19")).send().await.unwrap();
        let status=response.status();let result:Value=response.json().await.unwrap();
        assert_eq!(status,200,"{result}");
        assert_eq!(result["question"],"Should we launch?");
        assert_eq!(result["location_context"]["area_name"],name);
        assert_eq!(result["location_context"]["mapped_poi_count"],total);
        let prompts=bodies.lock().unwrap().join("\n");
        assert!(prompts.contains("jev-1.13.0"));
        assert!(prompts.contains(name),"area must reach actual outgoing model body");
        assert!(prompts.contains("Original strategy"));
        assert!(prompts.contains("not filtered to this neighborhood"));
    }
    let before=bodies.lock().unwrap().len();
    for payload in [request("unknown","2026-09-19"),request("a","2026-09-18"),json!({"question":"Q","location_area_id":12})] {
        let response=client.post(&url).json(&payload).send().await.unwrap();
        assert_eq!(response.status(),400);
        assert_eq!(bodies.lock().unwrap().len(),before);
    }
    snapshot["sources"]["osm"]["status"]=json!("unavailable");
    std::fs::write(path,snapshot.to_string()).unwrap();
    let response=client.post(&url).json(&request("a","2026-09-19")).send().await.unwrap();
    assert_eq!(response.status(),400);
    assert_eq!(bodies.lock().unwrap().len(),before);
    // Original unscoped API remains functional even when geographic source is unavailable.
    let mut unscoped=request("a","2026-09-19");unscoped.as_object_mut().unwrap().remove("location_area_id");
    let response=client.post(&url).json(&unscoped).send().await.unwrap();
    assert_eq!(response.status(),200);
    let result:Value=response.json().await.unwrap();assert!(result.get("location_context").is_none());
}
