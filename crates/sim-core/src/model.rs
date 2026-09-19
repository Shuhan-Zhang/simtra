//! Raw HTTP model client for Jev (TypeSafe), plus legacy backtest providers.
//!
//! Provider-specific request and response shapes stay behind `ModelClient`; callers
//! use typed `evaluate` for Jev and `complete` for legacy text models. Concurrency
//! is bounded; 429/5xx responses get retry/backoff. SQLite caches validated Jev
//! responses by endpoint, model, state and typed questions for reproducible replays.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use tokio::sync::Semaphore;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    AzureResponses, // gpt-4o / gpt-5.5  → POST /responses
    AzureChat,      // grok-4.3          → POST /chat/completions
    Anthropic,      // claude-sonnet-*   → POST /v1/messages (x-api-key)
    Jev,            // jev-*             → POST /v1/systemone (Bearer)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Model {
    Gpt4o,
    Gpt55,
    Grok43,
    Sonnet,
    Jev,
    JevLatest,
    JevPreview,
}

impl Model {
    pub fn id(&self) -> &'static str {
        match self {
            Model::Gpt4o => "gpt-4o",
            Model::Gpt55 => "gpt-5.5",
            Model::Grok43 => "grok-4.3",
            Model::Sonnet => "claude-sonnet-4-6",
            Model::Jev => "jev-1.13.0",
            Model::JevLatest => "jev-latest",
            Model::JevPreview => "jev-preview",
        }
    }
    pub fn provider(&self) -> Provider {
        match self {
            Model::Gpt4o | Model::Gpt55 => Provider::AzureResponses,
            Model::Grok43 => Provider::AzureChat,
            Model::Sonnet => Provider::Anthropic,
            Model::Jev | Model::JevLatest | Model::JevPreview => Provider::Jev,
        }
    }
    pub fn is_jev(self) -> bool { self.provider() == Provider::Jev }

    pub fn default_live() -> Self {
        match std::env::var("JEV_MODEL").unwrap_or_default().trim() {
            "jev-latest" => Self::JevLatest,
            "jev-preview" => Self::JevPreview,
            _ => Self::Jev,
        }
    }

    pub fn supported(s: &str) -> bool {
        let name = s.trim().to_ascii_lowercase();
        matches!(name.as_str(), "jev" | "jev-1.13" | "jev-1.13.0" | "jev-latest" | "jev-preview"
            | "gpt-4o" | "gpt4o" | "4o" | "gpt-5.5" | "gpt55" | "gpt-55" | "5.5"
            | "grok-4.3" | "grok" | "grok43" | "sonnet") || name.starts_with("claude")
    }

    /// gpt-4o / gpt-5.5 use the /responses shape; grok-4.3 uses /chat/completions.
    pub fn uses_responses(&self) -> bool {
        self.provider() == Provider::AzureResponses
    }
    pub fn parse(s: &str) -> Model {
        match s.trim().to_ascii_lowercase().as_str() {
            "gpt-4o" | "gpt4o" | "4o" => Model::Gpt4o,
            "gpt-5.5" | "gpt55" | "gpt-55" | "5.5" => Model::Gpt55,
            "grok-4.3" | "grok" | "grok43" => Model::Grok43,
            s if s.starts_with("claude") || s == "sonnet" => Model::Sonnet,
            "jev" | "jev-1.13" | "jev-1.13.0" => Model::Jev,
            "jev-latest" => Model::JevLatest,
            "jev-preview" => Model::JevPreview,
            _ => Model::Jev,
        }
    }
}

impl std::fmt::Display for Model {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.id())
    }
}

/// Sqlite-backed response cache. Makes clean-mode validation deterministic across
/// re-runs and avoids paying twice for the same (model, prompt).
pub struct Cache {
    conn: Mutex<rusqlite::Connection>,
}

impl Cache {
    pub fn open(path: &str) -> Result<Self> {
        let conn = rusqlite::Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS llm_cache (
                key TEXT PRIMARY KEY,
                model TEXT NOT NULL,
                response TEXT NOT NULL,
                created INTEGER NOT NULL
             );",
        )?;
        Ok(Cache { conn: Mutex::new(conn) })
    }
    fn get(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT response FROM llm_cache WHERE key=?1",
            [key],
            |r| r.get::<_, String>(0),
        )
        .ok()
    }
    fn put(&self, key: &str, model: &str, response: &str) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO llm_cache (key, model, response, created) VALUES (?1,?2,?3,strftime('%s','now'))",
            rusqlite::params![key, model, response],
        );
    }
}

#[derive(Default)]
pub struct Usage {
    pub calls: AtomicU64,
    pub cache_hits: AtomicU64,
    pub input_tokens: AtomicU64,
    pub output_tokens: AtomicU64,
    pub retries: AtomicU64,
}

impl Usage {
    pub fn snapshot(&self) -> UsageSnapshot {
        UsageSnapshot {
            calls: self.calls.load(Ordering::Relaxed),
            cache_hits: self.cache_hits.load(Ordering::Relaxed),
            input_tokens: self.input_tokens.load(Ordering::Relaxed),
            output_tokens: self.output_tokens.load(Ordering::Relaxed),
            retries: self.retries.load(Ordering::Relaxed),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UsageSnapshot {
    pub calls: u64,
    pub cache_hits: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub retries: u64,
}

#[derive(Clone)]
pub struct ModelClient {
    http: reqwest::Client,
    base: String,
    api_key: String,
    anthropic_key: String,
    anthropic_url: String,
    jev_key: String,
    jev_url: String,
    gemini_key: String,
    voice_url: String,
    voice_model: String,
    sem: Arc<Semaphore>,
    max_retries: u32,
    cache: Option<Arc<Cache>>,
    pub usage: Arc<Usage>,
    /// when true, network is disabled and only cache hits succeed (offline/deterministic).
    offline: bool,
}

/// Vision models used only to turn uploaded images into neutral attributes.
const VISION_MODEL_ANTHROPIC: &str = "claude-opus-5";
const VISION_MODEL_GEMINI: &str = "gemini-3.5-flash";

const DEFAULT_BASE: &str = "https://claude-day-resource.services.ai.azure.com/openai/v1";

impl ModelClient {
    /// Build from environment. Jev uses TYPESAFE_API_KEY (JEV_API_KEY alias).
    /// Legacy backtest providers retain their explicit credentials.
    pub fn from_env(cache: Option<Arc<Cache>>) -> Result<Self> {
        let api_key = std::env::var("MODEL_API_KEY").unwrap_or_default();
        let base = std::env::var("OPENAI_API_URL")
            .ok()
            .map(|u| u.replace("/responses", "").replace("/chat/completions", ""))
            .filter(|u| u.contains("/openai/v1"))
            .unwrap_or_else(|| DEFAULT_BASE.to_string());
        let max_inflight: usize = std::env::var("MODEL_MAX_INFLIGHT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8);
        let offline = std::env::var("MODEL_OFFLINE").map(|v| v == "1").unwrap_or(false);
        let anthropic_key = std::env::var("ANTHROPIC_API_KEY").unwrap_or_default();
        let anthropic_url = std::env::var("ANTHROPIC_API_URL")
            .unwrap_or_else(|_| "https://api.anthropic.com/v1/messages".to_string());
        let jev_key = std::env::var("TYPESAFE_API_KEY").ok()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| std::env::var("JEV_API_KEY").ok()).unwrap_or_default().trim().to_string();
        let jev_url = std::env::var("TYPESAFE_BASE_URL")
            .unwrap_or_else(|_| "https://api.typesafe.ai".to_string());
        let jev_url = format!("{}/v1/systemone", jev_url.trim_end_matches('/'));
        let gemini_key = std::env::var("GEMINI_API_KEY").unwrap_or_default().trim().to_string();
        let voice_model = std::env::var("GEMINI_MODEL").ok().filter(|m| m.starts_with("gemini-") && m.chars().all(|c| c.is_ascii_alphanumeric() || c=='-' || c=='.')).unwrap_or_else(|| "gemini-3.5-flash-lite".into());
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(180))
            .connect_timeout(Duration::from_secs(15))
            .build()?;
        Ok(ModelClient {
            http,
            base,
            api_key,
            anthropic_key,
            anthropic_url,
            jev_key,
            jev_url,
            gemini_key,
            voice_url: std::env::var("GEMINI_VOICE_API_URL").unwrap_or_else(|_| format!("https://generativelanguage.googleapis.com/v1beta/models/{voice_model}:generateContent")),
            voice_model,
            sem: Arc::new(Semaphore::new(max_inflight.max(1))),
            max_retries: 5,
            cache,
            usage: Arc::new(Usage::default()),
            offline,
        })
    }

    pub fn has_typesafe_key(&self) -> bool { !self.jev_key.trim().is_empty() }

    /// Bounded convenience adapter for batched behavior and event choices.
    /// Uses the repository's native typed Jev transport and validation.
    pub async fn jev_choices(&self, state: &str, questions: Value) -> Result<Value> {
        let questions = serde_json::from_value(questions)?;
        let result = tokio::time::timeout(Duration::from_secs(12),
            self.evaluate(Model::default_live(), Value::String(state.into()), questions))
            .await.map_err(|_| anyhow!("Jev timed out after 12 seconds"))??;
        Ok(serde_json::to_value(result)?)
    }

    #[cfg(test)]
    pub(crate) fn evolution_test_client(url: String) -> Self {
        let mut client=Self::from_env(None).unwrap();
        client.jev_url=url;client.jev_key="local-test".into();client.offline=false;client
    }

    pub fn has_key(&self) -> bool {
        !self.jev_key.is_empty()
    }

    pub fn health_model(&self) -> Option<Model> {
        if !self.jev_key.is_empty() { Some(Model::default_live()) } else { None }
    }

    pub async fn check_health(&self, model: Model) -> Result<()> {
        if model.is_jev() {
            let questions = std::collections::BTreeMap::from([("ready".into(),
                crate::jev::Question::noul("Does the state describe an API connectivity check?"))]);
            self.evaluate(model, json!("API connectivity check"), questions).await?;
        } else {
            self.complete(model, "", "Reply with: OK", 64).await?;
        }
        Ok(())
    }

    fn cache_key(model: Model, system: &str, user: &str, max_tokens: u32) -> String {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(model.id().as_bytes());
        h.update(b"\x00");
        h.update(system.as_bytes());
        h.update(b"\x00");
        h.update(user.as_bytes());
        h.update(b"\x00");
        h.update(max_tokens.to_le_bytes());
        hex::encode(h.finalize())
    }

    /// One completion. Returns the model's text. Uses cache first; on miss, calls the
    /// live endpoint with retry/backoff and stores the result.
    pub async fn complete(
        &self,
        model: Model,
        system: &str,
        user: &str,
        max_tokens: u32,
    ) -> Result<String> {
        let key = Self::cache_key(model, system, user, max_tokens);
        if let Some(c) = &self.cache {
            if let Some(hit) = c.get(&key) {
                self.usage.cache_hits.fetch_add(1, Ordering::Relaxed);
                return Ok(hit);
            }
        }
        if self.offline {
            return Err(anyhow!("offline mode: cache miss for {}", model.id()));
        }
        match model.provider() {
            Provider::Anthropic if self.anthropic_key.is_empty() => {
                return Err(anyhow!("ANTHROPIC_API_KEY not set"));
            }
            Provider::Jev => return Err(anyhow!("Jev requires typed evaluation, not text completion")),
            Provider::AzureResponses | Provider::AzureChat if self.api_key.is_empty() => {
                return Err(anyhow!("MODEL_API_KEY not set"));
            }
            _ => {}
        }
        let text = self.call_live(model, system, user, max_tokens).await?;
        if let Some(c) = &self.cache {
            c.put(&key, model.id(), &text);
        }
        Ok(text)
    }

    /// Optional narrative surface only. Never used for quantitative predictions.
    pub fn has_voice_provider(&self) -> bool { !self.gemini_key.is_empty() }

    /// One bounded native Gemini request for a sparse batch of synthetic voices.
    /// No retries: ambient text must not hold up the experiment or multiply cost.
    pub async fn complete_voice(&self, system: &str, user: &str, max_tokens: u32) -> Result<String> {
        use sha2::{Digest, Sha256};
        if system.len() > 8000 || user.len() > 64000 { return Err(anyhow!("voice batch exceeds context limit")); }
        let max_tokens = max_tokens.clamp(128, 4096);
        let mut hash = Sha256::new();
        for part in ["resident-voice-v1", &self.voice_url, &self.voice_model, system, user] { hash.update(part.as_bytes()); hash.update(b"\0"); }
        hash.update(max_tokens.to_le_bytes());
        let key = hex::encode(hash.finalize());
        if let Some(hit) = self.cache.as_ref().and_then(|c| c.get(&key)) {
            self.usage.cache_hits.fetch_add(1, Ordering::Relaxed);
            return Ok(hit);
        }
        if self.offline || !self.has_voice_provider() { return Err(anyhow!("Resident voice provider unavailable")); }
        let _permit = self.sem.acquire().await?;
        self.usage.calls.fetch_add(1, Ordering::Relaxed);
        let response = self.http.post(&self.voice_url).header("x-goog-api-key", &self.gemini_key)
            .timeout(Duration::from_secs(12)).json(&json!({
                "system_instruction":{"parts":[{"text":system}]},
                "contents":[{"role":"user","parts":[{"text":user}]}],
                "generationConfig":{"maxOutputTokens":max_tokens,"responseMimeType":"application/json","thinkingConfig":{"thinkingLevel":"low"}}
            })).send().await.map_err(|_| anyhow!("Resident voice request failed"))?;
        if !response.status().is_success() { return Err(anyhow!("Resident voice HTTP {}", response.status().as_u16())); }
        let body:Value = response.json().await.map_err(|_| anyhow!("Resident voice response was not JSON"))?;
        let text = body.pointer("/candidates/0/content/parts").and_then(Value::as_array)
            .map(|parts| parts.iter().filter(|p| p.get("thought").and_then(Value::as_bool) != Some(true))
                .filter_map(|p|p.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("")).unwrap_or_default();
        let parsed:Value=serde_json::from_str(&text).map_err(|_|anyhow!("Resident voice returned invalid JSON"))?;
        if !parsed.is_array() || text.len()>32000 { return Err(anyhow!("Resident voice returned an invalid batch")); }
        if let Some(cache)=&self.cache { cache.put(&key, &self.voice_model, &text); }
        Ok(text)
    }

    /// Which provider answers image-description calls, if any. Jev is text-only,
    /// so vision goes to Anthropic when configured, else Gemini.
    pub fn vision_provider(&self) -> Option<&'static str> {
        if !self.anthropic_key.is_empty() { Some("anthropic") }
        else if !self.gemini_key.is_empty() { Some("gemini") }
        else { None }
    }
    pub fn has_vision(&self) -> bool { self.vision_provider().is_some() }

    /// Describe one base64 image with a vision model and return its text. Cached
    /// by (provider model, prompts, image hash) like text completions.
    pub async fn describe_image(&self, media_type: &str, data_b64: &str, system: &str, user: &str, max_tokens: u32) -> Result<String> {
        let provider = self.vision_provider().ok_or_else(|| anyhow!("no vision model configured (ANTHROPIC_API_KEY or GEMINI_API_KEY)"))?;
        let model_id = match provider { "anthropic" => VISION_MODEL_ANTHROPIC, _ => VISION_MODEL_GEMINI };
        let image_hash = {
            use sha2::{Digest, Sha256};
            let mut h = Sha256::new(); h.update(media_type.as_bytes()); h.update(b"\x00"); h.update(data_b64.as_bytes());
            hex::encode(h.finalize())
        };
        let key = {
            use sha2::{Digest, Sha256};
            let mut h = Sha256::new();
            for part in [model_id, system, user, &image_hash] { h.update(part.as_bytes()); h.update(b"\x00"); }
            h.update(max_tokens.to_le_bytes());
            hex::encode(h.finalize())
        };
        if let Some(hit) = self.cache.as_ref().and_then(|c| c.get(&key)) {
            self.usage.cache_hits.fetch_add(1, Ordering::Relaxed);
            return Ok(hit);
        }
        if self.offline { return Err(anyhow!("offline mode: cache miss for {model_id}")); }
        let (url, body) = if provider == "anthropic" {
            (self.anthropic_url.clone(), json!({
                "model": model_id, "max_tokens": max_tokens.max(64), "system": system,
                "messages": [{"role":"user","content":[
                    {"type":"image","source":{"type":"base64","media_type":media_type,"data":data_b64}},
                    {"type":"text","text":user}]}],
            }))
        } else {
            (format!("https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent"), json!({
                "system_instruction": {"parts":[{"text":system}]},
                "contents": [{"role":"user","parts":[
                    {"inline_data":{"mime_type":media_type,"data":data_b64}},
                    {"text":user}]}],
                // thoughts count toward maxOutputTokens on Gemini 3.x; keep them short so the JSON fits
                "generationConfig": {"maxOutputTokens": max_tokens.max(64), "responseMimeType": "application/json", "thinkingConfig": {"thinkingLevel": "low"}},
            }))
        };
        let _permit = self.sem.acquire().await?;
        let mut attempt = 0u32;
        loop {
            self.usage.calls.fetch_add(1, Ordering::Relaxed);
            let req = if provider == "anthropic" {
                self.http.post(&url).header("x-api-key", &self.anthropic_key).header("anthropic-version", "2023-06-01")
            } else {
                self.http.post(&url).header("x-goog-api-key", &self.gemini_key)
            };
            let resp = req.json(&body).send().await;
            match resp {
                Ok(r) => {
                    let status = r.status();
                    let text = r.text().await.unwrap_or_default();
                    if status.is_success() {
                        let v: Value = serde_json::from_str(&text).context("vision response was not JSON")?;
                        let out = if provider == "anthropic" {
                            v.get("content").and_then(Value::as_array).map(|blocks| blocks.iter()
                                .filter_map(|b| b.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("")).unwrap_or_default()
                        } else {
                            v.pointer("/candidates/0/content/parts").and_then(Value::as_array).map(|parts| parts.iter()
                                .filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("")).unwrap_or_default()
                        };
                        if out.trim().is_empty() { return Err(anyhow!("vision model returned no text")); }
                        if let Some(c) = &self.cache { c.put(&key, model_id, &out); }
                        return Ok(out);
                    }
                    if (status.as_u16() == 429 || status.is_server_error()) && attempt < self.max_retries {
                        self.usage.retries.fetch_add(1, Ordering::Relaxed);
                        self.backoff(attempt).await; attempt += 1; continue;
                    }
                    // Provider bodies can echo request data; report status only.
                    return Err(anyhow!("vision HTTP {}", status.as_u16()));
                }
                Err(e) if attempt < self.max_retries => {
                    self.usage.retries.fetch_add(1, Ordering::Relaxed);
                    tracing::warn!("vision request error: {e}");
                    self.backoff(attempt).await; attempt += 1;
                }
                Err(e) => return Err(anyhow!("vision request failed: {e}")),
            }
        }
    }

    /// Native TypeSafe /v1/systemone evaluation. Validate before caching, and
    /// include endpoint, model, state and typed questions in the deterministic key.
    pub async fn evaluate(&self, model: Model, state: Value,
        questions: std::collections::BTreeMap<String, crate::jev::Question>) -> Result<crate::jev::Evaluation> {
        let result = self.evaluate_inner(model, state, questions).await;
        if let Err(error) = &result {
            crate::execution::emit("model.failed", crate::execution::failure_message(error), json!({"model":model.id()}));
        }
        result
    }

    async fn evaluate_inner(&self, model: Model, state: Value,
        questions: std::collections::BTreeMap<String, crate::jev::Question>) -> Result<crate::jev::Evaluation> {
        if !model.is_jev() { return Err(anyhow!("typed evaluations require a Jev model")); }
        if questions.is_empty() { return Err(anyhow!("at least one Jev question is required")); }
        for question in questions.values() { question.validate()?; }
        let body = json!({"model":model.id(), "state":state, "questions":questions});
        let key = Self::cache_key(model, &self.jev_url, &serde_json::to_string(&body)?, 0);
        if let Some(hit) = self.cache.as_ref().and_then(|c| c.get(&key)) {
            let result: crate::jev::Evaluation = serde_json::from_str(&hit)?;
            result.validate(&questions)?;
            self.usage.cache_hits.fetch_add(1, Ordering::Relaxed);
            crate::execution::emit("model.cache_hit", "Exact cached model response reused; no provider request.", json!({"model":model.id(),"questions":questions.len()}));
            return Ok(result);
        }
        if self.offline { return Err(anyhow!("offline mode: cache miss for {}", model.id())); }
        if self.jev_key.is_empty() { return Err(anyhow!("TYPESAFE_API_KEY (or JEV_API_KEY) not set")); }
        let _permit = self.sem.acquire().await?;
        let mut attempt = 0;
        loop {
            self.usage.calls.fetch_add(1, Ordering::Relaxed);
            let request_started = std::time::Instant::now();
            crate::execution::emit("model.request", "Sending typed evaluation to Jev.", json!({"model":model.id(),"attempt":attempt+1,"questions":questions.len()}));
            let response = self.http.post(&self.jev_url).bearer_auth(&self.jev_key).json(&body).send().await;
            match response {
                Ok(response) => {
                    let status = response.status();
                    let retry_after = response.headers().get(reqwest::header::RETRY_AFTER)
                        .and_then(|h| h.to_str().ok()).and_then(|s| s.parse::<f64>().ok())
                        .filter(|s| s.is_finite() && *s >= 0.0).map(|s| Duration::from_secs_f64(s.min(30.0)));
                    if !status.is_success() {
                        if (status.as_u16() == 429 || status.is_server_error()) && attempt < self.max_retries {
                            crate::execution::emit("model.retry", "Provider returned a retryable error; waiting before retry.", json!({"status":status.as_u16(),"attempt":attempt+1}));
                            if let Some(wait) = retry_after { tokio::time::sleep(wait).await; }
                            else { self.backoff(attempt).await; }
                        } else {
                            // Do not echo provider bodies: they can contain request data.
                            return Err(anyhow!("Jev HTTP {}{}", status.as_u16(), if status.as_u16() == 401 { ": check TYPESAFE_API_KEY" } else { "" }));
                        }
                    } else {
                        let result: crate::jev::Evaluation = response.json().await.context("invalid Jev response JSON")?;
                        result.validate(&questions)?;
                        self.record_usage(&json!({"usage":result.usage}));
                        if let Some(cache) = &self.cache { cache.put(&key, model.id(), &serde_json::to_string(&result)?); }
                        crate::execution::emit("model.response", "Provider response received and validated.", json!({"model":model.id(),"duration_ms":request_started.elapsed().as_millis() as u64,"questions":questions.len()}));
                        return Ok(result);
                    }
                }
                Err(_) if attempt < self.max_retries => {
                    crate::execution::emit("model.retry", "Connection failed; waiting before retry.", json!({"attempt":attempt+1}));
                    self.backoff(attempt).await;
                },
                Err(_) => return Err(anyhow!("Jev connection failed after retries")),
            }
            attempt += 1;
            self.usage.retries.fetch_add(1, Ordering::Relaxed);
        }
    }

    async fn call_live(
        &self,
        model: Model,
        system: &str,
        user: &str,
        max_tokens: u32,
    ) -> Result<String> {
        let _permit = self.sem.acquire().await.unwrap();
        let provider = model.provider();
        let (url, body) = match provider {
            Provider::AzureResponses => {
                let input = if system.is_empty() { user.to_string() } else { format!("{system}\n\n{user}") };
                (
                    format!("{}/responses", self.base),
                    json!({ "model": model.id(), "input": input, "max_output_tokens": max_tokens.max(16) }),
                )
            }
            Provider::AzureChat => {
                let mut messages = Vec::new();
                if !system.is_empty() { messages.push(json!({"role":"system","content":system})); }
                messages.push(json!({"role":"user","content":user}));
                (
                    format!("{}/chat/completions", self.base),
                    json!({ "model": model.id(), "messages": messages, "max_tokens": max_tokens.max(16) }),
                )
            }
            Provider::Anthropic => (
                self.anthropic_url.clone(),
                json!({
                    "model": model.id(),
                    "max_tokens": max_tokens.max(16),
                    "system": system,
                    "messages": [{"role":"user","content":user}],
                }),
            ),
            Provider::Jev => return Err(anyhow!("Jev requires typed evaluation")),
        };

        let mut attempt = 0u32;
        loop {
            self.usage.calls.fetch_add(1, Ordering::Relaxed);
            let req = match provider {
                Provider::Anthropic => self
                    .http
                    .post(&url)
                    .header("x-api-key", &self.anthropic_key)
                    .header("anthropic-version", "2023-06-01")
                    .header("Content-Type", "application/json"),
                _ => self
                    .http
                    .post(&url)
                    .header("Authorization", format!("Bearer {}", self.api_key))
                    .header("Content-Type", "application/json"),
            };
            let resp = req.json(&body).send().await;

            match resp {
                Ok(r) => {
                    let status = r.status();
                    if status.as_u16() == 401
                        && matches!(provider, Provider::AzureResponses | Provider::AzureChat)
                    {
                        // Fall back to api-key header path once.
                        let r2 = self
                            .http
                            .post(&url)
                            .header("api-key", &self.api_key)
                            .header("Content-Type", "application/json")
                            .json(&body)
                            .send()
                            .await?;
                        let s2 = r2.status();
                        let txt = r2.text().await.unwrap_or_default();
                        if s2.is_success() {
                            return self.extract(model, &txt);
                        }
                        return Err(anyhow!("auth failed: {} / {}", status, s2));
                    }
                    if status.as_u16() == 429 || status.is_server_error() {
                        let txt = r.text().await.unwrap_or_default();
                        // A per-day quota will not clear by waiting: fail fast with a clear
                        // message instead of sleeping through every retry.
                        if status.as_u16() == 429 && is_daily_quota_exhausted(&txt) {
                            return Err(anyhow!(
                                "model {} daily free-tier quota exhausted (429); add billing, switch model, or use another provider key",
                                model.id()
                            ));
                        }
                        // Rate limits get one short retry only: a free-tier quota that is
                        // really exhausted keeps answering 429 with a small "retry in" hint,
                        // and sleeping through five of those left polls hanging for minutes.
                        let rate_limited = status.as_u16() == 429;
                        if attempt >= self.max_retries || (rate_limited && attempt >= 1) {
                            return Err(anyhow!(
                                "model {} status {}{}: {}",
                                model.id(),
                                status,
                                if rate_limited { " (rate limited or quota exhausted; add billing or another provider key)" } else { " after retries" },
                                truncate(&txt, 300)
                            ));
                        }
                        // Rate-limited providers say how long to wait;
                        // honoring it beats a blind exponential backoff that never recovers.
                        match retry_after_hint(&txt) {
                            Some(d) => tokio::time::sleep(d.min(Duration::from_secs(30))).await,
                            None => self.backoff(attempt).await,
                        }
                        attempt += 1;
                        self.usage.retries.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                    let txt = r.text().await.unwrap_or_default();
                    if !status.is_success() {
                        return Err(anyhow!("model {} HTTP {}: {}", model.id(), status, truncate(&txt, 400)));
                    }
                    return self.extract(model, &txt);
                }
                Err(e) => {
                    if attempt >= self.max_retries {
                        return Err(anyhow!("request error for {}: {}", model.id(), e));
                    }
                    self.backoff(attempt).await;
                    attempt += 1;
                    self.usage.retries.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
            }
        }
    }


    async fn backoff(&self, attempt: u32) {
        // exponential backoff with jitter, capped.
        use rand::Rng;
        let base = 500u64 * (1u64 << attempt.min(5));
        let jitter = rand::thread_rng().gen_range(0..400);
        tokio::time::sleep(Duration::from_millis((base + jitter).min(20_000))).await;
    }

    fn record_usage(&self, v: &Value) {
        if let Some(u) = v.get("usage") {
            let it = u
                .get("input_tokens")
                .or_else(|| u.get("prompt_tokens"))
                .or_else(|| u.get("total_input_tokens"))
                .and_then(|x| x.as_u64())
                .unwrap_or(0);
            let ot = u
                .get("output_tokens")
                .or_else(|| u.get("completion_tokens"))
                .or_else(|| u.get("total_output_tokens"))
                .and_then(|x| x.as_u64())
                .unwrap_or(0);
            self.usage.input_tokens.fetch_add(it, Ordering::Relaxed);
            self.usage.output_tokens.fetch_add(ot, Ordering::Relaxed);
        }
    }

    fn extract(&self, model: Model, txt: &str) -> Result<String> {
        let v: Value = serde_json::from_str(txt)
            .with_context(|| format!("non-JSON response from {}: {}", model.id(), truncate(txt, 300)))?;
        self.record_usage(&v);
        if model.provider() == Provider::Anthropic {
            // Anthropic Messages API: content is an array of blocks; take the text block(s).
            if let Some(arr) = v.get("content").and_then(|c| c.as_array()) {
                for block in arr {
                    if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                            return Ok(text.to_string());
                        }
                    }
                }
            }
            return Err(anyhow!("no text block in Anthropic response for {}", model.id()));
        }
        if model.uses_responses() {
            // Prefer a top-level convenience field, else find the message item.
            if let Some(s) = v.get("output_text").and_then(|x| x.as_str()) {
                if !s.is_empty() {
                    return Ok(s.to_string());
                }
            }
            if let Some(arr) = v.get("output").and_then(|x| x.as_array()) {
                for item in arr {
                    if item.get("type").and_then(|t| t.as_str()) == Some("message") {
                        if let Some(text) = item
                            .get("content")
                            .and_then(|c| c.as_array())
                            .and_then(|c| c.first())
                            .and_then(|c0| c0.get("text"))
                            .and_then(|t| t.as_str())
                        {
                            return Ok(text.to_string());
                        }
                    }
                }
            }
            // Some responses are flagged incomplete (token budget consumed by reasoning).
            let status = v.get("status").and_then(|s| s.as_str()).unwrap_or("?");
            Err(anyhow!("no message in /responses output (status={}) for {}", status, model.id()))
        } else {
            v.get("choices")
                .and_then(|c| c.as_array())
                .and_then(|c| c.first())
                .and_then(|c0| c0.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| anyhow!("no choices[0].message.content for {}", model.id()))
        }
    }
}

/// Recognize explicit per-day quota errors from legacy providers.
pub fn is_daily_quota_exhausted(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    lower.contains("perday") || lower.contains("per day")
}

/// Parse a provider's "retry in 42.2s" / "retryDelay": "42s" hint from a 429 body.
/// Capped so a bad hint cannot stall a request for long.
pub fn retry_after_hint(body: &str) -> Option<Duration> {
    let lower = body.to_ascii_lowercase();
    let idx = lower.find("retry in ").map(|i| i + "retry in ".len())
        .or_else(|| lower.find("\"retrydelay\"").and_then(|i| lower[i..].find(':').map(|j| i + j + 1)))?;
    let rest: String = lower[idx..].chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    let secs: f64 = rest.parse().ok()?;
    if secs <= 0.0 { return None; }
    Some(Duration::from_millis(((secs + 1.0) * 1000.0).min(75_000.0) as u64))
}

fn truncate(s: &str, n: usize) -> String {
    if s.len() <= n {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(n).collect::<String>())
    }
}

/// Strip markdown code fences and isolate the first JSON value in a model reply.
pub fn extract_json(text: &str) -> Result<Value> {
    let t = text.trim();
    let t = t.strip_prefix("```json").or_else(|| t.strip_prefix("```")).unwrap_or(t);
    let t = t.strip_suffix("```").unwrap_or(t);
    let t = t.trim();
    // Try whole string, then the first {...} or [...] block.
    if let Ok(v) = serde_json::from_str::<Value>(t) {
        return Ok(v);
    }
    let start = t.find(['{', '[']);
    let end = t.rfind(['}', ']']);
    if let (Some(s), Some(e)) = (start, end) {
        if e > s {
            if let Ok(v) = serde_json::from_str::<Value>(&t[s..=e]) {
                return Ok(v);
            }
        }
    }
    Err(anyhow!("could not parse JSON from model reply: {}", truncate(text, 200)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_parse_and_shape() {
        assert_eq!(Model::parse("gpt-4o").id(), "gpt-4o");
        assert_eq!(Model::parse("GPT-5.5").id(), "gpt-5.5");
        assert_eq!(Model::parse("grok-4.3").id(), "grok-4.3");
        assert_eq!(Model::parse("jev-1.13.0").id(), "jev-1.13.0");
        assert_eq!(Model::Jev.provider(), Provider::Jev);
        assert!(Model::Gpt4o.uses_responses());
        assert!(Model::Gpt55.uses_responses());
        assert!(!Model::Grok43.uses_responses());

        let mut client = offline_client();
        assert_eq!(client.health_model(), None);
        client.jev_key = "test".to_string();
        assert_eq!(client.health_model(), Some(Model::default_live()));
    }

    #[test]
    fn extract_json_strips_fences() {
        let v = extract_json("```json\n{\"a\": 1}\n```").unwrap();
        assert_eq!(v["a"], 1);
        let v2 = extract_json("here you go: [1,2,3] done").unwrap();
        assert_eq!(v2[2], 3);
        let v3 = extract_json("{\"x\": {\"y\": 2}}").unwrap();
        assert_eq!(v3["x"]["y"], 2);
    }

    #[test]
    fn extract_responses_message_skips_reasoning() {
        let client = offline_client();
        let body = serde_json::json!({
            "output": [
                {"type": "reasoning", "content": []},
                {"type": "message", "content": [{"type":"output_text","text":"HELLO"}]}
            ]
        })
        .to_string();
        assert_eq!(client.extract(Model::Gpt55, &body).unwrap(), "HELLO");
    }

    #[test]
    fn extract_chat_completions() {
        let client = offline_client();
        let body = serde_json::json!({
            "choices": [{"message": {"role":"assistant","content":"WORLD"}}]
        })
        .to_string();
        assert_eq!(client.extract(Model::Grok43, &body).unwrap(), "WORLD");
    }

    #[tokio::test]
    async fn jev_retries_validates_and_replays_cache_offline() {
        use axum::{http::StatusCode, response::IntoResponse, Json};
        use std::collections::BTreeMap;
        use crate::jev::Question;
        let attempts = Arc::new(AtomicU64::new(0));
        let seen = attempts.clone();
        let app = axum::Router::new().route("/v1/systemone", axum::routing::post(move |Json(body): Json<Value>| {
            let seen = seen.clone();
            async move {
                if body["state"] == "unauthorized" {
                    return (StatusCode::UNAUTHORIZED, "never expose provider body or credentials").into_response();
                }
                if body["state"] == "malformed" {
                    return Json(json!({"model":"jev-1.13.0","answers":{}})).into_response();
                }
                if seen.fetch_add(1, Ordering::Relaxed) == 0 {
                    return (StatusCode::TOO_MANY_REQUESTS, [("retry-after", "0")], "rate limit").into_response();
                }
                Json(json!({"model":"jev-1.13.0", "answers":{"ready":{"type":"noul","noul":0.9}},
                    "usage":{"input_tokens":9,"output_tokens":2}})).into_response()
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut client = offline_client();
        client.offline = false;
        client.max_retries = 1;
        client.jev_key = "fixture-only".into();
        client.jev_url = format!("http://{}/v1/systemone", listener.local_addr().unwrap());
        client.cache = Some(Arc::new(Cache::open(":memory:").unwrap()));
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
        let questions = BTreeMap::from([("ready".into(),Question::noul("Ready?"))]);
        let result = client.evaluate(Model::Jev, json!("ready"), questions.clone()).await.unwrap();
        assert_eq!(result.answer("ready").unwrap().noul().unwrap(), 0.9);
        assert_eq!(attempts.load(Ordering::Relaxed), 2);
        assert_eq!(client.usage.snapshot().retries, 1);
        assert_eq!(client.usage.snapshot().input_tokens, 9);
        let error = client.evaluate(Model::Jev, json!("unauthorized"), questions.clone()).await.unwrap_err().to_string();
        assert!(error.contains("401"));
        assert!(!error.contains("never expose"));
        assert!(client.evaluate(Model::Jev, json!("malformed"), questions.clone()).await.is_err());
        client.offline = true;
        assert!(client.evaluate(Model::Jev, json!("ready"), questions.clone()).await.is_ok());
        assert!(client.evaluate(Model::Jev, json!("malformed"), questions.clone()).await.unwrap_err().to_string().contains("cache miss"));
        let changed = BTreeMap::from([("ready".into(),Question::noul("Different criteria?"))]);
        assert!(client.evaluate(Model::Jev, json!("ready"), changed).await.is_err());
        task.abort();
    }

    fn offline_client() -> ModelClient {
        ModelClient {
            http: reqwest::Client::new(),
            base: DEFAULT_BASE.to_string(),
            api_key: String::new(),
            anthropic_key: String::new(),
            anthropic_url: "https://api.anthropic.com/v1/messages".to_string(),
            jev_key: String::new(),
            gemini_key: String::new(),
            voice_url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent".into(),
            voice_model: "gemini-3.5-flash-lite".into(),
            jev_url: "https://api.typesafe.ai/v1/systemone".to_string(),
            sem: Arc::new(Semaphore::new(1)),
            max_retries: 0,
            cache: None,
            usage: Arc::new(Usage::default()),
            offline: true,
        }
    }
}

#[cfg(test)]
mod retry_hint_tests {
    use super::retry_after_hint;
    #[test]
    fn detects_daily_quota() {
        assert!(super::is_daily_quota_exhausted(r#"{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}"#));
        assert!(!super::is_daily_quota_exhausted(r#"{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel"}"#));
    }

    #[test]
    fn parses_retry_hints() {
        let d = retry_after_hint("... limit: 20, model: example\nPlease retry in 42.224655338s.").unwrap();
        assert!((d.as_secs_f64() - 43.22).abs() < 0.05);
        let d = retry_after_hint(r#"{"details":[{"retryDelay":"7s"}]}"#).unwrap();
        assert_eq!(d.as_secs(), 8);
        assert!(retry_after_hint("nothing here").is_none());
        assert!(retry_after_hint("retry in 0s").is_none());
        assert_eq!(retry_after_hint("retry in 9999s").unwrap().as_secs(), 75);
    }
}
