//! Live Neo4j integration test for the persona memory layer. Skipped unless
//! `NEO4J_URI` is set (e.g. `NEO4J_URI=http://localhost:7474 NEO4J_PASSWORD=... cargo test --test memory_neo4j`).

use simfrancisco::hydra::HydraEvidence;
use simfrancisco::memory::{self, AgentAnswer, MemoryClient, StimulusRecord, TestTag};
use simfrancisco::predict::{Framing, Poll, PollResult};
use std::collections::HashMap;

const EVENT_TEXT: &str = "A political figure was shot at a rally.";

#[tokio::test]
async fn neo4j_memory_roundtrip() {
    let ws_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::env::set_current_dir(&ws_root).ok();
    simfrancisco::load_dotenv(".env");
    let Some(mem) = MemoryClient::from_env() else {
        eprintln!("NEO4J_URI not set; skipping neo4j memory integration test");
        return;
    };
    assert!(mem.ping().await, "neo4j not reachable at NEO4J_URI");
    mem.ensure_schema().await.unwrap();

    // unique population per run so reruns against a persistent DB never collide
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let n = 30usize;
    let records = simfrancisco::pums::load_sf().unwrap();
    let pop = simfrancisco::persona::build_population(&records, n, seed, None);
    let pop_key = memory::population_key(&pop.profile.slug, pop.seed, pop.n);
    assert_eq!(pop_key, format!("sf:{seed}:{n}"));
    mem.ensure_population(&pop).await.unwrap();

    // city-wide event: every persona in sf remembers it
    // A crashed earlier run can leave same-day filler events behind; they would push
    // this run's event out of the recall cap, so clear them first.
    mem.run(&[(
        "MATCH (e:Event) WHERE e.text STARTS WITH 'Same-day filler event' DETACH DELETE e",
        serde_json::json!({}),
    )])
    .await
    .unwrap();
    let ev = mem
        .add_city_event("sf", "news", EVENT_TEXT, "2026-09-10")
        .await
        .unwrap();
    // Recall as of the event's own date: the city graph is shared and may hold many
    // newer events, and recall keeps only the RECALL_EVENTS most recent ones.
    let recalled = mem.recall(&pop_key, &[0, 1, 2], "2026-09-10").await.unwrap();
    for id in [0u32, 1, 2] {
        let m = recalled.get(&id).unwrap_or_else(|| panic!("persona {id} has no memory"));
        assert!(m.events.iter().any(|e| e.id == ev.id), "persona {id} missing city event");
        assert!(memory::prompt_fragment(m).contains("political figure"));
    }
    // Same-day events: the most recently created one must be recalled even when
    // more than RECALL_EVENTS events share the date (ordering by created_at, not id).
    let mut same_day = Vec::new();
    for i in 0..(memory::RECALL_EVENTS + 2) {
        let e = mem
            .add_city_event("sf", "news", &format!("Same-day filler event {i} for {seed}"), "2026-09-10")
            .await
            .unwrap();
        same_day.push(e.id);
    }
    let newest = same_day.last().unwrap().clone();
    let again = mem.recall(&pop_key, &[0], "2026-09-10").await.unwrap();
    assert!(
        again[&0].events.iter().any(|e| e.id == newest),
        "newest same-day event must survive the recall cap"
    );

    // dated before the event: not recalled (backtests stay leakage-free)
    let before = mem.recall(&pop_key, &[0, 1, 2], "2026-09-01").await.unwrap();
    for id in [0u32, 1, 2] {
        let none = before.get(&id).map(|m| !m.events.iter().any(|e| e.id == ev.id)).unwrap_or(true);
        assert!(none, "persona {id} recalled a future event");
    }

    // a test the population took part in
    let poll = Poll {
        question: "Do you support stricter gun laws?".into(),
        description: "A neutral description.".into(),
        framing: Framing::Vote,
        as_of_date: "2026-09-12".into(),
        model: Some("test".into()),
        population: None,
        event: None,
        options: vec![],
    };
    let result = PollResult {
        question: poll.question.clone(),
        as_of_date: poll.as_of_date.clone(),
        model: "test".into(),
        p_yes: 0.61,
        ci_low: 0.55,
        ci_high: 0.67,
        n_agents: n,
        n_eff: 28.0,
        design_effect: 1.05,
        breakdowns: HashMap::new(),
        n_archetypes: 3,
        n_llm_calls: 1,
        sample_rationales: vec!["safety".into()],
        p_distribution: vec![],
        option_breakdowns: vec![],
        option_ci: None,
        hydra: HydraEvidence::default(),
            memory_test_id: None,
    };
    let tag = TestTag::kind("poll").on_branch("sim-test", "sim-test:main");
    let record = memory::test_record(&pop_key, &poll, &result, &tag);
    let answers: Vec<AgentAnswer> = (0..n as u32)
        .map(|id| AgentAnswer {
            agent_id: id,
            p_yes: 0.72,
            dist: vec![],
            why: "safety first".into(),
            archetype: "arch".into(),
            personal_p_yes: None,
            personal_dist: None,
            personal_why: None,
        })
        .collect();
    mem.record_test(&pop_key, &record, &answers, Some(&ev.id)).await.unwrap();
    mem.record_stimuli(
        &record.id,
        &[
            StimulusRecord { label: "A".into(), text: "variant a".into() },
            StimulusRecord { label: "B".into(), text: "variant b".into() },
        ],
    )
    .await
    .unwrap();

    // every persona's answer and the test itself are readable back by id
    let answers = mem.test_answers(&record.id).await.unwrap().expect("test exists");
    assert_eq!(answers.len(), 30);
    assert!(answers.iter().all(|a| (a.p_yes - 0.72).abs() < 1e-9 && a.why == "safety first"));
    assert!(mem.test_answers("test-does-not-exist").await.unwrap().is_none());
    match mem.test_detail(&record.id).await.unwrap().expect("test detail") {
        memory::LineageItem::Test { id, question, population_key, breakdowns, .. } => {
            assert_eq!(id, record.id);
            assert_eq!(question, poll.question);
            assert_eq!(population_key, pop_key);
            assert!(breakdowns.is_some());
        }
        other => panic!("unexpected lineage item: {other:?}"),
    }

    // personal answers: stored on the ANSWERED edge and readable back
    mem.record_personal_answers(
        &pop_key,
        &record.id,
        &[memory::PersonalAnswer { agent_id: 5, p_yes: 0.31, dist: vec![], why: "I ride Muni daily and this is my own take.".into() }],
    )
    .await
    .unwrap();
    let personal = mem.personal_answers(&pop_key, &record.id, &[5, 6]).await.unwrap();
    assert_eq!(personal.len(), 1);
    assert_eq!(personal[0].agent_id, 5);
    assert!((personal[0].p_yes - 0.31).abs() < 1e-9);
    let all = mem.test_answers(&record.id).await.unwrap().unwrap();
    let a5 = all.iter().find(|a| a.agent_id == 5).unwrap();
    assert_eq!(a5.personal_why.as_deref(), Some("I ride Muni daily and this is my own take."));
    assert!(all.iter().find(|a| a.agent_id == 6).unwrap().personal_why.is_none());

    let recalled = mem.recall(&pop_key, &[0, 5, 29], "2026-09-12").await.unwrap();
    for id in [0u32, 5, 29] {
        let m = recalled.get(&id).unwrap();
        let t = m.tests.iter().find(|t| t.id == record.id).unwrap_or_else(|| panic!("persona {id} missing test"));
        assert!((t.p_yes - 0.72).abs() < 1e-9);
        assert_eq!(t.why, "safety first");
        let frag = memory::prompt_fragment(m);
        assert!(frag.contains("stricter gun laws"), "{frag}");
        assert!(frag.contains("72% yes"), "{frag}");
    }

    let view = mem.persona_view(&pop_key, 0).await.unwrap();
    assert_eq!(view["persona"]["agent_id"], 0);
    assert!(!view["events"].as_array().unwrap().is_empty());
    let tests = view["tests"].as_array().unwrap();
    assert!(!tests.is_empty());
    let mine = tests.iter().find(|t| t["id"] == record.id).unwrap();
    assert_eq!(mine["under_event"], EVENT_TEXT);
    assert_eq!(mine["stimuli"].as_array().unwrap().len(), 2);

    let events = mem.list_city_events("sf", 100).await.unwrap();
    assert!(events.iter().any(|e| e.event.id == ev.id));

    // Clean up: the graph is shared with the demo city, so remove this run's
    // population, personas, tests, stimuli and the seeded event.
    mem.run(&[
        (
            "MATCH (p:Population {key: $pop}) \
             OPTIONAL MATCH (a:Persona)-[:MEMBER_OF]->(p) \
             OPTIONAL MATCH (t:Test)-[:RAN_ON]->(p) \
             OPTIONAL MATCH (t)-[:USED_STIMULUS]->(s:Stimulus) \
             DETACH DELETE a, t, s, p",
            serde_json::json!({"pop": pop_key}),
        ),
        ("MATCH (e:Event {id: $id}) DETACH DELETE e", serde_json::json!({"id": ev.id})),
        ("MATCH (e:Event) WHERE e.id IN $ids DETACH DELETE e", serde_json::json!({"ids": same_day})),
    ])
    .await
    .unwrap();
}
