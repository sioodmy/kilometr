use chrono::DateTime;
use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;

use crate::models::{RailStopUpdate, RailTripLive};

#[derive(Debug, Deserialize)]
struct RawStopTimeUpdate {
    stop_sequence: i32,
    stop_id: Option<String>,
    arrival: Option<String>,
    departure: Option<String>,
    #[serde(default)]
    confirmed: bool,
    #[serde(default)]
    cancelled: bool,
    platform: Option<String>,
    track: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawTripUpdate {
    trip_id: String,
    start_date: Option<String>,
    agency_id: Option<String>,
    #[serde(default)]
    numbers: Vec<String>,
    #[serde(default)]
    cancelled: bool,
    #[serde(default)]
    detour: bool,
    #[serde(default)]
    stop_times: Vec<RawStopTimeUpdate>,
}

#[derive(Debug, Deserialize)]
struct RawFeed {
    timestamp: Option<String>,
    #[serde(default)]
    trip_updates: Vec<RawTripUpdate>,
}

pub enum RailFetchOutcome {
    NotModified,
    Updated {
        by_trip_id: HashMap<String, RailTripLive>,
        by_number: HashMap<String, Vec<RailTripLive>>,
        timestamp_iso: String,
        etag: String,
    },
}

pub async fn fetch_plk_updates(
    client: &Client,
    url: &str,
    last_etag: &str,
) -> Result<RailFetchOutcome, String> {
    let mut req = client.get(url);
    if !last_etag.is_empty() {
        req = req.header("If-None-Match", last_etag);
    }
    let resp = req.send().await.map_err(|e| format!("plk_updates: {e}"))?;
    if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(RailFetchOutcome::NotModified);
    }
    if !resp.status().is_success() {
        return Err(format!("plk_updates HTTP {}", resp.status()));
    }

    let etag = resp
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let raw: RawFeed = resp
        .json()
        .await
        .map_err(|e| format!("plk_updates JSON: {e}"))?;

    let timestamp_iso = raw
        .timestamp
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let feed_ms = DateTime::parse_from_rfc3339(&timestamp_iso)
        .map(|d| d.timestamp_millis())
        .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis());

    let mut by_trip_id: HashMap<String, RailTripLive> = HashMap::with_capacity(raw.trip_updates.len() * 2);
    let mut by_number: HashMap<String, Vec<RailTripLive>> = HashMap::new();

    for u in raw.trip_updates {
        let norm_id = u.trip_id.trim().to_string();
        if norm_id.is_empty() {
            continue;
        }
        let finished = is_finished(&u, feed_ms);
        let summarized = summarize(&norm_id, &u);

        insert_if_better(&mut by_trip_id, norm_id.clone(), summarized.clone(), finished);
        insert_if_better(
            &mut by_trip_id,
            format!("pl:{norm_id}"),
            summarized.clone(),
            finished,
        );
        if let Some(stripped) = norm_id.strip_prefix("PLK_") {
            insert_if_better(
                &mut by_trip_id,
                stripped.to_string(),
                summarized.clone(),
                finished,
            );
        }

        for num in &summarized.numbers {
            let entry = by_number.entry(num.clone()).or_default();
            if !finished {
                entry.insert(0, summarized.clone());
            } else {
                entry.push(summarized.clone());
            }
        }
    }

    Ok(RailFetchOutcome::Updated {
        by_trip_id,
        by_number,
        timestamp_iso,
        etag,
    })
}

fn is_finished(u: &RawTripUpdate, feed_ms: i64) -> bool {
    let Some(last) = u.stop_times.last() else {
        return false;
    };
    let Some(iso) = last.arrival.as_deref().or(last.departure.as_deref()) else {
        return false;
    };
    DateTime::parse_from_rfc3339(iso)
        .map(|d| d.timestamp_millis() < feed_ms - 15 * 60_000)
        .unwrap_or(false)
}

fn insert_if_better(
    map: &mut HashMap<String, RailTripLive>,
    key: String,
    candidate: RailTripLive,
    candidate_finished: bool,
) {
    match map.get(&key) {
        None => {
            map.insert(key, candidate);
        }
        Some(existing) => {
            if !candidate_finished
                && candidate.start_date.as_deref().unwrap_or("")
                    >= existing.start_date.as_deref().unwrap_or("")
            {
                map.insert(key, candidate);
            }
        }
    }
}

fn summarize(trip_id: &str, u: &RawTripUpdate) -> RailTripLive {
    let mut last_confirmed_seq = None;
    let stops: Vec<RailStopUpdate> = u
        .stop_times
        .iter()
        .map(|st| {
            if st.confirmed {
                last_confirmed_seq = Some(st.stop_sequence);
            }
            RailStopUpdate {
                seq: st.stop_sequence,
                stop_id: st.stop_id.clone(),
                arr: st.arrival.clone(),
                dep: st.departure.clone(),
                platform: st.platform.clone().filter(|p| !p.is_empty()),
                track: st.track.clone().filter(|t| !t.is_empty()),
                confirmed: st.confirmed,
                cancelled: st.cancelled,
            }
        })
        .collect();

    RailTripLive {
        trip_id: trip_id.to_string(),
        start_date: u.start_date.clone(),
        agency: u.agency_id.clone().unwrap_or_default(),
        numbers: u.numbers.clone(),
        cancelled: u.cancelled,
        detour: u.detour,
        delay_sec: 0,
        last_confirmed_seq,
        stops,
    }
}
