//! Complete data-pipeline HTTP flow against a local typed Jev fixture only.
//! No live service, scenario engine, population sampling, or paid calls.
use axum::{routing::post, Json, Router};
use serde_json::{json, Value};
use simfrancisco::{
    audience_api::{router, ResearchState},
    model::{Cache, ModelClient},
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

#[tokio::test]
async fn grounded_personas_cache_replay_and_invalid_provider_fail_closed() {
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let provider = Router::new().route("/v1/systemone", post(move |Json(body): Json<Value>| {
        let seen = seen.clone();
        async move {
            seen.fetch_add(1,Ordering::SeqCst);
            if body["state"]["business"] == "Malformed" {
                return Json(json!({"model":"jev-1.13.0","answers":{}}));
            }
            let mut answers = serde_json::Map::new();
            for (id, question) in body["questions"].as_object().unwrap() {
                let index: usize = id.split('_').nth(1).unwrap().parse().unwrap();
                let excerpt = &body["state"]["excerpts"][index];
                assert!(excerpt["source_kind"].as_str().unwrap().contains("interview"));
                let employee = excerpt["excerpt"].as_str().unwrap().contains("employee");
                let selected = if id.starts_with("relevance_") {
                    if employee { "irrelevant" } else { "relevant" }
                } else if id.starts_with("category_") || id.ends_with("_price_sensitivity") {
                    "price_high"
                } else if id.ends_with("_purchase_frequency") {
                    "frequency_frequent"
                } else if id.ends_with("_alternatives") {
                    "alternative_competitor"
                } else { "unknown" };
                let probabilities: serde_json::Map<String, Value> = question["criteria"].as_object().unwrap().keys()
                    .map(|key| (key.clone(), json!(if key == selected { 1.0 } else { 0.0 }))).collect();
                answers.insert(id.clone(),json!({"type":"choice","choice":selected,"confidence":1.0,"probabilities":probabilities}));
            }
            Json(json!({"model":"jev-1.13.0","answers":answers,"usage":{"input_tokens":1,"output_tokens":1}}))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    std::env::set_var(
        "TYPESAFE_BASE_URL",
        format!("http://{}", listener.local_addr().unwrap()),
    );
    std::env::set_var("TYPESAFE_API_KEY", "local-audience-fixture");
    std::env::set_var("MODEL_OFFLINE", "0");
    std::env::set_var("JEV_MODEL", "jev-1.13.0");
    let provider_task = tokio::spawn(async move { axum::serve(listener, provider).await.unwrap() });
    let dir = tempfile::tempdir().unwrap();
    let cache = Cache::open(dir.path().join("cache.db").to_str().unwrap()).unwrap();
    let client = ModelClient::from_env(Some(Arc::new(cache))).unwrap();
    let state = ResearchState::new(client, dir.path().join("panels.db").to_str().unwrap()).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let api_task = tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
    let http = reqwest::Client::new();
    let customer =
        "I buy Chipotle every week, but I compare the price to Qdoba before choosing lunch.";
    let input = json!({
        "question":"Which customer buying criteria matter to Chipotle pricing?",
        "business":"Chipotle","location":"San Francisco","discover":false,"panel_size":4,
        "sources":[
            {"kind":"interview","title":"Consented customer interview","text":customer},
            {"kind":"interview","title":"Staff interview","text":"I am an employee at Chipotle and wish my weekly pay was higher."}
        ]
    });
    let response = http
        .post(format!("{base}/audience-research/panels"))
        .json(&input)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 201);
    let first: Value = response.json().await.unwrap();
    assert_eq!(first["status"], "draft");
    assert_eq!(
        first["personas"].as_array().unwrap().len(),
        1,
        "employee is not a customer persona; requested size is not padding"
    );
    let attributes = first["personas"][0]["attributes"].as_array().unwrap();
    for key in ["price_sensitivity", "purchase_frequency", "alternatives"] {
        let attribute = attributes.iter().find(|a| a["key"] == key).unwrap();
        assert_eq!(attribute["provenance"], "inferred");
        assert_eq!(attribute["evidence"][0]["excerpt"], customer);
    }
    let quote = attributes
        .iter()
        .find(|a| a["key"] == "customer_statement")
        .unwrap();
    assert_eq!(quote["value"], customer);
    assert_eq!(quote["provenance"], "sourced");
    assert!(first.get("p_yes").is_none());
    assert!(first.get("weights").is_none());
    let replay: Value = http
        .post(format!("{base}/audience-research/panels"))
        .json(&input)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "exact rerun must use validated Jev cache"
    );
    assert_eq!(
        replay, first,
        "exact replay should reuse immutable saved version"
    );
    let mut malformed = input;
    malformed["business"] = json!("Malformed");
    let failed: Value = http
        .post(format!("{base}/audience-research/panels"))
        .json(&malformed)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(failed["status"], "needs_evidence");
    assert!(failed["personas"].as_array().unwrap().is_empty());
    assert!(failed["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|w| w.as_str().unwrap().contains("unavailable")));
    assert_eq!(failed["sources"].as_array().unwrap().len(), 2);
    api_task.abort();
    provider_task.abort();
}
