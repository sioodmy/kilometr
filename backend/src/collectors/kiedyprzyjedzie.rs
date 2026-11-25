use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use dashmap::DashMap;
use reqwest::Client;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

use crate::cities::CityConfig;
use crate::models::{UpcomingStop, VehicleSnapshot};

const STOPS_CACHE_TTL_MS: i64 = 6 * 3_600_000;
const MAX_HUB_STOPS: usize = 24;
const MAX_EXEC_PER_CITY: usize = 25;

#[derive(Debug, Clone)]
struct KpStop {
    place_id: String,
    name: String,
    only_disembarking: bool,
    is_station: bool,
}

#[derive(Debug, Clone)]
struct CachedStops {
    fetched_at_ms: i64,
    stops: Vec<KpStop>,
}

#[derive(Debug, Deserialize)]
struct KpStopsResponse {
    #[serde(default)]
    stops: Vec<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
struct KpDepartureRow {
    time: Option<String>,
    time_diff: Option<i32>,
    #[serde(default)]
    canceled: bool,
    #[serde(default)]
    is_estimated: bool,
    line_name: Option<String>,
    trip_execution_id: Option<serde_json::Value>,
    trip_index: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct KpDepartureGroup {
    #[serde(default)]
    rows: Vec<KpDepartureRow>,
}

#[derive(Debug, Deserialize)]
struct KpDeparturesResponse {
    #[serde(default)]
    departures: Vec<KpDepartureGroup>,
}

#[derive(Debug, Deserialize)]
struct KpTripExecVehicle {
    lat: Option<f64>,
    lon: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct KpTripExecLine {
    name: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
}

#[derive(Debug, Deserialize)]
struct KpTripExecTime {
    stop_name: Option<String>,
    departure_time: Option<String>,
}

#[derive(Debug, Deserialize)]
struct KpTripExecTrip {
    direction: Option<String>,
    line: Option<KpTripExecLine>,
    #[serde(default)]
    times: Vec<KpTripExecTime>,
}

#[derive(Debug, Deserialize)]
struct KpTripExecResponse {
    vehicle: Option<KpTripExecVehicle>,
    trip: Option<KpTripExecTrip>,
}

pub struct KpCollectorCache {
    stops: DashMap<String, CachedStops>,
}

impl KpCollectorCache {
    pub fn new() -> Self {
        Self {
            stops: DashMap::new(),
        }
    }

    pub async fn fetch_city_positions(
        &self,
        client: &Client,
        city: &CityConfig,
    ) -> Result<Vec<VehicleSnapshot>, String> {
        let Some(ref prefix) = city.kp_prefix else {
            return Ok(Vec::new());
        };
        let stops = self.load_stops(client, prefix).await?;
        let selected_ids = select_hub_stops(&stops);
        if selected_ids.is_empty() {
            return Ok(Vec::new());
        }

        let ids_joined = selected_ids.join(",");
        let dep_url = format!("https://{prefix}.kiedyprzyjedzie.pl/api/departures/{ids_joined}");
        let resp = client
            .get(&dep_url)
            .header("X-Requested-With", "XMLHttpRequest")
            .send()
            .await
            .map_err(|e| format!("kp departures {prefix}: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("kp departures {prefix} HTTP {}", resp.status()));
        }
        let parsed: KpDeparturesResponse = resp
            .json()
            .await
            .map_err(|e| format!("kp departures {prefix} JSON: {e}"))?;

        let now_ms = jiff::Timestamp::now().as_millisecond();
        let now_sec = epoch_ms_to_warsaw_sec(now_ms);
        let mut seen_exec = HashSet::new();
        let mut candidates: Vec<(String, i32, String, Option<i32>)> = Vec::new();

        for group in parsed.departures {
            for row in group.rows {
                if row.canceled || !row.is_estimated {
                    continue;
                }
                let Some(line) = row.line_name.as_deref().map(|l| l.trim()).filter(|l| !l.is_empty()) else {
                    continue;
                };
                if let Some(eta_min) = row.time.as_deref().and_then(parse_eta_min) {
                    if eta_min > 50 {
                        continue;
                    }
                }
                let exec_id = match row.trip_execution_id {
                    Some(serde_json::Value::String(s)) if !s.trim().is_empty() => s.trim().to_string(),
                    Some(serde_json::Value::Number(n)) => n.to_string(),
                    _ => continue,
                };
                if !seen_exec.insert(exec_id.clone()) {
                    continue;
                }
                let idx = row.trip_index.unwrap_or(0);
                // time_diff z kiedyprzyjedzie: dodatnie oznacza opoznienie w sekundach (lub ujemne przed czasem).
                candidates.push((exec_id, idx, line.to_string(), row.time_diff));
                if candidates.len() >= MAX_EXEC_PER_CITY {
                    break;
                }
            }
            if candidates.len() >= MAX_EXEC_PER_CITY {
                break;
            }
        }

        let mut out = Vec::new();
        // Ograniczone odpytywanie trip_execution po 4 rownolegle, aby nie przeciazac malych miast.
        let mut iter = candidates.into_iter();
        loop {
            let mut chunk = Vec::with_capacity(4);
            for _ in 0..4 {
                if let Some(c) = iter.next() {
                    chunk.push(c);
                }
            }
            if chunk.is_empty() {
                break;
            }
            let mut set = tokio::task::JoinSet::new();
            for (exec_id, idx, line, time_diff) in chunk {
                let b64 = B64.encode(exec_id.as_bytes());
                let url = format!(
                    "https://{prefix}.kiedyprzyjedzie.pl/api/trip_execution/{}/{}",
                    urlencoding::encode(&b64),
                    idx
                );
                let client_c = client.clone();
                let prefix_c = prefix.clone();
                let city_id = city.id.clone();
                set.spawn(async move {
                    let res = client_c
                        .get(&url)
                        .header("X-Requested-With", "XMLHttpRequest")
                        .send()
                        .await
                        .ok()?;
                    if !res.status().is_success() {
                        return None;
                    }
                    let body: KpTripExecResponse = res.json().await.ok()?;
                    let veh = body.vehicle?;
                    let lat = veh.lat?;
                    let lon = veh.lon?;
                    if !lat.is_finite() || !lon.is_finite() || (lat == 0.0 && lon == 0.0) {
                        return None;
                    }
                    let trip = body.trip;
                    let resolved_line = trip
                        .as_ref()
                        .and_then(|t| t.line.as_ref())
                        .and_then(|l| l.name.as_deref())
                        .map(|s| s.trim())
                        .filter(|s| !s.is_empty())
                        .unwrap_or(&line)
                        .to_string();
                    let mode = match trip
                        .as_ref()
                        .and_then(|t| t.line.as_ref())
                        .and_then(|l| l.kind.as_deref())
                    {
                        Some("tram") => "tram",
                        Some("trolleybus") => "trolleybus",
                        _ => "bus",
                    };
                    let mut upcoming = Vec::new();
                    if let Some(ref t) = trip {
                        for st in &t.times {
                            if let (Some(name), Some(dep)) =
                                (st.stop_name.as_deref(), st.departure_time.as_deref())
                            {
                                if let Some(sec) = parse_hhmm_sec(dep, now_sec) {
                                    if sec >= now_sec - 300 {
                                        upcoming.push(UpcomingStop {
                                            name: name.trim().to_string(),
                                            sched_sec: sec,
                                        });
                                    }
                                }
                            }
                        }
                    }
                    let current_stop = upcoming.first().map(|s| s.name.clone());
                    let next_stop = upcoming.get(1).map(|s| s.name.clone());

                    Some(VehicleSnapshot {
                        city: city_id,
                        vehicle_id: format!("kp:{exec_id}"),
                        line: resolved_line,
                        mode: mode.to_string(),
                        lat,
                        lon,
                        bearing: None,
                        delay_sec: time_diff,
                        timestamp_ms: now_ms,
                        headsign: trip.and_then(|t| t.direction).filter(|d| !d.trim().is_empty()),
                        brigade: None,
                        model: None,
                        agency: Some(prefix_c),
                        current_stop,
                        next_stop,
                        upcoming_stops: upcoming,
                        source: "kp".to_string(),
                        is_rail: false,
                    })
                });
            }
            while let Some(joined) = set.join_next().await {
                if let Ok(Some(v)) = joined {
                    out.push(v);
                }
            }
        }

        // Gdy brak pelnych pozycji, fallback z przystankami zachowuje stabilnosc bez bledu.
        let mut dedup: HashMap<String, VehicleSnapshot> = HashMap::with_capacity(out.len());
        for v in out {
            dedup.insert(v.vehicle_id.clone(), v);
        }
        Ok(dedup.into_values().collect())
    }

    async fn load_stops(&self, client: &Client, prefix: &str) -> Result<Vec<KpStop>, String> {
        let now_ms = jiff::Timestamp::now().as_millisecond();
        if let Some(entry) = self.stops.get(prefix) {
            if now_ms - entry.fetched_at_ms < STOPS_CACHE_TTL_MS {
                return Ok(entry.stops.clone());
            }
        }
        let url = format!("https://{prefix}.kiedyprzyjedzie.pl/stops");
        let resp = client
            .get(&url)
            .header("X-Requested-With", "XMLHttpRequest")
            .send()
            .await
            .map_err(|e| format!("kp stops {prefix}: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("kp stops {prefix} HTTP {}", resp.status()));
        }
        let parsed: KpStopsResponse = resp
            .json()
            .await
            .map_err(|e| format!("kp stops {prefix} JSON: {e}"))?;

        let mut list = Vec::with_capacity(parsed.stops.len());
        for row in parsed.stops {
            if row.len() < 5 {
                continue;
            }
            let place_id = match &row[0] {
                serde_json::Value::String(s) => s.trim().to_string(),
                serde_json::Value::Number(n) => n.to_string(),
                _ => continue,
            };
            let lon = row[3].as_f64().unwrap_or(0.0) / 1e6;
            let lat = row[4].as_f64().unwrap_or(0.0) / 1e6;
            if place_id.is_empty() || !lat.is_finite() || !lon.is_finite() || (lat == 0.0 && lon == 0.0)
            {
                continue;
            }
            let name = row[2].as_str().unwrap_or("").trim().to_string();
            let only_disembarking = row.get(5).and_then(|v| v.as_i64()) == Some(1);
            let is_station = row.get(6).and_then(|v| v.as_i64()) == Some(1);
            list.push(KpStop {
                place_id,
                name,
                only_disembarking,
                is_station,
            });
        }
        self.stops.insert(
            prefix.to_string(),
            CachedStops {
                fetched_at_ms: now_ms,
                stops: list.clone(),
            },
        );
        Ok(list)
    }
}

fn select_hub_stops(stops: &[KpStop]) -> Vec<String> {
    let boardable: Vec<&KpStop> = stops.iter().filter(|s| !s.only_disembarking).collect();
    if boardable.len() <= MAX_HUB_STOPS {
        return boardable.iter().map(|s| s.place_id.clone()).collect();
    }
    let mut selected = Vec::with_capacity(MAX_HUB_STOPS);
    let mut seen = HashSet::new();

    // Najpierw dworce i wezly przesiadkowe (is_station), potem rownomiernie po liscie.
    for s in boardable.iter().filter(|s| s.is_station || s.name.to_lowercase().contains("dworzec")) {
        if selected.len() >= MAX_HUB_STOPS {
            break;
        }
        if seen.insert(s.place_id.clone()) {
            selected.push(s.place_id.clone());
        }
    }
    let remaining = MAX_HUB_STOPS.saturating_sub(selected.len()).max(1);
    let step = (boardable.len() / remaining).max(1);
    let mut i = 0;
    while i < boardable.len() && selected.len() < MAX_HUB_STOPS {
        let id = &boardable[i].place_id;
        if seen.insert(id.clone()) {
            selected.push(id.clone());
        }
        i += step;
    }
    selected
}

fn parse_eta_min(raw: &str) -> Option<u32> {
    let s = raw.trim().to_ascii_lowercase();
    if s.starts_with("< 1") || s.starts_with("<1") {
        return Some(0);
    }
    let num_part = s.split_whitespace().next()?;
    if s.contains("min") {
        num_part.parse::<u32>().ok()
    } else {
        None
    }
}

fn parse_hhmm_sec(raw: &str, min_sec: i32) -> Option<i32> {
    let mut parts = raw.trim().split(':');
    let h: i32 = parts.next()?.parse().ok()?;
    let m: i32 = parts.next()?.parse().ok()?;
    let s: i32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut sec = h * 3600 + m * 60 + s;
    if sec < min_sec - 6 * 3600 {
        sec += 86_400;
    }
    Some(sec)
}

fn epoch_ms_to_warsaw_sec(ms: i64) -> i32 {
    let ts = jiff::Timestamp::from_millisecond(ms).unwrap_or_else(|_| jiff::Timestamp::now());
    let dt = ts
        .in_tz("Europe/Warsaw")
        .unwrap_or_else(|_| ts.to_zoned_datetime(jiff::tz::TimeZone::UTC));
    i32::from(dt.hour()) * 3600 + i32::from(dt.minute()) * 60 + i32::from(dt.second())
}
