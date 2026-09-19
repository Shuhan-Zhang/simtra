//! Frozen internet research is workspace scoped and must not change Census weights.
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn pinned_research_reaches_comparisons_and_preserves_population() {
    std::env::set_current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
    let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
    let captured = seen.clone();
    let fixture = axum::Router::new().route("/v1/systemone", axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
        let captured = captured.clone();
        async move {
            captured.lock().unwrap().push(body.clone());
            let mut answers = serde_json::Map::new();
            for (id, q) in body["questions"].as_object().unwrap() {
                let keys: Vec<_> = q["criteria"].as_object().unwrap().keys().collect();
                let probabilities: serde_json::Map<String, Value> = keys.iter().map(|k| ((*k).clone(), json!(1.0 / keys.len() as f64))).collect();
                answers.insert(id.clone(), json!({"type":"choice","choice":keys[0],"probabilities":probabilities,"confidence":1.0}));
            }
            axum::Json(json!({"model":"jev-1.13.0","answers":answers}))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    std::env::set_var("TYPESAFE_BASE_URL", format!("http://{}", listener.local_addr().unwrap()));
    std::env::set_var("TYPESAFE_API_KEY", "local-context-fixture");
    std::env::set_var("MODEL_OFFLINE", "0");
    for key in ["NEO4J_URI", "HYDRA_DB_KEY", "HYDRA_DB_API_KEY", "INSFORGE_API_KEY", "INSFORGE_ADMIN_KEY", "SF_PUMS_PATH", "JEV_MODEL"] { std::env::remove_var(key); }
    let provider = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap(); });
    let dir = tempfile::tempdir().unwrap();
    let mut state = simfrancisco::api::build_state("tiles.db", Some(dir.path().join("cache.db").to_str().unwrap()), dir.path().join("state.db").to_str().unwrap()).unwrap();
    state.hydra = None;
    state.engine.hydra = None;
    state.insforge = None;
    let panel: simfrancisco::audience_pipeline::Panel = serde_json::from_value(json!({
        "schema_version":1,"id":"chipotle-test","version":1,"created_at":"2026-09-19T00:00:00Z",
        "question":"Raise Chipotle bowl prices in SF", "business":"Chipotle", "location":"San Francisco", "status":"draft",
        "sources":[{"id":"s1","url":"https://example.test/menu","title":"Menu research","text":"FROZEN_RESEARCH_MARKER: some buyers seek affordable lunch.","kind":"web","retrieved_at":"2026-09-19T00:00:00Z","content_hash":"fixture"}],
        "personas":[{"id":"p1","label":"Price conscious","attributes":[{"key":"price_sensitivity","value":"high","provenance":"inferred","evidence":[{"source_id":"s1","excerpt":"affordable lunch"}]}]}],
        "conflicts":[],"gaps":["No measured purchase behavior"],"warnings":[],"methodology":"fixture","content_hash":""
    })).unwrap();
    let store = state.audience_research.panels.in_workspace("context-owner");
    let first = store.save(panel).unwrap();
    let reference = json!({"id":first.id,"version":first.version,"content_hash":first.content_hash});
    let mut revision = first.clone();
    revision.sources[0].text = "NEW_VERSION_MARKER".into();
    let second = store.save(revision).unwrap();
    let mut incomplete = first.clone();
    incomplete.id = "incomplete-panel".into();
    incomplete.status = "needs_evidence".into();
    incomplete.personas.clear();
    let incomplete = store.save(incomplete).unwrap();
    assert_eq!(second.version, 2);
    let mut headers = axum::http::HeaderMap::new();
    headers.insert("x-simtra-workspace", "context-owner".parse().unwrap());
    let reference_typed = serde_json::from_value(reference.clone()).unwrap();
    let context = state.audience_research.context_for(&headers, &reference_typed).unwrap();
    assert!(context.contains("FROZEN_RESEARCH_MARKER"));
    assert!(!context.contains("NEW_VERSION_MARKER"));
    assert!(context.contains("Census personas and weights remain fixed"));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, simfrancisco::api::router(state)).await.unwrap(); });
    let http = reqwest::Client::new();
    let sim: Value = http.post(format!("{base}/simulations")).json(&json!({"city":"sf","n":24,"seed":42})).send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    let bid = sim["main_branch"].as_str().unwrap();
    let sid = sim["simulation_id"].as_str().unwrap();
    let before: Value = http.get(format!("{base}/simulations/{sid}/demographics")).send().await.unwrap().json().await.unwrap();
    let input = json!({"question":"Would you buy a bowl?","assumptions":"Same bowl and quality","options":["Buy","Do not buy"],"as_of_date":"2026-09-19","model":"jev-1.13.0","research_panel":reference,"research_context":"CLIENT_INJECTION_MUST_BE_IGNORED","news_context":"CLIENT_NEWS_MUST_BE_IGNORED","scenarios":[{"label":"Current","description":"Current bowl price"},{"label":"Increase","description":"Bowl price increased 10 percent"}]});
    // Every invalid pin fails before any paid model work, for both transports.
    for suffix in ["research", "research/stream"] {
        for case in 0..4 {
            let mut bad = input.clone();
            let workspace = if case == 0 { "another-workspace" } else { "context-owner" };
            if case == 1 { bad["research_panel"]["version"] = json!(999); }
            if case == 2 { bad["research_panel"]["content_hash"] = json!("wrong-hash"); }
            if case == 3 { bad["research_panel"] = json!({"id":incomplete.id,"version":incomplete.version,"content_hash":incomplete.content_hash}); }
            let response = http.post(format!("{base}/branches/{bid}/{suffix}")).header("x-simtra-workspace", workspace).json(&bad).send().await.unwrap();
            assert_eq!(response.status(), 400, "pin case {case}, {suffix}");
        }
    }
    assert!(seen.lock().unwrap().is_empty());
    let result: Value = http.post(format!("{base}/branches/{bid}/research")).header("x-simtra-workspace", "context-owner").json(&input).send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    assert_eq!(result["scenarios"].as_array().unwrap().len(), 2);
    let expected_news = simfrancisco::news::prompt_block_at("sf", "2026-09-19");
    assert!(!expected_news.is_empty(), "Curated September demo news is available");
    assert_eq!(result["news_context"], expected_news);
    assert_eq!(result["pinned_news"], true);
    let articles: Vec<Value> = serde_json::from_str(expected_news.split_once('\n').unwrap().1).unwrap();
    assert!(articles.iter().all(|a| a["published"].as_str().is_some_and(|d| d >= "2026-09-12" && d <= "2026-09-19")));
    let count;
    {
        let requests = seen.lock().unwrap();
        count = requests.len();
        assert!(count >= 2 && count <= 24, "bounded archetype batching, never per resident");
        for request in requests.iter() {
            let description = request["state"]["description"].as_str().unwrap();
            assert!(description.contains("FROZEN_RESEARCH_MARKER"));
            assert!(!description.contains("NEW_VERSION_MARKER"));
            assert!(!description.contains("CLIENT_INJECTION_MUST_BE_IGNORED"));
            assert!(description.contains("untrusted evidence"));
            assert!(!description.contains("CLIENT_NEWS_MUST_BE_IGNORED"));
            assert!(description.contains(&serde_json::to_string(&expected_news).unwrap()));
        }
        for i in 0..count / 2 { assert_eq!(requests[i]["state"]["residents"], requests[i + count / 2]["state"]["residents"]); }
    }
    assert_eq!(result["trace"]["provider_requests"], count);
    let after: Value = http.get(format!("{base}/simulations/{sid}/demographics")).send().await.unwrap().json().await.unwrap();
    assert_eq!(before["n_agents"], after["n_agents"]);
    assert_eq!(before["total_weight"], after["total_weight"]);
    for (key, value) in before["variables"].as_object().unwrap() {
        assert_eq!(value["empirical"], after["variables"][key]["empirical"], "Research must not mutate Census demographic marginals");
    }
    let stream = http.post(format!("{base}/branches/{bid}/research/stream")).header("x-simtra-workspace", "context-owner").json(&input).send().await.unwrap().error_for_status().unwrap().text().await.unwrap();
    let events: Vec<Value> = stream.lines().map(|s| serde_json::from_str(s).unwrap()).collect();
    let replay = &events.last().unwrap()["data"];
    assert_eq!(replay["scenarios"], result["scenarios"]);
    assert_eq!(replay["news_context"], result["news_context"]);
    assert_eq!(replay["trace"]["provider_requests"], 0);
    assert_eq!(seen.lock().unwrap().len(), count);
    server.abort();
    provider.abort();
}
