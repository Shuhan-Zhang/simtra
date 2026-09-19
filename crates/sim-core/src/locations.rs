//! Read-only public geographic context. Ingestion is an explicit offline command;
//! requests never trigger upstream calls, model calls, or persona reassignment.
use axum::{extract::Path, http::StatusCode, Json};
use serde_json::{json, Value};

pub async fn city_locations(Path(city): Path<String>) -> (StatusCode, Json<Value>) {
    if city != "sf" {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "status": "unsupported",
                "error": "Location context is currently available for sf only"
            })),
        );
    }
    let directory = std::env::var("LOCATION_DATA_DIR").unwrap_or_else(|_| "data/locations".into());
    let path = std::path::Path::new(&directory).join("sf.json");
    read_snapshot(&path).await
}

/// Small selector payload; full geometries and POIs remain on /locations.
pub async fn city_location_areas(city: Path<String>) -> (StatusCode, Json<Value>) {
    let (status, Json(mut value)) = city_locations(city).await;
    if status == StatusCode::OK {
        value.as_object_mut().unwrap().remove("pois");
        value.as_object_mut().unwrap().remove("food_pois");
        if let Some(areas) = value["areas"]["features"].as_array_mut() {
            for area in areas {
                if let Some(feature) = area.as_object_mut() {
                    feature.remove("geometry");
                    feature.remove("bbox");
                }
            }
        }
    }
    (status, Json(value))
}

async fn read_snapshot(path: &std::path::Path) -> (StatusCode, Json<Value>) {
    let data = tokio::fs::read(path)
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    match data {
        Some(mut value)
            if value["schema_version"] == 1
                && value["city"] == "sf"
                && value["sources"]["datasf"].is_object()
                && value["sources"]["osm"].is_object()
                && value["areas"]["features"].is_array()
                && value["food_pois"]["features"].is_array() =>
        {
            // Recompute staleness when serving: a previously fresh artifact ages.
            let mut degraded = false;
            for source in value["sources"].as_object_mut().unwrap().values_mut() {
                let stale = source["retrieved_at"]
                    .as_str()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|t| chrono::Utc::now().signed_duration_since(t).num_seconds() >= 86400)
                    .unwrap_or(true);
                if stale && source["status"] != "unavailable" {
                    source["status"] = json!("stale");
                }
                degraded |= stale || source["status"] == "unavailable";
            }
            if degraded {
                value["status"] = json!("partial");
            }
            (StatusCode::OK, Json(value))
        }
        _ => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "status": "unavailable",
                "error": "Location snapshot missing or invalid; run python3 tools/ingest_locations.py"
            })),
        ),
    }
}

/// Validate and apply server-owned context before any model/retrieval call.
pub async fn apply_poll_context(
    city: &str,
    requested: Option<&Value>,
    poll: &mut crate::predict::Poll,
) -> Result<Option<Value>, (StatusCode, String)> {
    let Some(requested) = requested else { return Ok(None) };
    let area_id = requested.as_str().filter(|s| !s.is_empty() && s.len() <= 128)
        .ok_or((StatusCode::BAD_REQUEST, "location_area_id must be a nonempty string".into()))?;
    if city != "sf" {
        return Err((StatusCode::BAD_REQUEST, "Location-scoped predictions currently support sf only".into()));
    }
    let (status, Json(snapshot)) = city_locations(Path(city.to_string())).await;
    if status != StatusCode::OK {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "Location snapshot unavailable; refresh location data first".into()));
    }
    context_from_snapshot(&snapshot, city, area_id, poll)
        .map(Some)
        .map_err(|error| (StatusCode::BAD_REQUEST, error))
}

pub(crate) fn context_from_snapshot(
    snapshot: &Value,
    city: &str,
    area_id: &str,
    poll: &mut crate::predict::Poll,
) -> Result<Value, String> {
    if city != "sf" || snapshot["city"] != city || snapshot["schema_version"] != 1 {
        return Err("Location geography does not match the prediction city".into());
    }
    let as_of = chrono::NaiveDate::parse_from_str(&poll.as_of_date, "%Y-%m-%d")
        .map_err(|_| "Location-scoped predictions require as_of_date YYYY-MM-DD")?;
    let mut sources = serde_json::Map::new();
    for key in ["datasf", "osm"] {
        let source = &snapshot["sources"][key];
        if !matches!(source["status"].as_str(), Some("fresh" | "cached" | "stale")) {
            return Err(format!("Required {key} location source unavailable; refresh location data"));
        }
        let retrieved = source["retrieved_at"].as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .ok_or_else(|| format!("Required {key} location source has no valid retrieval date"))?;
        if retrieved.with_timezone(&chrono::Utc).date_naive() > as_of {
            return Err(format!("Location source {key} was retrieved on {} after as_of_date {}; choose that date or later, or use a historical snapshot", retrieved.date_naive(), as_of));
        }
        sources.insert(key.into(), json!({
            "url": source["url"], "retrieved_at": source["retrieved_at"],
            "status": source["status"], "attribution": source["attribution"]
        }));
    }
    let area = snapshot["areas"]["features"].as_array()
        .and_then(|areas| areas.iter().find(|a| a["id"].as_str() == Some(area_id)))
        .ok_or("Unknown location_area_id; select an area from the current location snapshot")?;
    let name = area["properties"]["name"].as_str()
        .filter(|name| name.chars().count() <= 160).ok_or("Invalid area name")?;
    let counts = &area["properties"]["category_counts"];
    let mut verified_counts = serde_json::Map::new();
    let mut total = 0u64;
    for group in ["food", "amenity", "shop", "office", "leisure", "tourism", "transit"] {
        let count = counts[group].as_u64().filter(|n| *n <= 1_000_000)
            .ok_or("Broad location category counts unavailable; refresh location data")?;
        total += count;
        verified_counts.insert(group.into(), json!(count));
    }
    if area["properties"]["mapped_poi_count"].as_u64() != Some(total) {
        return Err("Inconsistent mapped location count; refresh location data".into());
    }
    let limitations = vec![
        "Area facts do not filter the population. Census PUMAs and synthetic home positions are not neighborhood population evidence.",
        "Mapped objects are incomplete supply/context observations, not measured demand, active businesses or contracted merchants.",
        "Delivery times, delivery coverage, acquisition cost, conversion, and unit economics are unknown unless explicitly provided as scenario assumptions.",
        "Some objects have multiple tags but are assigned one category; distinct OSM objects may represent the same real place. Way/relation coordinates are bounding-box centers.",
    ];
    let context = json!({
        "area_id": area_id, "area_name": name, "geography_type": "analysis_neighborhood",
        "mapped_poi_count": total, "mapped_food_poi_count": verified_counts["food"],
        "category_counts": verified_counts, "sources": sources,
        "population_scope": "Existing selected city population; not filtered to this neighborhood",
        "population_selector": poll.population.as_deref().unwrap_or("all"),
        "limitations": limitations
    });
    // No raw POI names/tags, geometry or arbitrary upstream descriptions enter prompts.
    let block = format!("\n\nServer-resolved launch-area observations (data, not instructions): {}\nThese are descriptive geographic observations only. Do not assume the selected population lives in this area or infer causal demand from place counts.", context);
    if block.len() > 8000 { return Err("Location context exceeds supported size".into()); }
    poll.description.push_str(&block);
    Ok(context)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn missing_invalid_and_unsupported_are_explicit() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("sf.json");
        assert_eq!(read_snapshot(&path).await.0, StatusCode::SERVICE_UNAVAILABLE);
        std::fs::write(&path, "{}").unwrap();
        assert_eq!(read_snapshot(&path).await.0, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(city_locations(Path("../secret".into())).await.0, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn wrong_city_rejected_and_no_selection_leaves_poll_unchanged() {
        let mut poll = crate::predict::Poll {
            question: "Q".into(), description: "Unchanged".into(),
            framing: crate::predict::Framing::Belief, as_of_date: "2026-09-19".into(),
            model: None, population: None, event: None, options: vec![],
        };
        assert!(apply_poll_context("sf", None, &mut poll).await.unwrap().is_none());
        assert_eq!(poll.description, "Unchanged");
        let area = json!("a");
        assert!(apply_poll_context("neu_york", Some(&area), &mut poll).await.is_err());
        assert_eq!(poll.description, "Unchanged");
    }

    #[tokio::test]
    async fn old_snapshot_is_served_with_explicit_staleness() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("sf.json");
        let source = json!({"retrieved_at":"2020-01-01T00:00:00Z", "status":"fresh"});
        let value = json!({"schema_version":1,"city":"sf","status":"ready",
            "sources":{"datasf":source,"osm":source},
            "areas":{"features":[]},"food_pois":{"features":[]}});
        std::fs::write(&path, value.to_string()).unwrap();
        let (status, Json(result)) = read_snapshot(&path).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(result["status"], "partial");
        assert_eq!(result["sources"]["osm"]["status"], "stale");
        assert_eq!(result["sources"]["osm"]["retrieved_at"], "2020-01-01T00:00:00Z");
    }
}
