use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpcomingStop {
    pub name: String,
    /// Sekunda doby lokalnej (Europe/Warsaw) rozkladowego odjazdu lub przyjazdu.
    pub sched_sec: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VehicleSnapshot {
    pub city: String,
    pub vehicle_id: String,
    pub line: String,
    /// Typ: "tram", "bus", "train", "trolleybus", "subway".
    pub mode: String,
    pub lat: f64,
    pub lon: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bearing: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_sec: Option<i32>,
    /// Epoch ms pomiaru GPS lub odebrania.
    pub timestamp_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headsign: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brigade: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_stop: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_stop: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub upcoming_stops: Vec<UpcomingStop>,
    /// Zrodlo: "zbiorkom", "zbiorkom_rail", "kp", "mpk_wroclaw".
    pub source: String,
    pub is_rail: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RailStopUpdate {
    pub seq: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dep: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<String>,
    pub confirmed: bool,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RailTripLive {
    #[serde(rename = "tripId")]
    pub trip_id: String,
    #[serde(rename = "startDate", skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    pub agency: String,
    pub numbers: Vec<String>,
    pub cancelled: bool,
    pub detour: bool,
    #[serde(rename = "delaySec")]
    pub delay_sec: i32,
    #[serde(rename = "lastConfirmedSeq", skip_serializing_if = "Option::is_none")]
    pub last_confirmed_seq: Option<i32>,
    pub stops: Vec<RailStopUpdate>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Bbox {
    pub min_lon: f64,
    pub min_lat: f64,
    pub max_lon: f64,
    pub max_lat: f64,
}

impl Bbox {
    pub fn parse(raw: &str) -> Option<Self> {
        let parts: Vec<f64> = raw
            .split(',')
            .map(|p| p.trim().parse::<f64>())
            .collect::<Result<Vec<_>, _>>()
            .ok()?;
        if parts.len() != 4 || !parts.iter().all(|v| v.is_finite()) {
            return None;
        }
        let (min_lon, min_lat, max_lon, max_lat) = (parts[0], parts[1], parts[2], parts[3]);
        if min_lon > max_lon || min_lat > max_lat {
            return None;
        }
        if min_lat < -90.0 || max_lat > 90.0 || min_lon < -180.0 || max_lon > 180.0 {
            return None;
        }
        Some(Self {
            min_lon,
            min_lat,
            max_lon,
            max_lat,
        })
    }

    pub fn contains(&self, lat: f64, lon: f64) -> bool {
        lat >= self.min_lat && lat <= self.max_lat && lon >= self.min_lon && lon <= self.max_lon
    }

    /// Poszerza obszar o margines ułamkowy (np. 0.2 = 20% na kazda strone),
    /// aby szybkie przesuniecie mapy nie odsłaniało pustych krawedzi.
    pub fn expanded(&self, ratio: f64) -> Self {
        let dlat = (self.max_lat - self.min_lat).abs() * ratio;
        let dlon = (self.max_lon - self.min_lon).abs() * ratio;
        Self {
            min_lon: (self.min_lon - dlon).max(-180.0),
            min_lat: (self.min_lat - dlat).max(-90.0),
            max_lon: (self.max_lon + dlon).min(180.0),
            max_lat: (self.max_lat + dlat).min(90.0),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VehiclesResponse {
    pub city: String,
    pub updated_at: i64,
    pub count: usize,
    pub total_in_city: usize,
    pub boosted: bool,
    pub vehicles: Vec<VehicleSnapshot>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rail_vehicles: Vec<VehicleSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeatmapZone {
    pub id: String,
    pub lat: f64,
    pub lon: f64,
    pub radius_m: u32,
    pub avg_delay_sec: i32,
    pub max_delay_sec: i32,
    pub p90_delay_sec: i32,
    /// Skala 0.0..1.0 dla warstwy heatmap MapLibre.
    pub intensity: f32,
    /// "moderate", "heavy", "severe".
    pub severity: String,
    pub vehicle_count: u32,
    pub delayed_count: u32,
    pub top_lines: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hub_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub typical_delay_sec: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HubDelaySummary {
    pub id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub avg_delay_sec: i32,
    pub p90_delay_sec: i32,
    pub max_delay_sec: i32,
    pub vehicle_count: u32,
    pub delayed_count: u32,
    /// "normal", "moderate", "heavy", "severe".
    pub severity: String,
    pub top_lines: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub typical_delay_sec: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta_vs_typical_sec: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeatmapCitySummary {
    pub active_vehicles: u32,
    pub delayed_vehicles: u32,
    pub avg_delay_sec: i32,
    pub p90_delay_sec: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hottest_hub: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeatmapResponse {
    pub city: String,
    pub updated_at: i64,
    pub zones: Vec<HeatmapZone>,
    pub hubs: Vec<HubDelaySummary>,
    pub summary: HeatmapCitySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineDelaySummary {
    pub line: String,
    pub mode: String,
    pub active_vehicles: u32,
    pub avg_delay_sec: i32,
    pub median_delay_sec: i32,
    pub p90_delay_sec: i32,
    pub delayed_ratio: f32,
    /// "rising", "falling", "stable".
    pub trend: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub typical_delay_sec: Option<i32>,
    /// Estymowane opozn. dla pojazdow tej linii bez nadajnika GPS.
    pub estimated_untracked_delay_sec: i32,
    pub estimate_confidence: f32,
    /// Sugerowany bufor przesiadki [s] wyliczony z rozrzutu (p90).
    pub recommended_transfer_buffer_sec: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinesDelayResponse {
    pub city: String,
    pub updated_at: i64,
    pub day_type: String,
    pub hour_bucket: u8,
    pub lines: Vec<LineDelaySummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HubsDelayResponse {
    pub city: String,
    pub updated_at: i64,
    pub hubs: Vec<HubDelaySummary>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DelayEstimateLegInput {
    pub id: String,
    pub mode: String,
    #[serde(default)]
    pub line: Option<String>,
    #[serde(default)]
    pub trip_id: Option<String>,
    #[serde(default)]
    pub train_number: Option<String>,
    #[serde(default)]
    pub direction: Option<String>,
    #[serde(default)]
    pub from_stop: Option<String>,
    #[serde(default)]
    pub to_stop: Option<String>,
    #[serde(default)]
    pub from_lat: Option<f64>,
    #[serde(default)]
    pub from_lon: Option<f64>,
    #[serde(default)]
    pub to_lat: Option<f64>,
    #[serde(default)]
    pub to_lon: Option<f64>,
    #[serde(default)]
    pub scheduled_departure_sec: Option<i32>,
    #[serde(default)]
    pub scheduled_arrival_sec: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DelayEstimateRequest {
    pub city: String,
    #[serde(default)]
    pub date: Option<String>,
    pub legs: Vec<DelayEstimateLegInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchedVehicleInfo {
    pub vehicle_id: String,
    pub lat: f64,
    pub lon: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bearing: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_stop: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_stop: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DelayEstimateLegOutput {
    pub id: String,
    /// "live", "estimated", "scheduled".
    pub status: String,
    pub delay_sec: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrival_delay_sec: Option<i32>,
    pub confidence: f32,
    /// "live_gps", "live_plk", "live_line_peers", "live_corridor", "historical_profile", "blended", "none".
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_avg_delay_sec: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hub_avg_delay_sec: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub typical_delay_sec: Option<i32>,
    pub recommended_transfer_buffer_sec: i32,
    pub cancelled: bool,
    pub detour: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle: Option<MatchedVehicleInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DelayEstimateResponse {
    pub city: String,
    pub updated_at: i64,
    pub legs: Vec<DelayEstimateLegOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceHealthSummary {
    pub source: String,
    pub attempts: u64,
    pub failures: u64,
    pub consecutive_failures: u32,
    pub circuit_open: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_success_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStatus {
    pub service: String,
    pub version: String,
    pub uptime_secs: u64,
    pub cities_configured: usize,
    pub cities_live_active: usize,
    pub total_vehicles_in_memory: usize,
    pub total_rail_trips_cached: usize,
    pub boosted_cities: Vec<String>,
    pub db_size_bytes: u64,
    pub historical_line_profiles: usize,
    pub historical_hub_profiles: usize,
    pub sources: Vec<SourceHealthSummary>,
}
