//! Silnik postępu podróży (`tripProgress.ts`), pozycjonowania pojazdu/pasażera na liście
//! przystanków (`vehiclePosition.ts`), ciągłości śledzonego planu (`planMatch.ts`),
//! wyboru celu kompasu (`navigationTarget.ts`), manewrów pieszych i map-matchingu
//! (`turnManeuver.ts`) oraz filtracji Kalmana GPS (`locationFilter.ts`).

use std::f64::consts::PI;

use crate::live::project_point_to_polyline;
use crate::search::{bearing_degrees, distance_meters, normalize_polish};

const DAY_SEC: i32 = 86_400;
const HALF_DAY_SEC: i32 = 43_200;

// ============================================================================
// 1. `vehiclePosition.ts` w Rust
// ============================================================================

const MAX_VEHICLE_AGE_MS: f64 = 120_000.0;
const MAX_ROUTE_DISTANCE_M: f64 = 120.0;
const MAX_GPS_AGE_MS: f64 = 15_000.0;
const MAX_GPS_ACCURACY_M: f64 = 25.0;
const MIN_RIDING_SPEED_MPS: f64 = 2.2;
const MAX_RIDING_SPEED_MPS: f64 = 25.0;
const MAX_HEADING_DIFF_DEG: f64 = 65.0;
const MIN_BEARING_SEGMENT_M: f64 = 15.0;
const GPS_EARLY_WINDOW_SEC: i32 = 180;
const GPS_LATE_WINDOW_SEC: i32 = 600;
const MAX_PRE_DEPARTURE_SEC: i32 = 45 * 60;

#[derive(Clone, Debug)]
pub struct VpStop {
    pub stop_id: String,
    pub name: String,
    pub norm_name: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub arrive_sec: Option<i32>,
    pub depart_sec: Option<i32>,
}

#[derive(Clone, Debug)]
pub struct VpLeg {
    pub mode_is_walk: bool,
    pub line: String,
    pub trip_id: String,
    pub from_stop: String,
    pub to_stop: String,
    pub from_stop_id: String,
    pub to_stop_id: String,
    pub dep_sec: i32,
    pub arr_sec: i32,
    pub stops_count: i32,
}

#[derive(Clone, Debug)]
pub struct VpVehicle {
    pub line: String,
    pub lat: f64,
    pub lon: f64,
    pub current_stop_name: String,
    pub next_stop_name: String,
    pub matched_trip_id: String,
    pub updated_at_ms: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct VpDeviceLocation {
    pub lat: f64,
    pub lon: f64,
    pub accuracy: Option<f64>,
    pub speed: Option<f64>,
    pub heading: Option<f64>,
    pub timestamp_ms: f64,
}

fn norm_stop_name(s: &str) -> String {
    normalize_polish(s)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn find_user_segment(stops: &[VpStop], leg: &VpLeg) -> (usize, usize) {
    if stops.is_empty() {
        return (0, 0);
    }
    let from_id = leg.from_stop_id.trim();
    let to_id = leg.to_stop_id.trim();
    let from_name = norm_stop_name(&leg.from_stop);
    let to_name = norm_stop_name(&leg.to_stop);

    let mut from_idx: Option<usize> = None;
    if !from_id.is_empty() {
        from_idx = stops.iter().position(|s| s.stop_id == from_id);
    }
    if from_idx.is_none() && !from_name.is_empty() {
        from_idx = stops.iter().position(|s| s.norm_name == from_name);
    }
    let from = from_idx.unwrap_or(0);

    let mut to_idx: Option<usize> = None;
    if !to_id.is_empty() {
        to_idx = stops
            .iter()
            .enumerate()
            .position(|(i, s)| i >= from && s.stop_id == to_id);
    }
    if to_idx.is_none() && !to_name.is_empty() {
        to_idx = stops
            .iter()
            .enumerate()
            .position(|(i, s)| i >= from && s.norm_name == to_name);
    }
    let to = to_idx.unwrap_or(stops.len() - 1);
    (from, to)
}

#[derive(Clone, Copy)]
struct StopProjection {
    gap: usize,
    progress: f64,
}

fn project_to_stops(stops: &[VpStop], lat: f64, lon: f64) -> Option<StopProjection> {
    if !lat.is_finite() || !lon.is_finite() {
        return None;
    }
    let mut with_coords: Vec<(usize, (f64, f64))> = Vec::with_capacity(stops.len());
    for (idx, s) in stops.iter().enumerate() {
        if let (Some(slat), Some(slon)) = (s.lat, s.lon) {
            if slat.is_finite() && slon.is_finite() {
                with_coords.push((idx, (slat, slon)));
            }
        }
    }
    if with_coords.len() < 2 {
        return None;
    }
    let poly: Vec<(f64, f64)> = with_coords.iter().map(|&(_, c)| c).collect();
    let proj = project_point_to_polyline(lat, lon, &poly);
    if proj.distance_meters > MAX_ROUTE_DISTANCE_M {
        return None;
    }
    let seg_i = proj.segment_index.min(with_coords.len() - 2);
    let stop_idx = with_coords[seg_i].0;
    let total_gaps = (stops.len() - 1).max(1) as f64;
    let progress = ((stop_idx as f64 + proj.segment_progress) / total_gaps).clamp(0.0, 1.0);
    Some(StopProjection {
        gap: stop_idx.min(stops.len() - 2),
        progress,
    })
}

fn heading_matches_route(heading: Option<f64>, a: &VpStop, b: &VpStop) -> bool {
    let h = match heading {
        Some(v) if v.is_finite() && v >= 0.0 => v,
        _ => return true,
    };
    let (alat, alon, blat, blon) = match (a.lat, a.lon, b.lat, b.lon) {
        (Some(la), Some(loa), Some(lb), Some(lob))
            if la.is_finite() && loa.is_finite() && lb.is_finite() && lob.is_finite() =>
        {
            (la, loa, lb, lob)
        }
        _ => return true,
    };
    if distance_meters(alat, alon, blat, blon) < MIN_BEARING_SEGMENT_M {
        return true;
    }
    let route_bearing = bearing_degrees(alat, alon, blat, blon);
    let diff = ((h - route_bearing) % 360.0 + 540.0) % 360.0 - 180.0;
    diff.abs() <= MAX_HEADING_DIFF_DEG
}

fn is_within_leg_window(leg: &VpLeg, now_sec: i32) -> bool {
    let dep = leg.dep_sec;
    let arr_raw = leg.arr_sec;
    let arr = if arr_raw < dep {
        arr_raw + DAY_SEC
    } else {
        arr_raw
    };
    let mut cur = now_sec;
    if cur < dep - HALF_DAY_SEC {
        cur += DAY_SEC;
    }
    cur >= dep - GPS_EARLY_WINDOW_SEC && cur <= arr + GPS_LATE_WINDOW_SEC
}

fn riding_device_gap(
    stops: &[VpStop],
    leg: &VpLeg,
    loc: Option<VpDeviceLocation>,
    now_ms: f64,
    now_sec: i32,
) -> Option<i32> {
    if stops.len() < 2 {
        return None;
    }
    let location = loc?;
    if now_ms - location.timestamp_ms > MAX_GPS_AGE_MS {
        return None;
    }
    let acc = location.accuracy?;
    if acc <= 0.0 || acc > MAX_GPS_ACCURACY_M {
        return None;
    }
    let spd = location.speed?;
    if !(MIN_RIDING_SPEED_MPS..=MAX_RIDING_SPEED_MPS).contains(&spd) {
        return None;
    }
    if !is_within_leg_window(leg, now_sec) {
        return None;
    }
    let (u_from, u_to) = find_user_segment(stops, leg);
    let passenger_stops = &stops[u_from..=u_to];
    let proj = project_to_stops(passenger_stops, location.lat, location.lon)?;
    let a = &passenger_stops[proj.gap];
    let b = &passenger_stops[(proj.gap + 1).min(passenger_stops.len() - 1)];
    if !heading_matches_route(location.heading, a, b) {
        return None;
    }
    Some((u_from + proj.gap) as i32)
}

fn adjacent_stop_gap(stops: &[VpStop], vehicle: &VpVehicle) -> Option<usize> {
    let cur = norm_stop_name(&vehicle.current_stop_name);
    let next = norm_stop_name(&vehicle.next_stop_name);
    if cur.is_empty() && next.is_empty() {
        return None;
    }
    let mut best_gap: Option<usize> = None;
    let mut best_dist = f64::INFINITY;
    let has_v_coords = vehicle.lat.is_finite() && vehicle.lon.is_finite();

    for i in 0..(stops.len().saturating_sub(1)) {
        let a = &stops[i].norm_name;
        let b = &stops[i + 1].norm_name;
        let match_pair = if !cur.is_empty() && !next.is_empty() {
            a == &cur && b == &next
        } else if !cur.is_empty() {
            a == &cur
        } else {
            b == &next
        };
        if !match_pair {
            continue;
        }
        let mut dist = 0.0;
        if has_v_coords {
            match (stops[i].lat, stops[i].lon, stops[i + 1].lat, stops[i + 1].lon) {
                (Some(la), Some(loa), Some(lb), Some(lob))
                    if la.is_finite() && loa.is_finite() && lb.is_finite() && lob.is_finite() =>
                {
                    dist = project_point_to_polyline(
                        vehicle.lat,
                        vehicle.lon,
                        &[(la, loa), (lb, lob)],
                    )
                    .distance_meters;
                }
                (Some(la), Some(loa), _, _) if la.is_finite() && loa.is_finite() => {
                    dist = distance_meters(vehicle.lat, vehicle.lon, la, loa);
                }
                _ => {}
            }
        }
        if dist < best_dist {
            best_dist = dist;
            best_gap = Some(i);
        }
    }
    best_gap
}

fn estimate_gap_from_stop_times(
    stops: &[VpStop],
    leg: &VpLeg,
    now_sec: i32,
) -> Option<Option<i32>> {
    if stops.len() < 2 {
        return None;
    }
    if !stops
        .iter()
        .all(|s| s.arrive_sec.is_some() || s.depart_sec.is_some())
    {
        return None;
    }

    let mut times: Vec<(i32, i32)> = Vec::with_capacity(stops.len());
    let mut day_offset = 0i32;
    let mut prev = 0i32;
    for s in stops {
        let raw_arr = s.arrive_sec.or(s.depart_sec).unwrap_or(0);
        let raw_dep = s.depart_sec.or(s.arrive_sec).unwrap_or(raw_arr);
        if raw_arr + day_offset < prev - 3600 {
            day_offset += DAY_SEC;
        }
        let arr = raw_arr + day_offset;
        let dep = (raw_dep + day_offset).max(arr);
        prev = dep;
        times.push((arr, dep));
    }

    let (u_from, _) = find_user_segment(stops, leg);
    let mut delay_sec = 0i32;
    if let Some(&(_, sched_board)) = times.get(u_from) {
        let eff_dep = leg.dep_sec;
        let sched_dep = sched_board.rem_euclid(DAY_SEC);
        let raw_delay = eff_dep - sched_dep;
        if raw_delay.abs() <= 7200 {
            delay_sec = raw_delay;
        }
    }

    let first_dep = times[0].1 + delay_sec;
    let last_arr = times[times.len() - 1].0 + delay_sec;
    let mut cur = now_sec;
    if cur < first_dep - HALF_DAY_SEC {
        cur += DAY_SEC;
    }
    if cur < first_dep - MAX_PRE_DEPARTURE_SEC {
        return Some(None);
    }
    if cur < first_dep {
        return Some(Some(-1));
    }
    if cur >= last_arr {
        return Some(Some((stops.len() - 2) as i32));
    }

    for i in 0..(times.len() - 1) {
        if cur < times[i + 1].0 + delay_sec {
            return Some(Some(i as i32));
        }
    }
    Some(Some((stops.len() - 2) as i32))
}

fn estimate_gap(
    total_stops: usize,
    leg: &VpLeg,
    now_sec: i32,
    user_seg: (usize, usize),
) -> Option<(i32, f64)> {
    if total_stops < 2 {
        return Some((0, 0.0));
    }
    let dep = leg.dep_sec;
    let arr_raw = leg.arr_sec;
    let arr = if arr_raw < dep {
        arr_raw + DAY_SEC
    } else {
        arr_raw
    };
    let mut cur = now_sec;
    if cur < dep - HALF_DAY_SEC {
        cur += DAY_SEC;
    }
    if cur < dep - MAX_PRE_DEPARTURE_SEC {
        return None;
    }
    let seg_stops = user_seg.1.saturating_sub(user_seg.0);
    if seg_stops < 1 || arr <= dep {
        return Some((user_seg.0 as i32, 0.0));
    }
    if cur < dep {
        return Some((user_seg.0 as i32 - 1, 0.0));
    }
    if cur >= arr {
        return Some(((user_seg.1 - 1) as i32, 1.0));
    }
    let progress = ((cur - dep) as f64) / ((arr - dep) as f64);
    let rel = ((progress * (seg_stops as f64)).floor() as usize).min(seg_stops - 1);
    Some(((user_seg.0 + rel) as i32, progress))
}

/// Zwraca `Option<(gap, source)>` gdzie `source`: `0 = device`, `1 = vehicle`, `2 = estimate`.
pub fn locate_live_stop_position(
    stops: &[VpStop],
    leg: &VpLeg,
    vehicle: Option<&VpVehicle>,
    location: Option<VpDeviceLocation>,
    now_ms: f64,
    now_sec: i32,
) -> Option<(i32, u8)> {
    if stops.len() < 2 {
        return None;
    }
    if let Some(dev_gap) = riding_device_gap(stops, leg, location, now_ms, now_sec) {
        return Some((dev_gap, 0));
    }
    if let Some(v) = vehicle {
        if now_ms - v.updated_at_ms <= MAX_VEHICLE_AGE_MS {
            if let Some(by_name) = adjacent_stop_gap(stops, v) {
                return Some((by_name as i32, 1));
            }
            if let Some(proj) = project_to_stops(stops, v.lat, v.lon) {
                return Some((proj.gap as i32, 1));
            }
        }
    }
    if let Some(from_times) = estimate_gap_from_stop_times(stops, leg, now_sec) {
        return from_times.map(|g| (g, 2));
    }
    let user_seg = find_user_segment(stops, leg);
    let est = estimate_gap(stops.len(), leg, now_sec, user_seg)?;
    Some((est.0, 2))
}

/// Wynik `locateVehicle` dla `LegTimeline` i `tripProgress`:
/// `label_kind`:
/// - `0`: `noRoute`
/// - `1`: `liveBetween(stop_a, stop_b)`
/// - `2`: `liveBefore(stop_b)`
/// - `3`: `liveAt(stop_a)`
/// - `4`: `liveNear(stop_a)`
/// - `5`: `estRoute`
/// - `6`: `estBefore(from_stop)`
/// - `7`: `estDone(to_stop)`
/// - `8`: `estBetween(stop_a, stop_b)`
pub struct LocateVehicleOut {
    pub gap: i32,
    pub progress: f64,
    pub is_live: bool,
    pub label_kind: u8,
    pub stop_a: String,
    pub stop_b: String,
}

fn matches_leg(v: &VpVehicle, leg: &VpLeg) -> bool {
    if !v.matched_trip_id.is_empty() && !leg.trip_id.is_empty() {
        return v.matched_trip_id == leg.trip_id;
    }
    let leg_line = leg.line.trim().to_uppercase();
    !leg_line.is_empty() && v.line.trim().to_uppercase() == leg_line
}

pub fn locate_vehicle_core(
    stops: &[VpStop],
    leg: &VpLeg,
    vehicle: Option<&VpVehicle>,
    now_ms: f64,
    now_sec: i32,
) -> LocateVehicleOut {
    let total = stops.len();
    if total < 2 {
        return LocateVehicleOut {
            gap: 0,
            progress: 0.0,
            is_live: false,
            label_kind: 0,
            stop_a: String::new(),
            stop_b: String::new(),
        };
    }

    if let Some(v) = vehicle {
        if now_ms - v.updated_at_ms <= MAX_VEHICLE_AGE_MS && matches_leg(v, leg) {
            // 1. Dopasowanie po nazwach przystanków z feedu
            let cur_norm = norm_stop_name(&v.current_stop_name);
            let next_norm = norm_stop_name(&v.next_stop_name);
            let cur_idx = if !cur_norm.is_empty() {
                stops.iter().position(|s| s.norm_name == cur_norm)
            } else {
                None
            };
            let next_idx = if !next_norm.is_empty() {
                stops.iter().position(|s| s.norm_name == next_norm)
            } else {
                None
            };
            let gap_opt = if let Some(ci) = cur_idx {
                Some(ci.min(total - 2))
            } else {
                next_idx.map(|ni| ni.saturating_sub(1))
            };
            if let Some(gap) = gap_opt {
                let progress = ((gap as f64 + 0.5) / ((total - 1).max(1) as f64)).clamp(0.0, 1.0);
                let cur_label = cur_idx
                    .map(|i| stops[i].name.clone())
                    .unwrap_or_else(|| v.current_stop_name.clone());
                let next_label = next_idx
                    .map(|i| stops[i].name.clone())
                    .unwrap_or_else(|| v.next_stop_name.clone());
                let (kind, sa, sb) = if !cur_label.is_empty() && !next_label.is_empty() && cur_label != next_label {
                    (1u8, cur_label, next_label)
                } else if !next_label.is_empty() {
                    (2u8, String::new(), next_label)
                } else {
                    (3u8, cur_label, String::new())
                };
                return LocateVehicleOut {
                    gap: gap as i32,
                    progress,
                    is_live: true,
                    label_kind: kind,
                    stop_a: sa,
                    stop_b: sb,
                };
            }

            // 2. Rzutowanie współrzędnych GPS pojazdu na polilinię przystanków
            if let Some(proj) = project_to_stops(stops, v.lat, v.lon) {
                let a = &stops[proj.gap];
                let b = stops.get(proj.gap + 1);
                let (kind, sa, sb) = match b {
                    Some(b_stop) => (1u8, a.name.clone(), b_stop.name.clone()),
                    None => (4u8, a.name.clone(), String::new()),
                };
                return LocateVehicleOut {
                    gap: proj.gap as i32,
                    progress: proj.progress,
                    is_live: true,
                    label_kind: kind,
                    stop_a: sa,
                    stop_b: sb,
                };
            }
        }
    }

    // 3. Szacunek rozkładowy
    let user_seg = find_user_segment(stops, leg);
    let (gap, progress) = estimate_gap(total, leg, now_sec, user_seg).unwrap_or((user_seg.0 as i32 - 1, 0.0));
    if gap < user_seg.0 as i32 {
        return LocateVehicleOut {
            gap,
            progress,
            is_live: false,
            label_kind: 6,
            stop_a: stops
                .get(user_seg.0)
                .map(|s| s.name.clone())
                .unwrap_or_else(|| leg.from_stop.clone()),
            stop_b: String::new(),
        };
    }
    if progress >= 1.0 {
        return LocateVehicleOut {
            gap,
            progress,
            is_live: false,
            label_kind: 7,
            stop_a: stops
                .get(user_seg.1)
                .map(|s| s.name.clone())
                .unwrap_or_else(|| leg.to_stop.clone()),
            stop_b: String::new(),
        };
    }
    let g_idx = (gap.max(0) as usize).min(total - 1);
    let a_name = stops[g_idx].name.clone();
    match stops.get(g_idx + 1) {
        Some(b_stop) => LocateVehicleOut {
            gap,
            progress,
            is_live: false,
            label_kind: 8,
            stop_a: a_name,
            stop_b: b_stop.name.clone(),
        },
        None => LocateVehicleOut {
            gap,
            progress,
            is_live: false,
            label_kind: 5,
            stop_a: String::new(),
            stop_b: String::new(),
        },
    }
}

// ============================================================================
// 2. `tripProgress.ts` & `format.ts` w Rust
// ============================================================================

const BOARDING_GRACE_SEC: i32 = 45;
const DEFAULT_WALK_MPS: f64 = 1.25;

pub fn to_absolute_ms(sec: i32, now_ms: f64, midnight_ms: f64) -> f64 {
    let time_of_day = ((sec % DAY_SEC) + DAY_SEC) % DAY_SEC;
    let day_ms = (DAY_SEC as f64) * 1000.0;
    let tod_ms = (time_of_day as f64) * 1000.0;
    let c0 = midnight_ms - day_ms + tod_ms;
    let c1 = midnight_ms + tod_ms;
    let c2 = midnight_ms + day_ms + tod_ms;
    let mut best = c1;
    if (c0 - now_ms).abs() < (best - now_ms).abs() {
        best = c0;
    }
    if (c2 - now_ms).abs() < (best - now_ms).abs() {
        best = c2;
    }
    best
}

pub fn build_leg_clock(leg_dep_arr: &[(i32, i32)], board_index: isize, departure_sec: i32) -> Vec<(i32, i32)> {
    let mut out: Vec<(i32, i32)> = Vec::with_capacity(leg_dep_arr.len());
    let mut offset = 0i32;
    let mut prev = 0i32;
    for (i, &(raw_dep, raw_arr)) in leg_dep_arr.iter().enumerate() {
        if i > 0 && raw_dep + offset < prev - 60 {
            offset += DAY_SEC;
        }
        let dep_sec = raw_dep + offset;
        let mut arr_sec = raw_arr + offset;
        if arr_sec < dep_sec {
            offset += DAY_SEC;
            arr_sec += DAY_SEC;
        }
        prev = arr_sec;
        out.push((dep_sec, arr_sec));
    }
    if board_index >= 0 && (board_index as usize) < out.len() && departure_sec > 0 {
        let shift = departure_sec - out[board_index as usize].0;
        let day_shift = ((shift as f64) / (DAY_SEC as f64)).round() as i32 * DAY_SEC;
        if day_shift != 0 {
            for item in &mut out {
                item.0 += day_shift;
                item.1 += day_shift;
            }
        }
    }
    out
}

// ============================================================================
// 3. `planMatch.ts` w Rust (`matchTrackedConnection`, `resolveTrackedConnection`)
// ============================================================================

const LOOSE_WINDOW_SEC: i32 = 1800;
const DELAY_WINDOW_SEC: i32 = 900;

pub struct PlanMatchConn {
    pub orig_idx: u32,
    pub departure_sec: i32,
    pub duration_min: i32,
    pub trip_ids: Vec<String>,
    pub signature: String,
}

fn match_tracked_idx(
    conns: &[PlanMatchConn],
    committed: &PlanMatchConn,
    window_sec: i32,
) -> Option<usize> {
    if conns.is_empty() {
        return None;
    }

    if !committed.trip_ids.is_empty() {
        if let Some(pos) = conns.iter().position(|c| {
            !c.trip_ids.is_empty() && c.trip_ids.iter().all(|id| committed.trip_ids.contains(id))
        }) {
            return Some(pos);
        }
    }

    if !committed.signature.is_empty() {
        let mut by_sig: Vec<usize> = conns
            .iter()
            .enumerate()
            .filter(|(_, c)| {
                c.signature == committed.signature
                    && (c.departure_sec - committed.departure_sec).abs() <= window_sec
            })
            .map(|(i, _)| i)
            .collect();
        if !by_sig.is_empty() {
            by_sig.sort_by_key(|&i| (conns[i].departure_sec - committed.departure_sec).abs());
            return Some(by_sig[0]);
        }
    }

    conns
        .iter()
        .position(|c| c.departure_sec == committed.departure_sec)
}

fn conn_in_progress_idx(conns: &[PlanMatchConn], now_sec: i32) -> Option<usize> {
    let mut ongoing: Vec<usize> = conns
        .iter()
        .enumerate()
        .filter(|(_, c)| {
            let end_sec = c.departure_sec + c.duration_min * 60;
            c.departure_sec <= now_sec + 60 && end_sec > now_sec
        })
        .map(|(i, _)| i)
        .collect();
    if ongoing.is_empty() {
        return None;
    }
    ongoing.sort_by_key(|&i| conns[i].departure_sec);
    Some(ongoing[0])
}

fn next_departure_idx(conns: &[PlanMatchConn], now_sec: i32, grace_sec: i32) -> Option<usize> {
    let mut future: Vec<usize> = conns
        .iter()
        .enumerate()
        .filter(|(_, c)| c.departure_sec > now_sec - grace_sec)
        .map(|(i, _)| i)
        .collect();
    if future.is_empty() {
        return None;
    }
    future.sort_by_key(|&i| conns[i].departure_sec);
    Some(future[0])
}

/// Zwraca:
/// - `0`: brak (`null`)
/// - `1`: zachowaj dotychczasowe `committed`
/// - `2`: wybierz `conns[idx]` (zwraca `orig_idx`)
pub fn resolve_tracked_connection_core(
    conns: &[PlanMatchConn],
    committed: Option<&PlanMatchConn>,
    now_sec: i32,
    grace_sec: i32,
) -> (u8, u32) {
    if conns.is_empty() {
        return (0, 0);
    }
    if let Some(comm) = committed {
        let still_ahead = comm.departure_sec > now_sec - grace_sec;
        let window_sec = if still_ahead {
            DELAY_WINDOW_SEC
        } else {
            LOOSE_WINDOW_SEC
        };
        if let Some(idx) = match_tracked_idx(conns, comm, window_sec) {
            return (2, conns[idx].orig_idx);
        }
        if still_ahead {
            return (1, 0);
        }
    }
    if let Some(idx) = conn_in_progress_idx(conns, now_sec).or_else(|| next_departure_idx(conns, now_sec, grace_sec)) {
        return (2, conns[idx].orig_idx);
    }
    (0, 0)
}

// ============================================================================
// 4. `turnManeuver.ts` & `locationFilter.ts` w Rust
// ============================================================================

const TURN_MIN_SEGMENT_M: f64 = 12.0;
const TURN_SLIGHT_DEG: f64 = 28.0;
const TURN_REGULAR_DEG: f64 = 55.0;
const TURN_SHARP_DEG: f64 = 115.0;
const TURN_MERGE_M: f64 = 18.0;

#[inline]
fn signed_turn_degrees(in_b: f64, out_b: f64) -> f64 {
    let mut d = (out_b - in_b) % 360.0;
    if d > 180.0 {
        d -= 360.0;
    }
    if d <= -180.0 {
        d += 360.0;
    }
    d
}

/// Kind: 1=slight-left, 2=left, 3=sharp-left, 4=slight-right, 5=right, 6=sharp-right, 7=uturn
#[inline]
fn classify_turn_kind(delta: f64) -> Option<u8> {
    let abs = delta.abs();
    if abs < TURN_SLIGHT_DEG {
        return None;
    }
    if abs >= 155.0 {
        return Some(7);
    }
    if delta < 0.0 {
        if abs >= TURN_SHARP_DEG {
            Some(3)
        } else if abs >= TURN_REGULAR_DEG {
            Some(2)
        } else {
            Some(1)
        }
    } else if abs >= TURN_SHARP_DEG {
        Some(6)
    } else if abs >= TURN_REGULAR_DEG {
        Some(5)
    } else {
        Some(4)
    }
}

pub struct DetectedTurn {
    pub kind: u8,
    pub point_lat: f64,
    pub point_lon: f64,
    pub index: u32,
    pub along_m: f64,
    pub bearing_after: f64,
}

pub fn find_turns_in_range(
    path: &[(f64, f64)],
    cum: &[f64],
    start: usize,
    end: usize,
) -> Vec<DetectedTurn> {
    let mut turns: Vec<DetectedTurn> = Vec::new();
    if end <= start + 1 || end >= path.len() {
        return turns;
    }

    for i in (start + 1)..end {
        let mut back = i;
        while back > start && cum[i] - cum[back] < TURN_MIN_SEGMENT_M {
            back -= 1;
        }
        let mut fwd = i;
        while fwd < end && cum[fwd] - cum[i] < TURN_MIN_SEGMENT_M {
            fwd += 1;
        }
        if cum[i] - cum[back] < TURN_MIN_SEGMENT_M * 0.6
            || cum[fwd] - cum[i] < TURN_MIN_SEGMENT_M * 0.6
        {
            continue;
        }
        let in_b = bearing_degrees(path[back].0, path[back].1, path[i].0, path[i].1);
        let out_b = bearing_degrees(path[i].0, path[i].1, path[fwd].0, path[fwd].1);
        let delta = signed_turn_degrees(in_b, out_b);
        let kind = match classify_turn_kind(delta) {
            Some(k) => k,
            None => continue,
        };

        if let Some(prev) = turns.last_mut() {
            if cum[i] - prev.along_m < TURN_MERGE_M {
                if delta.abs() > 60.0 {
                    *prev = DetectedTurn {
                        kind,
                        point_lat: path[i].0,
                        point_lon: path[i].1,
                        index: i as u32,
                        along_m: cum[i],
                        bearing_after: out_b.round(),
                    };
                }
                continue;
            }
        }

        turns.push(DetectedTurn {
            kind,
            point_lat: path[i].0,
            point_lon: path[i].1,
            index: i as u32,
            along_m: cum[i],
            bearing_after: out_b.round(),
        });
    }
    turns
}

pub struct PathProjectionOut {
    pub segment_index: u32,
    pub segment_fraction: f64,
    pub along_m: f64,
    pub offset_m: f64,
    pub snapped_lat: f64,
    pub snapped_lon: f64,
    pub segment_bearing: f64,
}

fn project_segment(
    p: (f64, f64),
    a: (f64, f64),
    b: (f64, f64),
    seg_len: f64,
) -> (f64, f64, (f64, f64)) {
    if seg_len < 0.1 {
        return (0.0, distance_meters(p.0, p.1, a.0, a.1), a);
    }
    let cos_lat = ((a.0 * PI) / 180.0).cos();
    let ax = a.1 * cos_lat;
    let ay = a.0;
    let bx = b.1 * cos_lat;
    let by = b.0;
    let px = p.1 * cos_lat;
    let py = p.0;
    let dx = bx - ax;
    let dy = by - ay;
    let denom = dx * dx + dy * dy;
    let raw = if denom > 0.0 {
        ((px - ax) * dx + (py - ay) * dy) / denom
    } else {
        0.0
    };
    let t = raw.clamp(0.0, 1.0);
    let snapped = (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t);
    (t, distance_meters(p.0, p.1, snapped.0, snapped.1), snapped)
}

pub fn match_on_path_core(
    path: &[(f64, f64)],
    cum: &[f64],
    user: (f64, f64),
    prev_along_m: Option<f64>,
    accuracy_m: f64,
    span_start: usize,
    span_end: usize,
) -> Option<PathProjectionOut> {
    if path.len() < 2 {
        return None;
    }
    let start = span_start.min(path.len() - 2);
    let end = span_end.min(path.len() - 1).max(start + 1);

    let mut best: Option<PathProjectionOut> = None;
    let mut best_score = f64::INFINITY;

    for i in start..end {
        let seg_len = cum[i + 1] - cum[i];
        let (t, offset_m, snapped) = project_segment(user, path[i], path[i + 1], seg_len);
        let along_m = cum[i] + seg_len * t;

        let mut penalty = 0.0;
        if let Some(prev) = prev_along_m {
            if prev.is_finite() {
                let delta = along_m - prev;
                if delta < -8.0 {
                    penalty = (-delta) * 0.45;
                } else if delta > 160.0 {
                    penalty = (delta - 160.0) * 0.25;
                }
            }
        }
        let score = offset_m + penalty;
        if score < best_score {
            best_score = score;
            let seg_bearing = if seg_len >= 0.5 {
                bearing_degrees(path[i].0, path[i].1, path[i + 1].0, path[i + 1].1)
            } else {
                0.0
            };
            best = Some(PathProjectionOut {
                segment_index: i as u32,
                segment_fraction: t,
                along_m,
                offset_m,
                snapped_lat: snapped.0,
                snapped_lon: snapped.1,
                segment_bearing: seg_bearing,
            });
        }
    }

    let mut res = best?;
    if let Some(prev) = prev_along_m {
        if prev.is_finite() {
            let jitter_band = accuracy_m.clamp(8.0, 22.0);
            let backward = prev - res.along_m;
            if backward > 0.0 && backward <= jitter_band && res.offset_m <= 30.0 {
                let clamped_along = prev.min(cum[end]);
                let mut seg = start;
                while seg + 1 < end && cum[seg + 1] < clamped_along {
                    seg += 1;
                }
                let seg_len = (cum[seg + 1] - cum[seg]).max(0.001);
                let frac = ((clamped_along - cum[seg]) / seg_len).clamp(0.0, 1.0);
                let a = path[seg];
                let b = path[seg + 1];
                let snapped = (a.0 + (b.0 - a.0) * frac, a.1 + (b.1 - a.1) * frac);
                let seg_bearing = if seg_len >= 0.5 {
                    bearing_degrees(a.0, a.1, b.0, b.1)
                } else {
                    res.segment_bearing
                };
                res = PathProjectionOut {
                    segment_index: seg as u32,
                    segment_fraction: frac,
                    along_m: clamped_along,
                    offset_m: distance_meters(user.0, user.1, snapped.0, snapped.1),
                    snapped_lat: snapped.0,
                    snapped_lon: snapped.1,
                    segment_bearing: seg_bearing,
                };
            }
        }
    }

    Some(res)
}

// ============================================================================
// Binarny protokół wywołań (opcodes 30..34)
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
fn write_u16(out: &mut Vec<u8>, v: u16) {
    out.extend_from_slice(&v.to_le_bytes());
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

#[inline]
fn write_str(out: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    write_u16(out, b.len() as u16);
    out.extend_from_slice(b);
}

fn decode_stops_and_leg(payload: &[u8], off: &mut usize) -> (Vec<VpStop>, VpLeg) {
    let stop_count = read_u16(payload, off) as usize;
    let mut stops = Vec::with_capacity(stop_count);
    for _ in 0..stop_count {
        let stop_id = read_str(payload, off).to_string();
        let name = read_str(payload, off).to_string();
        let norm_name = norm_stop_name(&name);
        let flags = payload[*off];
        *off += 1;
        let lat = if (flags & 1) != 0 {
            Some(read_f64(payload, off))
        } else {
            None
        };
        let lon = if (flags & 1) != 0 {
            Some(read_f64(payload, off))
        } else {
            None
        };
        let arrive_sec = if (flags & 2) != 0 {
            Some(read_i32(payload, off))
        } else {
            None
        };
        let depart_sec = if (flags & 4) != 0 {
            Some(read_i32(payload, off))
        } else {
            None
        };
        stops.push(VpStop {
            stop_id,
            name,
            norm_name,
            lat,
            lon,
            arrive_sec,
            depart_sec,
        });
    }

    let mode_is_walk = payload[*off] != 0;
    *off += 1;
    let line = read_str(payload, off).to_string();
    let trip_id = read_str(payload, off).to_string();
    let from_stop = read_str(payload, off).to_string();
    let to_stop = read_str(payload, off).to_string();
    let from_stop_id = read_str(payload, off).to_string();
    let to_stop_id = read_str(payload, off).to_string();
    let dep_sec = read_i32(payload, off);
    let arr_sec = read_i32(payload, off);
    let stops_count = read_i32(payload, off);

    (
        stops,
        VpLeg {
            mode_is_walk,
            line,
            trip_id,
            from_stop,
            to_stop,
            from_stop_id,
            to_stop_id,
            dep_sec,
            arr_sec,
            stops_count,
        },
    )
}

fn decode_opt_vehicle(payload: &[u8], off: &mut usize) -> Option<VpVehicle> {
    let has_v = payload[*off] != 0;
    *off += 1;
    if !has_v {
        return None;
    }
    let line = read_str(payload, off).to_string();
    let lat = read_f64(payload, off);
    let lon = read_f64(payload, off);
    let current_stop_name = read_str(payload, off).to_string();
    let next_stop_name = read_str(payload, off).to_string();
    let matched_trip_id = read_str(payload, off).to_string();
    let updated_at_ms = read_f64(payload, off);
    Some(VpVehicle {
        line,
        lat,
        lon,
        current_stop_name,
        next_stop_name,
        matched_trip_id,
        updated_at_ms,
    })
}

fn decode_opt_location(payload: &[u8], off: &mut usize) -> Option<VpDeviceLocation> {
    let flags = payload[*off];
    *off += 1;
    if (flags & 1) == 0 {
        return None;
    }
    let lat = read_f64(payload, off);
    let lon = read_f64(payload, off);
    let accuracy = if (flags & 2) != 0 {
        Some(read_f64(payload, off))
    } else {
        None
    };
    let speed = if (flags & 4) != 0 {
        Some(read_f64(payload, off))
    } else {
        None
    };
    let heading = if (flags & 8) != 0 {
        Some(read_f64(payload, off))
    } else {
        None
    };
    let timestamp_ms = read_f64(payload, off);
    Some(VpDeviceLocation {
        lat,
        lon,
        accuracy,
        speed,
        heading,
        timestamp_ms,
    })
}

/// Cmd 30: `vehiclePosition.ts` (`findUserSegment`, `locateLiveStopPosition`, `locateVehicle`).
pub fn handle_vehicle_position_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.is_empty() {
        return Vec::new();
    }
    let mut off = 0usize;
    let subcmd = payload[off];
    off += 1;
    let mut out = Vec::new();

    match subcmd {
        // findUserSegment
        0 => {
            let (stops, leg) = decode_stops_and_leg(payload, &mut off);
            let (from, to) = find_user_segment(&stops, &leg);
            write_u32(&mut out, from as u32);
            write_u32(&mut out, to as u32);
        }
        // locateLiveStopPosition
        1 => {
            let now_ms = read_f64(payload, &mut off);
            let now_sec = read_i32(payload, &mut off);
            let (stops, leg) = decode_stops_and_leg(payload, &mut off);
            let veh = decode_opt_vehicle(payload, &mut off);
            let loc = decode_opt_location(payload, &mut off);
            match locate_live_stop_position(&stops, &leg, veh.as_ref(), loc, now_ms, now_sec) {
                Some((gap, src)) => {
                    out.push(1);
                    write_i32(&mut out, gap);
                    out.push(src);
                }
                None => {
                    out.push(0);
                }
            }
        }
        // locateVehicle
        2 => {
            let now_ms = read_f64(payload, &mut off);
            let now_sec = read_i32(payload, &mut off);
            let (stops, leg) = decode_stops_and_leg(payload, &mut off);
            let veh = decode_opt_vehicle(payload, &mut off);
            let res = locate_vehicle_core(&stops, &leg, veh.as_ref(), now_ms, now_sec);
            write_i32(&mut out, res.gap);
            write_f64(&mut out, res.progress);
            out.push(if res.is_live { 1 } else { 0 });
            out.push(res.label_kind);
            write_str(&mut out, &res.stop_a);
            write_str(&mut out, &res.stop_b);
        }
        _ => {}
    }
    out
}

/// Cmd 31: `planMatch.ts` (`matchTrackedConnection` + `resolveTrackedConnection`).
pub fn handle_plan_match_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.is_empty() {
        return Vec::new();
    }
    let mut off = 0usize;
    let subcmd = payload[off];
    off += 1;

    let read_conn = |buf: &[u8], o: &mut usize| -> PlanMatchConn {
        let orig_idx = read_u32(buf, o);
        let departure_sec = read_i32(buf, o);
        let duration_min = read_i32(buf, o);
        let signature = read_str(buf, o).to_string();
        let tid_count = read_u16(buf, o) as usize;
        let mut trip_ids = Vec::with_capacity(tid_count);
        for _ in 0..tid_count {
            trip_ids.push(read_str(buf, o).to_string());
        }
        PlanMatchConn {
            orig_idx,
            departure_sec,
            duration_min,
            trip_ids,
            signature,
        }
    };

    let mut out = Vec::with_capacity(8);
    match subcmd {
        // matchTrackedConnection(conns, committed, window_sec)
        0 => {
            let window_sec = read_i32(payload, &mut off);
            let committed = read_conn(payload, &mut off);
            let count = read_u32(payload, &mut off) as usize;
            let mut conns = Vec::with_capacity(count);
            for _ in 0..count {
                conns.push(read_conn(payload, &mut off));
            }
            match match_tracked_idx(&conns, &committed, window_sec) {
                Some(idx) => {
                    out.push(1);
                    write_u32(&mut out, conns[idx].orig_idx);
                }
                None => out.push(0),
            }
        }
        // resolveTrackedConnection(conns, committed?, now_sec, grace_sec)
        1 => {
            let now_sec = read_i32(payload, &mut off);
            let grace_sec = read_i32(payload, &mut off);
            let has_comm = payload[off] != 0;
            off += 1;
            let committed = if has_comm {
                Some(read_conn(payload, &mut off))
            } else {
                None
            };
            let count = read_u32(payload, &mut off) as usize;
            let mut conns = Vec::with_capacity(count);
            for _ in 0..count {
                conns.push(read_conn(payload, &mut off));
            }
            let (status, orig_idx) =
                resolve_tracked_connection_core(&conns, committed.as_ref(), now_sec, grace_sec);
            out.push(status);
            write_u32(&mut out, orig_idx);
        }
        _ => {}
    }
    out
}

/// Cmd 32: `turnManeuver.ts` (`findTurns`, `matchOnPath`).
pub fn handle_turn_maneuver_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.is_empty() {
        return Vec::new();
    }
    let mut off = 0usize;
    let subcmd = payload[off];
    off += 1;
    let mut out = Vec::new();

    match subcmd {
        // find_turns_in_range
        0 => {
            let start = read_u32(payload, &mut off) as usize;
            let end = read_u32(payload, &mut off) as usize;
            let n = read_u32(payload, &mut off) as usize;
            let mut path = Vec::with_capacity(n);
            for _ in 0..n {
                path.push((read_f64(payload, &mut off), read_f64(payload, &mut off)));
            }
            let cum = crate::live::cumulative_distances(&path);
            let turns = find_turns_in_range(&path, &cum, start, end);
            write_u32(&mut out, turns.len() as u32);
            for t in turns {
                out.push(t.kind);
                write_f64(&mut out, t.point_lat);
                write_f64(&mut out, t.point_lon);
                write_u32(&mut out, t.index);
                write_f64(&mut out, t.along_m);
                write_f64(&mut out, t.bearing_after);
            }
        }
        // match_on_path_core
        1 => {
            let u_lat = read_f64(payload, &mut off);
            let u_lon = read_f64(payload, &mut off);
            let has_prev = payload[off] != 0;
            off += 1;
            let prev_along_m = read_f64(payload, &mut off);
            let accuracy_m = read_f64(payload, &mut off);
            let span_start = read_u32(payload, &mut off) as usize;
            let span_end = read_u32(payload, &mut off) as usize;
            let n = read_u32(payload, &mut off) as usize;
            let mut path = Vec::with_capacity(n);
            for _ in 0..n {
                path.push((read_f64(payload, &mut off), read_f64(payload, &mut off)));
            }
            let cum = crate::live::cumulative_distances(&path);
            match match_on_path_core(
                &path,
                &cum,
                (u_lat, u_lon),
                if has_prev { Some(prev_along_m) } else { None },
                accuracy_m,
                span_start,
                span_end,
            ) {
                Some(p) => {
                    out.push(1);
                    write_u32(&mut out, p.segment_index);
                    write_f64(&mut out, p.segment_fraction);
                    write_f64(&mut out, p.along_m);
                    write_f64(&mut out, p.offset_m);
                    write_f64(&mut out, p.snapped_lat);
                    write_f64(&mut out, p.snapped_lon);
                    write_f64(&mut out, p.segment_bearing);
                }
                None => out.push(0),
            }
        }
        _ => {}
    }
    out
}

/// Cmd 33: `tripProgress.ts` (`computeLegClockAndProgress` + `toAbsoluteMs`).
/// Oblicza zegar odcinków (`legClock`), aktywny odcinek, fazę podróży, pozostałe przystanki,
/// czas do następnego przystanku oraz znaczniki ms dla `computeTripProgress` i `computeLegTimeline`.
pub fn handle_trip_progress_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.len() < 24 {
        return Vec::new();
    }
    let mut off = 0usize;
    let now_ms = read_f64(payload, &mut off);
    let midnight_ms = read_f64(payload, &mut off);
    let now_sec_raw = read_i32(payload, &mut off);
    let conn_dep_sec = read_i32(payload, &mut off);
    let walk_speed_mps = read_f64(payload, &mut off);
    let walk_mps = if walk_speed_mps > 0.0 {
        walk_speed_mps
    } else {
        DEFAULT_WALK_MPS
    };

    let leg_count = read_u16(payload, &mut off) as usize;
    struct LegIn {
        is_walk: bool,
        dep_sec: i32,
        arr_sec: i32,
        walk_m: f64,
    }
    let mut legs = Vec::with_capacity(leg_count);
    let mut first_board_idx: isize = -1;
    for i in 0..leg_count {
        let is_walk = payload[off] != 0;
        off += 1;
        let dep_sec = read_i32(payload, &mut off);
        let arr_sec = read_i32(payload, &mut off);
        let walk_m = read_f64(payload, &mut off);
        if !is_walk && first_board_idx < 0 {
            first_board_idx = i as isize;
        }
        legs.push(LegIn {
            is_walk,
            dep_sec,
            arr_sec,
            walk_m,
        });
    }

    let mut out = Vec::new();
    if legs.is_empty() {
        out.push(0);
        return out;
    }

    let pairs: Vec<(i32, i32)> = legs.iter().map(|l| (l.dep_sec, l.arr_sec)).collect();
    let clock = build_leg_clock(&pairs, first_board_idx, conn_dep_sec);

    let trip_start_sec = clock[0].0;
    let trip_end_sec = clock[clock.len() - 1].1;
    let board_sec = if first_board_idx >= 0 {
        clock[first_board_idx as usize].0
    } else {
        trip_start_sec
    };

    let mut now_sec = now_sec_raw;
    if now_sec < trip_start_sec - HALF_DAY_SEC {
        now_sec += DAY_SEC;
    }
    while now_sec > trip_end_sec + HALF_DAY_SEC {
        now_sec -= DAY_SEC;
    }

    // findActiveLeg
    let (active_idx, leg_prog) = if now_sec < clock[0].0 {
        (0usize, 0.0f64)
    } else {
        let mut found = None;
        for i in 0..legs.len() {
            let (d, a) = clock[i];
            if now_sec >= d && now_sec < a {
                let span = (a - d).max(1) as f64;
                found = Some((i, ((now_sec - d) as f64 / span).clamp(0.0, 1.0)));
                break;
            }
            if i + 1 < legs.len() && now_sec >= a && now_sec < clock[i + 1].0 {
                found = Some((i + 1, 0.0));
                break;
            }
        }
        found.unwrap_or((legs.len() - 1, 1.0))
    };

    // nextTransitLegIndex
    let mut next_transit_idx: isize = -1;
    for i in active_idx..legs.len() {
        if !legs[i].is_walk {
            next_transit_idx = i as isize;
            break;
        }
    }

    // resolvePhase: 0=walking, 1=waiting, 2=riding, 3=transfer, 4=arrived
    let phase: u8 = if now_sec >= trip_end_sec {
        4
    } else if !legs[active_idx].is_walk {
        if now_sec < clock[active_idx].0 {
            if (active_idx as isize) <= first_board_idx {
                1
            } else {
                3
            }
        } else {
            2
        }
    } else if active_idx == 0 {
        if first_board_idx >= 0 && clock[first_board_idx as usize].0 - now_sec <= BOARDING_GRACE_SEC
        {
            1
        } else {
            0
        }
    } else if next_transit_idx >= 0 {
        3
    } else {
        0
    };

    let total_span = (trip_end_sec - trip_start_sec).max(1) as f64;
    let overall_progress = if phase == 4 {
        1.0
    } else {
        (((now_sec - trip_start_sec) as f64) / total_span).clamp(0.0, 1.0)
    };

    let eta_min = if phase == 4 {
        0.0
    } else {
        (((trip_end_sec - now_sec).max(0) as f64) / 60.0).ceil()
    };

    let board_leg_idx: isize = if phase == 3 && next_transit_idx >= 0 {
        next_transit_idx
    } else {
        first_board_idx
    };
    let active_board_sec = if board_leg_idx >= 0 {
        clock[board_leg_idx as usize].0
    } else {
        board_sec
    };

    let depart_in_sec = (board_sec - now_sec).max(0);
    let board_in_sec = (active_board_sec - now_sec).max(0);
    let board_at_ms = to_absolute_ms(active_board_sec, now_ms, midnight_ms);

    let is_walk_active = legs[active_idx].is_walk;
    let approach_walk_idx: isize = if is_walk_active {
        active_idx as isize
    } else if active_idx > 0 && legs[active_idx - 1].is_walk && now_sec < clock[active_idx].0 {
        (active_idx - 1) as isize
    } else {
        -1
    };

    let (walk_meters, walk_sec, has_approach_prog, approach_prog) = if approach_walk_idx >= 0 {
        let wi = approach_walk_idx as usize;
        let wm = (legs[wi].walk_m * (1.0 - if is_walk_active { leg_prog } else { 0.0 }))
            .round()
            .max(0.0) as i32;
        let ws = ((wm as f64) / walk_mps).round() as i32;
        if is_walk_active && now_sec >= clock[wi].0 {
            (wm, ws, 1u8, leg_prog)
        } else {
            (wm, ws, 0u8, 0.0)
        }
    } else {
        (0, 0, 0u8, 0.0)
    };

    out.push(1);
    out.push(phase);
    write_u32(&mut out, active_idx as u32);
    write_i32(&mut out, next_transit_idx as i32);
    write_i32(&mut out, first_board_idx as i32);
    write_i32(&mut out, now_sec);
    write_f64(&mut out, leg_prog);
    write_f64(&mut out, overall_progress);
    write_f64(&mut out, eta_min);
    write_i32(&mut out, depart_in_sec);
    write_i32(&mut out, board_in_sec);
    write_f64(&mut out, board_at_ms);
    write_i32(&mut out, walk_meters);
    write_i32(&mut out, walk_sec);
    out.push(has_approach_prog);
    write_f64(&mut out, approach_prog);

    write_u16(&mut out, clock.len() as u16);
    for (d, a) in clock {
        write_i32(&mut out, d);
        write_i32(&mut out, a);
        write_f64(&mut out, to_absolute_ms(d, now_ms, midnight_ms));
        write_f64(&mut out, to_absolute_ms(a, now_ms, midnight_ms));
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locate_live_stop_position_prioritizes_device_over_vehicle() {
        let stops = vec![
            VpStop {
                stop_id: "a".into(),
                name: "Start".into(),
                norm_name: norm_stop_name("Start"),
                lat: Some(51.100),
                lon: Some(17.000),
                arrive_sec: None,
                depart_sec: None,
            },
            VpStop {
                stop_id: "b".into(),
                name: "Środek".into(),
                norm_name: norm_stop_name("Środek"),
                lat: Some(51.105),
                lon: Some(17.000),
                arrive_sec: None,
                depart_sec: None,
            },
            VpStop {
                stop_id: "c".into(),
                name: "Koniec".into(),
                norm_name: norm_stop_name("Koniec"),
                lat: Some(51.110),
                lon: Some(17.000),
                arrive_sec: None,
                depart_sec: None,
            },
        ];
        let leg = VpLeg {
            mode_is_walk: false,
            line: "4".into(),
            trip_id: "t4".into(),
            from_stop: "Start".into(),
            to_stop: "Koniec".into(),
            from_stop_id: "a".into(),
            to_stop_id: "c".into(),
            dep_sec: 9 * 3600 + 55 * 60,
            arr_sec: 10 * 3600 + 15 * 60,
            stops_count: 2,
        };
        let now_ms = 1_700_000_000_000.0;
        let now_sec = 10 * 3600;
        let veh = VpVehicle {
            line: "4".into(),
            lat: 51.1025,
            lon: 17.000,
            current_stop_name: "Start".into(),
            next_stop_name: "Środek".into(),
            matched_trip_id: "t4".into(),
            updated_at_ms: now_ms,
        };
        let loc = VpDeviceLocation {
            lat: 51.1075,
            lon: 17.0005,
            accuracy: Some(8.0),
            speed: Some(6.0),
            heading: Some(0.0),
            timestamp_ms: now_ms,
        };

        let res = locate_live_stop_position(&stops, &leg, Some(&veh), Some(loc), now_ms, now_sec);
        assert_eq!(res, Some((1, 0))); // gap=1, source=0 (device)
    }
}
