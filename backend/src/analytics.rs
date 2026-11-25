use jiff::civil::Weekday;
use dashmap::DashMap;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Mutex, RwLock};

use crate::models::{
    AnomaliesResponse, Bbox, DelayEstimateLegInput, DelayEstimateLegOutput, DelayEstimateRequest,
    DelayEstimateResponse, HeatmapCitySummary, HeatmapResponse, HeatmapZone, HourlyDelayPoint,
    HubDelaySummary, HubsDelayResponse, LineDelaySummary, LinesDelayResponse, MatchedVehicleInfo,
    RailTripLive, RouteHotspotInsight, RouteInsightsRequest, RouteInsightsResponse, TrafficAnomaly,
    TransferRiskInsight, VehicleSnapshot, VehiclesResponse,
};
use crate::storage::{
    CellProfileDelta, CellProfileKey, HistoricalProfile, HubProfileDelta, HubProfileKey,
    LineProfileDelta, LineProfileKey, LoadedProfiles, ObservationRecord, PersistenceBatch,
    RailProfileDelta,
};

/// Krok siatki przestrzennej (~350m w Polsce).
const CELL_LAT_STEP: f64 = 0.00315;
const CELL_LON_STEP: f64 = 0.0050;
/// Maksymalny wiek pojazdu w oknie live [ms].
const MAX_VEHICLE_AGE_MS: i64 = 180_000;
/// Okno przesuwne dla bieżącej analityki live [s] (10 min bieżące + 10 min poprzednie na trend).
const LIVE_WINDOW_SECS: i64 = 600;
const FULL_WINDOW_SECS: i64 = 1200;
/// Prog uznania pojazdu za opozniony [s].
const LATE_THRESHOLD_SEC: i32 = 180;
/// Limit sanitarny opoznien miejskich [s] (2h) i kolejowych (5h).
const MAX_URBAN_DELAY_SEC: i32 = 7200;
const MAX_RAIL_DELAY_SEC: i32 = 18_000;
/// Limit rozmiaru surowego batcha obserwacji w jednym oknie zrzutu.
const MAX_OBSERVATIONS_PER_BATCH: usize = 4000;
/// Promien dryfu GPS [m], ponizej ktorego uznajemy, ze pojazd stoi w miejscu.
const STATIONARY_RADIUS_M: f64 = 38.0;
/// Minimalny czas postoju z opoznieniem [ms], aby uznac pojazd za zablokowany w zatorze.
const STALL_MIN_MS: i64 = 150_000;
/// Czas wygaszania wykrytej anomalii po udroznieniu ruchu [ms].
const ANOMALY_HOLD_MS: i64 = 180_000;

#[derive(Debug, Clone)]
struct VehicleMotionState {
    anchor_lat: f64,
    anchor_lon: f64,
    stationary_since_ms: i64,
    last_seen_ms: i64,
}

#[derive(Debug, Default)]
struct CityVehicleBucket {
    urban: Vec<VehicleSnapshot>,
    urban_updated_at: i64,
    rail: Vec<VehicleSnapshot>,
    rail_updated_at: i64,
    /// Ostatnia minuta (epoch_sec / 60) zapisu obserwacji danego pojazdu (deduplikacja).
    last_recorded_min: HashMap<String, i64>,
    /// Stan ruchu pojazdow do deterministycznego wykrywania zatorow.
    motion: HashMap<String, VehicleMotionState>,
    /// Aktywne anomalie z histereza i czasem trwania.
    anomalies: HashMap<String, TrafficAnomaly>,
}

#[derive(Debug, Clone)]
struct WindowSample {
    ts_sec: i64,
    line: String,
    mode: String,
    delay_sec: i32,
    lat: f64,
    lon: f64,
    cell_lat: i32,
    cell_lon: i32,
    hub_key: Option<String>,
    hub_name: Option<String>,
}

#[derive(Debug, Default)]
pub struct RailFeedCache {
    pub updated_at_ms: i64,
    pub timestamp_iso: String,
    pub etag: String,
    pub by_trip_id: HashMap<String, RailTripLive>,
    pub by_number: HashMap<String, Vec<RailTripLive>>,
}

pub struct AnalyticsEngine {
    cities: DashMap<String, CityVehicleBucket>,
    windows: DashMap<String, VecDeque<WindowSample>>,
    rail_feed: RwLock<RailFeedCache>,
    line_profiles: DashMap<LineProfileKey, HistoricalProfile>,
    hub_profiles: DashMap<HubProfileKey, HistoricalProfile>,
    cell_profiles: DashMap<CellProfileKey, HistoricalProfile>,
    pending_batch: Mutex<PersistenceBatch>,
    boosted_cities: DashMap<String, i64>,
}

impl AnalyticsEngine {
    pub fn new(loaded: LoadedProfiles) -> Self {
        let line_profiles = DashMap::with_capacity(loaded.lines.len());
        for (k, v) in loaded.lines {
            line_profiles.insert(k, v);
        }
        let hub_profiles = DashMap::with_capacity(loaded.hubs.len());
        for (k, v) in loaded.hubs {
            hub_profiles.insert(k, v);
        }
        let cell_profiles = DashMap::with_capacity(loaded.cells.len());
        for (k, v) in loaded.cells {
            cell_profiles.insert(k, v);
        }

        Self {
            cities: DashMap::new(),
            windows: DashMap::new(),
            rail_feed: RwLock::new(RailFeedCache::default()),
            line_profiles,
            hub_profiles,
            cell_profiles,
            pending_batch: Mutex::new(PersistenceBatch::default()),
            boosted_cities: DashMap::new(),
        }
    }

    pub fn mark_city_demand(&self, city: &str, now_ms: i64) {
        self.boosted_cities.insert(city.to_string(), now_ms);
    }

    pub fn is_city_boosted(&self, city: &str, now_ms: i64, boost_ttl_secs: u64) -> bool {
        self.boosted_cities
            .get(city)
            .map(|ts| now_ms - *ts <= (boost_ttl_secs as i64) * 1000)
            .unwrap_or(false)
    }

    pub fn boosted_cities(&self, now_ms: i64, boost_ttl_secs: u64) -> Vec<String> {
        let ttl_ms = (boost_ttl_secs as i64) * 1000;
        let mut out = Vec::new();
        for entry in self.boosted_cities.iter() {
            if now_ms - *entry.value() <= ttl_ms {
                out.push(entry.key().clone());
            }
        }
        out.sort();
        out
    }

    pub fn total_vehicles_in_memory(&self) -> usize {
        self.cities
            .iter()
            .map(|c| c.urban.len() + c.rail.len())
            .sum()
    }

    pub fn active_city_count(&self, now_ms: i64) -> usize {
        self.cities
            .iter()
            .filter(|c| {
                now_ms - c.urban_updated_at <= MAX_VEHICLE_AGE_MS
                    || now_ms - c.rail_updated_at <= MAX_VEHICLE_AGE_MS
            })
            .count()
    }

    pub fn total_rail_trips_cached(&self) -> usize {
        self.rail_feed
            .read()
            .map(|g| g.by_trip_id.len())
            .unwrap_or(0)
    }

    pub fn historical_counts(&self) -> (usize, usize) {
        (self.line_profiles.len(), self.hub_profiles.len())
    }

    pub fn rail_etag(&self) -> String {
        self.rail_feed
            .read()
            .map(|g| g.etag.clone())
            .unwrap_or_default()
    }

    /// Zasilenie paczki pojazdow (miejskich lub kolei regionalnej) dla miasta.
    pub fn ingest_city_vehicles(
        &self,
        city: &str,
        raw_vehicles: Vec<VehicleSnapshot>,
        is_rail: bool,
        now_ms: i64,
    ) {
        let now_sec = now_ms / 1000;
        let current_min = now_sec / 60;
        let (day_type, hour_bucket) = warsaw_time_bucket(now_ms);

        // Odfiltrowujemy zaszumione wspolrzedne i skrajne outliery opoznien.
        let max_delay = if is_rail {
            MAX_RAIL_DELAY_SEC
        } else {
            MAX_URBAN_DELAY_SEC
        };
        let mut clean: Vec<VehicleSnapshot> = Vec::with_capacity(raw_vehicles.len());
        for mut v in raw_vehicles {
            if !v.lat.is_finite() || !v.lon.is_finite() || (v.lat == 0.0 && v.lon == 0.0) {
                continue;
            }
            if v.timestamp_ms <= 0 || v.timestamp_ms > now_ms + 60_000 {
                v.timestamp_ms = now_ms;
            }
            if now_ms - v.timestamp_ms > MAX_VEHICLE_AGE_MS {
                continue;
            }
            if let Some(d) = v.delay_sec {
                if d.abs() > max_delay {
                    v.delay_sec = None;
                }
            }
            clean.push(v);
        }

        let mut new_samples: Vec<WindowSample> = Vec::new();
        {
            let mut bucket = self.cities.entry(city.to_string()).or_default();
            // Czyszczenie mapy deduplikacji z wpisow starszych niz 30 min.
            if bucket.last_recorded_min.len() > 2500 {
                bucket
                    .last_recorded_min
                    .retain(|_, &mut m| current_min - m <= 30);
            }

            for v in &clean {
                let Some(delay_sec) = v.delay_sec else {
                    continue;
                };
                let dedup_key = format!("{}:{}", if is_rail { "R" } else { "U" }, v.vehicle_id);
                let prev_min = bucket.last_recorded_min.get(&dedup_key).copied();
                if prev_min == Some(current_min) {
                    continue;
                }
                bucket.last_recorded_min.insert(dedup_key, current_min);

                let (cell_lat, cell_lon) = cell_coords(v.lat, v.lon);
                let raw_hub = v
                    .current_stop
                    .as_deref()
                    .or(v.next_stop.as_deref())
                    .or_else(|| v.upcoming_stops.first().map(|s| s.name.as_str()));
                let (hub_key, hub_name) = match raw_hub {
                    Some(name) => {
                        let norm = normalize_hub_name(name);
                        if norm.len() >= 2 {
                            (Some(norm), Some(name.trim().to_string()))
                        } else {
                            (None, None)
                        }
                    }
                    None => (None, None),
                };

                new_samples.push(WindowSample {
                    ts_sec: now_sec,
                    line: v.line.to_ascii_uppercase(),
                    mode: v.mode.clone(),
                    delay_sec,
                    lat: v.lat,
                    lon: v.lon,
                    cell_lat,
                    cell_lon,
                    hub_key,
                    hub_name,
                });
            }

            if is_rail {
                bucket.rail = clean;
                bucket.rail_updated_at = now_ms;
            } else {
                // Aktualizacja stanu ruchu kazdego pojazdu miejskiego pod detektor zatorow.
                if bucket.motion.len() > 2500 {
                    bucket
                        .motion
                        .retain(|_, st| now_ms - st.last_seen_ms <= 600_000);
                }
                for v in &clean {
                    let entry = bucket.motion.entry(v.vehicle_id.clone()).or_insert(
                        VehicleMotionState {
                            anchor_lat: v.lat,
                            anchor_lon: v.lon,
                            stationary_since_ms: v.timestamp_ms,
                            last_seen_ms: v.timestamp_ms,
                        },
                    );
                    let moved = distance_meters_approx(entry.anchor_lat, entry.anchor_lon, v.lat, v.lon);
                    if moved >= STATIONARY_RADIUS_M {
                        entry.anchor_lat = v.lat;
                        entry.anchor_lon = v.lon;
                        entry.stationary_since_ms = v.timestamp_ms;
                    }
                    entry.last_seen_ms = now_ms;
                }
                bucket.urban = clean;
                bucket.urban_updated_at = now_ms;
            }
        }

        if !is_rail {
            self.recompute_anomalies(city, now_ms);
        }

        if new_samples.is_empty() {
            return;
        }

        // Dopisanie do przesuwnego okna w RAM.
        {
            let mut win = self.windows.entry(city.to_string()).or_default();
            for s in &new_samples {
                win.push_back(s.clone());
            }
            let cutoff = now_sec - FULL_WINDOW_SECS;
            while let Some(front) = win.front() {
                if front.ts_sec < cutoff {
                    win.pop_front();
                } else {
                    break;
                }
            }
        }

        // Aktualizacja profili historycznych w RAM + dopisanie do batcha SQLite.
        let mut batch = self.pending_batch.lock().unwrap_or_else(|e| e.into_inner());
        for s in new_samples {
            let pos_delay = (s.delay_sec.max(0)) as f64;
            let is_late = s.delay_sec >= LATE_THRESHOLD_SEC;

            let line_key = (
                city.to_string(),
                s.line.clone(),
                day_type.clone(),
                hour_bucket,
            );
            update_in_memory_profile(&self.line_profiles, line_key, pos_delay, is_late);
            batch.lines.push(LineProfileDelta {
                city: city.to_string(),
                line: s.line.clone(),
                day_type: day_type.clone(),
                hour_bucket,
                delay_sec: pos_delay,
                is_late,
            });

            if let (Some(hkey), Some(hname)) = (s.hub_key.clone(), s.hub_name.clone()) {
                let hub_key = (city.to_string(), hkey.clone(), day_type.clone(), hour_bucket);
                update_in_memory_profile(&self.hub_profiles, hub_key, pos_delay, is_late);
                batch.hubs.push(HubProfileDelta {
                    city: city.to_string(),
                    hub_key: hkey,
                    hub_name: hname,
                    lat: s.lat,
                    lon: s.lon,
                    day_type: day_type.clone(),
                    hour_bucket,
                    delay_sec: pos_delay,
                    is_late,
                });
            }

            let cell_key = (
                city.to_string(),
                s.cell_lat,
                s.cell_lon,
                day_type.clone(),
                hour_bucket,
            );
            update_in_memory_profile(&self.cell_profiles, cell_key, pos_delay, is_late);
            batch.cells.push(CellProfileDelta {
                city: city.to_string(),
                cell_lat: s.cell_lat,
                cell_lon: s.cell_lon,
                day_type: day_type.clone(),
                hour_bucket,
                delay_sec: pos_delay,
                is_late,
            });

            if batch.observations.len() < MAX_OBSERVATIONS_PER_BATCH {
                batch.observations.push(ObservationRecord {
                    ts_sec: s.ts_sec,
                    city: city.to_string(),
                    line: s.line,
                    hub_key: s.hub_key,
                    cell_lat: s.cell_lat,
                    cell_lon: s.cell_lon,
                    delay_sec: s.delay_sec,
                });
            }
        }
    }

    pub fn ingest_rail_updates(
        &self,
        by_trip_id: HashMap<String, RailTripLive>,
        by_number: HashMap<String, Vec<RailTripLive>>,
        timestamp_iso: String,
        etag: String,
        now_ms: i64,
    ) {
        let (day_type, hour_bucket) = warsaw_time_bucket(now_ms);
        {
            let mut batch = self.pending_batch.lock().unwrap_or_else(|e| e.into_inner());
            let mut seen = HashSet::new();
            for trip in by_trip_id.values() {
                if !seen.insert(trip.trip_id.clone()) {
                    continue;
                }
                let train_key = trip
                    .numbers
                    .first()
                    .cloned()
                    .unwrap_or_else(|| trip.trip_id.clone());
                let pos_delay = trip.delay_sec.clamp(0, MAX_RAIL_DELAY_SEC) as f64;
                batch.rails.push(RailProfileDelta {
                    agency: trip.agency.clone(),
                    train_key,
                    day_type: day_type.clone(),
                    hour_bucket,
                    delay_sec: pos_delay,
                    is_late: trip.delay_sec >= 300,
                    cancelled: trip.cancelled,
                });
            }
        }

        if let Ok(mut guard) = self.rail_feed.write() {
            guard.updated_at_ms = now_ms;
            guard.timestamp_iso = timestamp_iso;
            guard.etag = etag;
            guard.by_trip_id = by_trip_id;
            guard.by_number = by_number;
        }
    }

    pub fn drain_persistence_batch(&self) -> PersistenceBatch {
        let mut guard = self.pending_batch.lock().unwrap_or_else(|e| e.into_inner());
        std::mem::take(&mut *guard)
    }

    /// Zwraca pojazdy dla miasta, z szybkim filtrowaniem viewportu (bbox), linii i trybu.
    #[allow(clippy::too_many_arguments)]
    pub fn query_vehicles(
        &self,
        city: &str,
        bbox: Option<Bbox>,
        modes: Option<&HashSet<String>>,
        line: Option<&str>,
        include_rail: bool,
        since_ms: Option<i64>,
        now_ms: i64,
        boost_ttl_secs: u64,
    ) -> VehiclesResponse {
        self.mark_city_demand(city, now_ms);
        let expanded_bbox = bbox.map(|b| b.expanded(0.18));
        let line_norm = line.map(|l| l.trim().to_ascii_uppercase());

        let filter_fn = |v: &VehicleSnapshot| -> bool {
            if now_ms - v.timestamp_ms > MAX_VEHICLE_AGE_MS {
                return false;
            }
            if let Some(since) = since_ms {
                if v.timestamp_ms <= since {
                    return false;
                }
            }
            if let Some(b) = expanded_bbox {
                if !b.contains(v.lat, v.lon) {
                    return false;
                }
            }
            if let Some(ref mset) = modes {
                if !mset.contains(&v.mode) {
                    return false;
                }
            }
            if let Some(ref want) = line_norm {
                if v.line.to_ascii_uppercase() != *want {
                    return false;
                }
            }
            true
        };

        let (vehicles, rail_vehicles, total_in_city, updated_at) =
            if let Some(bucket) = self.cities.get(city) {
                let total = bucket.urban.len() + if include_rail { bucket.rail.len() } else { 0 };
                let urban: Vec<VehicleSnapshot> =
                    bucket.urban.iter().filter(|v| filter_fn(v)).cloned().collect();
                let rail: Vec<VehicleSnapshot> = if include_rail {
                    bucket.rail.iter().filter(|v| filter_fn(v)).cloned().collect()
                } else {
                    Vec::new()
                };
                let upd = bucket.urban_updated_at.max(bucket.rail_updated_at);
                (urban, rail, total, upd)
            } else {
                (Vec::new(), Vec::new(), 0, 0)
            };

        VehiclesResponse {
            city: city.to_string(),
            updated_at,
            count: vehicles.len() + rail_vehicles.len(),
            total_in_city,
            boosted: self.is_city_boosted(city, now_ms, boost_ttl_secs),
            vehicles,
            rail_vehicles,
        }
    }

    /// Buduje warstwe stref opoznien (heatmapa M3 Expressive) oraz goracych wezlow komunikacyjnych.
    pub fn query_heatmap(&self, city: &str, bbox: Option<Bbox>, now_ms: i64) -> HeatmapResponse {
        self.mark_city_demand(city, now_ms);
        let (day_type, hour_bucket) = warsaw_time_bucket(now_ms);
        let now_sec = now_ms / 1000;
        let live_cutoff = now_sec - LIVE_WINDOW_SECS;

        struct CellAcc {
            sum_lat: f64,
            sum_lon: f64,
            delays: Vec<i32>,
            delayed_count: u32,
            lines: HashMap<String, u32>,
            hub_votes: HashMap<String, (String, u32)>,
        }

        struct HubAcc {
            name: String,
            sum_lat: f64,
            sum_lon: f64,
            delays: Vec<i32>,
            delayed_count: u32,
            lines: HashMap<String, u32>,
        }

        let mut cells: HashMap<(i32, i32), CellAcc> = HashMap::new();
        let mut hubs: HashMap<String, HubAcc> = HashMap::new();
        let mut all_delays: Vec<i32> = Vec::new();
        let mut delayed_vehicles_total: u32 = 0;
        let mut active_vehicles_total: u32 = 0;

        // Bazujemy najpierw na biezacych swiezych pojazdach (najbardziej aktualny stan mapy).
        if let Some(bucket) = self.cities.get(city) {
            for v in bucket.urban.iter().chain(bucket.rail.iter()) {
                if now_ms - v.timestamp_ms > MAX_VEHICLE_AGE_MS {
                    continue;
                }
                active_vehicles_total += 1;
                let Some(delay) = v.delay_sec else {
                    continue;
                };
                let pos_delay = delay.max(0);
                all_delays.push(pos_delay);
                if delay >= LATE_THRESHOLD_SEC {
                    delayed_vehicles_total += 1;
                }

                if let Some(b) = bbox {
                    if !b.expanded(0.15).contains(v.lat, v.lon) {
                        continue;
                    }
                }

                let (clat, clon) = cell_coords(v.lat, v.lon);
                let cell = cells.entry((clat, clon)).or_insert_with(|| CellAcc {
                    sum_lat: 0.0,
                    sum_lon: 0.0,
                    delays: Vec::new(),
                    delayed_count: 0,
                    lines: HashMap::new(),
                    hub_votes: HashMap::new(),
                });
                cell.sum_lat += v.lat;
                cell.sum_lon += v.lon;
                cell.delays.push(pos_delay);
                if delay >= LATE_THRESHOLD_SEC {
                    cell.delayed_count += 1;
                    *cell.lines.entry(v.line.to_ascii_uppercase()).or_insert(0) += 1;
                }

                let raw_hub = v
                    .current_stop
                    .as_deref()
                    .or(v.next_stop.as_deref())
                    .or_else(|| v.upcoming_stops.first().map(|s| s.name.as_str()));
                if let Some(hname) = raw_hub {
                    let hkey = normalize_hub_name(hname);
                    if hkey.len() >= 2 {
                        let vote = cell
                            .hub_votes
                            .entry(hkey.clone())
                            .or_insert_with(|| (hname.trim().to_string(), 0));
                        vote.1 += 1;

                        let hub = hubs.entry(hkey).or_insert_with(|| HubAcc {
                            name: hname.trim().to_string(),
                            sum_lat: 0.0,
                            sum_lon: 0.0,
                            delays: Vec::new(),
                            delayed_count: 0,
                            lines: HashMap::new(),
                        });
                        hub.sum_lat += v.lat;
                        hub.sum_lon += v.lon;
                        hub.delays.push(pos_delay);
                        if delay >= LATE_THRESHOLD_SEC {
                            hub.delayed_count += 1;
                            *hub.lines.entry(v.line.to_ascii_uppercase()).or_insert(0) += 1;
                        }
                    }
                }
            }
        }

        // Gdy miasto ma malo biezacych pojazdow w kadrze (np. noc lub przerwa miedzy pollami),
        // wzbogacamy strefy z 10-minutowego okna przesuwnego.
        if cells.is_empty() {
            if let Some(win) = self.windows.get(city) {
                for s in win.iter().filter(|s| s.ts_sec >= live_cutoff) {
                    if let Some(b) = bbox {
                        if !b.expanded(0.15).contains(s.lat, s.lon) {
                            continue;
                        }
                    }
                    let pos_delay = s.delay_sec.max(0);
                    let cell = cells
                        .entry((s.cell_lat, s.cell_lon))
                        .or_insert_with(|| CellAcc {
                            sum_lat: 0.0,
                            sum_lon: 0.0,
                            delays: Vec::new(),
                            delayed_count: 0,
                            lines: HashMap::new(),
                            hub_votes: HashMap::new(),
                        });
                    cell.sum_lat += s.lat;
                    cell.sum_lon += s.lon;
                    cell.delays.push(pos_delay);
                    if s.delay_sec >= LATE_THRESHOLD_SEC {
                        cell.delayed_count += 1;
                        *cell.lines.entry(s.line.clone()).or_insert(0) += 1;
                    }
                }
            }
        }

        let mut zones: Vec<HeatmapZone> = Vec::new();
        for ((clat, clon), mut acc) in cells {
            let n = acc.delays.len() as u32;
            if n == 0 {
                continue;
            }
            let avg = (acc.delays.iter().map(|&d| d as f64).sum::<f64>() / n as f64).round() as i32;
            acc.delays.sort_unstable();
            let max_d = *acc.delays.last().unwrap_or(&0);
            let p90 = percentile_sorted(&acc.delays, 0.90);

            // Pomijamy strefy bez realnego opoznien (szum ponizej 2 min).
            if avg < 120 && max_d < 240 {
                continue;
            }
            let delay_factor = ((avg as f32 - 90.0) / 510.0).clamp(0.0, 1.0);
            let corroboration = if acc.lines.len() >= 2 || acc.delayed_count >= 2 {
                1.0_f32
            } else if max_d >= 360 {
                0.72_f32
            } else {
                0.42_f32
            };
            let intensity = (delay_factor * corroboration).clamp(0.15, 1.0);
            let severity = classify_severity(avg, p90, acc.delayed_count);
            if severity == "normal" {
                continue;
            }

            let mut top_lines: Vec<(String, u32)> = acc.lines.into_iter().collect();
            top_lines.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
            let top_lines: Vec<String> = top_lines.into_iter().take(5).map(|(l, _)| l).collect();

            let hub_name = acc
                .hub_votes
                .into_values()
                .max_by_key(|(_, count)| *count)
                .map(|(name, _)| name);

            let typical = self
                .cell_profiles
                .get(&(city.to_string(), clat, clon, day_type.clone(), hour_bucket))
                .filter(|p| p.sample_count >= 10)
                .map(|p| p.shrunk_delay_sec().round() as i32);

            zones.push(HeatmapZone {
                id: format!("cell:{clat}:{clon}"),
                lat: acc.sum_lat / n as f64,
                lon: acc.sum_lon / n as f64,
                radius_m: if severity == "severe" { 420 } else { 320 },
                avg_delay_sec: avg,
                max_delay_sec: max_d,
                p90_delay_sec: p90,
                intensity: (intensity * 100.0).round() / 100.0,
                severity: severity.to_string(),
                vehicle_count: n,
                delayed_count: acc.delayed_count,
                top_lines,
                hub_name,
                typical_delay_sec: typical,
            });
        }

        zones.sort_by(|a, b| {
            b.intensity
                .total_cmp(&a.intensity)
                .then_with(|| b.avg_delay_sec.cmp(&a.avg_delay_sec))
        });
        zones.truncate(120);

        let mut hub_list: Vec<HubDelaySummary> = Vec::new();
        for (hkey, mut acc) in hubs {
            let n = acc.delays.len() as u32;
            if n == 0 {
                continue;
            }
            let avg = (acc.delays.iter().map(|&d| d as f64).sum::<f64>() / n as f64).round() as i32;
            acc.delays.sort_unstable();
            let max_d = *acc.delays.last().unwrap_or(&0);
            let p90 = percentile_sorted(&acc.delays, 0.90);
            let severity = classify_severity(avg, p90, acc.delayed_count);
            if severity == "normal" {
                continue;
            }

            let typical = self
                .hub_profiles
                .get(&(city.to_string(), hkey.clone(), day_type.clone(), hour_bucket))
                .filter(|p| p.sample_count >= 10)
                .map(|p| p.shrunk_delay_sec().round() as i32);
            let delta = typical.map(|t| avg - t);

            let mut top_lines: Vec<(String, u32)> = acc.lines.into_iter().collect();
            top_lines.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

            hub_list.push(HubDelaySummary {
                id: format!("hub:{hkey}"),
                name: acc.name,
                lat: acc.sum_lat / n as f64,
                lon: acc.sum_lon / n as f64,
                avg_delay_sec: avg,
                p90_delay_sec: p90,
                max_delay_sec: max_d,
                vehicle_count: n,
                delayed_count: acc.delayed_count,
                severity: severity.to_string(),
                top_lines: top_lines.into_iter().take(6).map(|(l, _)| l).collect(),
                typical_delay_sec: typical,
                delta_vs_typical_sec: delta,
            });
        }

        hub_list.sort_by(|a, b| {
            b.avg_delay_sec
                .cmp(&a.avg_delay_sec)
                .then_with(|| b.delayed_count.cmp(&a.delayed_count))
        });
        hub_list.truncate(24);

        all_delays.sort_unstable();
        let city_avg = if all_delays.is_empty() {
            0
        } else {
            (all_delays.iter().map(|&d| d as f64).sum::<f64>() / all_delays.len() as f64).round()
                as i32
        };
        let city_p90 = percentile_sorted(&all_delays, 0.90);
        let hottest_hub = hub_list.first().map(|h| h.name.clone());

        HeatmapResponse {
            city: city.to_string(),
            updated_at: now_ms,
            zones,
            hubs: hub_list,
            summary: HeatmapCitySummary {
                active_vehicles: active_vehicles_total,
                delayed_vehicles: delayed_vehicles_total,
                avg_delay_sec: city_avg,
                p90_delay_sec: city_p90,
                hottest_hub,
                updated_at: now_ms,
            },
        }
    }

    /// Statystyki opoznien per linia (live + trend + historia + estymacja dla pojazdow bez GPS).
    pub fn query_lines(
        &self,
        city: &str,
        filter_lines: Option<&HashSet<String>>,
        now_ms: i64,
    ) -> LinesDelayResponse {
        self.mark_city_demand(city, now_ms);
        let (day_type, hour_bucket) = warsaw_time_bucket(now_ms);
        let now_sec = now_ms / 1000;
        let current_cutoff = now_sec - LIVE_WINDOW_SECS;

        struct LineLiveAcc {
            mode: String,
            current: Vec<i32>,
            previous: Vec<i32>,
            active_vehicles: u32,
        }

        let mut map: HashMap<String, LineLiveAcc> = HashMap::new();

        if let Some(bucket) = self.cities.get(city) {
            for v in bucket.urban.iter().chain(bucket.rail.iter()) {
                if now_ms - v.timestamp_ms > MAX_VEHICLE_AGE_MS {
                    continue;
                }
                let line = v.line.to_ascii_uppercase();
                if let Some(f) = filter_lines {
                    if !f.contains(&line) {
                        continue;
                    }
                }
                let entry = map.entry(line).or_insert_with(|| LineLiveAcc {
                    mode: v.mode.clone(),
                    current: Vec::new(),
                    previous: Vec::new(),
                    active_vehicles: 0,
                });
                entry.active_vehicles += 1;
                if let Some(d) = v.delay_sec {
                    entry.current.push(d.max(0));
                }
            }
        }

        if let Some(win) = self.windows.get(city) {
            for s in win.iter() {
                if let Some(f) = filter_lines {
                    if !f.contains(&s.line) {
                        continue;
                    }
                }
                let entry = map.entry(s.line.clone()).or_insert_with(|| LineLiveAcc {
                    mode: s.mode.clone(),
                    current: Vec::new(),
                    previous: Vec::new(),
                    active_vehicles: 0,
                });
                if s.ts_sec >= current_cutoff {
                    if entry.current.len() < 40 {
                        entry.current.push(s.delay_sec.max(0));
                    }
                } else {
                    entry.previous.push(s.delay_sec.max(0));
                }
            }
        }

        // Uwzględniamy rowniez linie znane z historii, jesli pytano o konkretne linie bez live GPS.
        if let Some(f) = filter_lines {
            for l in f {
                map.entry(l.clone()).or_insert_with(|| LineLiveAcc {
                    mode: "bus".to_string(),
                    current: Vec::new(),
                    previous: Vec::new(),
                    active_vehicles: 0,
                });
            }
        }

        let mut lines: Vec<LineDelaySummary> = Vec::with_capacity(map.len());
        for (line, mut acc) in map {
            let hist = self
                .line_profiles
                .get(&(city.to_string(), line.clone(), day_type.clone(), hour_bucket))
                .map(|r| r.clone());
            let typical = hist
                .as_ref()
                .filter(|p| p.sample_count >= 10)
                .map(|p| p.shrunk_delay_sec().round() as i32);

            acc.current.sort_unstable();
            let curr_n = acc.current.len();
            let avg = if curr_n > 0 {
                (acc.current.iter().map(|&d| d as f64).sum::<f64>() / curr_n as f64).round() as i32
            } else {
                typical.unwrap_or(0)
            };
            let median = if curr_n > 0 {
                percentile_sorted(&acc.current, 0.50)
            } else {
                typical.unwrap_or(0)
            };
            let p90 = if curr_n > 0 {
                percentile_sorted(&acc.current, 0.90)
            } else {
                hist.as_ref()
                    .map(|p| p.p90_delay_sec.round() as i32)
                    .unwrap_or(0)
            };
            let delayed_ratio = if curr_n > 0 {
                acc.current.iter().filter(|&&d| d >= LATE_THRESHOLD_SEC).count() as f32
                    / curr_n as f32
            } else {
                hist.as_ref().map(|p| p.late_rate as f32).unwrap_or(0.0)
            };

            let trend = if !acc.previous.is_empty() && curr_n > 0 {
                let prev_avg = acc.previous.iter().map(|&d| d as f64).sum::<f64>()
                    / acc.previous.len() as f64;
                let diff = (avg as f64) - prev_avg;
                if diff >= 60.0 {
                    "rising"
                } else if diff <= -60.0 {
                    "falling"
                } else {
                    "stable"
                }
            } else {
                "stable"
            };

            // Wyznaczenie estymacji dla pojazdow tej linii bez nadajnika GPS.
            let (est_delay, est_conf) =
                compute_line_untracked_estimate(acc.active_vehicles, median, hist.as_ref());
            let buffer = compute_transfer_buffer(p90, est_delay);

            lines.push(LineDelaySummary {
                line,
                mode: acc.mode,
                active_vehicles: acc.active_vehicles,
                avg_delay_sec: avg,
                median_delay_sec: median,
                p90_delay_sec: p90,
                delayed_ratio: (delayed_ratio * 100.0).round() / 100.0,
                trend: trend.to_string(),
                typical_delay_sec: typical,
                estimated_untracked_delay_sec: est_delay,
                estimate_confidence: (est_conf * 100.0).round() / 100.0,
                recommended_transfer_buffer_sec: buffer,
            });
        }

        lines.sort_by(|a, b| {
            b.avg_delay_sec
                .cmp(&a.avg_delay_sec)
                .then_with(|| a.line.cmp(&b.line))
        });

        LinesDelayResponse {
            city: city.to_string(),
            updated_at: now_ms,
            day_type,
            hour_bucket,
            lines,
        }
    }

    pub fn query_hubs(
        &self,
        city: &str,
        limit: usize,
        min_delay_sec: i32,
        now_ms: i64,
    ) -> HubsDelayResponse {
        let hm = self.query_heatmap(city, None, now_ms);
        let hubs = hm
            .hubs
            .into_iter()
            .filter(|h| h.avg_delay_sec >= min_delay_sec)
            .take(limit.clamp(1, 100))
            .collect();
        HubsDelayResponse {
            city: city.to_string(),
            updated_at: now_ms,
            hubs,
        }
    }

    /// Batchowa estymacja i dopasowanie live dla trasy lub udostepnionego polaczenia.
    pub fn estimate_legs(
        &self,
        req: &DelayEstimateRequest,
        now_ms: i64,
    ) -> DelayEstimateResponse {
        self.mark_city_demand(&req.city, now_ms);
        let (day_type, hour_bucket) = warsaw_time_bucket(now_ms);
        // Jesli zapytanie dotyczy innej daty niz dzisiaj (Europe/Warsaw), nie przypisujemy dzisiejszego GPS.
        let today = warsaw_datetime(now_ms);
        let today_str = format!(
            "{:04}-{:02}-{:02}",
            today.year(),
            today.month(),
            today.day()
        );
        let is_other_day = req
            .date
            .as_deref()
            .map(|d| !d.trim().is_empty() && d.trim() != today_str)
            .unwrap_or(false);
        if is_other_day {
            let legs = req
                .legs
                .iter()
                .map(|leg| DelayEstimateLegOutput {
                    id: leg.id.clone(),
                    status: "scheduled".to_string(),
                    delay_sec: 0,
                    arrival_delay_sec: None,
                    confidence: 0.0,
                    source: "none".to_string(),
                    line_avg_delay_sec: None,
                    hub_avg_delay_sec: None,
                    typical_delay_sec: leg
                        .line
                        .as_deref()
                        .and_then(|l| {
                            self.lookup_typical_line_delay(
                                &req.city,
                                &l.trim().to_ascii_uppercase(),
                                &day_type,
                                hour_bucket,
                            )
                        }),
                    recommended_transfer_buffer_sec: 0,
                    cancelled: false,
                    detour: false,
                    platform: None,
                    track: None,
                    vehicle: None,
                })
                .collect();
            return DelayEstimateResponse {
                city: req.city.clone(),
                updated_at: now_ms,
                legs,
            };
        }
        let heatmap = self.query_heatmap(&req.city, None, now_ms);
        let hubs_by_key: HashMap<String, &HubDelaySummary> = heatmap
            .hubs
            .iter()
            .map(|h| (h.id.trim_start_matches("hub:").to_string(), h))
            .collect();

        let mut results = Vec::with_capacity(req.legs.len());
        for leg in &req.legs {
            results.push(self.estimate_single_leg(
                &req.city,
                leg,
                &day_type,
                hour_bucket,
                &hubs_by_key,
                &heatmap.zones,
                now_ms,
            ));
        }

        DelayEstimateResponse {
            city: req.city.clone(),
            updated_at: now_ms,
            legs: results,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn estimate_single_leg(
        &self,
        city: &str,
        leg: &DelayEstimateLegInput,
        day_type: &str,
        hour_bucket: u8,
        hubs_by_key: &HashMap<String, &HubDelaySummary>,
        zones: &[HeatmapZone],
        now_ms: i64,
    ) -> DelayEstimateLegOutput {
        if leg.mode == "walk" {
            return DelayEstimateLegOutput {
                id: leg.id.clone(),
                status: "scheduled".to_string(),
                delay_sec: 0,
                arrival_delay_sec: None,
                confidence: 1.0,
                source: "none".to_string(),
                line_avg_delay_sec: None,
                hub_avg_delay_sec: None,
                typical_delay_sec: None,
                recommended_transfer_buffer_sec: 0,
                cancelled: false,
                detour: false,
                platform: None,
                track: None,
                vehicle: None,
            };
        }

        // 1. Pociagi: sprawdzamy bezposredni feed PKP PLK (perony, tory, odwolania, opoznienia).
        if leg.mode == "train" {
            if let Some(plk_out) = self.match_plk_leg(leg) {
                return plk_out;
            }
        }

        let line_upper = leg
            .line
            .as_deref()
            .map(|l| l.trim().to_ascii_uppercase())
            .filter(|l| !l.is_empty());

        // 2. Bezposrednie dopasowanie konkretnego pojazdu GPS (miejskie + kolej regionalna).
        let mut peer_delays: Vec<(i32, f64)> = Vec::new();
        let mut exact_vehicle: Option<&VehicleSnapshot> = None;
        let bucket_ref = self.cities.get(city);

        if let (Some(bucket), Some(ref want_line)) = (bucket_ref.as_ref(), &line_upper) {
            let candidates = if leg.mode == "train" {
                bucket.rail.as_slice()
            } else {
                bucket.urban.as_slice()
            };
            let want_dir = leg.direction.as_deref().map(normalize_hub_name);
            let want_from = leg.from_stop.as_deref().map(normalize_hub_name);
            let want_to = leg.to_stop.as_deref().map(normalize_hub_name);

            let mut best_score = 0_i32;
            for v in candidates {
                if now_ms - v.timestamp_ms > MAX_VEHICLE_AGE_MS {
                    continue;
                }
                let matches_line = v.line.to_ascii_uppercase() == *want_line
                    || (leg.mode == "train"
                        && leg
                            .train_number
                            .as_deref()
                            .map(|n| n.eq_ignore_ascii_case(v.brigade.as_deref().unwrap_or("")))
                            .unwrap_or(false));
                if !matches_line {
                    continue;
                }

                // Zbieranie peerow z tej samej linii na potrzeby estymacji bez GPS.
                if let Some(d) = v.delay_sec {
                    let dir_boost = match (&want_dir, v.headsign.as_deref()) {
                        (Some(wd), Some(hs))
                            if !wd.is_empty() && normalize_hub_name(hs) == *wd =>
                        {
                            1.6
                        }
                        _ => 1.0,
                    };
                    let age_sec = ((now_ms - v.timestamp_ms).max(0) as f64) / 1000.0;
                    let freshness = (1.0 - age_sec / 240.0).clamp(0.3, 1.0);
                    peer_delays.push((d.max(0), dir_boost * freshness));
                }

                // Dopasowanie konkretnego kursu po przystankach i czasie rozkladowym.
                let mut score = 0;
                if let (Some(ref wf), Some(sched_dep)) = (&want_from, leg.scheduled_departure_sec) {
                    for s in &v.upcoming_stops {
                        let sn = normalize_hub_name(&s.name);
                        if !sn.is_empty() && (sn == *wf || sn.contains(wf) || wf.contains(&sn)) {
                            let diff = wrapped_time_diff(s.sched_sec, sched_dep);
                            if diff <= 300 {
                                score += 600 - diff;
                            }
                        }
                    }
                }
                if let (Some(ref wt), Some(sched_arr)) = (&want_to, leg.scheduled_arrival_sec) {
                    for s in &v.upcoming_stops {
                        let sn = normalize_hub_name(&s.name);
                        if !sn.is_empty() && (sn == *wt || sn.contains(wt) || wt.contains(&sn)) {
                            let diff = wrapped_time_diff(s.sched_sec, sched_arr);
                            if diff <= 360 {
                                score += 400 - diff;
                            }
                        }
                    }
                }
                // Dodatkowe dopasowanie po numerze pociagu dla kolei regionalnej.
                if leg.mode == "train" {
                    if let (Some(tn), Some(br)) = (leg.train_number.as_deref(), v.brigade.as_deref())
                    {
                        if tn.eq_ignore_ascii_case(br) {
                            score += 500;
                        }
                    }
                }

                if score > best_score {
                    best_score = score;
                    exact_vehicle = Some(v);
                }
            }

            if let Some(v) = exact_vehicle {
                if let Some(delay) = v.delay_sec {
                    return DelayEstimateLegOutput {
                        id: leg.id.clone(),
                        status: "live".to_string(),
                        delay_sec: delay,
                        arrival_delay_sec: Some(delay),
                        confidence: 1.0,
                        source: "live_gps".to_string(),
                        line_avg_delay_sec: weighted_mean(&peer_delays),
                        hub_avg_delay_sec: lookup_hub_delay(leg, hubs_by_key, zones),
                        typical_delay_sec: self.lookup_typical_line_delay(
                            city,
                            want_line,
                            day_type,
                            hour_bucket,
                        ),
                        recommended_transfer_buffer_sec: compute_transfer_buffer(delay.max(0), delay.max(0)),
                        cancelled: false,
                        detour: false,
                        platform: None,
                        track: None,
                        vehicle: Some(MatchedVehicleInfo {
                            vehicle_id: v.vehicle_id.clone(),
                            lat: v.lat,
                            lon: v.lon,
                            bearing: v.bearing,
                            current_stop: v.current_stop.clone(),
                            next_stop: v.next_stop.clone(),
                            model: v.model.clone(),
                            updated_at: v.timestamp_ms,
                        }),
                    };
                }
            }
        }

        // 3. Brak bezposredniego GPS: fuzja Data Science (peers + korek w wezle/korytarzu + historia).
        let line_avg = weighted_mean(&peer_delays);
        let hub_delay = lookup_hub_delay(leg, hubs_by_key, zones);
        let hist_profile = line_upper.as_ref().and_then(|l| {
            self.line_profiles
                .get(&(city.to_string(), l.clone(), day_type.to_string(), hour_bucket))
                .map(|r| r.clone())
        });
        let typical = hist_profile
            .as_ref()
            .filter(|p| p.sample_count >= 10)
            .map(|p| p.shrunk_delay_sec().round() as i32);

        let mut weighted_sum = 0.0_f64;
        let mut total_weight = 0.0_f64;
        let mut signals = Vec::new();

        // Sygnal A: inne pojazdy tej samej linii teraz w ruchu.
        if !peer_delays.is_empty() {
            let mut vals: Vec<i32> = peer_delays.iter().map(|(d, _)| *d).collect();
            vals.sort_unstable();
            let med = percentile_sorted(&vals, 0.50) as f64;
            let w = if peer_delays.len() >= 2 { 0.60 } else { 0.35 };
            // Tlumienie 0.85 przy przenoszeniu opoznienia miedzy brygadami.
            weighted_sum += (med * 0.85) * w;
            total_weight += w;
            signals.push("live_line_peers");
        }

        // Sygnal B: zator na wezle startowym/koncowym lub w komorce siatki.
        if let Some(hd) = hub_delay {
            if hd >= 150 {
                let w = 0.30;
                weighted_sum += (hd as f64 * 0.75) * w;
                total_weight += w;
                signals.push("live_corridor");
            }
        }

        // Sygnal C: profil historyczny dla bieżacej godziny i typu dnia (shrinkage).
        if let Some(ref prof) = hist_profile {
            if prof.sample_count >= 12 {
                let shrunk = prof.shrunk_delay_sec();
                let w = if peer_delays.is_empty() { 0.45 } else { 0.18 };
                weighted_sum += shrunk * w;
                total_weight += w;
                signals.push("historical_profile");
            }
        }

        let (estimated_delay, confidence, source) = if total_weight > 0.0 {
            let est = (weighted_sum / total_weight).round() as i32;
            let conf = (total_weight.min(0.92)) as f32;
            let src = if signals.len() > 1 {
                "blended"
            } else {
                signals[0]
            };
            (est, conf, src)
        } else {
            (0, 0.0, "none")
        };

        let p90_ref = hist_profile
            .as_ref()
            .map(|p| p.p90_delay_sec.round() as i32)
            .unwrap_or(estimated_delay);

        // Nie pokazujemy fałszywych alarmow dla minimalnych lub niepewnych estymacji.
        let actionable = estimated_delay >= 90 && confidence >= 0.40;
        DelayEstimateLegOutput {
            id: leg.id.clone(),
            status: if actionable { "estimated" } else { "scheduled" }.to_string(),
            delay_sec: if actionable { estimated_delay } else { 0 },
            arrival_delay_sec: if actionable {
                Some(estimated_delay)
            } else {
                None
            },
            confidence: if actionable {
                (confidence * 100.0).round() / 100.0
            } else {
                0.0
            },
            source: if actionable {
                source.to_string()
            } else {
                "none".to_string()
            },
            line_avg_delay_sec: line_avg,
            hub_avg_delay_sec: hub_delay,
            typical_delay_sec: typical,
            recommended_transfer_buffer_sec: compute_transfer_buffer(p90_ref, estimated_delay),
            cancelled: false,
            detour: false,
            platform: None,
            track: None,
            vehicle: None,
        }
    }

    fn match_plk_leg(&self, leg: &DelayEstimateLegInput) -> Option<DelayEstimateLegOutput> {
        let guard = self.rail_feed.read().ok()?;
        let mut matched: Option<&RailTripLive> = None;

        if let Some(ref tid) = leg.trip_id {
            let canon = canonical_plk_trip_id(tid);
            matched = guard
                .by_trip_id
                .get(&canon)
                .or_else(|| guard.by_trip_id.get(tid.trim()));
        }

        if matched.is_none() {
            let mut nums = Vec::new();
            if let Some(ref tn) = leg.train_number {
                nums.extend(extract_train_numbers(tn));
            }
            if let Some(ref l) = leg.line {
                nums.extend(extract_train_numbers(l));
            }
            for n in nums {
                if let Some(list) = guard.by_number.get(&n) {
                    if let Some(first) = list.first() {
                        matched = Some(first);
                        break;
                    }
                }
            }
        }

        let trip = matched?;
        let mut platform: Option<String> = None;
        let mut track: Option<String> = None;
        let mut dep_delay = trip.delay_sec;
        let mut arr_delay = trip.delay_sec;

        if let Some(sched_dep) = leg.scheduled_departure_sec {
            if let Some((best_stop, best_delta)) = best_rail_stop_match(&trip.stops, sched_dep, true) {
                dep_delay = best_delta;
                platform = best_stop.platform.clone();
                track = best_stop.track.clone();
            }
        }
        if let Some(sched_arr) = leg.scheduled_arrival_sec {
            if let Some((_, best_delta)) = best_rail_stop_match(&trip.stops, sched_arr, false) {
                arr_delay = best_delta;
            }
        }
        if platform.is_none() {
            if let Some(first_with_p) = trip.stops.iter().find(|s| s.platform.is_some()) {
                platform = first_with_p.platform.clone();
                track = first_with_p.track.clone();
            }
        }

        Some(DelayEstimateLegOutput {
            id: leg.id.clone(),
            status: "live".to_string(),
            delay_sec: dep_delay,
            arrival_delay_sec: Some(arr_delay),
            confidence: 1.0,
            source: "live_plk".to_string(),
            line_avg_delay_sec: None,
            hub_avg_delay_sec: None,
            typical_delay_sec: None,
            recommended_transfer_buffer_sec: compute_transfer_buffer(arr_delay.max(0), arr_delay.max(0)),
            cancelled: trip.cancelled,
            detour: trip.detour,
            platform,
            track,
            vehicle: None,
        })
    }

    /// Kompatybilny endpoint `/v1/rail/delays` (taki sam format jak Cloudflare Worker).
    pub fn query_rail_delays(
        &self,
        trips_param: Option<&str>,
        numbers_param: Option<&str>,
    ) -> serde_json::Value {
        let guard = match self.rail_feed.read() {
            Ok(g) => g,
            Err(_) => {
                return serde_json::json!({
                    "updatedAt": "",
                    "fetchedAt": 0,
                    "trips": {}
                })
            }
        };

        let mut out: HashMap<String, RailTripLive> = HashMap::new();
        if let Some(tp) = trips_param {
            for raw in tp.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                let canon = canonical_plk_trip_id(raw);
                if let Some(found) = guard
                    .by_trip_id
                    .get(&canon)
                    .or_else(|| guard.by_trip_id.get(raw))
                {
                    let mut cloned = found.clone();
                    cloned.trip_id = raw.to_string();
                    out.insert(raw.to_string(), cloned);
                }
            }
        }
        if let Some(np) = numbers_param {
            for num in np.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                if let Some(list) = guard.by_number.get(num) {
                    if let Some(first) = list.first() {
                        out.entry(format!("num:{num}"))
                            .or_insert_with(|| first.clone());
                    }
                }
            }
        }

        serde_json::json!({
            "updatedAt": guard.timestamp_iso,
            "fetchedAt": guard.updated_at_ms,
            "trips": out
        })
    }

    fn lookup_typical_line_delay(
        &self,
        city: &str,
        line: &str,
        day_type: &str,
        hour_bucket: u8,
    ) -> Option<i32> {
        self.line_profiles
            .get(&(
                city.to_string(),
                line.to_string(),
                day_type.to_string(),
                hour_bucket,
            ))
            .filter(|p| p.sample_count >= 10)
            .map(|p| p.shrunk_delay_sec().round() as i32)
    }

    /// Deterministyczne wykrywanie zatorow komunikacyjnych ze strumienia GPS (bez AI):
    /// 1. Zator/zatrzymanie tramwajowe: >=2 tramwaje blisko siebie stojace z opoznieniem >=3 min.
    /// 2. Zator autobusowy: >=3 autobusy z >=2 linii z wysokim opoznieniem i postojem.
    /// 3. Silny odchyl od normy na wezle: >=2 pojazdy z >=2 linii i odchyl >=+3.5 min od historii.
    fn recompute_anomalies(&self, city: &str, now_ms: i64) {
        let (day_type, hour_bucket) = warsaw_time_bucket(now_ms);
        let Some(mut bucket) = self.cities.get_mut(city) else {
            return;
        };

        struct ZoneProbe {
            lat_sum: f64,
            lon_sum: f64,
            count: u32,
            tram_count: u32,
            tram_stalled: u32,
            bus_count: u32,
            bus_stalled: u32,
            delays: Vec<i32>,
            lines: HashMap<String, u32>,
            hub_votes: HashMap<String, (String, u32)>,
        }

        let mut zones: HashMap<(i32, i32), ZoneProbe> = HashMap::new();
        for v in &bucket.urban {
            if now_ms - v.timestamp_ms > MAX_VEHICLE_AGE_MS {
                continue;
            }
            let Some(delay) = v.delay_sec else {
                continue;
            };
            // Odrzucamy postoje na petli: pojazd na petli ma opoznienie bliskie 0 lub ujemne.
            if delay < LATE_THRESHOLD_SEC {
                continue;
            }
            let stalled = bucket
                .motion
                .get(&v.vehicle_id)
                .map(|m| now_ms - m.stationary_since_ms >= STALL_MIN_MS)
                .unwrap_or(false);

            let (clat, clon) = cell_coords(v.lat, v.lon);
            let probe = zones.entry((clat, clon)).or_insert_with(|| ZoneProbe {
                lat_sum: 0.0,
                lon_sum: 0.0,
                count: 0,
                tram_count: 0,
                tram_stalled: 0,
                bus_count: 0,
                bus_stalled: 0,
                delays: Vec::new(),
                lines: HashMap::new(),
                hub_votes: HashMap::new(),
            });
            probe.lat_sum += v.lat;
            probe.lon_sum += v.lon;
            probe.count += 1;
            probe.delays.push(delay);
            *probe.lines.entry(v.line.to_ascii_uppercase()).or_insert(0) += 1;
            if v.mode == "tram" {
                probe.tram_count += 1;
                if stalled {
                    probe.tram_stalled += 1;
                }
            } else {
                probe.bus_count += 1;
                if stalled {
                    probe.bus_stalled += 1;
                }
            }
            let raw_hub = v
                .current_stop
                .as_deref()
                .or(v.next_stop.as_deref())
                .or_else(|| v.upcoming_stops.first().map(|s| s.name.as_str()));
            if let Some(name) = raw_hub {
                let hkey = normalize_hub_name(name);
                if hkey.len() >= 2 {
                    let e = probe
                        .hub_votes
                        .entry(hkey)
                        .or_insert_with(|| (name.trim().to_string(), 0));
                    e.1 += 1;
                }
            }
        }

        let mut detected_ids: HashSet<String> = HashSet::new();
        for ((clat, clon), mut p) in zones {
            if p.count < 2 {
                continue;
            }
            p.delays.sort_unstable();
            let avg =
                (p.delays.iter().map(|&d| d as f64).sum::<f64>() / p.count as f64).round() as i32;
            let max_d = *p.delays.last().unwrap_or(&0);
            let best_hub = p
                .hub_votes
                .iter()
                .max_by_key(|(_, (_, cnt))| *cnt)
                .map(|(k, (name, _))| (k.clone(), name.clone()));
            let typical = best_hub
                .as_ref()
                .and_then(|(hkey, _)| {
                    self.hub_profiles
                        .get(&(city.to_string(), hkey.clone(), day_type.clone(), hour_bucket))
                        .filter(|hp| hp.sample_count >= 10)
                        .map(|hp| hp.shrunk_delay_sec().round() as i32)
                })
                .or_else(|| {
                    self.cell_profiles
                        .get(&(city.to_string(), clat, clon, day_type.clone(), hour_bucket))
                        .filter(|cp| cp.sample_count >= 10)
                        .map(|cp| cp.shrunk_delay_sec().round() as i32)
                });
            let delta = typical.map(|t| avg - t);

            let is_tram_stall = p.tram_stalled >= 2
                || (p.tram_count >= 2 && p.tram_stalled >= 1 && avg >= 300);
            let is_bus_jam = p.bus_count >= 3
                && p.lines.len() >= 2
                && avg >= 300
                && (p.bus_stalled >= 2 || avg >= 420);
            let is_hub_anomaly = p.count >= 2
                && p.lines.len() >= 2
                && avg >= 300
                && delta.map(|d| d >= 210).unwrap_or(false);

            if !is_tram_stall && !is_bus_jam && !is_hub_anomaly {
                continue;
            }

            let (kind, mode) = if is_tram_stall {
                ("tram_stall", "tram")
            } else if is_bus_jam {
                ("bus_congestion", "bus")
            } else {
                let m = if p.tram_count > 0 && p.bus_count > 0 {
                    "mixed"
                } else if p.tram_count > 0 {
                    "tram"
                } else {
                    "bus"
                };
                ("hub_anomaly", m)
            };

            let severity = if (is_tram_stall && (p.tram_stalled >= 3 || avg >= 480))
                || avg >= 600
                || delta.map(|d| d >= 420).unwrap_or(false)
            {
                "blocking"
            } else if avg >= 330 || p.tram_stalled >= 2 || p.bus_stalled >= 2 {
                "major"
            } else {
                "minor"
            };

            let id = format!("jam:{city}:{kind}:{clat}:{clon}");
            detected_ids.insert(id.clone());

            let mut lines: Vec<(String, u32)> = p.lines.into_iter().collect();
            lines.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
            let line_list: Vec<String> = lines.into_iter().take(8).map(|(l, _)| l).collect();

            let location_name = best_hub
                .map(|(_, name)| name)
                .unwrap_or_else(|| format!("{:.4}, {:.4}", p.lat_sum / p.count as f64, p.lon_sum / p.count as f64));
            let stalled_total = p.tram_stalled + p.bus_stalled;

            let detected_at_ms = bucket
                .anomalies
                .get(&id)
                .map(|prev| prev.detected_at_ms)
                .unwrap_or(now_ms);
            let duration_sec = ((now_ms - detected_at_ms).max(0) / 1000) as u64;

            bucket.anomalies.insert(
                id.clone(),
                TrafficAnomaly {
                    id,
                    city: city.to_string(),
                    kind: kind.to_string(),
                    severity: severity.to_string(),
                    mode: mode.to_string(),
                    location_name,
                    lat: p.lat_sum / p.count as f64,
                    lon: p.lon_sum / p.count as f64,
                    lines: line_list,
                    stalled_vehicles: stalled_total,
                    affected_vehicles: p.count,
                    avg_delay_sec: avg,
                    max_delay_sec: max_d,
                    typical_delay_sec: typical,
                    delta_vs_normal_sec: delta,
                    detected_at_ms,
                    updated_at_ms: now_ms,
                    duration_sec,
                },
            );
        }

        // Histereza: utrzymujemy anomalie przez ANOMALY_HOLD_MS po ostatnim potwierdzeniu.
        bucket
            .anomalies
            .retain(|id, a| detected_ids.contains(id) || now_ms - a.updated_at_ms <= ANOMALY_HOLD_MS);
    }

    pub fn query_anomalies(&self, city: &str, now_ms: i64) -> AnomaliesResponse {
        self.mark_city_demand(city, now_ms);
        let mut anomalies: Vec<TrafficAnomaly> = self
            .cities
            .get(city)
            .map(|b| {
                b.anomalies
                    .values()
                    .filter(|a| now_ms - a.updated_at_ms <= ANOMALY_HOLD_MS)
                    .cloned()
                    .map(|mut a| {
                        a.duration_sec = ((now_ms - a.detected_at_ms).max(0) / 1000) as u64;
                        a
                    })
                    .collect()
            })
            .unwrap_or_default();

        anomalies.sort_by(|a, b| {
            severity_rank(&b.severity)
                .cmp(&severity_rank(&a.severity))
                .then_with(|| b.avg_delay_sec.cmp(&a.avg_delay_sec))
        });

        AnomaliesResponse {
            city: city.to_string(),
            updated_at: now_ms,
            anomalies,
        }
    }

    /// Pelna karta prognozy punktualnosci dla szczegolow polaczenia:
    /// 5-godzinny profil historyczny linii, najgoretszy wezel na trasie i ocena przesiadek.
    pub fn query_route_insights(
        &self,
        req: &RouteInsightsRequest,
        now_ms: i64,
    ) -> RouteInsightsResponse {
        self.mark_city_demand(&req.city, now_ms);
        let day_type = day_type_for_date_or_now(req.date.as_deref(), now_ms);
        let focus_hour = ((req.departure_sec.rem_euclid(86_400)) / 3600) as u8;

        let transit_legs: Vec<&DelayEstimateLegInput> = req
            .legs
            .iter()
            .filter(|l| l.mode != "walk" && l.line.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false))
            .collect();

        if transit_legs.is_empty() {
            return empty_route_insights(&req.city, now_ms, &day_type, focus_hour);
        }

        // Wybieramy glowna linie o najwiekszej liczbie danych lub najwyzszym ryzyku opoznienia.
        let mut best_line: Option<(String, String, u64, i32, i32, f32)> = None;
        for leg in &transit_legs {
            let line = leg.line.as_deref().unwrap_or("").trim().to_ascii_uppercase();
            let prof = self
                .line_profiles
                .get(&(req.city.clone(), line.clone(), day_type.clone(), focus_hour))
                .map(|r| r.clone());
            let (samples, mean_d, p90_d, late_r) = match prof {
                Some(p) => (
                    p.sample_count,
                    p.shrunk_delay_sec().round() as i32,
                    p.p90_delay_sec.round() as i32,
                    p.late_rate as f32,
                ),
                None => (0, 0, 0, 0.0),
            };
            let score = mean_d + if samples >= 15 { 1000 } else { (samples as i32) * 10 };
            let replace = match &best_line {
                None => true,
                Some((_, _, b_samples, b_mean, _, _)) => {
                    let b_score = *b_mean + if *b_samples >= 15 { 1000 } else { (*b_samples as i32) * 10 };
                    score > b_score
                }
            };
            if replace {
                best_line = Some((line, leg.mode.clone(), samples, mean_d, p90_d, late_r));
            }
        }

        let (focus_line, focus_mode, base_samples, mut expected_delay, mut p90_delay, mut late_prob) =
            match best_line {
                Some(t) => t,
                None => return empty_route_insights(&req.city, now_ms, &day_type, focus_hour),
            };

        // 5-godzinne okno wokol godziny odjazdu (-2h..+2h) z profili SQLite/RAM.
        let mut hourly_profile = Vec::with_capacity(5);
        let mut window_samples: u64 = 0;
        for offset in -2_i8..=2_i8 {
            let h = ((focus_hour as i8 + offset).rem_euclid(24)) as u8;
            let p = self
                .line_profiles
                .get(&(req.city.clone(), focus_line.clone(), day_type.clone(), h))
                .map(|r| r.clone());
            let (avg_s, p90_s, cnt) = match p {
                Some(prof) if prof.sample_count >= 5 => (
                    prof.shrunk_delay_sec().round() as i32,
                    prof.p90_delay_sec.round() as i32,
                    prof.sample_count,
                ),
                Some(prof) => (0, 0, prof.sample_count),
                None => (0, 0, 0),
            };
            window_samples += cnt;
            hourly_profile.push(HourlyDelayPoint {
                hour: h,
                avg_delay_sec: avg_s,
                p90_delay_sec: p90_s,
                sample_count: cnt,
                is_departure_hour: offset == 0,
            });
        }

        // Sprawdzamy tez biezace dane live dla linii i wezlow na trasie.
        let heatmap = self.query_heatmap(&req.city, None, now_ms);
        let hubs_by_key: HashMap<String, &HubDelaySummary> = heatmap
            .hubs
            .iter()
            .map(|h| (h.id.trim_start_matches("hub:").to_string(), h))
            .collect();

        let mut hotspot: Option<RouteHotspotInsight> = None;
        for leg in &transit_legs {
            for stop_opt in [leg.from_stop.as_deref(), leg.to_stop.as_deref()] {
                if let Some(stop_name) = stop_opt {
                    let key = normalize_hub_name(stop_name);
                    if let Some(hub) = hubs_by_key.get(&key) {
                        if hub.avg_delay_sec >= 150
                            && hotspot
                                .as_ref()
                                .map_or(true, |cur| hub.avg_delay_sec > cur.avg_delay_sec)
                        {
                            hotspot = Some(RouteHotspotInsight {
                                name: hub.name.clone(),
                                avg_delay_sec: hub.avg_delay_sec,
                                typical_delay_sec: hub.typical_delay_sec,
                                delta_vs_typical_sec: hub.delta_vs_typical_sec,
                                delayed_count: hub.delayed_count,
                            });
                        }
                    }
                }
            }
        }

        // Aktywna anomalia zatoru dotykajaca ktorejkolwiek z linii na trasie.
        let route_lines: HashSet<String> = transit_legs
            .iter()
            .filter_map(|l| l.line.as_deref().map(|s| s.trim().to_ascii_uppercase()))
            .collect();
        let active_anomaly = self
            .query_anomalies(&req.city, now_ms)
            .anomalies
            .into_iter()
            .find(|a| a.lines.iter().any(|l| route_lines.contains(l)));

        // Ocena ryzyka przesiadek miedzy kolejnymi odcinkami tranzytowymi.
        let mut transfer_risks = Vec::new();
        for pair in transit_legs.windows(2) {
            let prev = pair[0];
            let next = pair[1];
            let (Some(arr), Some(dep)) = (prev.scheduled_arrival_sec, next.scheduled_departure_sec)
            else {
                continue;
            };
            let margin = dep - arr;
            if margin < 0 || margin > 1800 {
                continue;
            }
            let feeder_line = prev.line.as_deref().unwrap_or("").trim().to_ascii_uppercase();
            let feeder_p90 = self
                .line_profiles
                .get(&(req.city.clone(), feeder_line.clone(), day_type.clone(), focus_hour))
                .filter(|p| p.sample_count >= 10)
                .map(|p| p.p90_delay_sec.round() as i32)
                .unwrap_or(0);
            if feeder_p90 >= 180 && feeder_p90 >= margin - 60 {
                let risk = if feeder_p90 >= margin + 60 {
                    "risky"
                } else {
                    "tight"
                };
                transfer_risks.push(TransferRiskInsight {
                    stop_name: prev
                        .to_stop
                        .clone()
                        .or_else(|| next.from_stop.clone())
                        .unwrap_or_default(),
                    from_line: feeder_line,
                    to_line: next.line.as_deref().unwrap_or("").trim().to_ascii_uppercase(),
                    margin_sec: margin,
                    feeder_p90_delay_sec: feeder_p90,
                    risk: risk.to_string(),
                });
            }
        }

        // Jesli mamy aktywna anomalie albo goracy wezel, podnosimy oczekiwane opoznienie.
        if let Some(ref a) = active_anomaly {
            expected_delay = expected_delay.max(a.avg_delay_sec);
            p90_delay = p90_delay.max(a.max_delay_sec);
            late_prob = late_prob.max(0.85);
        } else if let Some(ref hs) = hotspot {
            expected_delay = expected_delay.max(hs.avg_delay_sec);
            late_prob = late_prob.max(0.55);
        }

        // Karta pokazuje sie TYLKO gdy mamy realna, sensowna baze danych.
        let has_enough_history = base_samples >= 15 || window_samples >= 35;
        let ready = has_enough_history
            || active_anomaly.is_some()
            || hotspot.as_ref().map(|h| h.delayed_count >= 2).unwrap_or(false)
            || !transfer_risks.is_empty();

        let risk_level = if active_anomaly.is_some()
            || expected_delay >= 300
            || p90_delay >= 540
            || transfer_risks.iter().any(|t| t.risk == "risky")
        {
            "high"
        } else if expected_delay >= 150
            || p90_delay >= 300
            || late_prob >= 0.35
            || !transfer_risks.is_empty()
        {
            "moderate"
        } else {
            "low"
        };

        RouteInsightsResponse {
            city: req.city.clone(),
            updated_at: now_ms,
            ready,
            risk_level: risk_level.to_string(),
            day_type,
            focus_hour,
            focus_line: Some(focus_line),
            focus_mode: Some(focus_mode),
            expected_delay_sec: expected_delay,
            p90_delay_sec: p90_delay,
            late_probability: (late_prob.clamp(0.0, 1.0) * 100.0).round() / 100.0,
            sample_count: base_samples.max(window_samples),
            hourly_profile,
            hotspot,
            transfer_risks,
            active_anomaly,
        }
    }

    /// Zasiewa realistyczne dane testowe wylacznie w trybie lokalnego dema (KILOMETR_SEED_DEMO=true).
    pub fn seed_demo_data(&self, now_ms: i64) {
        let (day_type, cur_hour) = warsaw_time_bucket(now_ms);
        let demo_lines: &[(&str, &str)] = &[
            ("wroclaw", "4"),
            ("wroclaw", "10"),
            ("wroclaw", "D"),
            ("wroclaw", "145"),
            ("wroclaw", "K"),
            ("warszawa", "9"),
            ("warszawa", "17"),
            ("warszawa", "116"),
            ("krakow", "4"),
            ("krakow", "50"),
            ("krakow", "52"),
        ];

        for &(city, line) in demo_lines {
            for offset in -4_i8..=4_i8 {
                let h = ((cur_hour as i8 + offset).rem_euclid(24)) as u8;
                // Typowy profil szczytu: mniejsze opoznienia poza szczytem, wyzsze o cur_hour / cur_hour+1.
                let base_delay = match offset {
                    -4 | -3 => 70.0,
                    -2 => 110.0,
                    -1 => 195.0,
                    0 => 320.0,
                    1 => 430.0,
                    2 => 260.0,
                    _ => 120.0,
                };
                self.line_profiles.insert(
                    (city.to_string(), line.to_string(), day_type.clone(), h),
                    HistoricalProfile {
                        sample_count: 68,
                        mean_delay_sec: base_delay,
                        p90_delay_sec: base_delay * 1.65,
                        late_rate: (base_delay / 550.0).clamp(0.12, 0.88),
                        ema_delay_sec: base_delay * 1.05,
                    },
                );
            }
        }

        // Historyczny profil wezla dla wyliczenia odchylu od normy.
        let demo_hubs: &[(&str, &str, &str, f64, f64, &[&str])] = &[
            (
                "wroclaw",
                "rondo reagana",
                "Rondo Reagana",
                51.1112,
                17.0615,
                &["4", "10", "33", "D", "145"],
            ),
            (
                "warszawa",
                "rondo dmowskiego",
                "Rondo Dmowskiego",
                52.2297,
                21.0122,
                &["7", "9", "24", "25"],
            ),
            (
                "krakow",
                "rondo mogilskie",
                "Rondo Mogilskie",
                50.0658,
                19.9593,
                &["4", "5", "50", "52"],
            ),
        ];

        for &(city, hkey, hname, lat, lon, lines) in demo_hubs {
            self.hub_profiles.insert(
                (city.to_string(), hkey.to_string(), day_type.clone(), cur_hour),
                HistoricalProfile {
                    sample_count: 95,
                    mean_delay_sec: 150.0,
                    p90_delay_sec: 280.0,
                    late_rate: 0.28,
                    ema_delay_sec: 155.0,
                },
            );

            // Trzy tramwaje stojace blisko siebie od 6 min: wyzwala realny detektor `tram_stall`.
            let stalled_since = now_ms - 360_000;
            let mut vehs = Vec::new();
            for (idx, line) in lines.iter().take(3).enumerate() {
                let vid = format!("demo-tram-{city}-{idx}");
                vehs.push(VehicleSnapshot {
                    city: city.to_string(),
                    vehicle_id: vid.clone(),
                    line: (*line).to_string(),
                    mode: "tram".to_string(),
                    lat: lat + (idx as f64) * 0.00018,
                    lon: lon + (idx as f64) * 0.00022,
                    bearing: Some(90.0),
                    delay_sec: Some(460 + (idx as i32) * 75),
                    timestamp_ms: now_ms,
                    headsign: Some(hname.to_string()),
                    brigade: Some(format!("0{}", idx + 1)),
                    model: Some("Pesa Twist".to_string()),
                    agency: None,
                    current_stop: Some(hname.to_string()),
                    next_stop: Some(hname.to_string()),
                    upcoming_stops: Vec::new(),
                    source: "demo".to_string(),
                    is_rail: false,
                });
                let mut bucket = self.cities.entry(city.to_string()).or_default();
                bucket.motion.insert(
                    vid,
                    VehicleMotionState {
                        anchor_lat: lat + (idx as f64) * 0.00018,
                        anchor_lon: lon + (idx as f64) * 0.00022,
                        stationary_since_ms: stalled_since,
                        last_seen_ms: now_ms,
                    },
                );
            }
            self.ingest_city_vehicles(city, vehs, false, now_ms);
        }
    }
}

fn empty_route_insights(
    city: &str,
    now_ms: i64,
    day_type: &str,
    focus_hour: u8,
) -> RouteInsightsResponse {
    RouteInsightsResponse {
        city: city.to_string(),
        updated_at: now_ms,
        ready: false,
        risk_level: "low".to_string(),
        day_type: day_type.to_string(),
        focus_hour,
        focus_line: None,
        focus_mode: None,
        expected_delay_sec: 0,
        p90_delay_sec: 0,
        late_probability: 0.0,
        sample_count: 0,
        hourly_profile: Vec::new(),
        hotspot: None,
        transfer_risks: Vec::new(),
        active_anomaly: None,
    }
}

fn day_type_for_date_or_now(date_opt: Option<&str>, now_ms: i64) -> String {
    if let Some(raw) = date_opt {
        if let Ok(date) = raw.trim().parse::<jiff::civil::Date>() {
            return match date.weekday() {
                Weekday::Saturday => "saturday",
                Weekday::Sunday => "sunday",
                _ => "weekday",
            }
            .to_string();
        }
    }
    warsaw_time_bucket(now_ms).0
}

fn severity_rank(s: &str) -> u8 {
    match s {
        "blocking" => 3,
        "major" => 2,
        "minor" => 1,
        _ => 0,
    }
}

fn distance_meters_approx(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let dlat = (lat2 - lat1) * 111_320.0;
    let avg_lat_rad = ((lat1 + lat2) * 0.5).to_radians();
    let dlon = (lon2 - lon1) * 111_320.0 * avg_lat_rad.cos();
    (dlat * dlat + dlon * dlon).sqrt()
}

pub fn warsaw_time_bucket(now_ms: i64) -> (String, u8) {
    let dt = warsaw_datetime(now_ms);
    let day_type = match dt.weekday() {
        Weekday::Saturday => "saturday",
        Weekday::Sunday => "sunday",
        _ => "weekday",
    };
    (day_type.to_string(), dt.hour() as u8)
}

fn warsaw_datetime(now_ms: i64) -> jiff::ZonedDateTime {
    let ts = jiff::Timestamp::from_millisecond(now_ms).unwrap_or_else(|_| jiff::Timestamp::now());
    ts.in_tz("Europe/Warsaw")
        .unwrap_or_else(|_| ts.to_zoned_datetime(jiff::tz::TimeZone::UTC))
}

pub fn cell_coords(lat: f64, lon: f64) -> (i32, i32) {
    (
        (lat / CELL_LAT_STEP).floor() as i32,
        (lon / CELL_LON_STEP).floor() as i32,
    )
}

pub fn normalize_hub_name(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut prev_space = true;
    for ch in raw.chars() {
        let mapped = match ch {
            'ą' | 'Ą' => 'a',
            'ć' | 'Ć' => 'c',
            'ę' | 'Ę' => 'e',
            'ł' | 'Ł' => 'l',
            'ń' | 'Ń' => 'n',
            'ó' | 'Ó' => 'o',
            'ś' | 'Ś' => 's',
            'ź' | 'Ź' | 'ż' | 'Ż' => 'z',
            c if c.is_ascii_alphanumeric() => c.to_ascii_lowercase(),
            _ => ' ',
        };
        if mapped == ' ' {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(mapped);
            prev_space = false;
        }
    }
    let trimmed = out.trim();
    // Obcinamy pojedynczy koncowy numer slupka (np. "rondo reagana 02" -> "rondo reagana"),
    // aby wspolne przystanki tworzyly jeden wezel komunikacyjny.
    let parts: Vec<&str> = trimmed.split(' ').collect();
    if parts.len() >= 2 {
        if let Some(last) = parts.last() {
            if last.len() <= 2 && last.chars().all(|c| c.is_ascii_digit()) {
                return parts[..parts.len() - 1].join(" ");
            }
        }
    }
    trimmed.to_string()
}

pub fn canonical_plk_trip_id(raw: &str) -> String {
    let mut trimmed = raw.trim();
    if let Some(idx) = trimmed.rfind("_LEG") {
        let suffix = &trimmed[idx + 4..];
        if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
            trimmed = &trimmed[..idx];
        }
    }
    // KD:T:2026:69558 -> PLK_KD_2026_69558
    if let Some(rest) = trimmed.strip_prefix("KD:T:").or_else(|| trimmed.strip_prefix("kd:t:")) {
        let segs: Vec<&str> = rest.split(':').collect();
        if segs.len() >= 2 {
            return format!("PLK_KD_{}_{}", segs[0], segs[1]);
        }
    }
    if let Some(pos) = trimmed.find(":PLK_") {
        return trimmed[pos + 1..].to_string();
    }
    if let Some(rest) = trimmed.strip_prefix("pl:") {
        return rest.to_string();
    }
    trimmed.to_string()
}

pub fn extract_train_numbers(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    for token in raw.split_whitespace() {
        let clean = token.trim();
        if clean.is_empty() {
            continue;
        }
        if clean.contains('/') {
            let parts: Vec<&str> = clean.split('/').collect();
            if parts.len() == 2 && parts[0].len() >= 3 && parts[0].chars().all(|c| c.is_ascii_digit())
            {
                out.push(parts[0].to_string());
                if parts[1].chars().all(|c| c.is_ascii_digit()) {
                    if parts[1].len() < parts[0].len() {
                        let prefix = &parts[0][..parts[0].len() - parts[1].len()];
                        out.push(format!("{prefix}{}", parts[1]));
                    } else {
                        out.push(parts[1].to_string());
                    }
                }
            }
        } else if (3..=6).contains(&clean.len()) && clean.chars().all(|c| c.is_ascii_digit()) {
            out.push(clean.to_string());
        }
    }
    out
}

fn update_in_memory_profile<K: Eq + std::hash::Hash>(
    map: &DashMap<K, HistoricalProfile>,
    key: K,
    pos_delay: f64,
    is_late: bool,
) {
    let late = if is_late { 1.0 } else { 0.0 };
    map.entry(key)
        .and_modify(|p| {
            p.sample_count += 1;
            let n = p.sample_count as f64;
            p.mean_delay_sec += (pos_delay - p.mean_delay_sec) / n;
            if pos_delay > p.p90_delay_sec {
                p.p90_delay_sec += 0.12 * (pos_delay - p.p90_delay_sec);
            } else {
                p.p90_delay_sec -= 0.015 * (p.p90_delay_sec - pos_delay);
            }
            p.late_rate += (late - p.late_rate) / n;
            p.ema_delay_sec = 0.92 * p.ema_delay_sec + 0.08 * pos_delay;
        })
        .or_insert(HistoricalProfile {
            sample_count: 1,
            mean_delay_sec: pos_delay,
            p90_delay_sec: pos_delay,
            late_rate: late,
            ema_delay_sec: pos_delay,
        });
}

fn percentile_sorted(sorted: &[i32], p: f64) -> i32 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((sorted.len() - 1) as f64 * p).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn classify_severity(avg: i32, p90: i32, delayed_count: u32) -> &'static str {
    if (avg >= 420 && delayed_count >= 2) || (avg >= 540) || (p90 >= 720 && delayed_count >= 2) {
        "severe"
    } else if avg >= 240 || (p90 >= 420 && delayed_count >= 2) {
        "heavy"
    } else if avg >= 120 {
        "moderate"
    } else {
        "normal"
    }
}

fn compute_line_untracked_estimate(
    active_vehicles: u32,
    live_median: i32,
    hist: Option<&HistoricalProfile>,
) -> (i32, f32) {
    let mut num = 0.0_f64;
    let mut den = 0.0_f64;
    if active_vehicles >= 2 {
        let w = 0.72;
        num += (live_median as f64 * 0.85) * w;
        den += w;
    } else if active_vehicles == 1 {
        let w = 0.42;
        num += (live_median as f64 * 0.80) * w;
        den += w;
    }
    if let Some(p) = hist {
        if p.sample_count >= 12 {
            let w = if active_vehicles == 0 { 0.48 } else { 0.20 };
            num += p.shrunk_delay_sec() * w;
            den += w;
        }
    }
    if den <= 0.0 {
        return (0, 0.0);
    }
    let est = (num / den).round() as i32;
    let conf = den.min(0.92) as f32;
    if est < 90 || conf < 0.40 {
        (0, 0.0)
    } else {
        (est, conf)
    }
}

fn compute_transfer_buffer(p90_sec: i32, est_delay_sec: i32) -> i32 {
    let worst = p90_sec.max(est_delay_sec);
    if worst >= 480 {
        300
    } else if worst >= 240 {
        240
    } else if worst >= 120 {
        180
    } else {
        0
    }
}

fn weighted_mean(samples: &[(i32, f64)]) -> Option<i32> {
    if samples.is_empty() {
        return None;
    }
    let mut s = 0.0;
    let mut w = 0.0;
    for &(v, weight) in samples {
        s += v as f64 * weight;
        w += weight;
    }
    if w <= 0.0 {
        None
    } else {
        Some((s / w).round() as i32)
    }
}

fn lookup_hub_delay(
    leg: &DelayEstimateLegInput,
    hubs_by_key: &HashMap<String, &HubDelaySummary>,
    zones: &[HeatmapZone],
) -> Option<i32> {
    let mut max_found: Option<i32> = None;
    for name_opt in [leg.from_stop.as_deref(), leg.to_stop.as_deref()] {
        if let Some(name) = name_opt {
            let key = normalize_hub_name(name);
            if let Some(hub) = hubs_by_key.get(&key) {
                max_found = Some(max_found.map_or(hub.avg_delay_sec, |m| m.max(hub.avg_delay_sec)));
            }
        }
    }
    if max_found.is_some() {
        return max_found;
    }
    for (lat_opt, lon_opt) in [(leg.from_lat, leg.from_lon), (leg.to_lat, leg.to_lon)] {
        if let (Some(lat), Some(lon)) = (lat_opt, lon_opt) {
            let (clat, clon) = cell_coords(lat, lon);
            let want = format!("cell:{clat}:{clon}");
            if let Some(z) = zones.iter().find(|z| z.id == want) {
                max_found = Some(max_found.map_or(z.avg_delay_sec, |m| m.max(z.avg_delay_sec)));
            }
        }
    }
    max_found
}

fn wrapped_time_diff(a: i32, b: i32) -> i32 {
    let a = a.rem_euclid(86_400);
    let b = b.rem_euclid(86_400);
    let direct = (a - b).abs();
    direct.min(86_400 - direct)
}

fn parse_iso_sec_of_day(iso: &str) -> Option<i32> {
    let time_part = iso.split('T').nth(1).unwrap_or(iso);
    let clean = time_part
        .split(['+', '-', 'Z'])
        .next()
        .unwrap_or(time_part);
    let mut parts = clean.split(':');
    let h: i32 = parts.next()?.parse().ok()?;
    let m: i32 = parts.next()?.parse().ok()?;
    let s: i32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    Some(h * 3600 + m * 60 + s)
}

fn best_rail_stop_match<'a>(
    stops: &'a [crate::models::RailStopUpdate],
    sched_sec: i32,
    is_departure: bool,
) -> Option<(&'a crate::models::RailStopUpdate, i32)> {
    let mut best: Option<(&crate::models::RailStopUpdate, i32, i32)> = None;
    for st in stops {
        let iso = if is_departure {
            st.dep.as_deref().or(st.arr.as_deref())
        } else {
            st.arr.as_deref().or(st.dep.as_deref())
        };
        let Some(actual) = iso.and_then(parse_iso_sec_of_day) else {
            continue;
        };
        let signed = ((actual - sched_sec.rem_euclid(86_400) + 129_600).rem_euclid(86_400)) - 43_200;
        if signed.abs() > MAX_RAIL_DELAY_SEC {
            continue;
        }
        let score = signed.abs();
        if best.map_or(true, |(_, _, bscore)| score < bscore) {
            best = Some((st, signed, score));
        }
    }
    best.map(|(st, delta, _)| (st, delta))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::UpcomingStop;

    fn sample_vehicle(
        city: &str,
        id: &str,
        line: &str,
        lat: f64,
        lon: f64,
        delay: i32,
        stop: Option<&str>,
        now_ms: i64,
    ) -> VehicleSnapshot {
        VehicleSnapshot {
            city: city.to_string(),
            vehicle_id: id.to_string(),
            line: line.to_string(),
            mode: "tram".to_string(),
            lat,
            lon,
            bearing: Some(90.0),
            delay_sec: Some(delay),
            timestamp_ms: now_ms,
            headsign: Some("Biskupin".to_string()),
            brigade: None,
            model: None,
            agency: None,
            current_stop: stop.map(|s| s.to_string()),
            next_stop: None,
            upcoming_stops: vec![UpcomingStop {
                name: stop.unwrap_or("Rondo Reagana").to_string(),
                sched_sec: 43_200,
            }],
            source: "zbiorkom".to_string(),
            is_rail: false,
        }
    }

    #[test]
    fn normalize_merges_polish_chars_and_platform_numbers() {
        assert_eq!(normalize_hub_name("Rondo Reagana 02"), "rondo reagana");
        assert_eq!(normalize_hub_name("Żółkiewskiego 1"), "zolkiewskiego");
        assert_eq!(normalize_hub_name("Dworzec Główny"), "dworzec glowny");
    }

    #[test]
    fn canonical_plk_id_handles_prefixes_and_legs() {
        assert_eq!(canonical_plk_trip_id("pl:PLK_IC_123_LEG1"), "PLK_IC_123");
        assert_eq!(canonical_plk_trip_id("KD:T:2026:69558"), "PLK_KD_2026_69558");
        assert_eq!(canonical_plk_trip_id("KML:PLK_KML_99"), "PLK_KML_99");
    }

    #[test]
    fn viewport_filtering_and_heatmap_work_correctly() {
        let now_ms = 1_795_518_000_000;
        let engine = AnalyticsEngine::new(LoadedProfiles::default());

        engine.ingest_city_vehicles(
            "wroclaw",
            vec![
                sample_vehicle("wroclaw", "v1", "4", 51.111, 17.061, 420, Some("Rondo Reagana 01"), now_ms),
                sample_vehicle("wroclaw", "v2", "10", 51.1112, 17.0612, 480, Some("Rondo Reagana 02"), now_ms),
                sample_vehicle("wroclaw", "v3", "145", 51.200, 17.200, 30, Some("Psie Pole"), now_ms),
            ],
            false,
            now_ms,
        );

        let bbox = Bbox::parse("17.04,51.10,17.08,51.13").unwrap();
        let res = engine.query_vehicles("wroclaw", Some(bbox), None, None, false, None, now_ms, 60);
        assert_eq!(res.vehicles.len(), 2);
        assert_eq!(res.total_in_city, 3);
        assert!(res.boosted);

        let hm = engine.query_heatmap("wroclaw", Some(bbox), now_ms);
        assert_eq!(hm.zones.len(), 1);
        assert_eq!(hm.zones[0].severity, "severe");
        assert_eq!(hm.hubs.len(), 1);
        assert_eq!(hm.hubs[0].name, "Rondo Reagana 01");
        assert_eq!(hm.hubs[0].delayed_count, 2);
    }

    #[test]
    fn estimates_untracked_leg_from_same_line_and_hub_congestion() {
        let now_ms = 1_795_518_000_000;
        let engine = AnalyticsEngine::new(LoadedProfiles::default());

        engine.ingest_city_vehicles(
            "wroclaw",
            vec![
                sample_vehicle("wroclaw", "v1", "D", 51.111, 17.061, 360, Some("Plac Grunwaldzki"), now_ms),
                sample_vehicle("wroclaw", "v2", "D", 51.112, 17.062, 420, Some("Plac Grunwaldzki"), now_ms),
            ],
            false,
            now_ms,
        );

        let req = DelayEstimateRequest {
            city: "wroclaw".to_string(),
            date: None,
            legs: vec![DelayEstimateLegInput {
                id: "leg-1".to_string(),
                mode: "bus".to_string(),
                line: Some("D".to_string()),
                trip_id: None,
                train_number: None,
                direction: Some("Biskupin".to_string()),
                from_stop: Some("Plac Grunwaldzki".to_string()),
                to_stop: Some("Krzyki".to_string()),
                from_lat: Some(51.111),
                from_lon: Some(17.061),
                to_lat: None,
                to_lon: None,
                // Inna godzina niz v1/v2 (43200), wiec nie lapie bezposredniego GPS.
                scheduled_departure_sec: Some(46_800),
                scheduled_arrival_sec: Some(48_000),
            }],
        };

        let out = engine.estimate_legs(&req, now_ms);
        assert_eq!(out.legs.len(), 1);
        assert_eq!(out.legs[0].status, "estimated");
        assert_eq!(out.legs[0].source, "blended");
        assert!(out.legs[0].delay_sec >= 240);
        assert!(out.legs[0].confidence >= 0.7);
    }

    #[test]
    fn detects_tram_stall_anomaly_and_ignores_on_time_terminus_layover() {
        let t0 = 1_795_518_000_000;
        let t1 = t0 + 210_000; // 3.5 min pozniej
        let engine = AnalyticsEngine::new(LoadedProfiles::default());

        // Scenariusz 1: 2 tramwaje stoja na petli (delay = 0) -> brak falszywego alarmu.
        let layover = vec![
            sample_vehicle("wroclaw", "t1", "4", 51.105, 17.105, 0, Some("Biskupin"), t0),
            sample_vehicle("wroclaw", "t2", "10", 51.1051, 17.1051, 20, Some("Biskupin"), t0),
        ];
        engine.ingest_city_vehicles("wroclaw", layover.clone(), false, t0);
        let layover_t1: Vec<_> = layover
            .into_iter()
            .map(|mut v| {
                v.timestamp_ms = t1;
                v
            })
            .collect();
        engine.ingest_city_vehicles("wroclaw", layover_t1, false, t1);
        assert!(engine.query_anomalies("wroclaw", t1).anomalies.is_empty());

        // Scenariusz 2: 2 tramwaje stoja w miejscu na trasie i nabijaja opoznienie -> zator tramwajowy!
        let jam_t0 = vec![
            sample_vehicle("wroclaw", "j1", "4", 51.111, 17.061, 360, Some("Rondo Reagana"), t0),
            sample_vehicle("wroclaw", "j2", "10", 51.1111, 17.0612, 420, Some("Rondo Reagana"), t0),
        ];
        engine.ingest_city_vehicles("wroclaw", jam_t0, false, t0);
        let jam_t1 = vec![
            sample_vehicle("wroclaw", "j1", "4", 51.11105, 17.06102, 540, Some("Rondo Reagana"), t1),
            sample_vehicle("wroclaw", "j2", "10", 51.11112, 17.06121, 600, Some("Rondo Reagana"), t1),
        ];
        engine.ingest_city_vehicles("wroclaw", jam_t1, false, t1);

        let res = engine.query_anomalies("wroclaw", t1);
        assert_eq!(res.anomalies.len(), 1);
        assert_eq!(res.anomalies[0].kind, "tram_stall");
        assert_eq!(res.anomalies[0].stalled_vehicles, 2);
        assert_eq!(res.anomalies[0].location_name, "Rondo Reagana");
    }

    #[test]
    fn route_insights_reports_ready_only_with_sufficient_data_and_evaluates_transfers() {
        let now_ms = 1_795_518_000_000;
        let engine = AnalyticsEngine::new(LoadedProfiles::default());

        let req = RouteInsightsRequest {
            city: "wroclaw".to_string(),
            date: None,
            departure_sec: 13 * 3600,
            legs: vec![
                DelayEstimateLegInput {
                    id: "l1".to_string(),
                    mode: "tram".to_string(),
                    line: Some("4".to_string()),
                    trip_id: None,
                    train_number: None,
                    direction: Some("Biskupin".to_string()),
                    from_stop: Some("Rynek".to_string()),
                    to_stop: Some("Rondo Reagana".to_string()),
                    from_lat: None,
                    from_lon: None,
                    to_lat: None,
                    to_lon: None,
                    scheduled_departure_sec: Some(13 * 3600),
                    scheduled_arrival_sec: Some(13 * 3600 + 600),
                },
                DelayEstimateLegInput {
                    id: "l2".to_string(),
                    mode: "bus".to_string(),
                    line: Some("D".to_string()),
                    trip_id: None,
                    train_number: None,
                    direction: Some("Krzyki".to_string()),
                    from_stop: Some("Rondo Reagana".to_string()),
                    to_stop: Some("Krzyki".to_string()),
                    from_lat: None,
                    from_lon: None,
                    to_lat: None,
                    to_lon: None,
                    // Ciasna przesiadka: tylko 4 min zapasu (240s).
                    scheduled_departure_sec: Some(13 * 3600 + 840),
                    scheduled_arrival_sec: Some(13 * 3600 + 1800),
                },
            ],
        };

        // Bez danych -> ready = false (karta ukryta).
        let empty = engine.query_route_insights(&req, now_ms);
        assert!(!empty.ready);

        // Po zasileniu historia demo -> ready = true, 5 godzin w profilu, wykryta ciasna przesiadka.
        engine.seed_demo_data(now_ms);
        let filled = engine.query_route_insights(&req, now_ms);
        assert!(filled.ready);
        assert_eq!(filled.hourly_profile.len(), 5);
        assert!(filled.hourly_profile.iter().any(|p| p.is_departure_hour));
        assert!(!filled.transfer_risks.is_empty());
    }
}
