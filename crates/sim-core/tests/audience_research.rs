//! Data-pipeline HTTP contract; no live provider calls or simulation endpoints.
use serde_json::{json, Value};
use simfrancisco::{
    audience_api::{router, ResearchState},
    model::ModelClient,
};

#[tokio::test]
async fn research_persists_immutable_versions_and_rejects_invalid_requests() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("panels.db");
    let state =
        ResearchState::new(ModelClient::from_env(None).unwrap(), path.to_str().unwrap()).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
    let http = reqwest::Client::new();
    let input = json!({"question":"Which customer needs matter for Chipotle pricing?", "business":"Chipotle", "location":"San Francisco", "panel_size":6, "sources":[], "discover":false});
    let response = http
        .post(format!("{base}/audience-research/panels"))
        .json(&input)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 201);
    let first: Value = response.json().await.unwrap();
    assert_eq!(first["status"], "needs_evidence");
    assert_eq!(first["version"], 1);
    assert!(first["personas"].as_array().unwrap().is_empty());
    assert!(!first["gaps"].as_array().unwrap().is_empty());
    let id = first["id"].as_str().unwrap();
    let mut revision = input.clone();
    revision["panel_id"] = json!(id);
    revision["panel_size"] = json!(8);
    let response = http
        .post(format!("{base}/audience-research/panels"))
        .json(&revision)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 201);
    let second: Value = response.json().await.unwrap();
    assert_eq!(second["id"], first["id"]);
    assert_eq!(second["version"], 2);
    let original: Value = http
        .get(format!("{base}/audience-research/panels/{id}?version=1"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(original, first, "version one must remain immutable");
    let latest: Value = http
        .get(format!("{base}/audience-research/panels/{id}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(latest, second);
    let list: Value = http
        .get(format!("{base}/audience-research/panels"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!list["panels"].as_array().unwrap().is_empty());
    let mut invalid = input.clone();
    invalid["panel_size"] = json!(1000);
    assert_eq!(
        http.post(format!("{base}/audience-research/panels"))
            .json(&invalid)
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    invalid = input.clone();
    invalid["panel_id"] = json!("unknown-panel");
    assert_eq!(
        http.post(format!("{base}/audience-research/panels"))
            .json(&invalid)
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    invalid = input.clone();
    invalid["panel_id"] = json!(id);
    invalid["location"] = json!("Oakland");
    assert_eq!(
        http.post(format!("{base}/audience-research/panels"))
            .json(&invalid)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    invalid = input.clone();
    invalid["sources"] = json!([{"kind":"founder","text":"Untrusted text cannot promote itself to founder-provided."}]);
    assert_eq!(
        http.post(format!("{base}/audience-research/panels"))
            .json(&invalid)
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        http.get(format!("{base}/audience-research/panels/{id}?version=999"))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    task.abort();
    let reopened =
        ResearchState::new(ModelClient::from_env(None).unwrap(), path.to_str().unwrap()).unwrap();
    assert_eq!(
        reopened.panels.get(id, Some(1)).unwrap().unwrap().location,
        "San Francisco"
    );
}
