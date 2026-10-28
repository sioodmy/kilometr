//! Silnik śledzenia pojazdów na żywo (`liveTracker`), dopasowania pociągów KD
//! (`zbiorkom.ts`), dopasowania pojazdu do geometrii odcinka na mapie (`liveVehicle.ts`)
//! oraz operacji geometrycznych na poliliniach (`routeGeometry.ts`).

use std::cell::RefCell;
use std::collections::HashMap;
use std::f64::consts::PI;

use crate::search::{distance_meters, normalize_polish};

const MAX_CORRIDOR_DIST_M: f64 = 350.0;
const MIN_DELAY_SEC: i32 = -300;
const MAX_DELAY_SEC: i32 = 2100;

#[derive(Clone, Copy, Debug)]
pub struct PolylineProjection {
    pub distance_meters: f64,
    pub closest_lat: f64,
    pub closest_lon: f64,
    pub segment_index: usize,
    pub segment_progress: f64,
}

/// Rzutuje punkt `(lat, lon)` na polilinię `coords` (`[(lat, lon)]`).
/// Zgodne 1:1 z `projectPointToPolyline` z `src/services/routeGeometry.ts`.
pub fn project_point_to_polyline(
    lat: f64,
    lon: f64,
    coords: &[(f64, f64)],
) -> PolylineProjection {
    if coords.is_empty() {
        return PolylineProjection {
            distance_meters: f64::INFINITY,
            closest_lat: lat,
            closest_lon: lon,
            segment_index: 0,
            segment_progress: 0.0,
        };
    }
    if coords.len() == 1 {
        let (lat0, lon0) = coords[0];
        return PolylineProjection {
            distance_meters: distance_meters(lat, lon, lat0, lon0),
            closest_lat: lat0,
            closest_lon: lon0,
            segment_index: 0,
            segment_progress: 0.0,
        };
    }

    let mut min_dist = f64::INFINITY;
    let mut best_lat = coords[0].0;
    let mut best_lon = coords[0].1;
    let mut best_seg = 0usize;
    let mut best_t = 0.0f64;

    for i in 0..(coords.len() - 1) {
        let (lat1, lon1) = coords[i];
        let (lat2, lon2) = coords[i + 1];
        let cos_lat = (((lat1 + lat2) * 0.5) * PI / 180.0).cos();
        let dx = (lon2 - lon1) * cos_lat;
        let dy = lat2 - lat1;
        let len_sq = dx * dx + dy * dy;
        let mut t = 0.0;
        if len_sq > 0.0 {
            t = (((lon - lon1) * cos_lat * dx + (lat - lat1) * dy) / len_sq).clamp(0.0, 1.0);
        }
        let proj_lat = lat1 + t * dy;
        let proj_lon = lon1 + t * (lon2 - lon1);
        let d = distance_meters(lat, lon, proj_lat, proj_lon);
        if d < min_dist {
            min_dist = d;
            best_lat = proj_lat;
            best_lon = proj_lon;
            best_seg = i;
            best_t = t;
        }
    }

    PolylineProjection {
        distance_meters: min_dist,
        closest_lat: best_lat,
        closest_lon: best_lon,
        segment_index: best_seg,
        segment_progress: best_t,
    }
}

pub fn cumulative_distances(coords: &[(f64, f64)]) -> Vec<f64> {
    let mut out = vec![0.0; coords.len()];
    for i in 1..coords.len() {
        out[i] = out[i - 1]
            + distance_meters(coords[i - 1].0, coords[i - 1].1, coords[i].0, coords[i].1);
    }
    out
}

#[derive(Clone, Copy, Debug)]
pub struct RoutePointProjection {
    pub progress: f64,
    pub distance_along_m: f64,
    pub offset_m: f64,
    pub lat: f64,
    pub lon: f64,
}

pub fn project_route_point_with_cum(
    coords: &[(f64, f64)],
    cum: &[f64],
    lat: f64,
    lon: f64,
) -> Option<RoutePointProjection> {
    if coords.len() < 2 || cum.len() != coords.len() {
        return None;
    }
    let total = *cum.last().unwrap_or(&0.0);
    if total <= 0.0 {
        return None;
    }
    let proj = project_point_to_polyline(lat, lon, coords);
    let seg_len = cum[proj.segment_index + 1] - cum[proj.segment_index];
    let distance_along_m = cum[proj.segment_index] + proj.segment_progress * seg_len;
    let progress = (distance_along_m / total).clamp(0.0, 1.0);
    Some(RoutePointProjection {
        progress,
        distance_along_m,
        offset_m: proj.distance_meters,
        lat: proj.closest_lat,
        lon: proj.closest_lon,
    })
}

pub fn interpolate_route_with_cum(
    coords: &[(f64, f64)],
    cum: &[f64],
    progress: f64,
) -> Option<(f64, f64)> {
    if coords.is_empty() || cum.len() != coords.len() {
        return None;
    }
    if coords.len() == 1 || progress <= 0.0 {
        return Some(coords[0]);
    }
    if progress >= 1.0 {
        return Some(*coords.last().unwrap());
    }
    let total = *cum.last().unwrap_or(&0.0);
    if total <= 0.0 {
        return Some(coords[0]);
    }
    let target = progress * total;
    let mut lo = 0usize;
    let mut hi = cum.len() - 1;
    while lo + 1 < hi {
        let mid = (lo + hi) >> 1;
        if cum[mid] <= target {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let span = cum[lo + 1] - cum[lo];
    let t = if span > 0.0 {
        (target - cum[lo]) / span
    } else {
        0.0
    };
    let (lat1, lon1) = coords[lo];
    let (lat2, lon2) = coords[lo + 1];
    Some((lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t))
}

// ============================================================================
// Indeks rozkładu dla `liveTracker` (dopasowanie wszystkich pojazdów MPK w Rust)
// ============================================================================

struct LiveTripEntry {
    trip_idx: u32,
    /// Dla każdego przystanku w `pattern.valid_stop_indices`: `(dep_sec, arr_sec)` lub `i32::MIN`
    valid_dep: Vec<i32>,
    valid_arr: Vec<i32>,
    /// Surowa sekwencja przystanków kursu do fallbacku <= 200 m: `(stop_idx, lat, lon, dep_sec)`
    fallback_stops: Vec<(u32, f64, f64, i32)>,
}

struct LivePatternEntry {
    valid_stop_indices: Vec<u32>,
    coords: Vec<(f64, f64)>,
    min_lat: f64,
    max_lat: f64,
    min_lon: f64,
    max_lon: f64,
    trips: Vec<LiveTripEntry>,
}

#[derive(Default)]
struct LiveScheduleIndex {
    /// Klucz: nazwa linii wielkimi literami (np. "4", "145", "A")
    by_line: HashMap<String, Vec<LivePatternEntry>>,
}

#[derive(Clone, Copy)]
pub struct VehicleMatchResult {
    pub matched: bool,
    pub trip_idx: u32,
    pub delay_sec: i32,
    pub current_stop_idx: u32,
    pub next_stop_idx: u32,
}

impl LiveScheduleIndex {
    fn match_single(&self, line: &str, lat: f64, lon: f64, now_sec: i32) -> Option<(u32, i32, u32, u32, f64)> {
        let patterns = self.by_line.get(line)?;
        if patterns.is_empty() {
            return None;
        }

        // Margines 350 m w stopniach (~0.0035 deg lat, ~0.0055 deg lon)
        const LAT_MARGIN: f64 = 0.004;
        const LON_MARGIN: f64 = 0.0065;

        let mut best: Option<(u32, i32, u32, u32, f64)> = None;

        // Krok 1: Rzutowanie na polilinie wzorców trasy (<= 350 m)
        for pattern in patterns {
            if pattern.coords.len() < 2 {
                continue;
            }
            if lat < pattern.min_lat - LAT_MARGIN
                || lat > pattern.max_lat + LAT_MARGIN
                || lon < pattern.min_lon - LON_MARGIN
                || lon > pattern.max_lon + LON_MARGIN
            {
                continue;
            }

            let proj = project_point_to_polyline(lat, lon, &pattern.coords);
            if proj.distance_meters > MAX_CORRIDOR_DIST_M {
                continue;
            }

            let n_valid = pattern.valid_stop_indices.len();
            let seg_idx = proj.segment_index.min(n_valid.saturating_sub(2));
            let (lat1, lon1) = pattern.coords[seg_idx];
            let (lat2, lon2) = pattern.coords[seg_idx + 1];
            let d_seg = distance_meters(lat1, lon1, lat2, lon2);
            let d1 = distance_meters(lat1, lon1, proj.closest_lat, proj.closest_lon);
            let t = if d_seg > 0.0 {
                (d1 / d_seg).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let curr_stop_idx = pattern.valid_stop_indices[seg_idx];
            let next_stop_idx = pattern.valid_stop_indices[(seg_idx + 1).min(n_valid - 1)];

            for trip in &pattern.trips {
                if seg_idx + 1 >= trip.valid_dep.len() {
                    continue;
                }
                let dep1 = trip.valid_dep[seg_idx];
                let arr2 = trip.valid_arr[seg_idx + 1];
                if dep1 == i32::MIN || arr2 == i32::MIN {
                    continue;
                }
                let expected_sec = (dep1 as f64 + t * (arr2 - dep1) as f64).round() as i32;
                let delay = now_sec - expected_sec;
                if !(MIN_DELAY_SEC..=MAX_DELAY_SEC).contains(&delay) {
                    continue;
                }
                let score = (delay.abs() as f64) + proj.distance_meters * 2.0;
                if best.map_or(true, |b| score < b.4) {
                    best = Some((trip.trip_idx, delay, curr_stop_idx, next_stop_idx, score));
                }
            }
        }

        // Krok 2: Fallback na bliskość pojedynczego przystanku (<= 200 m)
        if best.is_none() {
            for pattern in patterns {
                for trip in &pattern.trips {
                    let st_len = trip.fallback_stops.len();
                    for (i, &(stop_idx, s_lat, s_lon, dep_sec)) in
                        trip.fallback_stops.iter().enumerate()
                    {
                        let dist = distance_meters(lat, lon, s_lat, s_lon);
                        if dist > 200.0 {
                            continue;
                        }
                        let delay = now_sec - dep_sec;
                        if !(MIN_DELAY_SEC..=MAX_DELAY_SEC).contains(&delay) {
                            continue;
                        }
                        let score = (delay.abs() as f64) + dist * 2.0;
                        if best.map_or(true, |b| score < b.4) {
                            let next_stop_idx = trip.fallback_stops[(i + 1).min(st_len - 1)].0;
                            best = Some((trip.trip_idx, delay, stop_idx, next_stop_idx, score));
                        }
                    }
                }
            }
        }

        best
    }

    /// Dopasowuje wsadowo wszystkie pojazdy i rozwiązuje konflikty (`resolveConflicts`-
    /// jeden pojazd na kurs z najniższym wynikiem `score`).
    pub fn match_batch(&self, rows: &[(String, f64, f64, i32)]) -> Vec<VehicleMatchResult> {
        let mut raw_matches: Vec<Option<(u32, i32, u32, u32, f64)>> =
            Vec::with_capacity(rows.len());
        let mut by_trip: HashMap<u32, (usize, f64)> = HashMap::new();

        for (idx, (line, lat, lon, observed_sec)) in rows.iter().enumerate() {
            let m = self.match_single(line, *lat, *lon, *observed_sec);
            if let Some((trip_idx, _, _, _, score)) = m {
                match by_trip.get(&trip_idx) {
                    Some(&(_, best_score)) if score >= best_score => {}
                    _ => {
                        by_trip.insert(trip_idx, (idx, score));
                    }
                }
            }
            raw_matches.push(m);
        }

        raw_matches
            .into_iter()
            .enumerate()
            .map(|(idx, m)| match m {
                Some((trip_idx, delay_sec, curr_stop, next_stop, _)) => {
                    if by_trip.get(&trip_idx).map(|&(win_idx, _)| win_idx) == Some(idx) {
                        VehicleMatchResult {
                            matched: true,
                            trip_idx,
                            delay_sec,
                            current_stop_idx: curr_stop,
                            next_stop_idx: next_stop,
                        }
                    } else {
                        VehicleMatchResult {
                            matched: false,
                            trip_idx: u32::MAX,
                            delay_sec: 0,
                            current_stop_idx: u32::MAX,
                            next_stop_idx: u32::MAX,
                        }
                    }
                }
                None => VehicleMatchResult {
                    matched: false,
                    trip_idx: u32::MAX,
                    delay_sec: 0,
                    current_stop_idx: u32::MAX,
                    next_stop_idx: u32::MAX,
                },
            })
            .collect()
    }
}

thread_local! {
    static LIVE_SCHEDULE: RefCell<LiveScheduleIndex> = RefCell::new(LiveScheduleIndex::default());
}

// ============================================================================
// Dopasowanie pojazdu do odcinka trasy na mapie (`liveVehicle.ts`: `matchVehicleToLeg`)
// ============================================================================

const LEG_MAX_CORRIDOR_M: f64 = 220.0;
const LEG_MIN_PROGRESS: f64 = -0.02;
const LEG_MAX_PROGRESS: f64 = 1.02;
const LEG_MAX_EARLY_SEC: f64 = 240.0;
const LEG_MAX_LATE_SEC: f64 = 1500.0;
const TRIP_MATCH_BONUS: f64 = 0.45;
const SWITCH_TOLERANCE: f64 = 2.0;
const DAY_SEC: f64 = 86_400.0;

pub struct LegCandidateVehicle {
    pub orig_idx: u32,
    pub vehicle_id: String,
    pub lat: f64,
    pub lon: f64,
    pub matched_trip_id: String,
}

pub struct LegVehicleMatchOut {
    pub orig_idx: u32,
    pub progress: f64,
    pub snapped_lat: f64,
    pub snapped_lon: f64,
    pub offset_m: f64,
    pub score: f64,
}

fn build_leg_schedule(
    coords: &[(f64, f64)],
    cum: &[f64],
    stops: &[(f64, f64)],
    dep_sec: f64,
    arr_sec: f64,
) -> Vec<(f64, f64)> {
    let mut duration = arr_sec - dep_sec;
    if duration < 0.0 {
        duration += DAY_SEC;
    }
    if stops.len() < 2 || duration <= 0.0 {
        return Vec::new();
    }
    let mut pts: Vec<(f64, f64)> = Vec::with_capacity(stops.len());
    let n_minus_1 = (stops.len() - 1) as f64;
    for (i, &(s_lat, s_lon)) in stops.iter().enumerate() {
        if !s_lat.is_finite() || !s_lon.is_finite() {
            continue;
        }
        if let Some(proj) = project_route_point_with_cum(coords, cum, s_lat, s_lon) {
            let frac = (i as f64) / n_minus_1;
            pts.push((proj.progress, dep_sec + duration * frac));
        }
    }
    pts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut monotonic: Vec<(f64, f64)> = Vec::with_capacity(pts.len());
    for p in pts {
        if monotonic
            .last()
            .map_or(true, |prev| p.0 > prev.0 + 0.001)
        {
            monotonic.push(p);
        }
    }
    monotonic
}

fn expected_time_at(schedule: &[(f64, f64)], progress: f64, dep_sec: f64, arr_sec: f64) -> f64 {
    if schedule.len() < 2 {
        let mut duration = arr_sec - dep_sec;
        if duration < 0.0 {
            duration += DAY_SEC;
        }
        return dep_sec + progress.clamp(0.0, 1.0) * duration;
    }
    if progress <= schedule[0].0 {
        return schedule[0].1;
    }
    let last = schedule[schedule.len() - 1];
    if progress >= last.0 {
        return last.1;
    }
    for i in 1..schedule.len() {
        let prev = schedule[i - 1];
        let cur = schedule[i];
        if progress <= cur.0 {
            let span = cur.0 - prev.0;
            let t = if span > 0.0 {
                (progress - prev.0) / span
            } else {
                0.0
            };
            return prev.1 + t * (cur.1 - prev.1);
        }
    }
    last.1
}

pub fn match_vehicle_to_leg(
    coords: &[(f64, f64)],
    leg_stops: &[(f64, f64)],
    dep_sec: f64,
    arr_sec: f64,
    leg_trip_id: &str,
    now_sec: f64,
    prefer_vehicle_id: &str,
    candidates: &[LegCandidateVehicle],
) -> Option<LegVehicleMatchOut> {
    if coords.len() < 2 || candidates.is_empty() {
        return None;
    }
    let cum = cumulative_distances(coords);
    let schedule = build_leg_schedule(coords, &cum, leg_stops, dep_sec, arr_sec);

    let mut valid: Vec<(usize, LegVehicleMatchOut)> = Vec::new();
    for (ci, v) in candidates.iter().enumerate() {
        let proj = match project_route_point_with_cum(coords, &cum, v.lat, v.lon) {
            Some(p) => p,
            None => continue,
        };
        if proj.offset_m > LEG_MAX_CORRIDOR_M {
            continue;
        }
        if proj.progress < LEG_MIN_PROGRESS || proj.progress > LEG_MAX_PROGRESS {
            continue;
        }
        let expected_sec = expected_time_at(&schedule, proj.progress, dep_sec, arr_sec);
        let mut delay = now_sec - expected_sec;
        if delay < -DAY_SEC * 0.5 {
            delay += DAY_SEC;
        }
        if delay > DAY_SEC * 0.5 {
            delay -= DAY_SEC;
        }
        if delay < -LEG_MAX_EARLY_SEC || delay > LEG_MAX_LATE_SEC {
            continue;
        }

        let trip_match = !leg_trip_id.is_empty() && v.matched_trip_id == leg_trip_id;
        let raw = delay.abs() / 60.0 + proj.offset_m / 200.0;
        let score = if trip_match {
            raw * TRIP_MATCH_BONUS
        } else {
            raw
        };

        valid.push((
            ci,
            LegVehicleMatchOut {
                orig_idx: v.orig_idx,
                progress: proj.progress,
                snapped_lat: proj.lat,
                snapped_lon: proj.lon,
                offset_m: proj.offset_m,
                score,
            },
        ));
    }

    if valid.is_empty() {
        return None;
    }

    valid.sort_by(|a, b| {
        a.1.score
            .partial_cmp(&b.1.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    if !prefer_vehicle_id.is_empty() {
        if let Some(pos) = valid
            .iter()
            .position(|(ci, _)| candidates[*ci].vehicle_id == prefer_vehicle_id)
        {
            if valid[pos].1.score <= valid[0].1.score + SWITCH_TOLERANCE {
                return Some(valid.swap_remove(pos).1);
            }
        }
    }

    Some(valid.swap_remove(0).1)
}

// ============================================================================
// Binarny protokół wywołań (opcodes 20..24)
// ============================================================================

#[inline]
fn read_u16(b: &[u8], off: &mut usize) -> u16 {
    let v = u16::from_le_bytes([b[*off], b[*off + 1]]);
    *off += 2;
    v
}

#[inline]
fn read_u32(b: &[u8], off: &mut usize) -> u32 {
    let v = u32::from_le_bytes([b[*off], b[*off + 1], b[*off + 2], b[*off + 3]]);
    *off += 4;
    v
}

#[inline]
fn read_i32(b: &[u8], off: &mut usize) -> i32 {
    read_u32(b, off) as i32
}

#[inline]
fn read_f64(b: &[u8], off: &mut usize) -> f64 {
    let mut arr = [0u8; 8];
    arr.copy_from_slice(&b[*off..*off + 8]);
    *off += 8;
    f64::from_le_bytes(arr)
}

#[inline]
fn read_str<'a>(b: &'a [u8], off: &mut usize) -> &'a str {
    let len = read_u16(b, off) as usize;
    let s = std::str::from_utf8(&b[*off..*off + len]).unwrap_or("");
    *off += len;
    s
}

#[inline]
fn write_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

#[inline]
fn write_i32(out: &mut Vec<u8>, v: i32) {
    out.extend_from_slice(&v.to_le_bytes());
}

#[inline]
fn write_f64(out: &mut Vec<u8>, v: f64) {
    out.extend_from_slice(&v.to_le_bytes());
}

/// Cmd 20: Załadowanie wycinka rozkładu do `LIVE_SCHEDULE` w pamięci Rust.
/// Wejście:
/// `[line_count: u32, (line_str, pat_count: u32, (valid_stop_count: u16, (stop_idx: u32, lat: f64, lon: f64)*, trip_count: u32, (trip_idx: u32, (dep_sec: i32, arr_sec: i32)*valid_stop_count, fb_count: u16, (stop_idx: u32, lat: f64, lon: f64, dep_sec: i32)*fb_count)*)*)*]`
pub fn handle_live_load_schedule_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.len() < 4 {
        return Vec::new();
    }
    let mut off = 0usize;
    let line_count = read_u32(payload, &mut off) as usize;
    let mut by_line: HashMap<String, Vec<LivePatternEntry>> = HashMap::with_capacity(line_count);

    for _ in 0..line_count {
        let line = read_str(payload, &mut off).to_string();
        let pat_count = read_u32(payload, &mut off) as usize;
        let mut patterns = Vec::with_capacity(pat_count);

        for _ in 0..pat_count {
            let valid_count = read_u16(payload, &mut off) as usize;
            let mut valid_stop_indices = Vec::with_capacity(valid_count);
            let mut coords = Vec::with_capacity(valid_count);
            let mut min_lat = f64::INFINITY;
            let mut max_lat = f64::NEG_INFINITY;
            let mut min_lon = f64::INFINITY;
            let mut max_lon = f64::NEG_INFINITY;

            for _ in 0..valid_count {
                let s_idx = read_u32(payload, &mut off);
                let lat = read_f64(payload, &mut off);
                let lon = read_f64(payload, &mut off);
                valid_stop_indices.push(s_idx);
                coords.push((lat, lon));
                if lat < min_lat {
                    min_lat = lat;
                }
                if lat > max_lat {
                    max_lat = lat;
                }
                if lon < min_lon {
                    min_lon = lon;
                }
                if lon > max_lon {
                    max_lon = lon;
                }
            }

            let trip_count = read_u32(payload, &mut off) as usize;
            let mut trips = Vec::with_capacity(trip_count);
            for _ in 0..trip_count {
                let trip_idx = read_u32(payload, &mut off);
                let mut valid_dep = Vec::with_capacity(valid_count);
                let mut valid_arr = Vec::with_capacity(valid_count);
                for _ in 0..valid_count {
                    valid_dep.push(read_i32(payload, &mut off));
                    valid_arr.push(read_i32(payload, &mut off));
                }
                let fb_count = read_u16(payload, &mut off) as usize;
                let mut fallback_stops = Vec::with_capacity(fb_count);
                for _ in 0..fb_count {
                    let s_idx = read_u32(payload, &mut off);
                    let lat = read_f64(payload, &mut off);
                    let lon = read_f64(payload, &mut off);
                    let dep_sec = read_i32(payload, &mut off);
                    fallback_stops.push((s_idx, lat, lon, dep_sec));
                }
                trips.push(LiveTripEntry {
                    trip_idx,
                    valid_dep,
                    valid_arr,
                    fallback_stops,
                });
            }

            patterns.push(LivePatternEntry {
                valid_stop_indices,
                coords,
                min_lat,
                max_lat,
                min_lon,
                max_lon,
                trips,
            });
        }

        by_line.insert(line, patterns);
    }

    LIVE_SCHEDULE.with(|s| {
        s.borrow_mut().by_line = by_line;
    });

    let mut out = Vec::with_capacity(4);
    write_u32(&mut out, line_count as u32);
    out
}

/// Cmd 21: Wsadowe dopasowanie pojazdów MPK + rozwiązanie konfliktów (`matchAll` + `resolveConflicts`).
/// Wejście: `[now_sec: i32, row_count: u32, (line: str, lat: f64, lon: f64)*, observed_sec: i32*?]`
/// Wyjście: `[row_count: u32, (matched: u8, trip_idx: u32, delay_sec: i32, curr_stop_idx: u32, next_stop_idx: u32)*]`
pub fn handle_live_match_batch_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.len() < 8 {
        return Vec::new();
    }
    let mut off = 0usize;
    let now_sec = read_i32(payload, &mut off);
    let count = read_u32(payload, &mut off) as usize;
    let mut rows = Vec::with_capacity(count);
    for _ in 0..count {
        let line = read_str(payload, &mut off).to_string();
        let lat = read_f64(payload, &mut off);
        let lon = read_f64(payload, &mut off);
        rows.push((line, lat, lon, now_sec));
    }
    if payload.len().saturating_sub(off) == count * 4 {
        for row in &mut rows {
            row.3 = read_i32(payload, &mut off);
        }
    }

    let results = LIVE_SCHEDULE.with(|s| s.borrow().match_batch(&rows));
    let mut out = Vec::with_capacity(4 + results.len() * 17);
    write_u32(&mut out, results.len() as u32);
    for r in results {
        out.push(if r.matched { 1 } else { 0 });
        write_u32(&mut out, r.trip_idx);
        write_i32(&mut out, r.delay_sec);
        write_u32(&mut out, r.current_stop_idx);
        write_u32(&mut out, r.next_stop_idx);
    }
    out
}

/// Cmd 22: Dopasowanie pociągu KD (`matchZbKd` z `src/services/zbiorkom.ts`).
/// Wejście:
/// `[zb_stop_count: u16, (name: str, sched_sec: i32)*, cand_trip_count: u32, (trip_idx: u32, stop_count: u16, (name: str, local_sec: i32)*)*]`
/// Wyjście:
/// `[matched: u8, trip_idx: u32]`
pub fn handle_match_zb_kd_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.len() < 2 {
        return Vec::new();
    }
    let mut off = 0usize;
    let zb_count = read_u16(payload, &mut off) as usize;
    if zb_count == 0 {
        return vec![0, 0, 0, 0, 0];
    }
    let mut zb_stops = Vec::with_capacity(zb_count);
    for _ in 0..zb_count {
        let name = normalize_polish(read_str(payload, &mut off));
        let sched_sec = read_i32(payload, &mut off);
        zb_stops.push((name, sched_sec));
    }

    let cand_count = read_u32(payload, &mut off) as usize;
    let min_matches = 1usize;
    const MAX_SCHED_DIFF_SEC: i32 = 600;

    let mut best_trip: Option<u32> = None;
    let mut best_score = i32::MIN;

    for _ in 0..cand_count {
        let trip_idx = read_u32(payload, &mut off);
        let st_count = read_u16(payload, &mut off) as usize;
        let mut st = Vec::with_capacity(st_count);
        for _ in 0..st_count {
            let s_name = normalize_polish(read_str(payload, &mut off));
            let s_sec = read_i32(payload, &mut off);
            st.push((s_name, s_sec));
        }
        if st_count < min_matches {
            continue;
        }

        let mut matched = 0usize;
        let mut total_diff = 0i32;

        for (zb_name, zb_sec) in &zb_stops {
            if zb_name.is_empty() {
                continue;
            }
            if let Some((_, local_sec)) = st.iter().find(|(loc_name, loc_sec)| {
                !loc_name.is_empty()
                    && (loc_name.contains(zb_name.as_str()) || zb_name.contains(loc_name.as_str()))
                    && (loc_sec - zb_sec).abs() <= MAX_SCHED_DIFF_SEC
            }) {
                matched += 1;
                total_diff += (local_sec - zb_sec).abs();
            }
        }

        if matched >= min_matches {
            let score = (matched as i32) * 1000 - total_diff;
            if score > best_score {
                best_score = score;
                best_trip = Some(trip_idx);
            }
        }
    }

    let mut out = Vec::with_capacity(5);
    match best_trip {
        Some(idx) => {
            out.push(1);
            write_u32(&mut out, idx);
        }
        None => {
            out.push(0);
            write_u32(&mut out, 0);
        }
    }
    out
}

/// Cmd 23: `matchVehicleToLeg` (`src/services/liveVehicle.ts`).
/// Wejście:
/// `[dep_sec: f64, arr_sec: f64, now_sec: f64, leg_trip_id: str, prefer_veh_id: str, coord_count: u32, (lat: f64, lon: f64)*, stop_count: u16, (lat: f64, lon: f64)*, cand_count: u32, (orig_idx: u32, veh_id: str, lat: f64, lon: f64, matched_trip_id: str)*]`
/// Wyjście:
/// `[matched: u8, orig_idx: u32, progress: f64, snapped_lat: f64, snapped_lon: f64, offset_m: f64, score: f64]`
pub fn handle_match_vehicle_to_leg_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.len() < 24 {
        return Vec::new();
    }
    let mut off = 0usize;
    let dep_sec = read_f64(payload, &mut off);
    let arr_sec = read_f64(payload, &mut off);
    let now_sec = read_f64(payload, &mut off);
    let leg_trip_id = read_str(payload, &mut off).to_string();
    let prefer_veh_id = read_str(payload, &mut off).to_string();

    let coord_count = read_u32(payload, &mut off) as usize;
    let mut coords = Vec::with_capacity(coord_count);
    for _ in 0..coord_count {
        coords.push((read_f64(payload, &mut off), read_f64(payload, &mut off)));
    }

    let stop_count = read_u16(payload, &mut off) as usize;
    let mut leg_stops = Vec::with_capacity(stop_count);
    for _ in 0..stop_count {
        leg_stops.push((read_f64(payload, &mut off), read_f64(payload, &mut off)));
    }

    let cand_count = read_u32(payload, &mut off) as usize;
    let mut candidates = Vec::with_capacity(cand_count);
    for _ in 0..cand_count {
        let orig_idx = read_u32(payload, &mut off);
        let vehicle_id = read_str(payload, &mut off).to_string();
        let lat = read_f64(payload, &mut off);
        let lon = read_f64(payload, &mut off);
        let matched_trip_id = read_str(payload, &mut off).to_string();
        candidates.push(LegCandidateVehicle {
            orig_idx,
            vehicle_id,
            lat,
            lon,
            matched_trip_id,
        });
    }

    let mut out = Vec::with_capacity(45);
    match match_vehicle_to_leg(
        &coords,
        &leg_stops,
        dep_sec,
        arr_sec,
        &leg_trip_id,
        now_sec,
        &prefer_veh_id,
        &candidates,
    ) {
        Some(res) => {
            out.push(1);
            write_u32(&mut out, res.orig_idx);
            write_f64(&mut out, res.progress);
            write_f64(&mut out, res.snapped_lat);
            write_f64(&mut out, res.snapped_lon);
            write_f64(&mut out, res.offset_m);
            write_f64(&mut out, res.score);
        }
        None => {
            out.push(0);
        }
    }
    out
}

/// Cmd 24: Operacje na poliliniach (`routeGeometry.ts`: `projectPointToPolyline`, `projectRoutePoint`, `interpolateRoute`).
/// - `subcmd 0`: `projectPointToPolyline(lat, lon, coords)` -> `[dist_m: f64, closest_lat: f64, closest_lon: f64, seg_idx: u32, seg_prog: f64]`
/// - `subcmd 1`: `projectRoutePoint(lat, lon, coords)` -> `[ok: u8, progress: f64, dist_along_m: f64, offset_m: f64, lat: f64, lon: f64]`
/// - `subcmd 2`: `interpolateRoute(progress, coords)` -> `[ok: u8, lat: f64, lon: f64]`
pub fn handle_route_geometry_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.is_empty() {
        return Vec::new();
    }
    let mut off = 0usize;
    let subcmd = payload[off];
    off += 1;
    let mut out = Vec::new();
    match subcmd {
        0 => {
            let lat = read_f64(payload, &mut off);
            let lon = read_f64(payload, &mut off);
            let n = read_u32(payload, &mut off) as usize;
            let mut coords = Vec::with_capacity(n);
            for _ in 0..n {
                coords.push((read_f64(payload, &mut off), read_f64(payload, &mut off)));
            }
            let p = project_point_to_polyline(lat, lon, &coords);
            write_f64(&mut out, p.distance_meters);
            write_f64(&mut out, p.closest_lat);
            write_f64(&mut out, p.closest_lon);
            write_u32(&mut out, p.segment_index as u32);
            write_f64(&mut out, p.segment_progress);
        }
        1 => {
            let lat = read_f64(payload, &mut off);
            let lon = read_f64(payload, &mut off);
            let n = read_u32(payload, &mut off) as usize;
            let mut coords = Vec::with_capacity(n);
            for _ in 0..n {
                coords.push((read_f64(payload, &mut off), read_f64(payload, &mut off)));
            }
            let cum = cumulative_distances(&coords);
            match project_route_point_with_cum(&coords, &cum, lat, lon) {
                Some(r) => {
                    out.push(1);
                    write_f64(&mut out, r.progress);
                    write_f64(&mut out, r.distance_along_m);
                    write_f64(&mut out, r.offset_m);
                    write_f64(&mut out, r.lat);
                    write_f64(&mut out, r.lon);
                }
                None => out.push(0),
            }
        }
        2 => {
            let progress = read_f64(payload, &mut off);
            let n = read_u32(payload, &mut off) as usize;
            let mut coords = Vec::with_capacity(n);
            for _ in 0..n {
                coords.push((read_f64(payload, &mut off), read_f64(payload, &mut off)));
            }
            let cum = cumulative_distances(&coords);
            match interpolate_route_with_cum(&coords, &cum, progress) {
                Some((lat, lon)) => {
                    out.push(1);
                    write_f64(&mut out, lat);
                    write_f64(&mut out, lon);
                }
                None => out.push(0),
            }
        }
        _ => {}
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_batch_matching_and_conflict_resolution_work() {
        let mut idx = LiveScheduleIndex::default();
        idx.by_line.insert(
            "4".into(),
            vec![LivePatternEntry {
                valid_stop_indices: vec![10, 11, 12],
                coords: vec![(51.100, 17.000), (51.105, 17.000), (51.110, 17.000)],
                min_lat: 51.100,
                max_lat: 51.110,
                min_lon: 17.000,
                max_lon: 17.000,
                trips: vec![LiveTripEntry {
                    trip_idx: 42,
                    valid_dep: vec![36000, 36180, 36360],
                    valid_arr: vec![36000, 36180, 36360],
                    fallback_stops: vec![],
                }],
            }],
        );

        // Dwa pojazdy na tej samej linii 4 blisko tego samego kursu - wygrywa dokładniejszy!
        let rows = vec![
            ("4".to_string(), 51.1025, 17.000, 36100), // idealnie w połowie seg 0 (expected = 36090)
            ("4".to_string(), 51.1025, 17.002, 36100), // ~140m z boku (gorszy score)
        ];
        let matched = idx.match_batch(&rows);
        assert!(matched[0].matched);
        assert_eq!(matched[0].trip_idx, 42);
        assert_eq!(matched[0].delay_sec, 10);
        assert_eq!(matched[0].current_stop_idx, 10);
        assert_eq!(matched[0].next_stop_idx, 11);
        // Drugi pojazd przegrał konflikt o ten sam trip_idx 42!
        assert!(!matched[1].matched);

        let rows = vec![
            ("4".to_string(), 51.1025, 17.000, 36150),
            ("4".to_string(), 51.1025, 17.000, 36090),
        ];
        let matched = idx.match_batch(&rows);
        assert!(!matched[0].matched);
        assert!(matched[1].matched);
        assert_eq!(matched[1].delay_sec, 0);

        LIVE_SCHEDULE.with(|s| *s.borrow_mut() = idx);
        let mut payload = Vec::new();
        write_i32(&mut payload, 36150);
        write_u32(&mut payload, 1);
        payload.extend_from_slice(&1u16.to_le_bytes());
        payload.extend_from_slice(b"4");
        write_f64(&mut payload, 51.1025);
        write_f64(&mut payload, 17.000);
        let legacy = handle_live_match_batch_cmd(&payload);
        assert_eq!(i32::from_le_bytes(legacy[9..13].try_into().unwrap()), 60);
        write_i32(&mut payload, 36090);
        let timestamped = handle_live_match_batch_cmd(&payload);
        assert_eq!(i32::from_le_bytes(timestamped[9..13].try_into().unwrap()), 0);
    }
}
