// Local-only integration fixture helper. See INTEGRATION-EVIDENCE.md.
#[tokio::main]
async fn main() {
    let fixture = axum::Router::new().route("/v1/systemone", axum::routing::post(|axum::Json(body): axum::Json<serde_json::Value>| async move {
        use serde_json::{json, Map, Value};
        let mut answers = Map::new();
        for (id, question) in body["questions"].as_object().unwrap() {
            let answer = match question["type"].as_str().unwrap() {
                "noul" => json!({"type":"noul","noul":0.6}),
                "score" => {
                    let levels = question["criteria"].as_array().unwrap();
                    let probabilities: Map<String, Value> = levels.iter().enumerate().map(|(i,_)| (i.to_string(), json!(if i == 2 { 1.0 } else { 0.0 }))).collect();
                    let legend: Map<String, Value> = levels.iter().enumerate().map(|(i,v)| (i.to_string(),v.clone())).collect();
                    json!({"type":"score","score":2.0,"probabilities":probabilities,"legend":legend,"confidence":1.0})
                },
                "choice" => {
                    let criteria = question["criteria"].as_object().unwrap();
                    let selected = if id == "route" {
                        if body["state"]["candidate_options"].as_array().map_or(0, Vec::len) >= 2 { "explicit_options" } else { "vote" }
                    } else if id == "design" {
                        let q = body["state"]["decision"].as_str().unwrap_or("").to_lowercase();
                        if q.contains("price") { "price" } else if q.contains("launch") { "launch" } else { "compare" }
                    } else if id == "measure" { "trial" }
                    else { criteria.keys().next().unwrap().as_str() };
                    let probabilities: Map<String, Value> = criteria.keys().map(|k| (k.clone(),json!(if k == selected { 1.0 } else { 0.0 }))).collect();
                    json!({"type":"choice","choice":selected,"probabilities":probabilities,"confidence":1.0})
                },
                _ => panic!("unsupported fixture question"),
            };
            answers.insert(id.clone(), answer);
        }
        axum::Json(json!({"model":"jev-1.13.0","answers":answers,"usage":{"input_tokens":0,"output_tokens":0}}))
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let model_url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap(); });
    std::env::set_var("MODEL_OFFLINE", "0");
    std::env::set_var("MODEL_FIXTURE", "1");
    std::env::set_var("TYPESAFE_API_KEY", "local-fixture");
    std::env::set_var("TYPESAFE_BASE_URL", &model_url);
    std::env::set_var("JEV_MODEL", "jev-1.13.0");
    for key in ["ANTHROPIC_API_KEY", "MODEL_API_KEY", "JEV_API_KEY", "NEO4J_URI", "HYDRA_DB_KEY", "HYDRA_DB_API_KEY", "SF_PUMS_PATH", "INSFORGE_API_KEY", "INSFORGE_ADMIN_KEY", "ROCKETRIDE_WEBHOOK_URL", "ROCKETRIDE_URL", "NEWS_API_KEY", "NEWS_REFRESH_HOURS"] { std::env::remove_var(key); }
    let dir = std::env::var("SIMTRA_FIXTURE_DIR").expect("temporary fixture directory");
    let cache = format!("{dir}/cache.db");
    let store = format!("{dir}/state.db");
    let mut state = simfrancisco::api::build_state("tiles.db", Some(&cache), &store).unwrap();
    state.hydra = None; state.engine.hydra = None; state.insforge = None; state.rocketride = None;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:5188").await.unwrap();
    println!("Local fixture API listening on 5188");
    axum::serve(listener, simfrancisco::api::router(state)).await.unwrap();
}
