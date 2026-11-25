#![forbid(unsafe_code)]

use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hasher};
use std::ops::BitXor;
use std::sync::{Arc, Mutex, OnceLock, RwLock};

#[derive(Default)]
struct FxHasher(u64);

impl Hasher for FxHasher {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = self.0.rotate_left(5).bitxor(b as u64).wrapping_mul(0x517c_c1b7_2722_0a95);
        }
    }

    #[inline]
    fn write_u8(&mut self, i: u8) {
        self.0 = self.0.rotate_left(5).bitxor(i as u64).wrapping_mul(0x517c_c1b7_2722_0a95);
    }

    #[inline]
    fn write_u16(&mut self, i: u16) {
        self.0 = self.0.rotate_left(5).bitxor(i as u64).wrapping_mul(0x517c_c1b7_2722_0a95);
    }

    #[inline]
    fn write_u32(&mut self, i: u32) {
        self.0 = self.0.rotate_left(5).bitxor(i as u64).wrapping_mul(0x517c_c1b7_2722_0a95);
    }

    #[inline]
    fn write_u64(&mut self, i: u64) {
        self.0 = self.0.rotate_left(5).bitxor(i).wrapping_mul(0x517c_c1b7_2722_0a95);
    }

    #[inline]
    fn write_usize(&mut self, i: usize) {
        self.0 = self.0.rotate_left(5).bitxor(i as u64).wrapping_mul(0x517c_c1b7_2722_0a95);
    }

    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
}

type FxBuildHasher = BuildHasherDefault<FxHasher>;

const MAX_LEGS: usize = 4;
const MAX_RS: usize = MAX_LEGS + 1;

pub const NET_MAGIC: i32 = 0x5241_5031; // "RAP1"
pub const QUERY_MAGIC: i32 = 0x5251_5231; // "RQR1"
pub const ARRIVE_BY_QUERY_MAGIC: i32 = 0x5251_5232;
pub const STATUS_NET_MISSING: i32 = -1;
pub const STATUS_BAD_INPUT: i32 = -2;

pub const INF: i32 = 0x3fff_ffff;
pub const DEFAULT_WALK_SPEED_MPS: f64 = 1.34;
pub const WALK_DETOUR_FACTOR: f64 = 1.15;
pub const MAX_TRANSFER_WALK_M: i32 = 800;
pub const TRANSFER_WALK_SLACK_SEC: i32 = 60;
pub const MAX_REFINE_LATER_SEC: i32 = 480;
pub const REFINE_LIMIT: usize = 48;
pub const MIN_FOOTPATH_SEC: i32 = 45;

pub const BOARD_LATE_HALF_LIFE_SEC: f64 = 15.0 * 60.0;
pub const ARRIVE_LATE_HALF_LIFE_SEC: f64 = 30.0 * 60.0;
pub const ARRIVE_EARLY_HALF_LIFE_SEC: f64 = 5.0 * 60.0;
pub const BOARD_EARLY_CAP_SEC: i32 = 120;

pub const KIND_TRAM: u8 = 0;
pub const KIND_BUS: u8 = 1;
pub const KIND_TRAIN: u8 = 2;
pub const KIND_CABLE: u8 = 3;
/// Metro (Warszawa M1/M2). Osobny kind, bo NIE podlega bramce `trains_enabled`:
/// wyłączenie „Pociągów regionalnych” nie może zniknąć metra z wyników.
/// Wąskie filtry (tram/bus) też go nie przepuszczają, tylko tryb „wszystkie”.
pub const KIND_SUBWAY: u8 = 4;

pub const ALLOWED_ALL: i32 = 0;
pub const ALLOWED_TRAM: i32 = 1;
pub const ALLOWED_BUS: i32 = 2;

const MAX_CACHED_NETWORKS: usize = 8;

#[inline]
pub fn js_round(x: f64) -> i32 {
    (x + 0.5).floor() as i32
}

#[inline]
pub fn predict_delay_sec(measured_sec: i32, ahead_sec: i32, is_board: bool) -> i32 {
    if measured_sec == 0 {
        return 0;
    }
    let ahead = ahead_sec.max(0) as f64;
    if measured_sec > 0 {
        let hl = if is_board {
            BOARD_LATE_HALF_LIFE_SEC
        } else {
            ARRIVE_LATE_HALF_LIFE_SEC
        };
        return js_round((measured_sec as f64) * 0.5_f64.powf(ahead / hl));
    }
    if is_board {
        return measured_sec.max(-BOARD_EARLY_CAP_SEC);
    }
    js_round((measured_sec as f64) * 0.5_f64.powf(ahead / ARRIVE_EARLY_HALF_LIFE_SEC))
}

fn predict_delay_for_kind(measured: i32, ahead: i32, board: bool, kind: u8) -> i32 {
    if kind == KIND_BUS && measured > 0 { return measured; }
    predict_delay_sec(measured, ahead, board)
}

#[derive(Clone, Copy)]
pub struct PatternMeta {
    pub stops_off: u32,
    pub times_off: u32,
    pub trip_off: u32,
    pub n: u32,
    pub n_trips: u32,
    pub kind: u8,
}

pub struct CompiledNet {
    pub n_stops: usize,
    pub fp_count: usize,
    pub fp_start: Vec<i32>,
    pub fp_to: Vec<i32>,
    pub fp_dist_m: Vec<i32>,
    pub fp_fixed_sec: Vec<i32>,
    // Odwrotny indeks footpathów (to -> krawędź w fp_*) do target pruningu ostatniej rundy.
    pub rev_fp_start: Vec<i32>,
    pub rev_fp_from: Vec<i32>,
    pub rev_fp_edge: Vec<i32>,
    pub sp_count: usize,
    pub sp_start: Vec<i32>,
    pub sp_pat: Vec<i32>,
    pub sp_pos: Vec<i32>,
    pub patterns: Vec<PatternMeta>,
    pub total_trips: usize,
    pub all_stops: Vec<i32>,
    pub all_dep: Vec<i32>,
    pub all_arr: Vec<i32>,
    fp_dur_cache: Mutex<Vec<(u64, i32, Arc<Vec<i32>>)>>,
    reversed: OnceLock<Box<CompiledNet>>,
}

fn build_reverse_footpaths(
    n_stops: usize,
    fp_count: usize,
    fp_start: &[i32],
    fp_to: &[i32],
) -> (Vec<i32>, Vec<i32>, Vec<i32>) {
    let mut rev_start = vec![0_i32; n_stops + 1];
    for &to in fp_to {
        rev_start[to as usize + 1] += 1;
    }
    for s in 0..n_stops {
        rev_start[s + 1] += rev_start[s];
    }
    let mut cursor = rev_start.clone();
    let total = fp_to.len();
    let mut rev_from = vec![0_i32; total];
    let mut rev_edge = vec![0_i32; total];
    for from in 0..fp_count {
        for e in fp_start[from] as usize..fp_start[from + 1] as usize {
            let to = fp_to[e] as usize;
            let out = cursor[to] as usize;
            cursor[to] += 1;
            rev_from[out] = from as i32;
            rev_edge[out] = e as i32;
        }
    }
    (rev_start, rev_from, rev_edge)
}

impl CompiledNet {
    // Odwrócony rozkład powstaje raz na wycinek, dopiero przy szukaniu przyjazdu.
    fn reversed(&self) -> &CompiledNet {
        self.reversed.get_or_init(|| {
            let mut fp_start = vec![0; self.n_stops + 1];
            for &to in &self.fp_to {
                fp_start[to as usize + 1] += 1;
            }
            for s in 0..self.n_stops {
                fp_start[s + 1] += fp_start[s];
            }
            let mut cursor = fp_start.clone();
            let mut fp_to = vec![0; self.fp_to.len()];
            let mut fp_dist_m = vec![0; self.fp_to.len()];
            let mut fp_fixed_sec = vec![0; self.fp_to.len()];
            for from in 0..self.fp_count {
                for e in self.fp_start[from] as usize..self.fp_start[from + 1] as usize {
                    let to = self.fp_to[e] as usize;
                    let out = cursor[to] as usize;
                    cursor[to] += 1;
                    fp_to[out] = from as i32;
                    fp_dist_m[out] = self.fp_dist_m[e];
                    fp_fixed_sec[out] = self.fp_fixed_sec[e];
                }
            }
            let (rev_fp_start, rev_fp_from, rev_fp_edge) =
                build_reverse_footpaths(self.n_stops, self.n_stops, &fp_start, &fp_to);
            let mut all_stops = self.all_stops.clone();
            let mut all_dep = vec![0_i32; self.all_dep.len()];
            let mut all_arr = vec![0_i32; self.all_arr.len()];
            for pat in &self.patterns {
                let stops_off = pat.stops_off as usize;
                let times_off = pat.times_off as usize;
                let n = pat.n as usize;
                let len = n * pat.n_trips as usize;
                all_stops[stops_off..stops_off + n].reverse();
                for i in 0..len {
                    all_dep[times_off + i] = -self.all_arr[times_off + len - 1 - i];
                    all_arr[times_off + i] = -self.all_dep[times_off + len - 1 - i];
                }
            }
            Box::new(Self {
                n_stops: self.n_stops,
                fp_count: self.n_stops,
                fp_start,
                fp_to,
                fp_dist_m,
                fp_fixed_sec,
                rev_fp_start,
                rev_fp_from,
                rev_fp_edge,
                sp_count: self.sp_count,
                sp_start: self.sp_start.clone(),
                sp_pat: self.sp_pat.clone(),
                sp_pos: self.sp_pos.iter().zip(&self.sp_pat)
                    .map(|(&pos, &p)| self.patterns[p as usize].n as i32 - 1 - pos)
                    .collect(),
                patterns: self.patterns.clone(),
                total_trips: self.total_trips,
                all_stops,
                all_dep,
                all_arr,
                fp_dur_cache: Mutex::new(Vec::new()),
                reversed: OnceLock::new(),
            })
        })
    }

    #[inline]
    pub fn pat_stops(&self, p: usize) -> &[i32] {
        let meta = &self.patterns[p];
        let off = meta.stops_off as usize;
        &self.all_stops[off..off + meta.n as usize]
    }

    #[inline]
    pub fn pat_dep(&self, p: usize) -> &[i32] {
        let meta = &self.patterns[p];
        let off = meta.times_off as usize;
        let len = meta.n_trips as usize * meta.n as usize;
        &self.all_dep[off..off + len]
    }

    #[inline]
    pub fn pat_arr(&self, p: usize) -> &[i32] {
        let meta = &self.patterns[p];
        let off = meta.times_off as usize;
        let len = meta.n_trips as usize * meta.n as usize;
        &self.all_arr[off..off + len]
    }

    pub fn foot_durations(&self, speed_mps: f64, max_m: i32) -> Arc<Vec<i32>> {
        let speed_key = (speed_mps * 1000.0).round() as u64;
        if let Ok(guard) = self.fp_dur_cache.lock() {
            for (sk, mm, cached) in guard.iter() {
                if *sk == speed_key && *mm == max_m {
                    return Arc::clone(cached);
                }
            }
        }
        let total = self.fp_to.len();
        let inv_speed = WALK_DETOUR_FACTOR / speed_mps;
        let mut out = vec![0_i32; total];
        for e in 0..total {
            let fixed = self.fp_fixed_sec[e];
            if fixed > 0 {
                out[e] = fixed;
            } else if self.fp_dist_m[e] > max_m {
                out[e] = -1;
            } else {
                out[e] = MIN_FOOTPATH_SEC.max(js_round((self.fp_dist_m[e] as f64) * inv_speed));
            }
        }
        let arc = Arc::new(out);
        if let Ok(mut guard) = self.fp_dur_cache.lock() {
            if guard.len() >= 8 {
                guard.remove(0);
            }
            guard.push((speed_key, max_m, Arc::clone(&arc)));
        }
        arc
    }

    pub fn from_packed_bytes(bytes: &[u8]) -> Option<Self> {
        let mut r = WordReader::new(bytes)?;
        let magic = r.next()?;
        if magic != NET_MAGIC {
            return None;
        }
        let n_stops = usize::try_from(r.next()?).ok()?;
        let fp_count = usize::try_from(r.next()?).ok()?;
        let fp_total = usize::try_from(r.next()?).ok()?;
        let n_pat = usize::try_from(r.next()?).ok()?;
        let sp_count = usize::try_from(r.next()?).ok()?;
        let sp_total = usize::try_from(r.next()?).ok()?;

        if fp_count > n_stops || sp_count > n_stops {
            return None;
        }

        let fp_start = r.read_vec(fp_count.checked_add(1)?)?;
        let fp_to = r.read_vec(fp_total)?;
        let fp_dist_m = r.read_vec(fp_total)?;
        let fp_fixed_sec = r.read_vec(fp_total)?;
        let sp_start = r.read_vec(sp_count.checked_add(1)?)?;
        let sp_pat = r.read_vec(sp_total)?;
        let sp_pos = r.read_vec(sp_total)?;

        // Validate CSR bounds for footpaths and stop-patterns so queries never panic
        for s in 0..fp_count {
            let a = fp_start[s];
            let b = fp_start[s + 1];
            if a < 0 || b < a || (b as usize) > fp_total {
                return None;
            }
        }
        for &to in &fp_to {
            if to < 0 || (to as usize) >= n_stops {
                return None;
            }
        }
        for s in 0..sp_count {
            let a = sp_start[s];
            let b = sp_start[s + 1];
            if a < 0 || b < a || (b as usize) > sp_total {
                return None;
            }
        }

        let rem_words = bytes.len().saturating_sub(r.pos) / 4;
        let est_times = rem_words.saturating_sub(sp_total + n_pat * 3) / 2;
        let mut patterns = Vec::with_capacity(n_pat);
        let mut all_stops = Vec::with_capacity(sp_total);
        let mut all_dep = Vec::with_capacity(est_times);
        let mut all_arr = Vec::with_capacity(est_times);
        let mut total_trips: usize = 0;

        for _ in 0..n_pat {
            let kind_raw = r.next()?;
            let kind = match kind_raw {
                0 => KIND_TRAM,
                1 => KIND_BUS,
                2 => KIND_TRAIN,
                3 => KIND_CABLE,
                4 => KIND_SUBWAY,
                _ => KIND_BUS,
            };
            let n = usize::try_from(r.next()?).ok()?;
            let n_trips = usize::try_from(r.next()?).ok()?;
            if n < 2 || n_trips == 0 {
                return None;
            }
            let times_len = n.checked_mul(n_trips)?;
            let stops_off = all_stops.len();
            let times_off = all_dep.len();
            let trip_off = total_trips;
            total_trips = total_trips.checked_add(n_trips)?;

            r.read_into(&mut all_stops, n)?;
            for &s in &all_stops[stops_off..stops_off + n] {
                if s < 0 || (s as usize) >= n_stops {
                    return None;
                }
            }
            r.read_into(&mut all_dep, times_len)?;
            r.read_into(&mut all_arr, times_len)?;

            patterns.push(PatternMeta {
                stops_off: u32::try_from(stops_off).ok()?,
                times_off: u32::try_from(times_off).ok()?,
                trip_off: u32::try_from(trip_off).ok()?,
                n: u32::try_from(n).ok()?,
                n_trips: u32::try_from(n_trips).ok()?,
                kind,
            });
        }

        for i in 0..sp_total {
            let p = sp_pat[i];
            let pos = sp_pos[i];
            if p < 0 || (p as usize) >= n_pat {
                return None;
            }
            if pos < 0 || (pos as usize) >= patterns[p as usize].n as usize {
                return None;
            }
        }

        let (rev_fp_start, rev_fp_from, rev_fp_edge) =
            build_reverse_footpaths(n_stops, fp_count, &fp_start, &fp_to);

        Some(Self {
            n_stops,
            fp_count,
            fp_start,
            fp_to,
            fp_dist_m,
            fp_fixed_sec,
            rev_fp_start,
            rev_fp_from,
            rev_fp_edge,
            sp_count,
            sp_start,
            sp_pat,
            sp_pos,
            patterns,
            total_trips,
            all_stops,
            all_dep,
            all_arr,
            fp_dur_cache: Mutex::new(Vec::with_capacity(4)),
            reversed: OnceLock::new(),
        })
    }
}

struct NetCache {
    order: Vec<i32>,
    map: HashMap<i32, Arc<CompiledNet>>,
}

impl NetCache {
    fn new() -> Self {
        Self {
            order: Vec::with_capacity(MAX_CACHED_NETWORKS),
            map: HashMap::with_capacity(MAX_CACHED_NETWORKS),
        }
    }

    fn has(&self, net_id: i32) -> bool {
        self.map.contains_key(&net_id)
    }

    fn get(&self, net_id: i32) -> Option<Arc<CompiledNet>> {
        self.map.get(&net_id).cloned()
    }

    fn insert(&mut self, net_id: i32, net: Arc<CompiledNet>) {
        if let Some(pos) = self.order.iter().position(|&id| id == net_id) {
            self.order.remove(pos);
        } else if self.order.len() >= MAX_CACHED_NETWORKS {
            let oldest = self.order.remove(0);
            self.map.remove(&oldest);
        }
        self.order.push(net_id);
        self.map.insert(net_id, net);
    }

    fn remove(&mut self, net_id: i32) {
        self.map.remove(&net_id);
        if let Some(pos) = self.order.iter().position(|&id| id == net_id) {
            self.order.remove(pos);
        }
    }

    fn clear(&mut self) {
        self.map.clear();
        self.order.clear();
    }
}

static NET_REGISTRY: OnceLock<RwLock<NetCache>> = OnceLock::new();

fn registry() -> &'static RwLock<NetCache> {
    NET_REGISTRY.get_or_init(|| RwLock::new(NetCache::new()))
}

pub fn has_network(net_id: i32) -> bool {
    registry().read().map(|g| g.has(net_id)).unwrap_or(false)
}

pub fn load_network(net_id: i32, bytes: &[u8]) -> bool {
    let Some(compiled) = CompiledNet::from_packed_bytes(bytes) else {
        return false;
    };
    let Ok(mut guard) = registry().write() else {
        return false;
    };
    guard.insert(net_id, Arc::new(compiled));
    true
}

pub fn drop_network(net_id: i32) {
    if let Ok(mut guard) = registry().write() {
        guard.remove(net_id);
    }
}

pub fn clear_networks() {
    if let Ok(mut guard) = registry().write() {
        guard.clear();
    }
}

struct WordReader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> WordReader<'a> {
    #[inline]
    fn new(bytes: &'a [u8]) -> Option<Self> {
        if bytes.len() % 4 != 0 {
            return None;
        }
        Some(Self { bytes, pos: 0 })
    }

    #[inline]
    fn next(&mut self) -> Option<i32> {
        if self.pos + 4 > self.bytes.len() {
            return None;
        }
        let b = &self.bytes[self.pos..self.pos + 4];
        self.pos += 4;
        Some(i32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    #[inline]
    fn next_f64(&mut self) -> Option<f64> {
        let lo = self.next()? as u32 as u64;
        let hi = self.next()? as u32 as u64;
        Some(f64::from_bits(lo | (hi << 32)))
    }

    fn read_vec(&mut self, count: usize) -> Option<Vec<i32>> {
        let mut out = Vec::with_capacity(count);
        self.read_into(&mut out, count)?;
        Some(out)
    }

    fn read_into(&mut self, out: &mut Vec<i32>, count: usize) -> Option<()> {
        let byte_len = count.checked_mul(4)?;
        let end = self.pos.checked_add(byte_len)?;
        if end > self.bytes.len() {
            return None;
        }
        let slice = &self.bytes[self.pos..end];
        self.pos = end;
        out.reserve(count);
        out.extend(
            slice
                .chunks_exact(4)
                .map(|b| i32::from_le_bytes([b[0], b[1], b[2], b[3]])),
        );
        Some(())
    }
}

#[derive(Clone)]
pub struct QueryInput {
    pub arrive_by: bool,
    pub net_id: i32,
    pub t0: i32,
    pub window_sec: i32,
    pub max_transfers: usize,
    pub min_t: i32,
    pub train_need: i32,
    pub trains_enabled: bool,
    pub cable_enabled: bool,
    pub allowed_mode: i32,
    pub speed_mps: f64,
    pub max_transfer_walk_m: i32,
    pub wr: f64,
    pub transfer_penalty_sec: i32,
    pub latest_arr: i32,
    pub now_sec: Option<i32>,
    pub origins: Vec<(usize, i32, i32)>,
    pub destinations: Vec<(usize, i32, i32)>,
    pub delays: Vec<(usize, usize, i32)>,
    pub transfer_buffers: Vec<(usize, usize, i32)>,
}

impl QueryInput {
    pub fn from_packed_bytes(bytes: &[u8]) -> Option<Self> {
        let mut r = WordReader::new(bytes)?;
        let magic = r.next()?;
        if magic != QUERY_MAGIC && magic != ARRIVE_BY_QUERY_MAGIC {
            return None;
        }
        let net_id = r.next()?;
        let t0 = r.next()?;
        let window_sec = r.next()?.max(0);
        let max_transfers = (r.next()?.clamp(0, 3)) as usize;
        let min_t = r.next()?.clamp(0, 600);
        let train_need = r.next()?.clamp(0, 1200).max(min_t);
        let trains_enabled = r.next()? != 0;
        let cable_enabled = r.next()? != 0;
        let allowed_mode = r.next()?;
        let speed_raw = r.next_f64()?;
        let speed_mps = if speed_raw.is_finite() {
            speed_raw.clamp(0.5, 3.0)
        } else {
            DEFAULT_WALK_SPEED_MPS
        };
        let max_transfer_walk_m = r.next()?.clamp(0, MAX_TRANSFER_WALK_M);
        let wr_raw = r.next_f64()?;
        let wr = if wr_raw.is_finite() {
            wr_raw.max(1.0)
        } else {
            1.8
        };
        let transfer_penalty_sec = r.next()?;
        let latest_arr = r.next()?;
        let has_now = r.next()? != 0;
        let now_val = r.next()?;
        let now_sec = if has_now { Some(now_val) } else { None };

        let n_origins = usize::try_from(r.next()?).ok()?;
        let n_destinations = usize::try_from(r.next()?).ok()?;
        let n_delays = usize::try_from(r.next()?).ok()?;

        let mut origins = Vec::with_capacity(n_origins);
        for _ in 0..n_origins {
            let s = usize::try_from(r.next()?).ok()?;
            let walk_sec = r.next()?;
            let walk_m = r.next()?;
            origins.push((s, walk_sec, walk_m));
        }

        let mut destinations = Vec::with_capacity(n_destinations);
        for _ in 0..n_destinations {
            let s = usize::try_from(r.next()?).ok()?;
            let walk_sec = r.next()?;
            let walk_m = r.next()?;
            destinations.push((s, walk_sec, walk_m));
        }

        let mut delays = Vec::with_capacity(n_delays);
        for _ in 0..n_delays {
            let p = usize::try_from(r.next()?).ok()?;
            let j = usize::try_from(r.next()?).ok()?;
            let d0 = r.next()?;
            delays.push((p, j, d0));
        }
        let mut transfer_buffers = Vec::new();
        if r.pos < bytes.len() {
            let count = usize::try_from(r.next()?).ok()?;
            for _ in 0..count {
                transfer_buffers.push((usize::try_from(r.next()?).ok()?, usize::try_from(r.next()?).ok()?, r.next()?.clamp(0, 600)));
            }
        }

        Some(Self {
            arrive_by: magic == ARRIVE_BY_QUERY_MAGIC,
            net_id,
            t0,
            window_sec,
            max_transfers,
            min_t,
            train_need,
            trains_enabled,
            cable_enabled,
            allowed_mode,
            speed_mps,
            max_transfer_walk_m,
            wr,
            transfer_penalty_sec,
            latest_arr,
            now_sec,
            origins,
            destinations,
            delays,
            transfer_buffers,
        })
    }
}

#[derive(Clone, Copy, Default)]
struct ILeg {
    p: usize,
    j: usize,
    b: usize,
    a: usize,
    walk_in: i32,
}

#[derive(Clone, Copy)]
struct SmallLegs {
    len: u8,
    data: [ILeg; MAX_LEGS],
}

impl SmallLegs {
    #[inline]
    fn new() -> Self {
        Self {
            len: 0,
            data: [ILeg::default(); MAX_LEGS],
        }
    }

    #[inline]
    fn len(&self) -> usize {
        self.len as usize
    }

    #[inline]
    fn as_slice(&self) -> &[ILeg] {
        &self.data[..self.len as usize]
    }

    #[inline]
    fn as_mut_slice(&mut self) -> &mut [ILeg] {
        &mut self.data[..self.len as usize]
    }

    #[inline]
    fn push(&mut self, leg: ILeg) -> bool {
        let idx = self.len as usize;
        if idx >= MAX_LEGS {
            return false;
        }
        self.data[idx] = leg;
        self.len += 1;
        true
    }

    #[inline]
    fn last_mut(&mut self) -> Option<&mut ILeg> {
        let l = self.len as usize;
        if l == 0 {
            None
        } else {
            Some(&mut self.data[l - 1])
        }
    }

    #[inline]
    fn reverse(&mut self) {
        self.as_mut_slice().reverse();
    }
}

#[derive(Clone, Copy)]
struct ICand {
    legs: SmallLegs,
    dest: usize,
    /// Opcjonalne końcowe dojście pieszo: (skąd, sek, metry). Pozwala kończyć
    /// podróż spacerem zamiast wymuszonej przesiadki na ostatni krótki kurs.
    walk_out: Option<(usize, i32, i32)>,
}

#[derive(Clone, Copy)]
struct CandInfo {
    c: ICand,
    arr: i32,
    cost: f64,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct ChainKey {
    len: u8,
    pairs: [(u32, u32); 4],
}

impl ChainKey {
    #[inline]
    fn from_legs(legs: &[ILeg]) -> Self {
        let mut pairs = [(0_u32, 0_u32); 4];
        let len = legs.len().min(4);
        for (i, l) in legs.iter().take(len).enumerate() {
            pairs[i] = (l.p as u32, l.j as u32);
        }
        Self {
            len: len as u8,
            pairs,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct FullKey {
    len: u8,
    dest: u32,
    legs: [(u32, u32, u16, u16); 4],
}

impl FullKey {
    #[inline]
    fn from_cand(c: &ICand) -> Self {
        let mut legs = [(0_u32, 0_u32, 0_u16, 0_u16); 4];
        let slice = c.legs.as_slice();
        let len = slice.len().min(4);
        for (i, l) in slice.iter().take(len).enumerate() {
            legs[i] = (l.p as u32, l.j as u32, l.b as u16, l.a as u16);
        }
        Self {
            len: len as u8,
            dest: c.dest as u32,
            legs,
        }
    }
}

struct DelayOverlay {
    any_delay: bool,
    pat_offset: Vec<u32>,
    late_max: Vec<i32>,
    early_max: Vec<i32>,
    dep_arena: Vec<i32>,
    arr_arena: Vec<i32>,
}

impl DelayOverlay {
    fn new() -> Self {
        Self {
            any_delay: false,
            pat_offset: Vec::new(),
            late_max: Vec::new(),
            early_max: Vec::new(),
            dep_arena: Vec::new(),
            arr_arena: Vec::new(),
        }
    }

    fn build(&mut self, net: &CompiledNet, delays: &[(usize, usize, i32)], now_sec: Option<i32>, reverse: bool) {
        let n_pat = net.patterns.len();
        if self.any_delay {
            self.pat_offset.fill(u32::MAX);
            self.late_max.fill(0);
            self.early_max.fill(0);
            self.dep_arena.clear();
            self.arr_arena.clear();
            self.any_delay = false;
        }
        if self.pat_offset.len() < n_pat {
            self.pat_offset.resize(n_pat, u32::MAX);
            self.late_max.resize(n_pat, 0);
            self.early_max.resize(n_pat, 0);
        }
        if delays.is_empty() {
            return;
        }

        for &(p, j, d0) in delays {
            if d0 == 0 || p >= n_pat {
                continue;
            }
            let pat = &net.patterns[p];
            if j >= pat.n_trips as usize {
                continue;
            }
            let base_off = if self.pat_offset[p] == u32::MAX {
                let off = self.dep_arena.len();
                self.dep_arena.extend_from_slice(net.pat_dep(p));
                self.arr_arena.extend_from_slice(net.pat_arr(p));
                self.pat_offset[p] = off as u32;
                self.any_delay = true;
                off
            } else {
                self.pat_offset[p] as usize
            };

            let n = pat.n as usize;
            let sched_dep = net.pat_dep(p);
            let sched_arr = net.pat_arr(p);
            let vehicle_at = now_sec.map(|now| now - d0);

            for i in 0..n {
                let k = j * n + i;
                let sd = sched_dep[k];
                let sa = sched_arr[k];
                let (board_time, arrival_time) = if reverse { (-sd, -sa) } else { (sd, sa) };
                let sign = if reverse { -1 } else { 1 };
                let db = sign * match vehicle_at {
                    None => d0,
                    Some(va) => predict_delay_for_kind(d0, board_time - va, !reverse, pat.kind),
                };
                let da = sign * match vehicle_at {
                    None => d0,
                    Some(va) => predict_delay_for_kind(d0, arrival_time - va, reverse, pat.kind),
                };
                self.dep_arena[base_off + k] = sd + db;
                self.arr_arena[base_off + k] = sa + da;
                if db > self.late_max[p] {
                    self.late_max[p] = db;
                }
                if -db > self.early_max[p] {
                    self.early_max[p] = -db;
                }
            }
        }
    }

    #[inline]
    fn has_delay(&self, p: usize) -> bool {
        self.any_delay && self.pat_offset[p] != u32::MAX
    }

    #[inline]
    fn dep<'a>(&'a self, net: &'a CompiledNet, p: usize) -> &'a [i32] {
        if !self.any_delay {
            return net.pat_dep(p);
        }
        let off = self.pat_offset[p];
        if off == u32::MAX {
            net.pat_dep(p)
        } else {
            let meta = &net.patterns[p];
            let start = off as usize;
            &self.dep_arena[start..start + meta.n_trips as usize * meta.n as usize]
        }
    }

    #[inline]
    fn arr<'a>(&'a self, net: &'a CompiledNet, p: usize) -> &'a [i32] {
        if !self.any_delay {
            return net.pat_arr(p);
        }
        let off = self.pat_offset[p];
        if off == u32::MAX {
            net.pat_arr(p)
        } else {
            let meta = &net.patterns[p];
            let start = off as usize;
            &self.arr_arena[start..start + meta.n_trips as usize * meta.n as usize]
        }
    }
}

#[inline]
fn lower_bound_trips(dep: &[i32], n: usize, n_trips: usize, pos: usize, target: i32) -> usize {
    let mut lo = 0;
    let mut hi = n_trips;
    while lo < hi {
        let mid = (lo + hi) >> 1;
        if dep[mid * n + pos] < target {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
}

#[derive(Clone, Copy, Default)]
struct LabelMeta {
    arr_at: i32,
    p_a: i32,
    p_b: i32,
    p_c: i32,
    p_d: i32,
}

struct RaptorScratch {
    reverse: bool,
    enabled: Vec<u8>,
    access_sec: Vec<i32>,
    access_m: Vec<i32>,
    egress_sec: Vec<i32>,
    egress_m: Vec<i32>,
    origin_list: Vec<usize>,
    dest_list: Vec<usize>,
    can_walk_to_dest: Vec<u8>,
    walk_to_dest_list: Vec<usize>,
    last_dest_pos: Vec<i32>,
    // Wszystkie rundy przystanku leżą w jednej linii cache (stały krok MAX_RS = 5).
    tau: Vec<[i32; MAX_RS]>,
    p_type: Vec<u8>,
    labels: Vec<LabelMeta>,
    best_arr: [i32; MAX_RS],
    best_val: [i32; MAX_RS],
    marked: Vec<u8>,
    mark_list: Vec<usize>,
    mark_count: usize,
    improved_flag: Vec<u8>,
    improved_list: Vec<usize>,
    improved_count: usize,
    queue: Vec<i32>,
    queued: Vec<usize>,
    pos_head: Vec<i32>,
    pos_next: Vec<i32>,
    ref_b: Vec<f64>,
    ref_bf: Vec<i32>,
    ref_bw: Vec<i32>,
    ref_c: Vec<f64>,
    ref_cf: Vec<i32>,
    delays: DelayOverlay,
    has_transfer_buffers: bool,
    tb_epoch: u32,
    tb_stamp: Vec<u32>,
    tb_val: Vec<i32>,
}

impl RaptorScratch {
    fn new() -> Self {
        Self {
            reverse: false,
            enabled: Vec::new(),
            access_sec: Vec::new(),
            access_m: Vec::new(),
            egress_sec: Vec::new(),
            egress_m: Vec::new(),
            origin_list: Vec::new(),
            dest_list: Vec::new(),
            can_walk_to_dest: Vec::new(),
            walk_to_dest_list: Vec::new(),
            last_dest_pos: Vec::new(),
            tau: Vec::new(),
            p_type: Vec::new(),
            labels: Vec::new(),
            best_arr: [INF; MAX_RS],
            best_val: [INF; MAX_RS],
            marked: Vec::new(),
            mark_list: Vec::new(),
            mark_count: 0,
            improved_flag: Vec::new(),
            improved_list: Vec::new(),
            improved_count: 0,
            queue: Vec::new(),
            queued: Vec::new(),
            pos_head: Vec::new(),
            pos_next: Vec::new(),
            ref_b: Vec::new(),
            ref_bf: Vec::new(),
            ref_bw: Vec::new(),
            ref_c: Vec::new(),
            ref_cf: Vec::new(),
            delays: DelayOverlay::new(),
            has_transfer_buffers: false,
            tb_epoch: 0,
            tb_stamp: Vec::new(),
            tb_val: Vec::new(),
        }
    }

    fn prepare(&mut self, n_stops: usize, n_pat: usize, rs: usize) {
        if self.enabled.len() < n_pat {
            self.enabled.resize(n_pat, 0);
        }

        if self.access_sec.len() < n_stops {
            self.access_sec.resize(n_stops, -1);
            self.access_m.resize(n_stops, 0);
            self.egress_sec.resize(n_stops, -1);
            self.egress_m.resize(n_stops, 0);
        }
        self.access_sec[..n_stops].fill(-1);
        self.egress_sec[..n_stops].fill(-1);
        self.origin_list.clear();
        self.dest_list.clear();
        self.walk_to_dest_list.clear();

        if self.can_walk_to_dest.len() < n_stops {
            self.can_walk_to_dest.resize(n_stops, 0);
        }
        self.can_walk_to_dest[..n_stops].fill(0);

        if self.last_dest_pos.len() < n_pat {
            self.last_dest_pos.resize(n_pat, -1);
        }
        self.last_dest_pos[..n_pat].fill(-1);

        if self.tau.len() < n_stops {
            self.tau.resize(n_stops, [INF; MAX_RS]);
        }
        self.tau[..n_stops].fill([INF; MAX_RS]);

        let total = rs * n_stops;
        if self.p_type.len() < total {
            self.p_type.resize(total, 0);
            self.labels.resize(total, LabelMeta::default());
        }
        self.p_type[..total].fill(0);

        self.best_arr = [INF; MAX_RS];
        self.best_val = [INF; MAX_RS];

        if self.marked.len() < n_stops {
            self.marked.resize(n_stops, 0);
            self.mark_list.resize(n_stops, 0);
            self.improved_flag.resize(n_stops, 0);
            self.improved_list.resize(n_stops, 0);
        }
        self.marked[..n_stops].fill(0);
        self.mark_count = 0;
        self.improved_flag[..n_stops].fill(0);
        self.improved_count = 0;

        if self.queue.len() < n_pat {
            self.queue.resize(n_pat, -1);
            self.queued.resize(n_pat, 0);
        }
        self.queue[..n_pat].fill(-1);

        if self.pos_head.len() < n_stops {
            self.pos_head.resize(n_stops, -1);
        }
    }

    #[inline]
    fn has_tb(&self, net: &CompiledNet, p: usize, j: usize) -> bool {
        if !self.has_transfer_buffers {
            return false;
        }
        let idx = net.patterns[p].trip_off as usize + j;
        self.tb_stamp[idx] == self.tb_epoch
    }

    #[inline]
    fn get_tb(&self, net: &CompiledNet, p: usize, j: usize) -> i32 {
        if !self.has_transfer_buffers {
            return 0;
        }
        let idx = net.patterns[p].trip_off as usize + j;
        if self.tb_stamp[idx] == self.tb_epoch {
            self.tb_val[idx]
        } else {
            0
        }
    }

    #[inline]
    fn mark(&mut self, s: usize) {
        if self.marked[s] == 0 {
            self.marked[s] = 1;
            self.mark_list[self.mark_count] = s;
            self.mark_count += 1;
        }
    }

    fn backtrack(&self, net: &CompiledNet, round: usize, stop: usize) -> Option<SmallLegs> {
        let n_stops = net.n_stops;
        let mut legs = SmallLegs::new();
        let mut k = round;
        let mut s = stop;
        let mut walk_in = 0;
        for _guard in 0..32 {
            let id = k * n_stops + s;
            let t = self.p_type[id];
            if t == 1 {
                if let Some(first) = legs.last_mut() {
                    first.walk_in = 0;
                }
                legs.reverse();
                return Some(legs);
            }
            if t == 3 {
                let lbl = self.labels[id];
                walk_in = lbl.p_b;
                s = lbl.p_a as usize;
                continue;
            }
            if t != 2 || k == 0 {
                return None;
            }
            let lbl = self.labels[id];
            let p = lbl.p_a as usize;
            if let Some(next_leg) = legs.last_mut() {
                next_leg.walk_in = walk_in;
            }
            walk_in = 0;
            let b_pos = lbl.p_c as usize;
            if !legs.push(ILeg {
                p,
                j: lbl.p_b as usize,
                b: b_pos,
                a: lbl.p_d as usize,
                walk_in: 0,
            }) {
                return None;
            }
            s = net.pat_stops(p)[b_pos] as usize;
            k -= 1;
        }
        None
    }

    #[inline]
    fn pointless(&self, net: &CompiledNet, legs: &[ILeg], dest: usize) -> bool {
        for l in legs {
            if (l.a as i32) - (l.b as i32) <= 0 {
                return true;
            }
        }
        if legs.len() != 1 {
            return false;
        }
        let l = &legs[0];
        if (l.a as i32) - (l.b as i32) > 1 || net.patterns[l.p].kind == KIND_CABLE {
            return false;
        }
        let origin = net.pat_stops(l.p)[l.b] as usize;
        let total_m = self.access_m[origin] + self.egress_m[dest];
        total_m > 500 || self.egress_m[dest] > 350
    }

    #[inline]
    fn arrival_buffer(&self, net: &CompiledNet, k: usize, stop: usize) -> i32 {
        if self.reverse || k == 0 || !self.has_transfer_buffers {
            return 0;
        }
        let mut id = k * net.n_stops + stop;
        if self.p_type[id] == 3 {
            id = k * net.n_stops + self.labels[id].p_a as usize;
        }
        if self.p_type[id] != 2 {
            return 0;
        }
        let lbl = self.labels[id];
        self.get_tb(net, lbl.p_a as usize, lbl.p_b as usize)
    }

    #[inline]
    fn board_ready(
        &self,
        net: &CompiledNet,
        km1: usize,
        s: usize,
        is_train: bool,
        min_t: i32,
        train_need: i32,
    ) -> i32 {
        let r = self.tau[s][km1];
        if self.reverse || km1 == 0 || !is_train || train_need <= min_t {
            return r;
        }
        let id = km1 * net.n_stops + s;
        let lbl = self.labels[id];
        if self.p_type[id] == 3 {
            return r.max(lbl.p_c + train_need.max(lbl.p_b + TRANSFER_WALK_SLACK_SEC) + self.arrival_buffer(net, km1, s));
        }
        r.max(lbl.arr_at + train_need + self.arrival_buffer(net, km1, s))
    }

    #[allow(clippy::too_many_arguments)]
    fn check_target(
        &mut self,
        net: &CompiledNet,
        k: usize,
        p: usize,
        j: usize,
        b_pos: usize,
        a_pos: usize,
        s: usize,
        a: i32,
        latest_arr: i32,
        wr: f64,
        bound_val: &mut i32,
        cands: &mut Vec<ICand>,
    ) {
        let e = self.egress_sec[s];
        let arr_t = a + e;
        if arr_t > latest_arr {
            return;
        }
        let mut ba = self.best_arr[1];
        let mut bv = self.best_val[1];
        for r in 2..=k {
            if self.best_arr[r] < ba {
                ba = self.best_arr[r];
            }
            if self.best_val[r] < bv {
                bv = self.best_val[r];
            }
        }
        // Dolne ograniczenie wartości: uncertainty >= 0, więc zdominowany
        // kandydat odpada przed kosztem backtrackingu.
        let base_val = a + js_round(wr * (e as f64));
        if arr_t >= ba && base_val >= bv {
            return;
        }
        let b_stop = net.pat_stops(p)[b_pos] as usize;
        let Some(mut legs) = self.backtrack(net, k - 1, b_stop) else {
            return;
        };
        if !legs.push(ILeg {
            p,
            j,
            b: b_pos,
            a: a_pos,
            walk_in: 0,
        }) {
            return;
        }
        if legs.len() > 1 {
            let id = (k - 1) * net.n_stops + b_stop;
            let walk_in = if self.p_type[id] == 3 { self.labels[id].p_b } else { 0 };
            if let Some(last) = legs.last_mut() {
                last.walk_in = walk_in;
            }
        }
        if self.pointless(net, legs.as_slice(), s) {
            return;
        }
        let val_t = if self.has_transfer_buffers {
            let mut uncertainty = 0_i32;
            for l in legs.as_slice() {
                if self.has_tb(net, l.p, l.j) {
                    uncertainty += 120;
                }
            }
            let v = base_val + uncertainty;
            if arr_t >= ba && v >= bv {
                return;
            }
            v
        } else {
            base_val
        };
        cands.push(ICand { legs, dest: s, walk_out: None });
        if arr_t < self.best_arr[k] {
            self.best_arr[k] = arr_t;
        }
        if val_t < self.best_val[k] {
            self.best_val[k] = val_t;
        }
        if val_t < *bound_val {
            *bound_val = val_t;
        }
    }

    #[inline]
    fn earliest_trip(&self, net: &CompiledNet, p: usize, pos: usize, r: i32, transferring: bool) -> i32 {
        let pat = &net.patterns[p];
        let n = pat.n as usize;
        let n_trips = pat.n_trips as usize;
        let rev_tb = self.reverse && transferring && self.has_transfer_buffers;
        if !self.delays.has_delay(p) && !rev_tb {
            let dep = net.pat_dep(p);
            let j = lower_bound_trips(dep, n, n_trips, pos, r);
            return if j < n_trips { j as i32 } else { -1 };
        }
        let sched = net.pat_dep(p);
        let dep = self.delays.dep(net, p);
        let early = if self.delays.any_delay { self.delays.early_max[p] } else { 0 };
        let late = if self.delays.any_delay { self.delays.late_max[p] } else { 0 };
        let mut best: i32 = -1;
        let mut best_t: i32 = INF;
        let start = lower_bound_trips(sched, n, n_trips, pos, r - late);
        for j in start..n_trips {
            if sched[j * n + pos] - early > best_t {
                break;
            }
            let t = dep[j * n + pos];
            let extra = if rev_tb { self.get_tb(net, p, j) } else { 0 };
            if t >= r + extra && t < best_t {
                best_t = t;
                best = j as i32;
            }
        }
        best
    }

    #[allow(clippy::too_many_arguments)]
    fn scan_pattern(
        &mut self,
        net: &CompiledNet,
        k: usize,
        is_last_round: bool,
        p: usize,
        start: usize,
        min_t: i32,
        train_need: i32,
        latest_arr: i32,
        wr: f64,
        bound_val: &mut i32,
        cands: &mut Vec<ICand>,
    ) {
        let pat = net.patterns[p];
        let n = pat.n as usize;
        let end_pos = if is_last_round {
            (self.last_dest_pos[p] as usize + 1).min(n)
        } else {
            n
        };
        let n_trips = pat.n_trips as usize;
        let stops = net.pat_stops(p);
        let is_train = pat.kind == KIND_TRAIN;
        let n_stops = net.n_stops;
        let kk = k * n_stops;
        let km1 = k - 1;
        let delay_off = if self.delays.any_delay {
            self.delays.pat_offset[p]
        } else {
            u32::MAX
        };
        let pat_has_delay = delay_off != u32::MAX;
        let times_base = if pat_has_delay {
            delay_off as usize
        } else {
            pat.times_off as usize
        };
        let fast_fifo = !pat_has_delay && !(self.reverse && km1 > 0 && self.has_transfer_buffers);
        let base_ready_add = if self.reverse && is_train { train_need } else { min_t };

        let mut cur: i32 = -1;
        let mut row: usize = 0;
        let mut board_pos: usize = 0;
        let mut cur_extra: i32 = 0;

        for i in start..end_pos {
            let s = stops[i] as usize;
            if cur >= 0 {
                let a = if pat_has_delay {
                    self.delays.arr_arena[times_base + row + i]
                } else {
                    net.all_arr[times_base + row + i]
                };
                // Dla a >= *bound_val zachodzi arr_t >= ba oraz base_val >= bv,
                // więc zarówno check_target, jak i poprawa etykiety zawsze odpadają.
                if a < *bound_val {
                    if self.egress_sec[s] >= 0 {
                        self.check_target(
                            net,
                            k,
                            p,
                            cur as usize,
                            board_pos,
                            i,
                            s,
                            a,
                            latest_arr,
                            wr,
                            bound_val,
                            cands,
                        );
                    }
                    if (!is_last_round || self.can_walk_to_dest[s] != 0) && a < *bound_val {
                        let ready = a + base_ready_add + cur_extra;
                        let row_tau = &self.tau[s];
                        let mut best_s = row_tau[0];
                        for r in 1..=k {
                            if row_tau[r] < best_s {
                                best_s = row_tau[r];
                            }
                        }
                        if ready < best_s {
                            self.tau[s][k] = ready;
                            let id = kk + s;
                            self.p_type[id] = 2;
                            self.labels[id] = LabelMeta {
                                arr_at: a,
                                p_a: p as i32,
                                p_b: cur,
                                p_c: board_pos as i32,
                                p_d: i as i32,
                            };
                            if self.improved_flag[s] == 0 {
                                self.improved_flag[s] = 1;
                                self.improved_list[self.improved_count] = s;
                                self.improved_count += 1;
                            }
                            if !is_last_round {
                                self.mark(s);
                            }
                        }
                    }
                }
            }
            if i < end_pos - 1 && self.tau[s][km1] < INF {
                if fast_fifo {
                    if cur != 0 {
                        let r = self.board_ready(net, km1, s, is_train, min_t, train_need);
                        let dep = &net.all_dep[times_base..times_base + n_trips * n];
                        if cur < 0 {
                            if dep[(n_trips - 1) * n + i] >= r {
                                let j = lower_bound_trips(dep, n, n_trips, i, r);
                                if j < n_trips {
                                    cur = j as i32;
                                    row = j * n;
                                    board_pos = i;
                                    cur_extra = if self.reverse { 0 } else { self.get_tb(net, p, j) };
                                }
                            }
                        } else {
                            let cur_u = cur as usize;
                            let cur_dep = dep[row + i];
                            // Szybki test FIFO: bez binary searcha, gdy poprzedni kurs już odjechał.
                            if r <= cur_dep && dep[(cur_u - 1) * n + i] >= r {
                                let j = lower_bound_trips(dep, n, cur_u, i, r);
                                if j < cur_u && dep[j * n + i] < cur_dep {
                                    cur = j as i32;
                                    row = j * n;
                                    board_pos = i;
                                    cur_extra = if self.reverse { 0 } else { self.get_tb(net, p, j) };
                                }
                            }
                        }
                    }
                } else {
                    let r = self.board_ready(net, km1, s, is_train, min_t, train_need);
                    let cur_dep = if cur >= 0 {
                        if pat_has_delay {
                            self.delays.dep_arena[times_base + row + i]
                        } else {
                            net.all_dep[times_base + row + i]
                        }
                    } else {
                        INF
                    };
                    if cur < 0 || r <= cur_dep {
                        let j = self.earliest_trip(net, p, i, r, km1 > 0);
                        if j >= 0 {
                            let j_usize = j as usize;
                            let new_dep = if pat_has_delay {
                                self.delays.dep_arena[times_base + j_usize * n + i]
                            } else {
                                net.all_dep[times_base + j_usize * n + i]
                            };
                            if cur < 0 || new_dep < cur_dep {
                                cur = j;
                                row = j_usize * n;
                                board_pos = i;
                                cur_extra = if self.reverse { 0 } else { self.get_tb(net, p, j_usize) };
                            }
                        }
                    }
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn relax_footpaths(
        &mut self,
        net: &CompiledNet,
        fp_dur: &[i32],
        k: usize,
        is_last_round: bool,
        min_t: i32,
        train_need: i32,
        latest_arr: i32,
        bound_val: i32,
        cands: &mut Vec<ICand>,
    ) {
        let count = self.improved_count;
        if count == 0 {
            return;
        }
        let n_stops = net.n_stops;
        let kk = k * n_stops;
        self.improved_count = 0;

        for x in 0..count {
            let s = self.improved_list[x];
            self.improved_flag[s] = 0;
            if s >= net.fp_count || self.p_type[kk + s] != 2 {
                continue;
            }
            let lbl = self.labels[kk + s];
            let src = lbl.arr_at;
            if src >= bound_val {
                continue;
            }
            let p = lbl.p_a as usize;
            let need = if self.reverse && net.patterns[p].kind == KIND_TRAIN { train_need } else { min_t };
            let src_buf = if self.reverse { 0 } else { self.get_tb(net, p, lbl.p_b as usize) };
            let src_egress = self.egress_sec[s];
            let start = net.fp_start[s] as usize;
            let end = net.fp_start[s + 1] as usize;
            for e in start..end {
                let w = fp_dur[e];
                if w < 0 {
                    continue;
                }
                let arr_to = src + w;
                if arr_to >= bound_val {
                    continue;
                }
                let to = net.fp_to[e] as usize;
                let dest_egress = self.egress_sec[to];
                if is_last_round && dest_egress < 0 {
                    continue;
                }
                let ready = src + need.max(w + TRANSFER_WALK_SLACK_SEC) + src_buf;
                let row_tau = &self.tau[to];
                let mut best_s = row_tau[0];
                for r in 1..=k {
                    if row_tau[r] < best_s {
                        best_s = row_tau[r];
                    }
                }
                if ready >= best_s {
                    continue;
                }
                self.tau[to][k] = ready;
                let id = kk + to;
                self.p_type[id] = 3;
                self.labels[id] = LabelMeta {
                    arr_at: arr_to,
                    p_a: s as i32,
                    p_b: w,
                    p_c: src,
                    p_d: 0,
                };
                if !is_last_round {
                    self.mark(to);
                }

                // Spacer zamiast wymuszonej przesiadki: cel sprawdzany jest
                // tylko przy wysiadaniu z kursu, więc bez tego każda podróż
                // musiała kończyć się pojazdem i przesiadka na 1 przystanek
                // wygrywała z dojściem z buta. Gdy dojście pieszo z końca
                // kursu trafia na przystanek pod celem, dołóż wariant
                // „koniec pieszo”.
                if dest_egress >= 0
                    && (src_egress < 0 || w + dest_egress < src_egress)
                    && arr_to + dest_egress <= latest_arr
                {
                    if let Some(legs) = self.backtrack(net, k, s) {
                        if !self.pointless(net, legs.as_slice(), to) {
                            cands.push(ICand {
                                legs,
                                dest: to,
                                walk_out: Some((s, w, 20.max(net.fp_dist_m[e]))),
                            });
                        }
                    }
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn run_iteration(
        &mut self,
        net: &CompiledNet,
        fp_dur: &[i32],
        tau0: i32,
        trigger_stops: Option<&[usize]>,
        r_max: usize,
        min_t: i32,
        train_need: i32,
        latest_arr: i32,
        wr: f64,
        cands: &mut Vec<ICand>,
    ) {
        for i in 0..self.origin_list.len() {
            let o = self.origin_list[i];
            let v = tau0 + self.access_sec[o];
            if v < self.tau[o][0] {
                self.tau[o][0] = v;
                self.p_type[o] = 1;
                self.labels[o].arr_at = v;
            }
        }
        self.mark_count = 0;
        if let Some(triggers) = trigger_stops {
            for &s in triggers {
                self.mark(s);
            }
        } else {
            for i in 0..self.origin_list.len() {
                let o = self.origin_list[i];
                self.mark(o);
            }
        }

        for k in 1..=r_max {
            let is_last_round = k == r_max;
            let mut q_count = 0;
            let m_count = self.mark_count;
            self.mark_count = 0;
            for m in 0..m_count {
                let s = self.mark_list[m];
                self.marked[s] = 0;
                if s >= net.sp_count {
                    continue;
                }
                let start = net.sp_start[s] as usize;
                let end = net.sp_start[s + 1] as usize;
                for e in start..end {
                    let p = net.sp_pat[e] as usize;
                    if self.enabled[p] == 0 {
                        continue;
                    }
                    let pos = net.sp_pos[e];
                    if is_last_round {
                        if pos >= self.last_dest_pos[p] {
                            continue;
                        }
                    } else if (pos as usize) >= net.patterns[p].n as usize - 1 {
                        continue;
                    }
                    let qp = self.queue[p];
                    if qp < 0 {
                        self.queue[p] = pos;
                        self.queued[q_count] = p;
                        q_count += 1;
                    } else if pos < qp {
                        self.queue[p] = pos;
                    }
                }
            }
            if q_count == 0 {
                break;
            }
            let mut bound_val = self.best_val[1];
            for r in 2..=k {
                if self.best_val[r] < bound_val {
                    bound_val = self.best_val[r];
                }
            }
            for q in 0..q_count {
                let p = self.queued[q];
                let start = self.queue[p] as usize;
                self.queue[p] = -1;
                self.scan_pattern(
                    net,
                    k,
                    is_last_round,
                    p,
                    start,
                    min_t,
                    train_need,
                    latest_arr,
                    wr,
                    &mut bound_val,
                    cands,
                );
            }
            self.relax_footpaths(
                net,
                fp_dur,
                k,
                is_last_round,
                min_t,
                train_need,
                latest_arr,
                bound_val,
                cands,
            );
            if self.mark_count == 0 {
                break;
            }
        }
        for m in 0..self.mark_count {
            let s = self.mark_list[m];
            self.marked[s] = 0;
        }
        self.mark_count = 0;
    }

    #[allow(clippy::too_many_arguments)]
    fn refine(
        &mut self,
        net: &CompiledNet,
        fp_dur: &[i32],
        c: &ICand,
        orig_arr: i32,
        min_t: i32,
        train_need: i32,
        wr: f64,
        t0: i32,
        latest_arr: i32,
    ) -> Option<ICand> {
        let c_legs = c.legs.as_slice();
        let m = c_legs.len();
        let mut offs = [0_usize; MAX_LEGS];
        let mut total_n = 0_usize;
        for li in 0..m {
            offs[li] = total_n;
            total_n += net.patterns[c_legs[li].p].n as usize;
        }
        if self.ref_b.len() < total_n {
            self.ref_b.resize(total_n, f64::INFINITY);
            self.ref_bf.resize(total_n, -1);
            self.ref_bw.resize(total_n, 0);
            self.ref_c.resize(total_n, f64::INFINITY);
            self.ref_cf.resize(total_n, -1);
        }
        self.ref_b[..total_n].fill(f64::INFINITY);
        self.ref_bf[..total_n].fill(-1);
        self.ref_bw[..total_n].fill(0);
        self.ref_c[..total_n].fill(f64::INFINITY);
        self.ref_cf[..total_n].fill(-1);

        for li in 0..m {
            let l = &c_legs[li];
            let pat = net.patterns[l.p];
            let n = pat.n as usize;
            let row = l.j * n;
            let pat_stops = net.pat_stops(l.p);
            let dep = self.delays.dep(net, l.p);
            let off = offs[li];

            if li == 0 {
                for pos in 0..(n - 1) {
                    let acc = self.access_sec[pat_stops[pos] as usize];
                    if acc < 0 {
                        continue;
                    }
                    let d = dep[row + pos];
                    if d - acc < t0 {
                        continue;
                    }
                    self.ref_b[off + pos] = wr * (acc as f64) - (d as f64);
                }
            } else {
                let prev = &c_legs[li - 1];
                let pp = net.patterns[prev.p];
                let pp_n = pp.n as usize;
                let prow = prev.j * pp_n;
                let pp_stops = net.pat_stops(prev.p);
                let parr = self.delays.arr(net, prev.p);
                let transfer_kind = if self.reverse { pp.kind } else { pat.kind };
                let need = if transfer_kind == KIND_TRAIN {
                    train_need
                } else {
                    min_t
                };
                let extra = if self.reverse {
                    self.get_tb(net, l.p, l.j)
                } else {
                    self.get_tb(net, prev.p, prev.j)
                };

                if self.pos_next.len() < n {
                    self.pos_next.resize(n, -1);
                }
                for pos in (0..(n - 1)).rev() {
                    let s = pat_stops[pos] as usize;
                    self.pos_next[pos] = self.pos_head[s];
                    self.pos_head[s] = pos as i32;
                }

                let prev_off = offs[li - 1];
                for a in 1..pp_n {
                    let cv = self.ref_c[prev_off + a];
                    if cv == f64::INFINITY {
                        continue;
                    }
                    let s = pp_stops[a] as usize;
                    let t = parr[prow + a];

                    // Direct transfer at stop s
                    let mut p_idx = self.pos_head[s];
                    let ready_direct = t + need + extra;
                    while p_idx >= 0 {
                        let pos = p_idx as usize;
                        if dep[row + pos] >= ready_direct && cv < self.ref_b[off + pos] {
                            self.ref_b[off + pos] = cv;
                            self.ref_bf[off + pos] = a as i32;
                            self.ref_bw[off + pos] = 0;
                        }
                        p_idx = self.pos_next[pos];
                    }

                    // Footpath transfers from stop s
                    if s < net.fp_count {
                        let start = net.fp_start[s] as usize;
                        let end = net.fp_start[s + 1] as usize;
                        for e in start..end {
                            let w = fp_dur[e];
                            if w < 0 {
                                continue;
                            }
                            let to = net.fp_to[e] as usize;
                            let mut fp_pos = self.pos_head[to];
                            if fp_pos < 0 {
                                continue;
                            }
                            let ready_fp = t + need.max(w + TRANSFER_WALK_SLACK_SEC) + extra;
                            let val_fp = cv + (wr - 1.0) * (w as f64);
                            while fp_pos >= 0 {
                                let pos = fp_pos as usize;
                                if dep[row + pos] >= ready_fp && val_fp < self.ref_b[off + pos] {
                                    self.ref_b[off + pos] = val_fp;
                                    self.ref_bf[off + pos] = a as i32;
                                    self.ref_bw[off + pos] = w;
                                }
                                fp_pos = self.pos_next[pos];
                            }
                        }
                    }
                }

                for pos in 0..(n - 1) {
                    self.pos_head[pat_stops[pos] as usize] = -1;
                }
            }

            let mut run = f64::INFINITY;
            let mut run_pos: i32 = -1;
            for pos in 0..n {
                if pos > 0 && run < f64::INFINITY {
                    self.ref_c[off + pos] = run;
                    self.ref_cf[off + pos] = run_pos;
                }
                let bv = self.ref_b[off + pos];
                if bv < run {
                    run = bv;
                    run_pos = pos as i32;
                }
            }
        }

        let last = &c_legs[m - 1];
        let lp = net.patterns[last.p];
        let lp_n = lp.n as usize;
        let lrow = last.j * lp_n;
        let lp_stops = net.pat_stops(last.p);
        let larr = self.delays.arr(net, last.p);
        let arr_cap = latest_arr.min(orig_arr + MAX_REFINE_LATER_SEC);
        let last_off = offs[m - 1];
        let mut best_total = f64::INFINITY;
        let mut best_a: i32 = -1;

        for a in 1..lp_n {
            let cv = self.ref_c[last_off + a];
            if cv == f64::INFINITY {
                continue;
            }
            let s = lp_stops[a] as usize;
            let e = self.egress_sec[s];
            if e < 0 {
                continue;
            }
            let t = larr[lrow + a];
            if t + e > arr_cap {
                continue;
            }
            let total = cv + (t as f64) + wr * (e as f64);
            if total < best_total - 1e-6 {
                best_total = total;
                best_a = a as i32;
            }
        }
        if best_a < 0 {
            return None;
        }

        let mut legs = SmallLegs::new();
        legs.len = m as u8;
        let mut a = best_a as usize;
        for li in (0..m).rev() {
            let l = &c_legs[li];
            let off = offs[li];
            let b_idx = self.ref_cf[off + a];
            if b_idx < 0 {
                return None;
            }
            let b_usize = b_idx as usize;
            legs.data[li] = ILeg {
                p: l.p,
                j: l.j,
                b: b_usize,
                a,
                walk_in: if li > 0 { self.ref_bw[off + b_usize] } else { 0 },
            };
            if li > 0 {
                let prev_a = self.ref_bf[off + b_usize];
                if prev_a < 0 {
                    return None;
                }
                a = prev_a as usize;
            }
        }

        Some(ICand {
            legs,
            dest: lp_stops[best_a as usize] as usize,
            walk_out: None,
        })
    }
}

#[inline]
fn foot_distance_m(net: &CompiledNet, from: usize, to: usize, walk_sec: i32) -> i32 {
    if from < net.fp_count {
        let start = net.fp_start[from] as usize;
        let end = net.fp_start[from + 1] as usize;
        for e in start..end {
            if net.fp_to[e] as usize == to {
                return 20.max(net.fp_dist_m[e]);
            }
        }
    }
    20.max(js_round((walk_sec as f64) * DEFAULT_WALK_SPEED_MPS))
}

thread_local! {
    static SCRATCH: RefCell<RaptorScratch> = RefCell::new(RaptorScratch::new());
}

pub fn execute_query_bytes(bytes: &[u8]) -> Vec<u8> {
    let words = execute_query_words(bytes);
    let mut out = Vec::with_capacity(words.len() * 4);
    for w in words {
        out.extend_from_slice(&w.to_le_bytes());
    }
    out
}

pub fn execute_query_words(bytes: &[u8]) -> Vec<i32> {
    let Some(q) = QueryInput::from_packed_bytes(bytes) else {
        return vec![STATUS_BAD_INPUT];
    };
    let net_opt = registry().read().ok().and_then(|g| g.get(q.net_id));
    let Some(net) = net_opt else {
        return vec![STATUS_NET_MISSING];
    };
    run_on_net(&net, &q)
}

// Przyjazd odwraca zegar i kierunek sieci; wynik wraca w kolejności od startu do celu.
pub fn run_on_net(net: &CompiledNet, q: &QueryInput) -> Vec<i32> {
    if !q.arrive_by {
        return run_forward(net, q);
    }
    let reverse_q = QueryInput {
        t0: -q.t0,
        latest_arr: INF,
        origins: q.destinations.clone(),
        destinations: q.origins.clone(),
        delays: q.delays.iter().filter_map(|&(p, j, d)| {
            let pat = net.patterns.get(p)?;
            let nt = pat.n_trips as usize;
            (j < nt).then(|| (p, nt - 1 - j, d))
        }).collect(),
        transfer_buffers: q.transfer_buffers.iter().filter_map(|&(p, j, d)| {
            let pat = net.patterns.get(p)?;
            let nt = pat.n_trips as usize;
            (j < nt).then(|| (p, nt - 1 - j, d))
        }).collect(),
        ..q.clone()
    };
    let reversed = run_forward(net.reversed(), &reverse_q);
    let mut out = vec![0];
    let mut pos = 1;
    while pos + 7 <= reversed.len() {
        let header = &reversed[pos..pos + 7];
        let count = header[6] as usize;
        let end = pos + 7 + count * 8;
        if end + 3 > reversed.len() || count == 0 {
            break;
        }
        // Końcowe dojście pieszo z odwróconego przebiegu to w oryginale
        // dojście do przystanku przed pierwszym kursem: sklej je z egressem
        // w jedno access walk, żeby struktura nóg wyszła naturalnie.
        let walk_from = reversed[end];
        let walk_sec = reversed[end + 1];
        let walk_m = reversed[end + 2];
        let legs: Vec<_> = reversed[pos + 7..end].chunks_exact(8).collect();
        // Pierwotne dojście i odejście zamieniają się miejscami wraz z czasem.
        if -legs[0][6] + header[2] <= q.t0 {
            let (first_stop, access_sec, access_m) = if walk_from >= 0 && walk_sec > 0 {
                (walk_from, header[4] + walk_sec, header[5] + walk_m)
            } else {
                (header[0], header[4], header[5])
            };
            out.extend_from_slice(&[header[1], first_stop, access_sec, access_m, header[2], header[3], header[6]]);
            for i in (0..count).rev() {
                let l = legs[i];
                let pat = net.patterns[l[0] as usize];
                let walk = legs.get(i + 1);
                out.extend_from_slice(&[
                    l[0], pat.n_trips as i32 - 1 - l[1],
                    pat.n as i32 - 1 - l[3], pat.n as i32 - 1 - l[2],
                    walk.map_or(0, |l| l[4]), walk.map_or(0, |l| l[5]), -l[7], -l[6],
                ]);
            }
            // Dojście zostało już wchłonięte w access: brak osobnej nogi.
            out.extend_from_slice(&[-1, 0, 0]);
            out[0] += 1;
        }
        pos = end + 3;
    }
    out
}

fn run_forward(net: &CompiledNet, q: &QueryInput) -> Vec<i32> {
    if q.origins.is_empty() || q.destinations.is_empty() {
        return vec![0];
    }

    let fp_dur = net.foot_durations(q.speed_mps, q.max_transfer_walk_m);
    let n_stops = net.n_stops;
    let n_pat = net.patterns.len();
    let r_max = q.max_transfers + 1;
    let rs = r_max + 1;

    SCRATCH.with(|cell| {
        let mut s = cell.borrow_mut();
        s.prepare(n_stops, n_pat, rs);
        s.reverse = q.arrive_by;

        for p in 0..n_pat {
            let kind = net.patterns[p].kind;
            // KIND_SUBWAY celowo wpada w ostatnią gałąź: działa w trybie
            // „wszystkie” i nie zależy od żadnego przełącznika (metro to nie
            // pociąg regionalny), a filtry tram/bus go nie przepuszczają.
            let ok = if kind == KIND_TRAIN {
                q.trains_enabled && q.allowed_mode == ALLOWED_ALL
            } else if kind == KIND_CABLE {
                q.cable_enabled && q.allowed_mode == ALLOWED_ALL
            } else if q.allowed_mode != ALLOWED_ALL {
                (q.allowed_mode == ALLOWED_TRAM && kind == KIND_TRAM)
                    || (q.allowed_mode == ALLOWED_BUS && kind == KIND_BUS)
            } else {
                true
            };
            s.enabled[p] = u8::from(ok);
        }

        s.delays.build(net, &q.delays, q.now_sec, q.arrive_by);
        s.has_transfer_buffers = false;
        if !q.transfer_buffers.is_empty() {
            s.tb_epoch = s.tb_epoch.wrapping_add(1);
            if s.tb_epoch == 0 {
                s.tb_stamp.fill(0);
                s.tb_epoch = 1;
            }
            if s.tb_stamp.len() < net.total_trips {
                s.tb_stamp.resize(net.total_trips, 0);
                s.tb_val.resize(net.total_trips, 0);
            }
            let epoch = s.tb_epoch;
            for &(p, j, extra) in &q.transfer_buffers {
                if p < n_pat && j < net.patterns[p].n_trips as usize {
                    let idx = net.patterns[p].trip_off as usize + j;
                    s.tb_stamp[idx] = epoch;
                    s.tb_val[idx] = extra;
                    s.has_transfer_buffers = true;
                }
            }
        }

        for &(stop, walk_sec, walk_m) in &q.origins {
            if stop >= n_stops {
                continue;
            }
            let w = walk_sec.max(0);
            if s.access_sec[stop] < 0 {
                s.origin_list.push(stop);
                s.access_sec[stop] = w;
                s.access_m[stop] = walk_m;
            } else if w < s.access_sec[stop] {
                s.access_sec[stop] = w;
                s.access_m[stop] = walk_m;
            }
        }
        for &(stop, walk_sec, walk_m) in &q.destinations {
            if stop >= n_stops {
                continue;
            }
            let w = walk_sec.max(0);
            if s.egress_sec[stop] < 0 {
                s.dest_list.push(stop);
                s.egress_sec[stop] = w;
                s.egress_m[stop] = walk_m;
            } else if w < s.egress_sec[stop] {
                s.egress_sec[stop] = w;
                s.egress_m[stop] = walk_m;
            }
        }
        if s.origin_list.is_empty() || s.dest_list.is_empty() {
            return vec![0];
        }
        // Zachowaj deterministyczną kolejność przystanków startowych jak skan 0..n_stops.
        s.origin_list.sort_unstable();

        // Target pruning ostatniej rundy: wyznaczamy przystanki z dojściem pieszym do celu
        // oraz najdalszą pozycję docelową (lub sąsiadującą z celem) na każdym wzorcu.
        for i in 0..s.dest_list.len() {
            let d = s.dest_list[i];
            let r_start = net.rev_fp_start[d] as usize;
            let r_end = net.rev_fp_start[d + 1] as usize;
            for re in r_start..r_end {
                let edge = net.rev_fp_edge[re] as usize;
                if fp_dur[edge] < 0 {
                    continue;
                }
                let from = net.rev_fp_from[re] as usize;
                if s.can_walk_to_dest[from] == 0 {
                    s.can_walk_to_dest[from] = 1;
                    s.walk_to_dest_list.push(from);
                }
            }
            if d < net.sp_count {
                let sp_s = net.sp_start[d] as usize;
                let sp_e = net.sp_start[d + 1] as usize;
                for e in sp_s..sp_e {
                    let p = net.sp_pat[e] as usize;
                    let pos = net.sp_pos[e];
                    if pos > s.last_dest_pos[p] {
                        s.last_dest_pos[p] = pos;
                    }
                }
            }
        }
        for i in 0..s.walk_to_dest_list.len() {
            let ws = s.walk_to_dest_list[i];
            if ws < net.sp_count {
                let sp_s = net.sp_start[ws] as usize;
                let sp_e = net.sp_start[ws + 1] as usize;
                for e in sp_s..sp_e {
                    let p = net.sp_pat[e] as usize;
                    let pos = net.sp_pos[e];
                    if pos > s.last_dest_pos[p] {
                        s.last_dest_pos[p] = pos;
                    }
                }
            }
        }

        let lo = q.t0;
        let hi = q.t0 + q.window_sec;
        let mut triggers: Vec<(i32, usize)> = Vec::new();

        if q.window_sec > 0 {
            for i in 0..s.origin_list.len() {
                let o = s.origin_list[i];
                if o >= net.sp_count {
                    continue;
                }
                let acc = s.access_sec[o];
                let start = net.sp_start[o] as usize;
                let end = net.sp_start[o + 1] as usize;
                for e in start..end {
                    let p = net.sp_pat[e] as usize;
                    if s.enabled[p] == 0 {
                        continue;
                    }
                    let pos = net.sp_pos[e] as usize;
                    let pat = &net.patterns[p];
                    let pat_n = pat.n as usize;
                    let pat_trips = pat.n_trips as usize;
                    if pos >= pat_n - 1 {
                        continue;
                    }
                    let sched_dep = net.pat_dep(p);
                    let eff_dep = s.delays.dep(net, p);
                    let late = if s.delays.any_delay { s.delays.late_max[p] } else { 0 };
                    let early = if s.delays.any_delay { s.delays.early_max[p] } else { 0 };
                    let from = lower_bound_trips(sched_dep, pat_n, pat_trips, pos, lo + acc - late);
                    for j in from..pat_trips {
                        if sched_dep[j * pat_n + pos] - early - acc >= hi {
                            break;
                        }
                        let tau0 = eff_dep[j * pat_n + pos] - acc;
                        if tau0 >= lo && tau0 < hi {
                            triggers.push((tau0, o));
                        }
                    }
                }
            }

            triggers.sort_unstable_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
            triggers.dedup();
        }

        let mut cands: Vec<ICand> = Vec::new();
        s.run_iteration(
            net,
            &fp_dur,
            hi,
            None,
            r_max,
            q.min_t,
            q.train_need,
            q.latest_arr,
            q.wr,
            &mut cands,
        );

        let mut x = 0;
        let mut group: Vec<usize> = Vec::new();
        while x < triggers.len() {
            let t = triggers[x].0;
            group.clear();
            while x < triggers.len() && triggers[x].0 == t {
                group.push(triggers[x].1);
                x += 1;
            }
            s.run_iteration(
                net,
                &fp_dur,
                t,
                Some(&group),
                r_max,
                q.min_t,
                q.train_need,
                q.latest_arr,
                q.wr,
                &mut cands,
            );
        }

        if cands.is_empty() {
            return vec![0];
        }

        let mut by_chain_idx: HashMap<ChainKey, usize, FxBuildHasher> =
            HashMap::with_capacity_and_hasher(cands.len(), FxBuildHasher::default());
        let mut unique_cands: Vec<CandInfo> = Vec::with_capacity(cands.len());

        for c in cands {
            let legs = c.legs.as_slice();
            let first = &legs[0];
            let last = &legs[legs.len() - 1];
            let first_stop = net.pat_stops(first.p)[first.b] as usize;
            let access = s.access_sec[first_stop];
            let egress = s.egress_sec[c.dest];
            let walk_out_sec = c.walk_out.map(|(_, wsec, _)| wsec).unwrap_or(0);
            let first_dep = s.delays.dep(net, first.p)[first.j * net.patterns[first.p].n as usize + first.b];
            let last_arr = s.delays.arr(net, last.p)[last.j * net.patterns[last.p].n as usize + last.a];
            let dep = q.t0.max(first_dep - access);
            let arr = last_arr + walk_out_sec + egress;
            let mut walk_sec = access + egress + walk_out_sec;
            let mut uncertainty = 0.0_f64;
            for l in legs {
                walk_sec += l.walk_in;
                if s.has_tb(net, l.p, l.j) {
                    uncertainty += 120.0;
                }
            }
            let transfers = (legs.len() - 1) as i32;
            let time = if q.latest_arr < INF {
                q.latest_arr - dep
            } else {
                arr - q.t0
            };
            let cost_v = (time as f64)
                + (q.wr - 1.0) * (walk_sec as f64)
                + (transfers as f64) * (q.transfer_penalty_sec as f64)
                + uncertainty;
            let ci = CandInfo {
                c,
                arr,
                cost: cost_v,
            };
            let key = ChainKey::from_legs(legs);
            if let Some(&idx) = by_chain_idx.get(&key) {
                if ci.cost < unique_cands[idx].cost {
                    unique_cands[idx] = ci;
                }
            } else {
                by_chain_idx.insert(key, unique_cands.len());
                unique_cands.push(ci);
            }
        }

        unique_cands.sort_by(|x, y| x.cost.partial_cmp(&y.cost).unwrap_or(Ordering::Equal));
        if unique_cands.len() > REFINE_LIMIT {
            unique_cands.truncate(REFINE_LIMIT);
        }

        let mut seen: HashSet<FullKey, FxBuildHasher> =
            HashSet::with_capacity_and_hasher(unique_cands.len(), FxBuildHasher::default());
        let mut out_words: Vec<i32> = Vec::with_capacity(1 + unique_cands.len() * 24);
        out_words.push(0); // placeholder for candidate count
        let mut count = 0_i32;

        for ci in unique_cands {
            // Dojście końcowe nie pasuje do refina (ten optymalizuje tylko
            // wysiadanie z kursu), więc warianty „koniec pieszo” idą jak są.
            let refined = if ci.c.walk_out.is_some() {
                ci.c
            } else {
                s.refine(
                    net,
                    &fp_dur,
                    &ci.c,
                    ci.arr,
                    q.min_t,
                    q.train_need,
                    q.wr,
                    q.t0,
                    q.latest_arr,
                )
                .unwrap_or(ci.c)
            };

            let key = FullKey::from_cand(&refined);
            if !seen.insert(key) {
                continue;
            }
            let refined_legs = refined.legs.as_slice();
            if refined_legs.is_empty() {
                continue;
            }

            let first = &refined_legs[0];
            let first_stop = net.pat_stops(first.p)[first.b] as usize;
            let access_sec = s.access_sec[first_stop];
            let access_m = s.access_m[first_stop];
            let egress_sec = s.egress_sec[refined.dest];
            let egress_m = s.egress_m[refined.dest];

            out_words.push(refined.dest as i32);
            out_words.push(first_stop as i32);
            out_words.push(access_sec);
            out_words.push(access_m);
            out_words.push(egress_sec);
            out_words.push(egress_m);
            out_words.push(refined_legs.len() as i32);

            let mut prev_stop: Option<usize> = None;
            for l in refined_legs {
                let pat = &net.patterns[l.p];
                let row = l.j * pat.n as usize;
                let pat_stops = net.pat_stops(l.p);
                let from = pat_stops[l.b] as usize;
                let to = pat_stops[l.a] as usize;
                let walk_in_m = match prev_stop {
                    Some(ps) if ps != from => foot_distance_m(net, ps, from, l.walk_in),
                    _ => 0,
                };
                let dep_sec = s.delays.dep(net, l.p)[row + l.b];
                let arr_sec = s.delays.arr(net, l.p)[row + l.a];

                out_words.push(l.p as i32);
                out_words.push(l.j as i32);
                out_words.push(l.b as i32);
                out_words.push(l.a as i32);
                out_words.push(l.walk_in);
                out_words.push(walk_in_m);
                out_words.push(dep_sec);
                out_words.push(arr_sec);

                prev_stop = Some(to);
            }

            // Trzeba pamiętać: dojście końcowe (3 słowa) zawsze, żeby dekod po
            // stronie TS mógł je spakować w nogę spacerową.
            let (walk_from, walk_wsec, walk_wm) = match refined.walk_out {
                Some((from, wsec, wm)) => (from as i32, wsec, wm),
                None => (-1, 0, 0),
            };
            out_words.push(walk_from);
            out_words.push(walk_wsec);
            out_words.push(walk_wm);
            count += 1;
        }

        out_words[0] = count;
        out_words
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delay_prediction_matches_spec() {
        assert_eq!(predict_delay_sec(300, 0, true), 300);
        assert_eq!(predict_delay_sec(300, 15 * 60, true), 150);
        assert!(predict_delay_sec(300, 15 * 60, false) > predict_delay_sec(300, 15 * 60, true));
        assert_eq!(predict_delay_sec(-400, 600, true), -120);
        assert!(predict_delay_sec(-120, 30 * 60, false).abs() <= 2);
        assert_eq!(predict_delay_sec(0, 600, true), 0);
    }

    #[test]
    fn refine_prefers_staying_on_tram_over_early_alight() {
        // S0..S4 along a single tram line; S3->S4 takes 400s on tram vs ~343s walk.
        // With walkReluctance >= 1.8, refine must keep riding to S4.
        let mut net_words = vec![
            NET_MAGIC, 5, // n_stops
            5, // fp_count
            2, // fp_total (S3<->S4)
            1, // n_pat
            5, // sp_count
            5, // sp_total
            // fp_start (6)
            0, 0, 0, 0, 1, 2, // fp_to (2): S3->S4, S4->S3
            4, 3, // fp_dist_m (2)
            400, 400, // fp_fixed_sec (2)
            0, 0, // sp_start (6)
            0, 1, 2, 3, 4, 5, // sp_pat (5)
            0, 0, 0, 0, 0, // sp_pos (5)
            0, 1, 2, 3, 4, // pattern 0: tram, 5 stops, 1 trip
            0, 5, 1, // stops
            0, 1, 2, 3, 4,
        ];
        let start = 8 * 3600;
        let times = [start, start + 120, start + 240, start + 360, start + 760];
        net_words.extend_from_slice(&times);
        net_words.extend_from_slice(&times);

        let mut net_bytes = Vec::with_capacity(net_words.len() * 4);
        for w in net_words {
            net_bytes.extend_from_slice(&w.to_le_bytes());
        }
        assert!(load_network(101, &net_bytes));

        let speed_bits = DEFAULT_WALK_SPEED_MPS.to_bits();
        let wr_bits = 1.8_f64.to_bits();
        let query_words = vec![
            QUERY_MAGIC,
            101,
            start - 60,
            0,
            2,
            120,
            300,
            1,
            1,
            ALLOWED_ALL,
            speed_bits as u32 as i32,
            (speed_bits >> 32) as u32 as i32,
            800,
            wr_bits as u32 as i32,
            (wr_bits >> 32) as u32 as i32,
            600,
            INF,
            0,
            0,
            1, // n_origins
            2, // n_destinations (S3 with 343s walk, S4 with 30s walk)
            0, // n_delays
            // origin: S0, 30s, 0m
            0,
            30,
            0,
            // dests: S3 (343s, 400m), S4 (30s, 0m)
            3,
            343,
            400,
            4,
            30,
            0,
        ];
        let mut q_bytes = Vec::with_capacity(query_words.len() * 4);
        for w in query_words {
            q_bytes.extend_from_slice(&w.to_le_bytes());
        }
        let res = execute_query_words(&q_bytes);
        assert!(res[0] >= 1);
        // Candidate 0 dest should be S4 (stop index 4), leg 0 alight pos should be 4
        assert_eq!(res[1], 4);
        let alight_pos = res[1 + 7 + 3];
        assert_eq!(alight_pos, 4);
    }

    /// Sieć z jednym wzorcem (2 przystanki, 1 kurs). Służy do sprawdzenia
    /// bramki `trains_enabled`: metro ma własny KIND_SUBWAY i NIE może
    /// zależeć od przełącznika pociągów. Ten test to regression guard na
    /// wypadek, gdyby ktoś kiedyś złączył metro z powrotem z KIND_TRAIN.
    fn build_single_pattern_net(net_id: i32, kind: u8) -> i32 {
        let start = 8 * 3600;
        let mut words = vec![
            NET_MAGIC, 2, // n_stops
            0, // fp_count
            0, // fp_total
            1, // n_pat
            2, // sp_count
            2, // sp_total
            // fp_start (fp_count + 1 = 1)
            0,
            // sp_start (3)
            0, 1, 2,
            // sp_pat (2)
            0, 0,
            // sp_pos (2)
            0, 1,
            // pattern 0: kind, 2 stops, 1 trip
            kind as i32, 2, 1,
            // stops
            0, 1,
            // dep times
            start, start + 300,
            // arr times
            start, start + 300,
        ];
        let mut bytes = Vec::with_capacity(words.len() * 4);
        for w in words.drain(..) {
            bytes.extend_from_slice(&w.to_le_bytes());
        }
        assert!(load_network(net_id, &bytes));
        start
    }

    fn run_simple_query(net_id: i32, start: i32, trains_enabled: i32) -> Vec<i32> {
        let speed_bits = DEFAULT_WALK_SPEED_MPS.to_bits();
        let wr_bits = 1.8_f64.to_bits();
        let words = vec![
            QUERY_MAGIC,
            net_id,
            start - 60, // t0
            3600,       // window_sec
            2,          // max_transfers
            60,         // min_t
            300,        // train_need
            trains_enabled,
            1,           // cable_enabled
            ALLOWED_ALL, // allowed_mode
            speed_bits as u32 as i32,
            (speed_bits >> 32) as u32 as i32,
            800, // max_transfer_walk_m
            wr_bits as u32 as i32,
            (wr_bits >> 32) as u32 as i32,
            600, // transfer_penalty_sec
            INF, // latest_arr
            0,   // has_now
            0,   // now_val
            1,   // n_origins
            1,   // n_destinations
            0,   // n_delays
            // origin: S0, bez dojścia
            0, 0, 0,
            // dest: S1, bez dojścia
            1, 0, 0,
        ];
        let mut bytes = Vec::with_capacity(words.len() * 4);
        for w in words {
            bytes.extend_from_slice(&w.to_le_bytes());
        }
        execute_query_words(&bytes)
    }

    #[test]
    fn arrive_by_includes_egress_and_preserves_forward_leg_times() {
        let start = build_single_pattern_net(904, KIND_BUS);
        let net = registry().read().unwrap().get(904).unwrap();
        let mut q = QueryInput {
            arrive_by: true,
            net_id: 904,
            t0: start + 390,
            window_sec: 3600,
            max_transfers: 2,
            min_t: 120,
            train_need: 300,
            trains_enabled: true,
            cable_enabled: true,
            allowed_mode: ALLOWED_ALL,
            speed_mps: DEFAULT_WALK_SPEED_MPS,
            max_transfer_walk_m: 800,
            wr: 1.8,
            transfer_penalty_sec: 300,
            latest_arr: INF,
            now_sec: None,
            origins: vec![(0, 90, 20)],
            destinations: vec![(1, 90, 20)],
            delays: Vec::new(),
            transfer_buffers: Vec::new(),
        };
        let result = run_on_net(&net, &q);
        assert_eq!(result[0], 1);
        assert_eq!(&result[1..8], &[1, 0, 90, 20, 90, 20, 1]);
        assert_eq!(&result[8..16], &[0, 0, 0, 1, 0, 0, start, start + 300]);
        assert_eq!(&result[16..19], &[-1, 0, 0]);
        q.t0 -= 1;
        assert_eq!(run_on_net(&net, &q), vec![0]);
    }

    #[test]
    fn terminal_walk_replaces_forced_short_transfer() {
        // S0 --kurs--> S1, dalej pieszo do S2 pod celem. Bez końca pieszo
        // podróż nie mogła się skończyć na przystanku S2 (cel sprawdzany
        // wyłącznie przy wysiadaniu), więc planer wymuszał przesiadkę
        // na ostatni przystanek. Teraz wariant „koniec pieszo” wygrywa.
        let start = 8 * 3600;
        let mut words = vec![
            NET_MAGIC,
            3, // n_stops
            2, // fp_count
            1, // fp_total (S1->S2)
            1, // n_pat
            3, // sp_count
            2, // sp_total
            // fp_start (fp_count+1 = 3)
            0, 0, 1,
            // fp_to (1)
            2,
            // fp_dist_m (1)
            160,
            // fp_fixed_sec (1)
            0,
            // sp_start (4)
            0, 1, 2, 2,
            // sp_pat (2)
            0, 0,
            // sp_pos (2)
            0, 1,
            // pattern 0: tram, 2 przystanki, 1 kurs
            KIND_TRAM as i32,
            2,
            1,
            // stops
            0, 1,
        ];
        for t in [start, start + 300] {
            words.push(t);
        }
        for t in [start, start + 300] {
            words.push(t);
        }
        let mut bytes = Vec::with_capacity(words.len() * 4);
        for w in words {
            bytes.extend_from_slice(&w.to_le_bytes());
        }
        assert!(load_network(705, &bytes));

        let net = registry().read().unwrap().get(705).unwrap();
        let q = QueryInput {
            arrive_by: false,
            net_id: 705,
            t0: start - 60,
            window_sec: 3600,
            max_transfers: 1,
            min_t: 60,
            train_need: 300,
            trains_enabled: true,
            cable_enabled: true,
            allowed_mode: ALLOWED_ALL,
            speed_mps: DEFAULT_WALK_SPEED_MPS,
            max_transfer_walk_m: 800,
            wr: 1.8,
            transfer_penalty_sec: 300,
            latest_arr: INF,
            now_sec: None,
            origins: vec![(0, 30, 0)],
            destinations: vec![(2, 30, 0)],
            delays: Vec::new(),
            transfer_buffers: Vec::new(),
        };
        let out = run_on_net(&net, &q);

        assert_eq!(out[0], 1);
        assert_eq!(out[1], 2, "cel musi być S2 - koniec podróży na spacerze");
        assert_eq!(&out[1..8], &[2, 0, 30, 0, 30, 0, 1]);
        assert_eq!(&out[8..16], &[0, 0, 0, 1, 0, 0, start, start + 300]);
        // Trailing: skąd (S1), ~137 s, ~160 m
        assert_eq!(out[16], 1);
        assert_eq!(out[17], 137);
        assert_eq!(out[18], 160);
    }

    #[test]
    fn subway_ignores_trains_toggle() {
        let start = build_single_pattern_net(901, KIND_SUBWAY);
        let with_trains = run_simple_query(901, start, 1);
        assert!(with_trains[0] >= 1, "metro musi działać z włączonymi pociągami");
        assert_eq!(with_trains[1], 1);
        assert_eq!(with_trains[1 + 7 + 3], 1);

        let without_trains = run_simple_query(901, start, 0);
        assert!(
            without_trains[0] >= 1,
            "wyłączenie pociągów nie może gasić metra (KIND_SUBWAY)"
        );
        assert_eq!(without_trains[1 + 7 + 3], 1);
    }

    #[test]
    fn train_respects_trains_toggle() {
        let start = build_single_pattern_net(902, KIND_TRAIN);
        assert!(run_simple_query(902, start, 1)[0] >= 1);
        assert_eq!(run_simple_query(902, start, 0)[0], 0);
    }

    #[test]
    fn subway_excluded_from_narrow_mode_filters() {
        let start = build_single_pattern_net(903, KIND_SUBWAY);
        for allowed in [ALLOWED_TRAM, ALLOWED_BUS] {
            let speed_bits = DEFAULT_WALK_SPEED_MPS.to_bits();
            let wr_bits = 1.8_f64.to_bits();
            let words = vec![
                QUERY_MAGIC,
                903,
                start - 60,
                3600,
                2,
                60,
                300,
                1,
                1,
                allowed,
                speed_bits as u32 as i32,
                (speed_bits >> 32) as u32 as i32,
                800,
                wr_bits as u32 as i32,
                (wr_bits >> 32) as u32 as i32,
                600,
                INF,
                0,
                0,
                1,
                1,
                0,
                0, 0, 0,
                1, 0, 0,
            ];
            let mut bytes = Vec::with_capacity(words.len() * 4);
            for w in words {
                bytes.extend_from_slice(&w.to_le_bytes());
            }
            let res = execute_query_words(&bytes);
            assert_eq!(res[0], 0, "metro nie może wejść w filtr tram/bus");
        }
    }

    #[test]
    fn transfer_buffer_delays_next_boarding_forward_and_arrive_by() {
        // S0 -> S1 (wzorzec 0, 1 kurs: 8:00..8:05), S1 -> S2 (wzorzec 1, 2 kursy: 8:07..8:12 i 8:10..8:15).
        // Przy min_t = 120s kurs 8:07 jest łapany normalnie (8:05 + 120s = 8:07),
        // ale z transfer_buffer = 180s na (0, 0) gotowość to 8:10, więc musi złapać kurs 8:10.
        let start = 8 * 3600;
        let words = vec![
            NET_MAGIC, 3, 0, 0, 2, 3, 4,
            0, // fp_start
            0, 1, 3, 4, // sp_start: S0:[0], S1:[0,1], S2:[1]
            0, 0, 1, 1, // sp_pat
            0, 1, 0, 1, // sp_pos
            // pattern 0: bus, 2 stops, 1 trip
            KIND_BUS as i32, 2, 1, 0, 1,
            start, start + 300,
            start, start + 300,
            // pattern 1: bus, 2 stops, 2 trips
            KIND_BUS as i32, 2, 2, 1, 2,
            start + 420, start + 720, start + 600, start + 900,
            start + 420, start + 720, start + 600, start + 900,
        ];
        let mut bytes = Vec::with_capacity(words.len() * 4);
        for w in words {
            bytes.extend_from_slice(&w.to_le_bytes());
        }
        assert!(load_network(905, &bytes));
        let net = registry().read().unwrap().get(905).unwrap();

        let base_q = QueryInput {
            arrive_by: false,
            net_id: 905,
            t0: start - 60,
            window_sec: 1800,
            max_transfers: 2,
            min_t: 120,
            train_need: 300,
            trains_enabled: true,
            cable_enabled: true,
            allowed_mode: ALLOWED_ALL,
            speed_mps: DEFAULT_WALK_SPEED_MPS,
            max_transfer_walk_m: 800,
            wr: 1.8,
            transfer_penalty_sec: 300,
            latest_arr: INF,
            now_sec: None,
            origins: vec![(0, 0, 0)],
            destinations: vec![(2, 0, 0)],
            delays: Vec::new(),
            transfer_buffers: Vec::new(),
        };

        let no_buf = run_on_net(&net, &base_q);
        assert_eq!(no_buf[0], 1);
        // Leg 1 to kurs 0 (8:07..8:12)
        assert_eq!(no_buf[1 + 7 + 8 + 1], 0);
        assert_eq!(no_buf[1 + 7 + 8 + 6], start + 420);

        let mut with_buf = base_q.clone();
        with_buf.transfer_buffers = vec![(0, 0, 180)];
        let res_buf = run_on_net(&net, &with_buf);
        assert_eq!(res_buf[0], 1);
        // Leg 1 musi przeskoczyć na kurs 1 (8:10..8:15)
        assert_eq!(res_buf[1 + 7 + 8 + 1], 1);
        assert_eq!(res_buf[1 + 7 + 8 + 6], start + 600);

        // Ten sam przypadek w trybie arrive_by z terminem 8:12 (powinien nie zdążyć przez bufor) vs 8:15
        let mut arr_tight = with_buf.clone();
        arr_tight.arrive_by = true;
        arr_tight.t0 = start + 720;
        assert_eq!(run_on_net(&net, &arr_tight)[0], 0);

        let mut arr_ok = arr_tight;
        arr_ok.t0 = start + 900;
        let res_arr = run_on_net(&net, &arr_ok);
        assert_eq!(res_arr[0], 1);
        assert_eq!(res_arr[1 + 7 + 8 + 1], 1);
    }
}
