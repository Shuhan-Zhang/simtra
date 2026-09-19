//! Real HTTP + native Jev transport, using only a loopback fixture.
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn research_holds_context_and_population_constant_and_returns_inherited_answers() {
    std::env::set_current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .unwrap();
    let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
    let captured = seen.clone();
    let fixture = axum::Router::new().route("/v1/systemone", axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
        let captured = captured.clone();
        async move {
            captured.lock().unwrap().push(body.clone());
            if body["state"]["description"].as_str().unwrap_or("").contains("FAIL_SCENARIO") {
                return (axum::http::StatusCode::BAD_REQUEST, axum::Json(json!({"error":"fixture failure"})));
            }
            let price = body["state"]["description"].as_str().unwrap_or("").contains("$12");
            let p = if price { 0.35 } else { 0.65 };
            let mut answers = serde_json::Map::new();
            for (id, q) in body["questions"].as_object().unwrap() {
                let keys: Vec<_> = q["criteria"].as_object().unwrap().keys().collect();
                let selected = if id == "design" { "launch" } else if id == "measure" { "trial" } else { keys[0].as_str() };
                let probabilities: serde_json::Map<String,Value> = keys.iter().enumerate().map(|(i, k)| {
                    let value = if id.starts_with("answer_") { if i == 0 { p } else { 1.0 - p } } else if k.as_str() == selected { 1.0 } else { 0.0 };
                    ((*k).clone(), json!(value))
                }).collect();
                answers.insert(id.clone(), json!({"type":"choice", "choice":selected,"probabilities":probabilities,"confidence":1.0}));
            }
            (axum::http::StatusCode::OK, axum::Json(json!({"model":"jev-1.13.0","answers":answers})))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    std::env::set_var(
        "TYPESAFE_BASE_URL",
        format!("http://{}", listener.local_addr().unwrap()),
    );
    std::env::set_var("TYPESAFE_API_KEY", "local-research-fixture");
    std::env::set_var("MODEL_OFFLINE", "0");
    for key in [
        "NEO4J_URI",
        "HYDRA_DB_KEY",
        "HYDRA_DB_API_KEY",
        "INSFORGE_API_KEY",
        "INSFORGE_ADMIN_KEY",
        "SF_PUMS_PATH",
        "JEV_MODEL",
    ] {
        std::env::remove_var(key);
    }
    let provider = tokio::spawn(async move {
        axum::serve(listener, fixture).await.unwrap();
    });
    let dir = tempfile::tempdir().unwrap();
    let mut state = simfrancisco::api::build_state(
        "tiles.db",
        Some(dir.path().join("cache.db").to_str().unwrap()),
        dir.path().join("state.db").to_str().unwrap(),
    )
    .unwrap();
    state.hydra = None;
    state.engine.hydra = None;
    state.insforge = None;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, simfrancisco::api::router(state))
            .await
            .unwrap();
    });
    let c = reqwest::Client::new();
    let plan: Value = c.post(format!("{base}/cities/sf/experiment-plan"))
        .json(&json!({"question":"I have 5000 dollars to launch a food marketplace in SF. Where and what offer?"}))
        .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    assert_eq!(plan["kind"], "launch");
    assert_eq!(plan["trace"]["provider_requests"], 1);
    assert_eq!(plan["trace"]["cache_hits"], 0);
    assert_eq!(plan["measure"], "trial");
    assert_eq!(plan["locations"].as_array().unwrap().len(), 2);
    assert_ne!(plan["locations"][0], plan["locations"][1]);
    {
        let mut requests = seen.lock().unwrap();
        assert_eq!(
            requests.len(),
            1,
            "planning makes one typed evaluation only"
        );
        assert!(
            requests[0]["state"]["residents"].is_null(),
            "planning must not poll residents"
        );
        requests.clear();
    }
    assert_eq!(
        c.post(format!("{base}/cities/sf/experiment-plan"))
            .json(&json!({"question":""}))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        c.post(format!("{base}/cities/missing/experiment-plan"))
            .json(&json!({"question":"launch?"}))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert!(seen.lock().unwrap().is_empty());
    let sim: Value = c
        .post(format!("{base}/simulations"))
        .json(&json!({"city":"sf","n":24,"seed":42,"filters":{"age":35}}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let bid = sim["main_branch"].as_str().unwrap();
    let input = json!({"question":"Would you buy once in the next month?", "assumptions":"Same portion and quality", "options":["Would buy","Would not buy"], "as_of_date":"2026-09-19", "model":"jev-1.13.0", "scenarios":[{"label":"Current","description":"Burrito $10"},{"label":"Increase","description":"Burrito $12"}]});
    let response = c
        .post(format!("{base}/branches/{bid}/research"))
        .json(&input)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let result: Value = response.json().await.unwrap();
    let requests = seen.lock().unwrap().len();
    assert_eq!(result["trace"]["provider_requests"], requests);
    assert_eq!(result["trace"]["cache_hits"], 0);
    let events = result["trace"]["events"].as_array().unwrap();
    assert_eq!(events.iter().filter(|e| e["kind"] == "scenario.completed").count(), 2);
    assert!(events.iter().all(|e| e["run_id"] == result["trace"]["run_id"]));
    let log = result["trace"].to_string();
    for secret in ["local-research-fixture", "Burrito $10", "Resident profiles", "Bearer"] { assert!(!log.contains(secret)); }
    assert_eq!(result["context_policy"], "explicit_assumptions_only");
    let scenarios = result["scenarios"].as_array().unwrap();
    assert_eq!(scenarios.len(), 2);
    for (i, s) in scenarios.iter().enumerate() {
        assert_eq!(s["result"]["n_agents"], 24);
        assert_eq!(s["result"]["memory_test_id"], Value::Null);
        assert_eq!(s["result"]["evidence"]["claim_class"], "simulated_estimate");
        let p = s["result"]["p_distribution"][0][1].as_f64().unwrap();
        assert!((p - if i == 0 { 0.65 } else { 0.35 }).abs() < 1e-9);
        let ids: Vec<u64> = s["response_groups"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|g| {
                g["agent_ids"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|id| id.as_u64().unwrap())
            })
            .collect();
        assert_eq!(ids.len(), 24);
        assert_eq!(
            ids.iter().collect::<std::collections::HashSet<_>>().len(),
            24
        );
    }
    {
        let requests = seen.lock().unwrap();
        assert!(requests.len() >= 2);
        let half = requests.len() / 2;
        for i in 0..half {
            assert_eq!(
                requests[i]["state"]["residents"],
                requests[i + half]["state"]["residents"]
            );
        }
        for r in requests.iter() {
            assert_eq!(r["state"]["news"], "");
            assert_eq!(r["state"]["evidence"], "");
            assert_eq!(r["state"]["event"], Value::Null);
            assert!(!r["state"]["residents"].to_string().contains(" Memory: "));
        }
    }
    let mut bad = input.clone();
    // Exact replay streams real cache events, not fabricated model progress.
    let stream = c.post(format!("{base}/branches/{bid}/research/stream")).json(&input).send().await.unwrap();
    assert_eq!(stream.headers()["content-type"], "application/x-ndjson");
    let body = stream.text().await.unwrap();
    let messages: Vec<Value> = body.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(messages[0]["type"], "log");
    let replay = &messages.last().unwrap()["data"];
    assert_eq!(replay["trace"]["provider_requests"], 0);
    assert_eq!(replay["trace"]["cache_hits"], requests);
    assert_ne!(replay["trace"]["run_id"], result["trace"]["run_id"]);
    assert_eq!(seen.lock().unwrap().len(), requests);
    assert_eq!(replay["scenarios"], result["scenarios"]);
    bad["scenarios"][1]["description"] = json!("FAIL_SCENARIO");
    let failed_stream = c.post(format!("{base}/branches/{bid}/research/stream")).json(&bad).send().await.unwrap().text().await.unwrap();
    let failures: Vec<Value> = failed_stream.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(failures.last().unwrap()["type"], "error");
    assert!(failures.iter().all(|e| e["type"] != "result"));
    assert!(failures.iter().any(|e| e["event"]["kind"] == "model.failed"));
    assert_eq!(
        c.post(format!("{base}/branches/{bid}/research"))
            .json(&bad)
            .send()
            .await
            .unwrap()
            .status(),
        502
    );
    let count = seen.lock().unwrap().len();
    bad["scenarios"][1] = bad["scenarios"][0].clone();
    assert_eq!(
        c.post(format!("{base}/branches/{bid}/research"))
            .json(&bad)
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        seen.lock().unwrap().len(),
        count,
        "invalid inputs must not spend model calls"
    );
    let mut factorial = input.clone();
    factorial["scenarios"] = json!((0..84).map(|i| json!({"label":format!("Combination {i}"),"description":format!("Restaurant area {}, format {}, price change {}%", i/42, (i/21)%2, i%21)})).collect::<Vec<_>>());
    let combinations: Value = c
        .post(format!("{base}/branches/{bid}/research"))
        .json(&factorial)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(combinations["scenarios"].as_array().unwrap().len(), 84);
    assert_eq!(combinations["trace"]["events"].as_array().unwrap().iter().filter(|e| e["kind"]=="scenario.completed").count(), 84);
    factorial["scenarios"]
        .as_array_mut()
        .unwrap()
        .push(json!({"label":"Eighty-fifth","description":"Exceeds bounded design"}));
    let count = seen.lock().unwrap().len();
    assert_eq!(
        c.post(format!("{base}/branches/{bid}/research"))
            .json(&factorial)
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(seen.lock().unwrap().len(), count);
    // Missing credentials must fail before a network request and explain why.
    std::env::remove_var("TYPESAFE_API_KEY");
    std::env::remove_var("JEV_API_KEY");
    let no_key = simfrancisco::ModelClient::from_env(None).unwrap();
    let trace = simfrancisco::execution::Trace::new(None);
    let questions = std::collections::BTreeMap::from([("ready".into(), simfrancisco::jev::Question::noul("Ready?"))]);
    assert!(trace.scope(no_key.evaluate(simfrancisco::Model::default_live(), json!("test"), questions)).await.is_err());
    assert_eq!(trace.snapshot()["provider_requests"], 0);
    assert_eq!(trace.snapshot()["events"][0]["kind"], "model.failed");
    assert!(trace.snapshot()["events"][0]["message"].as_str().unwrap().contains("TYPESAFE_API_KEY"));
    server.abort();
    provider.abort();
}
