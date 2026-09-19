//! Typed question-context fixture; no paid provider or web-search calls.
use axum::{routing::post, Json, Router};
use serde_json::{json, Value};
use simfrancisco::{
    audience_context::identify,
    model::{Cache, ModelClient},
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

#[tokio::test]
async fn identifies_exact_business_audience_and_market_without_text_generation() {
    let calls = Arc::new(AtomicUsize::new(0));
    let count = calls.clone();
    let provider = Router::new().route("/v1/systemone", post(move |Json(body): Json<Value>| {
        let count = count.clone();
        async move {
            count.fetch_add(1, Ordering::SeqCst);
            let named = body["state"]["question"].as_str().unwrap().contains("Chipotle");
            let mut answers = serde_json::Map::new();
            for (id, question) in body["questions"].as_object().unwrap() {
                let selected = match (id.as_str(), named) {
                    ("business_start" | "business_end", true) => "1",
                    ("audience_start", true) => "1", ("audience_end", true) => "2",
                    ("market_start", true) => "4", ("market_end", true) => "5",
                    ("topic", _) => "pricing", _ => "unknown",
                };
                let probabilities: serde_json::Map<String, Value> = question["criteria"].as_object().unwrap().keys()
                    .map(|key| (key.clone(),json!(if key == selected {1.0} else {0.0}))).collect();
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
    std::env::set_var("TYPESAFE_API_KEY", "local-context-fixture");
    std::env::set_var("MODEL_OFFLINE", "0");
    std::env::set_var("JEV_MODEL", "jev-1.13.0");
    let task = tokio::spawn(async move { axum::serve(listener, provider).await.unwrap() });
    let dir = tempfile::tempdir().unwrap();
    let cache = Arc::new(Cache::open(dir.path().join("cache.db").to_str().unwrap()).unwrap());
    let client = ModelClient::from_env(Some(cache)).unwrap();
    let raw = "Would Chipotle customers in Los Angeles prefer cheaper meals?";
    let context = identify(&client, raw, "San Francisco").await.unwrap();
    assert_eq!(context.business.value.as_deref(), Some("Chipotle"));
    assert_eq!(context.business.excerpt.as_deref(), Some("Chipotle"));
    assert_eq!(context.business.provenance, "inferred");
    assert_eq!(
        context.audience.value.as_deref(),
        Some("Chipotle customers")
    );
    assert_eq!(context.market.value.as_deref(), Some("Los Angeles"));
    assert_eq!(context.requested_market, "San Francisco");
    assert_eq!(context.topic.value.as_deref(), Some("pricing"));
    identify(&client, raw, "San Francisco").await.unwrap();
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "identical questions reuse the typed-model cache"
    );
    let unknown = identify(
        &client,
        "Would my customers prefer cheaper meals?",
        "San Francisco",
    )
    .await
    .unwrap();
    assert!(unknown.business.value.is_none());
    assert!(unknown.audience.value.is_none());
    assert_eq!(unknown.market.value.as_deref(), Some("San Francisco"));
    assert_eq!(unknown.market.provenance, "inferred");
    task.abort();
}
