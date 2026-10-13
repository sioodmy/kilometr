#![forbid(unsafe_code)]

use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock, RwLock};

pub const NET_MAGIC: i32 = 0x5241_5031; // "RAP1"
pub const QUERY_MAGIC: i32 = 0x5251_5231; // "RQR1"
pub const STATUS_NET_MISSING: i32 = -1;
pub const STATUS_BAD_INPUT: i32 = -2;

pub const INF: i32 = 0x3fff_ffff;
pub const DEFAULT_WALK_SPEED_MPS: f64 = 1.34;
pub const WALK_DETOUR_FACTOR: f64 = 1.15;
pub const MAX_TRANSFER_WALK_M: i32 = 800;
pub const CATCH_SLACK_SEC: i32 = 60;
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

#[derive(Clone, Copy)]
pub struct PatternMeta {
    pub kind: u8,
    pub n: usize,
    pub n_trips: usize,
    pub stops_off: usize,
    pub times_off: usize,
}

pub struct CompiledNet {
    pub n_stops: usize,
    pub fp_count: usize,
    pub fp_start: Vec<i32>,
    pub fp_to: Vec<i32>,
    pub fp_dist_m: Vec<i32>,
    pub fp_fixed_sec: Vec<i32>,
    pub sp_count: usize,
    pub sp_start: Vec<i32>,
    pub sp_pat: Vec<i32>,
    pub sp_pos: Vec<i32>,
    pub patterns: Vec<PatternMeta>,
    pub all_stops: Vec<i32>,
    pub all_dep: Vec<i32>,
    pub all_arr: Vec<i32>,
    fp_dur_cache: Mutex<Vec<(u64, i32, Arc<Vec<i32>>)>>,
}

impl CompiledNet {
    #[inline]
    pub fn pat_stops(&self, p: usize) -> &[i32] {
        let meta = &self.patterns[p];
        &self.all_stops[meta.stops_off..meta.stops_off + meta.n]
    }

    #[inline]
    pub fn pat_dep(&self, p: usize) -> &[i32] {
        let meta = &self.patterns[p];
        let len = meta.n_trips * meta.n;
        &self.all_dep[meta.times_off..meta.times_off + len]
    }

    #[inline]
    pub fn pat_arr(&self, p: usize) -> &[i32] {
        let meta = &self.patterns[p];
        let len = meta.n_trips * meta.n;
        &self.all_arr[meta.times_off..meta.times_off + len]
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
        let mut out = vec![0_i32; total];
        for e in 0..total {
            let fixed = self.fp_fixed_sec[e];
            if fixed > 0 {
                out[e] = fixed;
            } else if self.fp_dist_m[e] > max_m {
                out[e] = -1;
            } else {
                let d = ((self.fp_dist_m[e] as f64) * WALK_DETOUR_FACTOR) / speed_mps;
                out[e] = MIN_FOOTPATH_SEC.max(js_round(d));
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

        let mut patterns = Vec::with_capacity(n_pat);
        let mut all_stops = Vec::new();
        let mut all_dep = Vec::new();
        let mut all_arr = Vec::new();

        for _ in 0..n_pat {
            let kind_raw = r.next()?;
            let kind = match kind_raw {
                0 => KIND_TRAM,
                1 => KIND_BUS,
                2 => KIND_TRAIN,
                3 => KIND_CABLE,
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

            r.read_into(&mut all_stops, n)?;
            for &s in &all_stops[stops_off..stops_off + n] {
                if s < 0 || (s as usize) >= n_stops {
                    return None;
                }
            }
            r.read_into(&mut all_dep, times_len)?;
            r.read_into(&mut all_arr, times_len)?;

            patterns.push(PatternMeta {
                kind,
                n,
                n_trips,
                stops_off,
                times_off,
            });
        }

        for i in 0..sp_total {
            let p = sp_pat[i];
            let pos = sp_pos[i];
            if p < 0 || (p as usize) >= n_pat {
                return None;
            }
            if pos < 0 || (pos as usize) >= patterns[p as usize].n {
                return None;
            }
        }

        Some(Self {
            n_stops,
            fp_count,
            fp_start,
            fp_to,
            fp_dist_m,
            fp_fixed_sec,
            sp_count,
            sp_start,
            sp_pat,
            sp_pos,
            patterns,
            all_stops,
            all_dep,
            all_arr,
            fp_dur_cache: Mutex::new(Vec::with_capacity(4)),
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
        if self.pos.checked_add(byte_len)? > self.bytes.len() {
            return None;
        }
        out.reserve(count);
        for _ in 0..count {
            let b = &self.bytes[self.pos..self.pos + 4];
            self.pos += 4;
            out.push(i32::from_le_bytes([b[0], b[1], b[2], b[3]]));
        }
        Some(())
    }
}

pub struct QueryInput {
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
}

impl QueryInput {
    pub fn from_packed_bytes(bytes: &[u8]) -> Option<Self> {
        let mut r = WordReader::new(bytes)?;
        if r.next()? != QUERY_MAGIC {
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

        Some(Self {
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
        })
    }
}

#[derive(Clone, Copy)]
struct ILeg {
    p: usize,
    j: usize,
    b: usize,
    a: usize,
    walk_in: i32,
}

#[derive(Clone)]
struct ICand {
    legs: Vec<ILeg>,
    dest: usize,
}

#[derive(Clone)]
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
        let len = c.legs.len().min(4);
        for (i, l) in c.legs.iter().take(len).enumerate() {
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
    pat_offset: Vec<u32>,
    late_max: Vec<i32>,
    early_max: Vec<i32>,
    dep_arena: Vec<i32>,
    arr_arena: Vec<i32>,
}

impl DelayOverlay {
    fn new() -> Self {
        Self {
            pat_offset: Vec::new(),
            late_max: Vec::new(),
            early_max: Vec::new(),
            dep_arena: Vec::new(),
            arr_arena: Vec::new(),
        }
    }

    fn build(&mut self, net: &CompiledNet, delays: &[(usize, usize, i32)], now_sec: Option<i32>) {
        let n_pat = net.patterns.len();
        self.pat_offset.clear();
        self.pat_offset.resize(n_pat, u32::MAX);
        self.late_max.clear();
        self.late_max.resize(n_pat, 0);
        self.early_max.clear();
        self.early_max.resize(n_pat, 0);
        self.dep_arena.clear();
        self.arr_arena.clear();

        for &(p, j, d0) in delays {
            if d0 == 0 || p >= n_pat {
                continue;
            }
            let pat = &net.patterns[p];
            if j >= pat.n_trips {
                continue;
            }
            let base_off = if self.pat_offset[p] == u32::MAX {
                let off = self.dep_arena.len();
                self.dep_arena.extend_from_slice(net.pat_dep(p));
                self.arr_arena.extend_from_slice(net.pat_arr(p));
                self.pat_offset[p] = off as u32;
                off
            } else {
                self.pat_offset[p] as usize
            };

            let n = pat.n;
            let sched_dep = net.pat_dep(p);
            let sched_arr = net.pat_arr(p);
            let vehicle_at = now_sec.map(|now| now - d0);

            for i in 0..n {
                let k = j * n + i;
                let sd = sched_dep[k];
                let sa = sched_arr[k];
                let db = match vehicle_at {
                    None => d0,
                    Some(va) => predict_delay_sec(d0, sd - va, true),
                };
                let da = match vehicle_at {
                    None => d0,
                    Some(va) => predict_delay_sec(d0, sa - va, false),
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
        self.pat_offset[p] != u32::MAX
    }

    #[inline]
    fn dep<'a>(&'a self, net: &'a CompiledNet, p: usize) -> &'a [i32] {
        let off = self.pat_offset[p];
        if off == u32::MAX {
            net.pat_dep(p)
        } else {
            let meta = &net.patterns[p];
            let start = off as usize;
            &self.dep_arena[start..start + meta.n_trips * meta.n]
        }
    }

    #[inline]
    fn arr<'a>(&'a self, net: &'a CompiledNet, p: usize) -> &'a [i32] {
        let off = self.pat_offset[p];
        if off == u32::MAX {
            net.pat_arr(p)
        } else {
            let meta = &net.patterns[p];
            let start = off as usize;
            &self.arr_arena[start..start + meta.n_trips * meta.n]
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

struct RaptorScratch {
    enabled: Vec<u8>,
    access_sec: Vec<i32>,
    access_m: Vec<i32>,
    egress_sec: Vec<i32>,
    egress_m: Vec<i32>,
    origin_list: Vec<usize>,
    tau: Vec<i32>,
    arr_at: Vec<i32>,
    p_type: Vec<u8>,
    p_a: Vec<i32>,
    p_b: Vec<i32>,
    p_c: Vec<i32>,
    p_d: Vec<i32>,
    best_arr: Vec<i32>,
    best_val: Vec<i32>,
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
    delays: DelayOverlay,
}

impl RaptorScratch {
    fn new() -> Self {
        Self {
            enabled: Vec::new(),
            access_sec: Vec::new(),
            access_m: Vec::new(),
            egress_sec: Vec::new(),
            egress_m: Vec::new(),
            origin_list: Vec::new(),
            tau: Vec::new(),
            arr_at: Vec::new(),
            p_type: Vec::new(),
            p_a: Vec::new(),
            p_b: Vec::new(),
            p_c: Vec::new(),
            p_d: Vec::new(),
            best_arr: Vec::new(),
            best_val: Vec::new(),
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
            delays: DelayOverlay::new(),
        }
    }

    fn prepare(&mut self, n_stops: usize, n_pat: usize, rs: usize) {
        self.enabled.clear();
        self.enabled.resize(n_pat, 0);

        self.access_sec.clear();
        self.access_sec.resize(n_stops, -1);
        self.access_m.clear();
        self.access_m.resize(n_stops, 0);

        self.egress_sec.clear();
        self.egress_sec.resize(n_stops, -1);
        self.egress_m.clear();
        self.egress_m.resize(n_stops, 0);

        self.origin_list.clear();

        let total = rs * n_stops;
        self.tau.clear();
        self.tau.resize(total, INF);
        self.arr_at.clear();
        self.arr_at.resize(total, INF);
        self.p_type.clear();
        self.p_type.resize(total, 0);
        self.p_a.clear();
        self.p_a.resize(total, 0);
        self.p_b.clear();
        self.p_b.resize(total, 0);
        self.p_c.clear();
        self.p_c.resize(total, 0);
        self.p_d.clear();
        self.p_d.resize(total, 0);

        self.best_arr.clear();
        self.best_arr.resize(rs, INF);
        self.best_val.clear();
        self.best_val.resize(rs, INF);

        self.marked.clear();
        self.marked.resize(n_stops, 0);
        self.mark_list.clear();
        self.mark_list.resize(n_stops, 0);
        self.mark_count = 0;

        self.improved_flag.clear();
        self.improved_flag.resize(n_stops, 0);
        self.improved_list.clear();
        self.improved_list.resize(n_stops, 0);
        self.improved_count = 0;

        self.queue.clear();
        self.queue.resize(n_pat, -1);
        self.queued.clear();
        self.queued.resize(n_pat, 0);

        self.pos_head.clear();
        self.pos_head.resize(n_stops, -1);
    }

    #[inline]
    fn mark(&mut self, s: usize) {
        if self.marked[s] == 0 {
            self.marked[s] = 1;
            self.mark_list[self.mark_count] = s;
            self.mark_count += 1;
        }
    }

    fn backtrack(&self, net: &CompiledNet, round: usize, stop: usize) -> Option<Vec<ILeg>> {
        let n_stops = net.n_stops;
        let mut legs: Vec<ILeg> = Vec::with_capacity(round);
        let mut k = round;
        let mut s = stop;
        let mut walk_in = 0;
        for _guard in 0..32 {
            let id = k * n_stops + s;
            let t = self.p_type[id];
            if t == 1 {
                if let Some(first) = legs.first_mut() {
                    first.walk_in = 0;
                }
                return Some(legs);
            }
            if t == 3 {
                walk_in = self.p_b[id];
                s = self.p_a[id] as usize;
                continue;
            }
            if t != 2 || k == 0 {
                return None;
            }
            let p = self.p_a[id] as usize;
            if let Some(first) = legs.first_mut() {
                first.walk_in = walk_in;
            }
            walk_in = 0;
            let b_pos = self.p_c[id] as usize;
            legs.insert(
                0,
                ILeg {
                    p,
                    j: self.p_b[id] as usize,
                    b: b_pos,
                    a: self.p_d[id] as usize,
                    walk_in: 0,
                },
            );
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
    fn board_ready(
        &self,
        n_stops: usize,
        km1: usize,
        s: usize,
        is_train: bool,
        min_t: i32,
        train_need: i32,
    ) -> i32 {
        let id = km1 * n_stops + s;
        let r = self.tau[id];
        if km1 == 0 || !is_train || train_need <= min_t {
            return r;
        }
        if self.p_type[id] == 3 {
            return r.max(self.p_c[id] + train_need.max(self.p_b[id] + TRANSFER_WALK_SLACK_SEC));
        }
        r.max(self.arr_at[id] + train_need)
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
        let val_t = a + js_round(wr * (e as f64));
        let mut ba = INF;
        let mut bv = INF;
        for r in 1..=k {
            if self.best_arr[r] < ba {
                ba = self.best_arr[r];
            }
            if self.best_val[r] < bv {
                bv = self.best_val[r];
            }
        }
        if arr_t >= ba && val_t >= bv {
            return;
        }
        let b_stop = net.pat_stops(p)[b_pos] as usize;
        let Some(mut legs) = self.backtrack(net, k - 1, b_stop) else {
            return;
        };
        legs.push(ILeg {
            p,
            j,
            b: b_pos,
            a: a_pos,
            walk_in: 0,
        });
        if legs.len() > 1 {
            let id = (k - 1) * net.n_stops + b_stop;
            let walk_in = if self.p_type[id] == 3 { self.p_b[id] } else { 0 };
            if let Some(last) = legs.last_mut() {
                last.walk_in = walk_in;
            }
        }
        if self.pointless(net, &legs, s) {
            return;
        }
        cands.push(ICand { legs, dest: s });
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
    fn earliest_trip(&self, net: &CompiledNet, p: usize, pos: usize, r: i32) -> i32 {
        let pat = &net.patterns[p];
        let n = pat.n;
        let n_trips = pat.n_trips;
        if !self.delays.has_delay(p) {
            let dep = net.pat_dep(p);
            let j = lower_bound_trips(dep, n, n_trips, pos, r);
            return if j < n_trips { j as i32 } else { -1 };
        }
        let sched = net.pat_dep(p);
        let dep = self.delays.dep(net, p);
        let early = self.delays.early_max[p];
        let late = self.delays.late_max[p];
        let mut best: i32 = -1;
        let mut best_t: i32 = INF;
        let start = lower_bound_trips(sched, n, n_trips, pos, r - late);
        for j in start..n_trips {
            if sched[j * n + pos] - early > best_t {
                break;
            }
            let t = dep[j * n + pos];
            if t >= r && t < best_t {
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
        let n = pat.n;
        let stops = net.pat_stops(p);
        let is_train = pat.kind == KIND_TRAIN;
        let n_stops = net.n_stops;
        let kk = k * n_stops;
        let km1 = k - 1;
        let km1_base = km1 * n_stops;
        let mut cur: i32 = -1;
        let mut row: usize = 0;
        let mut board_pos: usize = 0;

        for i in start..n {
            let s = stops[i] as usize;
            if cur >= 0 {
                let a = self.delays.arr(net, p)[row + i];
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
                if a < *bound_val {
                    let ready = a + min_t;
                    let mut best_s = INF;
                    for r in 0..=k {
                        let v = self.tau[r * n_stops + s];
                        if v < best_s {
                            best_s = v;
                        }
                    }
                    if ready < best_s {
                        let id = kk + s;
                        self.tau[id] = ready;
                        self.arr_at[id] = a;
                        self.p_type[id] = 2;
                        self.p_a[id] = p as i32;
                        self.p_b[id] = cur;
                        self.p_c[id] = board_pos as i32;
                        self.p_d[id] = i as i32;
                        if self.improved_flag[s] == 0 {
                            self.improved_flag[s] = 1;
                            self.improved_list[self.improved_count] = s;
                            self.improved_count += 1;
                        }
                        self.mark(s);
                    }
                }
            }
            if i < n - 1 && self.tau[km1_base + s] < INF {
                let r = self.board_ready(n_stops, km1, s, is_train, min_t, train_need);
                let cur_dep = if cur >= 0 {
                    self.delays.dep(net, p)[row + i]
                } else {
                    INF
                };
                if cur < 0 || r <= cur_dep {
                    let j = self.earliest_trip(net, p, i, r);
                    if j >= 0 {
                        let j_usize = j as usize;
                        let new_dep = self.delays.dep(net, p)[j_usize * n + i];
                        if cur < 0 || new_dep < cur_dep {
                            cur = j;
                            row = j_usize * n;
                            board_pos = i;
                        }
                    }
                }
            }
        }
    }

    fn relax_footpaths(
        &mut self,
        net: &CompiledNet,
        fp_dur: &[i32],
        k: usize,
        min_t: i32,
        bound_val: i32,
    ) {
        let n_stops = net.n_stops;
        let kk = k * n_stops;
        let count = self.improved_count;
        self.improved_count = 0;

        for x in 0..count {
            let s = self.improved_list[x];
            self.improved_flag[s] = 0;
            if s >= net.fp_count || self.p_type[kk + s] != 2 {
                continue;
            }
            let src = self.arr_at[kk + s];
            if src >= bound_val {
                continue;
            }
            let start = net.fp_start[s] as usize;
            let end = net.fp_start[s + 1] as usize;
            for e in start..end {
                let w = fp_dur[e];
                if w < 0 {
                    continue;
                }
                let to = net.fp_to[e] as usize;
                if src + w >= bound_val {
                    continue;
                }
                let ready = src + min_t.max(w + TRANSFER_WALK_SLACK_SEC);
                let mut best_s = INF;
                for r in 0..=k {
                    let v = self.tau[r * n_stops + to];
                    if v < best_s {
                        best_s = v;
                    }
                }
                if ready >= best_s {
                    continue;
                }
                let id = kk + to;
                self.tau[id] = ready;
                self.arr_at[id] = src + w;
                self.p_type[id] = 3;
                self.p_a[id] = s as i32;
                self.p_b[id] = w;
                self.p_c[id] = src;
                self.mark(to);
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
            if v < self.tau[o] {
                self.tau[o] = v;
                self.arr_at[o] = v;
                self.p_type[o] = 1;
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
                    if (pos as usize) >= net.patterns[p].n - 1 {
                        continue;
                    }
                    if self.queue[p] < 0 {
                        self.queue[p] = pos;
                        self.queued[q_count] = p;
                        q_count += 1;
                    } else if pos < self.queue[p] {
                        self.queue[p] = pos;
                    }
                }
            }
            if q_count == 0 {
                break;
            }
            let mut bound_val = INF;
            for r in 1..=k {
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
            self.relax_footpaths(net, fp_dur, k, min_t, bound_val);
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
        let m = c.legs.len();
        let mut b_mat: Vec<Vec<f64>> = Vec::with_capacity(m);
        let mut b_from: Vec<Vec<i32>> = Vec::with_capacity(m);
        let mut b_walk: Vec<Vec<i32>> = Vec::with_capacity(m);
        let mut c_mat: Vec<Vec<f64>> = Vec::with_capacity(m);
        let mut c_from: Vec<Vec<i32>> = Vec::with_capacity(m);

        for li in 0..m {
            let l = &c.legs[li];
            let pat = net.patterns[l.p];
            let n = pat.n;
            let row = l.j * n;
            let pat_stops = net.pat_stops(l.p);
            let dep = self.delays.dep(net, l.p);
            let mut b = vec![f64::INFINITY; n];
            let mut bf = vec![-1_i32; n];
            let mut bw = vec![0_i32; n];

            if li == 0 {
                for pos in 0..(n - 1) {
                    let acc = self.access_sec[pat_stops[pos] as usize];
                    if acc < 0 {
                        continue;
                    }
                    let d = dep[row + pos];
                    if d - acc < t0 - CATCH_SLACK_SEC {
                        continue;
                    }
                    b[pos] = wr * (acc as f64) - (d as f64);
                }
            } else {
                let prev = &c.legs[li - 1];
                let pp = net.patterns[prev.p];
                let prow = prev.j * pp.n;
                let pp_stops = net.pat_stops(prev.p);
                let parr = self.delays.arr(net, prev.p);
                let need = if pat.kind == KIND_TRAIN {
                    train_need
                } else {
                    min_t
                };

                if self.pos_next.len() < n {
                    self.pos_next.resize(n, -1);
                }
                for pos in (0..(n - 1)).rev() {
                    let s = pat_stops[pos] as usize;
                    self.pos_next[pos] = self.pos_head[s];
                    self.pos_head[s] = pos as i32;
                }

                let cp = &c_mat[li - 1];
                for a in 1..pp.n {
                    let cv = cp[a];
                    if cv == f64::INFINITY {
                        continue;
                    }
                    let s = pp_stops[a] as usize;
                    let t = parr[prow + a];

                    // Direct transfer at stop s
                    let mut p_idx = self.pos_head[s];
                    let ready_direct = t + need;
                    while p_idx >= 0 {
                        let pos = p_idx as usize;
                        if dep[row + pos] >= ready_direct && cv < b[pos] {
                            b[pos] = cv;
                            bf[pos] = a as i32;
                            bw[pos] = 0;
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
                            let ready_fp = t + need.max(w + TRANSFER_WALK_SLACK_SEC);
                            let val_fp = cv + (wr - 1.0) * (w as f64);
                            let mut fp_pos = self.pos_head[to];
                            while fp_pos >= 0 {
                                let pos = fp_pos as usize;
                                if dep[row + pos] >= ready_fp && val_fp < b[pos] {
                                    b[pos] = val_fp;
                                    bf[pos] = a as i32;
                                    bw[pos] = w;
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

            let mut c_arr = vec![f64::INFINITY; n];
            let mut cf = vec![-1_i32; n];
            let mut run = f64::INFINITY;
            let mut run_pos: i32 = -1;
            for pos in 0..n {
                if pos > 0 && run < f64::INFINITY {
                    c_arr[pos] = run;
                    cf[pos] = run_pos;
                }
                if b[pos] < run {
                    run = b[pos];
                    run_pos = pos as i32;
                }
            }
            b_mat.push(b);
            b_from.push(bf);
            b_walk.push(bw);
            c_mat.push(c_arr);
            c_from.push(cf);
        }

        let last = &c.legs[m - 1];
        let lp = net.patterns[last.p];
        let lrow = last.j * lp.n;
        let lp_stops = net.pat_stops(last.p);
        let larr = self.delays.arr(net, last.p);
        let arr_cap = latest_arr.min(orig_arr + MAX_REFINE_LATER_SEC);
        let mut best_total = f64::INFINITY;
        let mut best_a: i32 = -1;

        for a in 1..lp.n {
            let cv = c_mat[m - 1][a];
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

        let mut legs = vec![
            ILeg {
                p: 0,
                j: 0,
                b: 0,
                a: 0,
                walk_in: 0,
            };
            m
        ];
        let mut a = best_a as usize;
        for li in (0..m).rev() {
            let l = &c.legs[li];
            let b_idx = c_from[li][a];
            if b_idx < 0 {
                return None;
            }
            let b_usize = b_idx as usize;
            legs[li] = ILeg {
                p: l.p,
                j: l.j,
                b: b_usize,
                a,
                walk_in: if li > 0 { b_walk[li][b_usize] } else { 0 },
            };
            if li > 0 {
                let prev_a = b_from[li][b_usize];
                if prev_a < 0 {
                    return None;
                }
                a = prev_a as usize;
            }
        }

        Some(ICand {
            legs,
            dest: lp_stops[best_a as usize] as usize,
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

pub fn run_on_net(net: &CompiledNet, q: &QueryInput) -> Vec<i32> {
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

        for p in 0..n_pat {
            let kind = net.patterns[p].kind;
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

        s.delays.build(net, &q.delays, q.now_sec);

        for &(stop, walk_sec, walk_m) in &q.origins {
            if stop >= n_stops {
                continue;
            }
            let w = walk_sec.max(0);
            if s.access_sec[stop] < 0 || w < s.access_sec[stop] {
                s.access_sec[stop] = w;
                s.access_m[stop] = walk_m;
            }
        }
        for &(stop, walk_sec, walk_m) in &q.destinations {
            if stop >= n_stops {
                continue;
            }
            let w = walk_sec.max(0);
            if s.egress_sec[stop] < 0 || w < s.egress_sec[stop] {
                s.egress_sec[stop] = w;
                s.egress_m[stop] = walk_m;
            }
        }

        for stop in 0..n_stops {
            if s.access_sec[stop] >= 0 {
                s.origin_list.push(stop);
            }
        }
        if s.origin_list.is_empty() {
            return vec![0];
        }

        let lo = q.t0 - CATCH_SLACK_SEC;
        let hi = q.t0 + q.window_sec;
        let mut triggers: Vec<(i32, usize)> = Vec::new();

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
                if pos >= pat.n - 1 {
                    continue;
                }
                let sched_dep = net.pat_dep(p);
                let eff_dep = s.delays.dep(net, p);
                let late = s.delays.late_max[p];
                let early = s.delays.early_max[p];
                let from = lower_bound_trips(sched_dep, pat.n, pat.n_trips, pos, lo + acc - late);
                for j in from..pat.n_trips {
                    if sched_dep[j * pat.n + pos] - early - acc >= hi {
                        break;
                    }
                    let tau0 = eff_dep[j * pat.n + pos] - acc;
                    if tau0 >= lo && tau0 < hi {
                        triggers.push((tau0, o));
                    }
                }
            }
        }

        triggers.sort_by(|a, b| b.0.cmp(&a.0));

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

        let mut by_chain_idx: HashMap<ChainKey, usize> = HashMap::with_capacity(cands.len());
        let mut unique_cands: Vec<CandInfo> = Vec::with_capacity(cands.len());

        for c in cands {
            let first = &c.legs[0];
            let last = &c.legs[c.legs.len() - 1];
            let first_stop = net.pat_stops(first.p)[first.b] as usize;
            let access = s.access_sec[first_stop];
            let egress = s.egress_sec[c.dest];
            let first_dep = s.delays.dep(net, first.p)[first.j * net.patterns[first.p].n + first.b];
            let last_arr = s.delays.arr(net, last.p)[last.j * net.patterns[last.p].n + last.a];
            let dep = q.t0.max(first_dep - access);
            let arr = last_arr + egress;
            let mut walk_sec = access + egress;
            for l in &c.legs {
                walk_sec += l.walk_in;
            }
            let transfers = (c.legs.len() - 1) as i32;
            let time = if q.latest_arr < INF {
                q.latest_arr - dep
            } else {
                arr - q.t0
            };
            let cost_v = (time as f64)
                + (q.wr - 1.0) * (walk_sec as f64)
                + (transfers as f64) * (q.transfer_penalty_sec as f64);
            let ci = CandInfo {
                c,
                arr,
                cost: cost_v,
            };
            let key = ChainKey::from_legs(&ci.c.legs);
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

        let mut seen: HashSet<FullKey> = HashSet::with_capacity(unique_cands.len());
        let mut out_words: Vec<i32> = Vec::with_capacity(1 + unique_cands.len() * 24);
        out_words.push(0); // placeholder for candidate count
        let mut count = 0_i32;

        for ci in unique_cands {
            let refined = s
                .refine(
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
                .unwrap_or(ci.c);

            let key = FullKey::from_cand(&refined);
            if !seen.insert(key) {
                continue;
            }
            if refined.legs.is_empty() {
                continue;
            }

            let first = &refined.legs[0];
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
            out_words.push(refined.legs.len() as i32);

            let mut prev_stop: Option<usize> = None;
            for l in &refined.legs {
                let pat = &net.patterns[l.p];
                let row = l.j * pat.n;
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
}
