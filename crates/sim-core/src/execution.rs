//! Request-scoped execution evidence. Never record credentials, prompts or provider bodies.
use serde_json::{json, Value};
use std::{future::Future, sync::{Arc, Mutex, atomic::{AtomicU64, Ordering}}, time::Instant};
use tokio::sync::mpsc::UnboundedSender;

static NEXT_RUN: AtomicU64 = AtomicU64::new(1);
tokio::task_local! { static CURRENT: Trace; }

#[derive(Clone)]
pub struct Trace(Arc<Inner>);
struct Inner {
    id: String,
    start: Instant,
    events: Mutex<Vec<Value>>,
    sender: Option<UnboundedSender<Value>>,
}
impl Trace {
    pub fn new(sender: Option<UnboundedSender<Value>>) -> Self {
        Self(Arc::new(Inner {
            id: format!("{}-{}", chrono::Utc::now().timestamp_micros(), NEXT_RUN.fetch_add(1, Ordering::Relaxed)),
            start: Instant::now(), events: Mutex::new(Vec::new()), sender,
        }))
    }
    pub async fn scope<F: Future>(&self, future: F) -> F::Output { CURRENT.scope(self.clone(), future).await }
    pub fn record(&self, kind: &str, message: &str, details: Value) {
        let mut events = self.0.events.lock().unwrap();
        // Requests are bounded to 24 scenarios. Cap retained/streamed metadata too.
        if events.len() >= 2000 { return; }
        let event = json!({"run_id":self.0.id,"seq":events.len()+1,"elapsed_ms":self.0.start.elapsed().as_millis() as u64,
            "kind":kind,"message":message,"details":details});
        tracing::info!(target: "simfrancisco::execution", event = %event, "experiment execution");
        events.push(event.clone());
        if let Some(sender) = &self.0.sender { let _ = sender.send(json!({"type":"log","event":event})); }
    }
    pub fn snapshot(&self) -> Value {
        let events = self.0.events.lock().unwrap();
        let count = |kind: &str| events.iter().filter(|e| e["kind"] == kind).count();
        json!({"run_id":self.0.id,"elapsed_ms":self.0.start.elapsed().as_millis() as u64,
            "provider_requests":count("model.request"),"cache_hits":count("model.cache_hit"),
            "retries":count("model.retry"),"events":*events})
    }
}
pub fn emit(kind: &str, message: &str, details: Value) {
    let _ = CURRENT.try_with(|trace| trace.record(kind, message, details));
}

pub fn failure_message(error: &anyhow::Error) -> &'static str {
    let message = format!("{error:#}");
    if message.contains("TYPESAFE_API_KEY (or JEV_API_KEY) not set") {
        "Live model unavailable: set TYPESAFE_API_KEY on the backend. No fixture results were substituted."
    } else if message.contains("offline mode") {
        "Backend is in cache-only mode and this evaluation is not cached."
    } else if message.contains("Jev HTTP 401") || message.contains("Jev HTTP 403") {
        "Jev rejected the backend credentials. Check the server API key."
    } else if message.contains("Jev HTTP 429") {
        "Jev rate limit or quota reached. No complete result is available."
    } else {
        "Model evaluation failed or returned incomplete data. No complete result is available."
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn concurrent_traces_do_not_mix_usage_or_events() {
        let a = Trace::new(None);
        let b = Trace::new(None);
        tokio::join!(a.scope(async {
            emit("model.request", "request", json!({}));
            tokio::task::yield_now().await;
            emit("model.response", "response", json!({}));
        }), b.scope(async {
            emit("model.cache_hit", "cache", json!({}));
            tokio::task::yield_now().await;
        }));
        assert_eq!(a.snapshot()["provider_requests"], 1);
        assert_eq!(a.snapshot()["cache_hits"], 0);
        assert_eq!(b.snapshot()["provider_requests"], 0);
        assert_eq!(b.snapshot()["cache_hits"], 1);
        assert_ne!(a.snapshot()["run_id"], b.snapshot()["run_id"]);
    }
    #[test]
    fn public_errors_do_not_echo_provider_details() {
        let error = anyhow::anyhow!("untrusted provider body: credential-like-secret");
        assert!(!failure_message(&error).contains("credential-like-secret"));
    }
}
