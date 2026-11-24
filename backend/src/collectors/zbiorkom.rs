use chrono::{TimeZone, Timelike, Utc};
use chrono_tz::Europe::Warsaw;
use reqwest::Client;
use serde::Deserialize;

use crate::cities::CityConfig;
use crate::models::{UpcomingStop, VehicleSnapshot};

#[derive(Debug, Deserialize)]
struct ZbResponse {
    #[serde(default)]
    positions: Vec<ZbPosition>,
}

#[derive(Debug, Deserialize)]
struct ZbVehicle {
    id: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    agency: Option<String>,
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ZbUpcomingStop {
    name: Option<String>,
    #[serde(rename = "scheduledArrival")]
    scheduled_arrival: Option<i64>,
    #[serde(rename = "scheduledDeparture")]
    scheduled_departure: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ZbPosition {
    vehicle: Option<ZbVehicle>,
    #[serde(rename = "routeName")]
    route_name: Option<String>,
    brigade: Option<String>,
    location: Option<[f64; 2]>,
    timestamp: Option<i64>,
    bearing: Option<f64>,
    delay: Option<f64>,
    headsign: Option<String>,
    #[serde(rename = "upcomingStops")]
    upcoming_stops: Option<Vec<ZbUpcomingStop>>,
}

pub async fn fetch_city_positions(
    client: &Client,
    base_url: &str,
    city: &CityConfig,
) -> Result<Vec<VehicleSnapshot>, String> {
    let mut url = format!(
        "{base_url}/api6-open/{}/positions/{}",
        city.zbiorkom_slug, city.zbiorkom_bbox
    );
    if let Some(ref agencies) = city.zbiorkom_agencies {
        url.push_str("?agencies=");
        url.push_str(&urlencoding::encode(agencies));
    }

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("zbiorkom {}: {e}", city.id))?;
    if !resp.status().is_success() {
        return Err(format!("zbiorkom {} HTTP {}", city.id, resp.status()));
    }
    let parsed: ZbResponse = resp
        .json()
        .await
        .map_err(|e| format!("zbiorkom {} JSON: {e}", city.id))?;

    let now_ms = Utc::now().timestamp_millis();
    Ok(convert_positions(&city.id, parsed.positions, false, "zbiorkom", now_ms))
}

pub async fn fetch_city_rail_positions(
    client: &Client,
    base_url: &str,
    city: &CityConfig,
) -> Result<Vec<VehicleSnapshot>, String> {
    if city.rail_agencies.is_empty() {
        return Ok(Vec::new());
    }
    let agencies = city.rail_agencies.join(",");
    let url = format!(
        "{base_url}/api6-open/pkp/positions/{}?agencies={}",
        city.zbiorkom_bbox,
        urlencoding::encode(&agencies)
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("zbiorkom_rail {}: {e}", city.id))?;
    if !resp.status().is_success() {
        return Err(format!("zbiorkom_rail {} HTTP {}", city.id, resp.status()));
    }
    let parsed: ZbResponse = resp
        .json()
        .await
        .map_err(|e| format!("zbiorkom_rail {} JSON: {e}", city.id))?;

    let now_ms = Utc::now().timestamp_millis();
    Ok(convert_positions(
        &city.id,
        parsed.positions,
        true,
        "zbiorkom_rail",
        now_ms,
    ))
}

fn convert_positions(
    city_id: &str,
    positions: Vec<ZbPosition>,
    is_rail: bool,
    source: &str,
    now_ms: i64,
) -> Vec<VehicleSnapshot> {
    let mut out = Vec::with_capacity(positions.len());
    for p in positions {
        let Some([lon, lat]) = p.location else {
            continue;
        };
        if !lat.is_finite() || !lon.is_finite() || (lat == 0.0 && lon == 0.0) {
            continue;
        }
        let veh = p.vehicle;
        let line = if is_rail {
            p.route_name
                .as_deref()
                .or(p.brigade.as_deref())
                .unwrap_or("")
                .trim()
                .to_string()
        } else {
            p.route_name.as_deref().unwrap_or("").trim().to_string()
        };
        let raw_id = veh
            .as_ref()
            .and_then(|v| v.id.as_deref())
            .or(p.brigade.as_deref())
            .unwrap_or("")
            .trim()
            .to_string();
        if line.is_empty() || raw_id.is_empty() {
            continue;
        }

        let mode = if is_rail {
            "train"
        } else {
            match veh.as_ref().and_then(|v| v.kind.as_deref()) {
                Some("0") => "tram",
                Some("1") => "subway",
                Some("2") => "train",
                Some("11") => "trolleybus",
                _ => "bus",
            }
        };

        let delay_sec = p.delay.filter(|d| d.is_finite()).map(|d| (d / 1000.0).round() as i32);
        let bearing = p.bearing.filter(|b| b.is_finite()).map(|b| {
            let norm = ((b % 360.0) + 360.0) % 360.0;
            if norm >= 360.0 { 0.0 } else { norm }
        });

        let mut upcoming_stops = Vec::new();
        if let Some(stops) = p.upcoming_stops {
            for s in stops {
                let name = s.name.unwrap_or_default().trim().to_string();
                let ms = s.scheduled_departure.or(s.scheduled_arrival);
                if !name.is_empty() {
                    if let Some(ts) = ms {
                        upcoming_stops.push(UpcomingStop {
                            name,
                            sched_sec: epoch_ms_to_warsaw_sec(ts),
                        });
                    }
                }
            }
        }
        let current_stop = upcoming_stops.first().map(|s| s.name.clone());
        let next_stop = upcoming_stops.get(1).map(|s| s.name.clone());

        out.push(VehicleSnapshot {
            city: city_id.to_string(),
            vehicle_id: raw_id,
            line,
            mode: mode.to_string(),
            lat,
            lon,
            bearing,
            delay_sec,
            timestamp_ms: p.timestamp.unwrap_or(now_ms),
            headsign: p.headsign.map(|h| h.trim().to_string()).filter(|h| !h.is_empty()),
            brigade: p.brigade.map(|b| b.trim().to_string()).filter(|b| !b.is_empty()),
            model: veh
                .as_ref()
                .and_then(|v| v.model.as_deref())
                .map(|m| m.trim().to_string())
                .filter(|m| !m.is_empty()),
            agency: veh
                .as_ref()
                .and_then(|v| v.agency.as_deref())
                .map(|a| a.trim().to_string())
                .filter(|a| !a.is_empty()),
            current_stop,
            next_stop,
            upcoming_stops,
            source: source.to_string(),
            is_rail,
        });
    }
    out
}

fn epoch_ms_to_warsaw_sec(ms: i64) -> i32 {
    let dt = Utc
        .timestamp_millis_opt(ms)
        .single()
        .unwrap_or_else(Utc::now)
        .with_timezone(&Warsaw);
    (dt.hour() * 3600 + dt.minute() * 60 + dt.second()) as i32
}
