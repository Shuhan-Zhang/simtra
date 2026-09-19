//! Native Jev contract tests. Live calls require the explicitly ignored smoke test.
use serde_json::{json, Value};
use simfrancisco::{
    memory::TestTag,
    model::{Cache, Model, ModelClient},
    predict::{Engine, Event, Framing, Poll, Population0},
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

fn workspace() {
    std::env::set_current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .unwrap();
}

async fn features(client: ModelClient, live: bool) {
    let records = simfrancisco::pums::load_sf().unwrap();
    let pop = simfrancisco::persona::build_population(&records, 3, 42, None);
    let engine = Engine::new(client);
    let mut poll = Poll {
        question: "Would you support more frequent public transit?".into(),
        description: "A proposal for more frequent service.".into(),
        framing: Framing::Vote,
        as_of_date: "2026-09-19".into(),
        model: Some("jev-1.13.0".into()),
        population: None,
        event: None,
        options: vec![],
    };
    let first = engine.run_poll(&pop, &poll).await.unwrap();
    assert_eq!(first.model, "jev-1.13.0");
    assert_eq!(first.n_agents, 3);
    assert!((0.0..=1.0).contains(&first.p_yes));
    assert!(!first.breakdowns.is_empty());
    assert!(first
        .sample_rationales
        .iter()
        .all(|s| s.contains("Jev-selected factor")));
    let calls = engine.client.usage.snapshot().calls;
    let repeated = engine.run_poll(&pop, &poll).await.unwrap();
    assert_eq!(
        engine.client.usage.snapshot().calls,
        calls,
        "repeat must use cache"
    );
    assert_eq!(first.p_yes, repeated.p_yes);
    assert!(engine.client.usage.snapshot().cache_hits > 0);

    poll.framing = Framing::Options;
    poll.options = vec!["Bus".into(), "Train".into(), "Bicycle".into()];
    poll.question = "Which commute mode would you choose?".into();
    let options = engine.run_poll(&pop, &poll).await.unwrap();
    assert_eq!(
        options
            .p_distribution
            .iter()
            .map(|(s, _)| s)
            .collect::<Vec<_>>(),
        poll.options.iter().collect::<Vec<_>>()
    );
    assert!((options.p_distribution.iter().map(|(_, p)| p).sum::<f64>() - 1.0).abs() < 1e-6);
    poll.framing = Framing::Belief;
    poll.options.clear();
    poll.question = "Will transit ridership rise next year?".into();
    let belief = engine.run_poll(&pop, &poll).await.unwrap();
    assert!((0.0..=1.0).contains(&belief.p_yes));
    if !live {
        assert!((belief.p_yes - 0.4).abs() < 1e-6);
    }
    let ab = engine
        .run_ab_test(
            &pop,
            "Which message is more appealing?",
            "Save time on your commute.",
            "Spend less on your commute.",
            &poll.as_of_date,
            Model::Jev,
            Population0::All,
            &TestTag::poll(),
        )
        .await
        .unwrap();
    assert_eq!(ab.p_distribution.len(), 2);
    poll.framing = Framing::Vote;
    poll.question = "Would you support more frequent public transit?".into();
    let (base, exposed, delta) = engine
        .run_counterfactual(
            &pop,
            &poll,
            Event {
                text: "An advertisement highlights shorter waits with more frequent service."
                    .into(),
                as_of_date: poll.as_of_date.clone(),
            },
            &TestTag::poll(),
        )
        .await
        .unwrap();
    assert!((delta - (exposed.p_yes - base.p_yes)).abs() < 1e-9);
    let ids = vec![0, 1, 2];
    let chatter = engine.chatter(&pop, &ids).await;
    assert_eq!(chatter.len(), 3);
    assert!(chatter
        .iter()
        .all(|(_, s)| s.contains("Jev-selected template")));
    let reactions = engine
        .react_to_event(
            &pop,
            "The city proposes more frequent bus service.",
            &poll.as_of_date,
            &ids,
        )
        .await;
    assert_eq!(reactions.len(), 3);
    assert!(reactions
        .iter()
        .all(|(_, t, s)| t.contains("Jev-selected template")
            && simfrancisco::memory::SENTIMENTS.contains(&s.as_str())));
    let personal = engine
        .personal_answers(
            &pop,
            &poll.question,
            &poll.description,
            Framing::Vote,
            &[],
            &poll.as_of_date,
            &ids,
            &HashMap::new(),
        )
        .await
        .unwrap();
    assert_eq!(personal.len(), 3);
    let parsed = simfrancisco::parse::parse_question(
        &engine.client,
        "San Francisco",
        "Which commute do residents prefer: bus, train, or bicycle?",
        Model::Jev,
    )
    .await;
    assert!(parsed.supported, "{}", parsed.reason);
    assert_eq!(parsed.framing, "options");
    assert_eq!(parsed.options, vec!["bus", "train", "bicycle"]);
    println!("Jev backend: binary, options, belief, A/B, counterfactual, chatter, reactions, personal answers, router, cache passed; {} requests", engine.client.usage.snapshot().calls);
}

#[tokio::test]
async fn native_jev_backend_contract() {
    workspace();
    let requests = Arc::new(Mutex::new(Vec::<Value>::new()));
    let seen = requests.clone();
    let app = axum::Router::new().route("/v1/systemone", axum::routing::post(move |headers: axum::http::HeaderMap, axum::Json(body): axum::Json<Value>| {
        let seen = seen.clone();
        async move {
            assert_eq!(headers.get("authorization").unwrap(), "Bearer local-jev-fixture");
            assert!(body.get("messages").is_none());
            assert!(body.get("max_tokens").is_none());
            seen.lock().unwrap().push(body.clone());
            let mut answers = serde_json::Map::new();
            for (id,q) in body["questions"].as_object().unwrap() {
                let answer = match q["type"].as_str().unwrap() {
                    "noul" => json!({"type":"noul", "noul":0.65}),
                    "score" => {
                        let n = q["criteria"].as_array().unwrap().len();
                        let probabilities: serde_json::Map<String,Value> = (0..n).map(|i| (i.to_string(),json!(if i == 2 {1.0} else {0.0}))).collect();
                        let legend: serde_json::Map<String,Value> = (0..n).map(|i| (i.to_string(),q["criteria"][i].clone())).collect();
                        json!({"type":"score", "score":2.0,"probabilities":probabilities,"legend":legend,"confidence":1.0})
                    },
                    "choice" => {
                        let criteria = q["criteria"].as_object().unwrap();
                        let choice = if id == "route" { "explicit_options" } else { criteria.keys().last().unwrap() };
                        let probabilities: serde_json::Map<String,Value> = criteria.keys().map(|k| (k.clone(),json!(if k == choice {1.0} else {0.0}))).collect();
                        json!({"type":"choice", "choice":choice,"probabilities":probabilities,"confidence":1.0})
                    },
                    other => panic!("unexpected question type {other}"),
                };
                answers.insert(id.clone(),answer);
            }
            axum::Json(json!({"model":"jev-1.13.0","answers":answers,"usage":{"input_tokens":20,"output_tokens":10}}))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    std::env::set_var(
        "TYPESAFE_BASE_URL",
        format!("http://{}", listener.local_addr().unwrap()),
    );
    std::env::set_var("TYPESAFE_API_KEY", "local-jev-fixture");
    std::env::set_var("JEV_MODEL", "jev-1.13.0");
    std::env::set_var("MODEL_OFFLINE", "0");
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let cache = Arc::new(Cache::open(":memory:").unwrap());
    features(ModelClient::from_env(Some(cache)).unwrap(), false).await;
    let requests = requests.lock().unwrap();
    assert!(requests.iter().all(|r| r["model"] == "jev-1.13.0"));
    assert!(requests
        .iter()
        .any(|r| r["state"]["ab_stimuli"]["A"] == "Save time on your commute."));
    assert!(
        requests
            .iter()
            .any(|r| r["questions"].as_object().unwrap().len() >= 6),
        "residents must be batched"
    );
    task.abort();
}

#[tokio::test]
#[ignore = "loads .env and makes paid TypeSafe calls; run explicitly"]
async fn live_jev_smoke() {
    workspace();
    simfrancisco::load_dotenv(".env");
    assert!(
        ModelClient::from_env(None).unwrap().has_key(),
        "set TYPESAFE_API_KEY"
    );
    let cache = Arc::new(Cache::open(":memory:").unwrap());
    features(ModelClient::from_env(Some(cache)).unwrap(), true).await;
}
