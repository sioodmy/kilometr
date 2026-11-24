use chrono::Utc;
use reqwest::Client;
use serde::Deserialize;

use crate::models::VehicleSnapshot;

const WROCLAW_TRAMS: &[&str] = &[
    "0", "1", "2", "3", "4", "5", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17",
    "18", "19", "20", "21", "22", "23", "74", "76",
];

const WROCLAW_BUSES: &[&str] = &[
    "A", "D", "K", "N", "100", "101", "102", "103", "104", "105", "106", "107", "108", "110",
    "111", "112", "113", "114", "115", "116", "117", "118", "119", "120", "121", "122", "123",
    "124", "125", "126", "127", "128", "129", "130", "131", "132", "133", "134", "136", "137",
    "138", "142", "143", "144", "145", "146", "147", "148", "149", "150", "151", "152", "153",
    "206", "240", "241", "242", "243", "244", "245", "246", "247", "248", "249", "250", "251",
    "253", "255", "257", "259", "306", "310", "315", "319", "343", "345", "602", "607", "612",
    "715", "747", "903", "904", "905", "907", "908", "909", "911", "913", "914", "917", "920",
    "921", "923", "924", "927", "928", "930", "931", "933", "937", "938", "941", "944", "945",
    "947", "948", "955", "958", "961", "964", "967",
];

#[derive(Debug, Deserialize)]
struct MpkRow {
    name: String,
    #[serde(rename = "type")]
    kind: String,
    x: f64,
    y: f64,
    k: serde_json::Value,
}

/// Awaryjny bezposredni feed MPK Wroclaw gdy zbiorkom.live dla Wroclawia nie odpowiada.
pub async fn fetch_mpk_wroclaw_fallback(
    client: &Client,
    url: &str,
) -> Result<Vec<VehicleSnapshot>, String> {
    let mut form: Vec<(&str, &str)> = Vec::with_capacity(WROCLAW_TRAMS.len() + WROCLAW_BUSES.len());
    for t in WROCLAW_TRAMS {
        form.push(("busList[tram][]", t));
    }
    for b in WROCLAW_BUSES {
        form.push(("busList[bus][]", b));
    }

    let resp = client
        .post(url)
        .header("User-Agent", "Mozilla/5.0")
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("mpk_wroclaw: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("mpk_wroclaw HTTP {}", resp.status()));
    }
    let rows: Vec<MpkRow> = resp
        .json()
        .await
        .map_err(|e| format!("mpk_wroclaw JSON: {e}"))?;

    let now_ms = Utc::now().timestamp_millis();
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let line = r.name.trim().to_string();
        if line.is_empty() || !r.x.is_finite() || !r.y.is_finite() || (r.x == 0.0 && r.y == 0.0) {
            continue;
        }
        let id = match r.k {
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => s,
            _ => continue,
        };
        out.push(VehicleSnapshot {
            city: "wroclaw".to_string(),
            vehicle_id: id,
            line,
            mode: if r.kind == "tram" { "tram" } else { "bus" }.to_string(),
            lat: r.x,
            lon: r.y,
            bearing: None,
            delay_sec: None,
            timestamp_ms: now_ms,
            headsign: None,
            brigade: None,
            model: None,
            agency: Some("MPK".to_string()),
            current_stop: None,
            next_stop: None,
            upcoming_stops: Vec::new(),
            source: "mpk_wroclaw".to_string(),
            is_rail: false,
        });
    }
    Ok(out)
}
