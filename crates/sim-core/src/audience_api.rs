//! Research-to-persona handoff. Deliberately independent of the prediction engine.
use crate::audience_pipeline::{build_panel, BuildRequest, PanelStore};
use crate::{audience_sources, model::ModelClient};
use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Semaphore;

#[derive(Clone)]
pub struct ResearchState {
    pub client: ModelClient,
    pub panels: Arc<PanelStore>,
    gate: Arc<Semaphore>,
}
impl ResearchState {
    pub fn new(client: ModelClient, path: &str) -> anyhow::Result<Self> {
        Ok(Self {
            client,
            panels: Arc::new(PanelStore::open(path)?),
            gate: Arc::new(Semaphore::new(1)),
        })
    }
}

pub fn router(state: ResearchState) -> Router {
    Router::new()
        .route("/audience-research/config", get(config))
        .route("/audience-research/panels", get(list).post(create))
        .route("/audience-research/panels/:id", get(detail))
        .layer(DefaultBodyLimit::max(128 * 1024))
        .with_state(state)
}
type Reply = (StatusCode, Json<Value>);
fn error(status: StatusCode, message: &str) -> Reply {
    (status, Json(json!({"error":message})))
}
async fn config(State(st): State<ResearchState>) -> Json<Value> {
    Json(
        json!({"search_configured":audience_sources::search_configured(),"jev_configured":st.client.has_key(),"max_sources":8,"max_panel_size":12,"scope":"persona_data_only"}),
    )
}
async fn list(State(st): State<ResearchState>) -> Reply {
    match st.panels.list() {
        Ok(panels) => (StatusCode::OK, Json(json!({"panels":panels}))),
        Err(_) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not read saved audience panels.",
        ),
    }
}
#[derive(Deserialize)]
struct Version {
    version: Option<u32>,
}
async fn detail(
    State(st): State<ResearchState>,
    Path(id): Path<String>,
    Query(q): Query<Version>,
) -> Reply {
    match st.panels.get(&id, q.version) {
        Ok(Some(panel)) => (StatusCode::OK, Json(json!(panel))),
        Ok(None) => error(StatusCode::NOT_FOUND, "Audience panel version not found."),
        Err(_) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not read the audience panel.",
        ),
    }
}

fn validate(req: &BuildRequest) -> Result<(), &'static str> {
    if !(8..=2000).contains(&req.question.trim().chars().count()) {
        return Err("Enter a research question between 8 and 2000 characters.");
    }
    if !(2..=160).contains(&req.business.trim().chars().count()) {
        return Err("Enter a business or product name between 2 and 160 characters.");
    }
    if req.location.chars().count() > 200 {
        return Err("Location must be at most 200 characters.");
    }
    if !(2..=12).contains(&req.panel_size) {
        return Err("Panel size must be between 2 and 12. Fewer profiles may be returned when evidence is limited.");
    }
    if req.sources.len() > 8 {
        return Err("Use at most 8 sources per panel version.");
    }
    if req.founder_context.chars().count() > 8000 {
        return Err("Founder context must be at most 8000 characters.");
    }
    if req.panel_id.as_ref().is_some_and(|id| {
        id.is_empty()
            || id.len() > 100
            || !id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    }) {
        return Err("Invalid panel ID.");
    }
    for source in &req.sources {
        if source
            .text
            .as_ref()
            .is_some_and(|s| s.chars().count() > 12000)
        {
            return Err("Each pasted source must be at most 12000 characters.");
        }
        if source.url.as_ref().is_some_and(|s| s.len() > 2048) {
            return Err("Source URL is too long.");
        }
        if source
            .title
            .as_ref()
            .is_some_and(|s| s.chars().count() > 240)
        {
            return Err("Source title is too long.");
        }
        if !["web", "review", "reddit", "x", "interview", "official"]
            .contains(&source.kind.as_str())
        {
            return Err("Unsupported source kind.");
        }
        if source.url.as_ref().map_or(true, |s| s.trim().is_empty())
            && source.text.as_ref().map_or(true, |s| s.trim().is_empty())
        {
            return Err("Each source needs a URL or pasted evidence.");
        }
    }
    Ok(())
}

async fn create(
    State(st): State<ResearchState>,
    payload: Result<Json<BuildRequest>, axum::extract::rejection::JsonRejection>,
) -> Reply {
    let Json(mut req) = match payload {
        Ok(req) => req,
        Err(_) => {
            return error(
                StatusCode::BAD_REQUEST,
                "Provide a valid audience research request (maximum 128 KB).",
            )
        }
    };
    if let Err(message) = validate(&req) {
        return error(StatusCode::BAD_REQUEST, message);
    }
    req.question = req.question.trim().to_string();
    req.business = req.business.trim().to_string();
    req.location = req.location.trim().to_string();
    // Revisions must refer to a real lineage; never silently create a new lineage on a typo.
    if let Some(id) = &req.panel_id {
        match st.panels.get(id, None) {
            Ok(Some(previous)) => {
                if previous.question != req.question
                    || previous.business != req.business
                    || previous.location != req.location
                {
                    return error(StatusCode::CONFLICT,"A panel version must keep the same question, business, and location. Start a separate panel for a different audience context.");
                }
            }
            Ok(None) => return error(StatusCode::NOT_FOUND, "Panel to revise does not exist."),
            Err(_) => {
                return error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Could not read saved audience panel.",
                )
            }
        }
    }
    let Ok(_permit) = st.gate.try_acquire() else {
        return error(StatusCode::TOO_MANY_REQUESTS,"Audience research is already running. Wait for it to finish before starting another panel.");
    };
    let result = tokio::time::timeout(std::time::Duration::from_secs(150), async {
        let (sources, warnings) = audience_sources::collect(&req).await?;
        build_panel(&st.client, &req, sources, warnings).await
    })
    .await;
    match result {
        Ok(Ok(panel))=>match st.panels.save(panel) {
            Ok(saved)=>(StatusCode::CREATED,Json(json!(saved))),
            Err(_)=>error(StatusCode::INTERNAL_SERVER_ERROR,"Research completed but could not be saved. No panel version was created."),
        },
        Ok(Err(_))=>error(StatusCode::BAD_GATEWAY,"Audience research could not finish. Check server Jev configuration and source availability; no panel version was saved."),
        Err(_)=>error(StatusCode::GATEWAY_TIMEOUT,"Audience research exceeded its time limit. No panel version was saved; try fewer sources."),
    }
}
