#![forbid(unsafe_code)]

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::sync::{Mutex, OnceLock};

pub const FOOT_QUERY_MAGIC: u32 = 0x464F_4F54; // "FOOT"
pub const RAIL_QUERY_MAGIC: u32 = 0x5241_494C; // "RAIL"
pub const TRAM_QUERY_MAGIC: u32 = 0x5452_414D; // "TRAM"
pub const SUBW_QUERY_MAGIC: u32 = 0x5355_4257; // "SUBW"
pub const BUS_QUERY_MAGIC: u32 = 0x4255_5320; // "BUS "

const TILE_ZOOM: u32 = 14;
const DEFAULT_EXTENT: i32 = 4096;
const MAX_CACHED_TILES: usize = 128;

const BRUNNEL_SURFACE: u8 = 0;
const BRUNNEL_BRIDGE: u8 = 1;
const BRUNNEL_TUNNEL: u8 = 2;

const SEG_FLAG_RESTRICTED: u8 = 1 << 0;
const SEG_FLAG_P1_END: u8 = 1 << 1;
const SEG_FLAG_P2_END: u8 = 1 << 2;
const SEG_FLAG_MAJOR: u8 = 1 << 3;
const SEG_FLAG_BUSWAY: u8 = 1 << 4;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RouteProfile {
    Foot,
    Rail,
    Tram,
    Subway,
    Bus,
}

#[derive(Clone, Copy)]
struct RawSeg {
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
    weight_milli: u16,
    layer: i8,
    brunnel: u8,
    oneway: i8,
    flags: u8,
    is_connector: bool,
}

#[derive(Clone, Copy)]
pub struct SplitSeg {
    pub x1: i32,
    pub y1: i32,
    pub x2: i32,
    pub y2: i32,
    pub weight_milli: u16,
    pub layer: i8,
    pub brunnel: u8,
    pub oneway: i8,
    pub flags: u8,
}

struct CachedFootTile {
    tx: i32,
    ty: i32,
    segs: Vec<SplitSeg>,
    rails: Vec<SplitSeg>,
    trams: Vec<SplitSeg>,
    subways: Vec<SplitSeg>,
    buses: Vec<SplitSeg>,
}

static FOOT_TILES: OnceLock<Mutex<Vec<CachedFootTile>>> = OnceLock::new();

fn tile_registry() -> &'static Mutex<Vec<CachedFootTile>> {
    FOOT_TILES.get_or_init(|| Mutex::new(Vec::with_capacity(32)))
}

pub fn has_foot_tile(tx: i32, ty: i32) -> bool {
    let Ok(guard) = tile_registry().lock() else {
        return false;
    };
    guard.iter().any(|t| t.tx == tx && t.ty == ty)
}

pub fn clear_foot_tiles() {
    if let Ok(mut guard) = tile_registry().lock() {
        guard.clear();
    }
}

pub fn load_foot_tile(tx: i32, ty: i32, mvt_bytes: &[u8]) -> bool {
    if mvt_bytes.is_empty() || tx < 0 || ty < 0 {
        return false;
    }
    let parsed = parse_mvt_transportation_all(tx, ty, mvt_bytes);
    let segs = pre_split_tile_segments(tx, ty, &parsed.foot, true);
    let rails = pre_split_tile_segments(tx, ty, &parsed.rail, false);
    let trams = pre_split_tile_segments(tx, ty, &parsed.tram, false);
    let subways = pre_split_tile_segments(tx, ty, &parsed.subway, false);
    let buses = pre_split_tile_segments(tx, ty, &parsed.bus, true);

    let Ok(mut guard) = tile_registry().lock() else {
        return false;
    };
    if let Some(pos) = guard.iter().position(|t| t.tx == tx && t.ty == ty) {
        let mut entry = guard.remove(pos);
        entry.segs = segs;
        entry.rails = rails;
        entry.trams = trams;
        entry.subways = subways;
        entry.buses = buses;
        guard.push(entry);
        return true;
    }
    if guard.len() >= MAX_CACHED_TILES {
        guard.remove(0);
    }
    guard.push(CachedFootTile {
        tx,
        ty,
        segs,
        rails,
        trams,
        subways,
        buses,
    });
    true
}

#[derive(Clone, Copy)]
enum MvtVal<'a> {
    Str(&'a [u8]),
    Int(i64),
    Bool(bool),
    Other,
}

fn read_varint(buf: &[u8], mut pos: usize) -> Option<(u64, usize)> {
    let mut val = 0_u64;
    let mut shift = 0_u32;
    while pos < buf.len() {
        let b = buf[pos];
        pos += 1;
        val |= u64::from(b & 0x7f) << shift;
        if (b & 0x80) == 0 {
            return Some((val, pos));
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
    None
}

fn skip_field(buf: &[u8], wire: u64, pos: usize) -> Option<usize> {
    match wire {
        0 => read_varint(buf, pos).map(|(_, p)| p),
        1 => pos.checked_add(8).filter(|&p| p <= buf.len()),
        2 => {
            let (len, p1) = read_varint(buf, pos)?;
            let l = usize::try_from(len).ok()?;
            p1.checked_add(l).filter(|&p| p <= buf.len())
        }
        5 => pos.checked_add(4).filter(|&p| p <= buf.len()),
        _ => None,
    }
}

#[inline]
fn unzigzag32(n: u32) -> i32 {
    ((n >> 1) as i32) ^ -((n & 1) as i32)
}

fn parse_mvt_value(buf: &[u8]) -> MvtVal<'_> {
    let mut pos = 0;
    while pos < buf.len() {
        let Some((tag, p1)) = read_varint(buf, pos) else {
            break;
        };
        pos = p1;
        let field = tag >> 3;
        let wire = tag & 7;
        match (field, wire) {
            (1, 2) => {
                if let Some((len, p2)) = read_varint(buf, pos) {
                    if let Ok(l) = usize::try_from(len) {
                        if let Some(end) = p2.checked_add(l) {
                            if end <= buf.len() {
                                return MvtVal::Str(&buf[p2..end]);
                            }
                        }
                    }
                }
                return MvtVal::Other;
            }
            (4, 0) | (5, 0) => {
                if let Some((v, _)) = read_varint(buf, pos) {
                    return MvtVal::Int(v as i64);
                }
                return MvtVal::Other;
            }
            (6, 0) => {
                if let Some((v, _)) = read_varint(buf, pos) {
                    let sv = ((v >> 1) as i64) ^ -((v & 1) as i64);
                    return MvtVal::Int(sv);
                }
                return MvtVal::Other;
            }
            (7, 0) => {
                if let Some((v, _)) = read_varint(buf, pos) {
                    return MvtVal::Bool(v != 0);
                }
                return MvtVal::Other;
            }
            _ => {
                let Some(next) = skip_field(buf, wire, pos) else {
                    break;
                };
                pos = next;
            }
        }
    }
    MvtVal::Other
}

fn is_layer_named(layer_buf: &[u8], target: &[u8]) -> bool {
    let mut pos = 0;
    while pos < layer_buf.len() {
        let Some((tag, p1)) = read_varint(layer_buf, pos) else {
            return false;
        };
        pos = p1;
        let field = tag >> 3;
        let wire = tag & 7;
        if field == 1 && wire == 2 {
            let Some((len, p2)) = read_varint(layer_buf, pos) else {
                return false;
            };
            let Ok(l) = usize::try_from(len) else {
                return false;
            };
            let Some(end) = p2.checked_add(l) else {
                return false;
            };
            return end <= layer_buf.len() && &layer_buf[p2..end] == target;
        }
        let Some(next) = skip_field(layer_buf, wire, pos) else {
            return false;
        };
        pos = next;
    }
    false
}

fn brunnel_code(brunnel: &[u8]) -> u8 {
    match brunnel {
        b"bridge" => BRUNNEL_BRIDGE,
        b"tunnel" => BRUNNEL_TUNNEL,
        _ => BRUNNEL_SURFACE,
    }
}

fn classify_pedestrian_way(
    class: &[u8],
    subclass: &[u8],
    foot: &[u8],
    access: &[u8],
    service: &[u8],
    brunnel: &[u8],
    ramp: bool,
) -> Option<(u16, bool)> {
    if matches!(
        class,
        b"rail"
            | b"transit"
            | b"motorway"
            | b"motorway_link"
            | b"trunk"
            | b"trunk_link"
            | b"aerialway"
            | b"ferry"
            | b"pier"
            | b"bridge"
            | b"raceway"
            | b"busway"
    ) {
        return None;
    }

    if matches!(foot, b"no" | b"private") {
        return None;
    }

    let foot_explicit_ok = matches!(foot, b"yes" | b"designated" | b"permissive" | b"official");
    if matches!(
        access,
        b"no" | b"private" | b"customers" | b"delivery" | b"military"
    ) && !foot_explicit_ok
    {
        return None;
    }

    let is_connector = ramp
        || !brunnel.is_empty()
        || matches!(
            subclass,
            b"steps" | b"footway" | b"pedestrian" | b"corridor" | b"crossing" | b"platform"
        );

    let weight_milli = match class {
        b"path" => match subclass {
            b"footway" | b"pedestrian" | b"living_street" | b"platform" | b"corridor"
            | b"crossing" => 900,
            b"path" => 940,
            b"steps" => 1350,
            b"cycleway" => {
                if foot_explicit_ok {
                    950
                } else {
                    1220
                }
            }
            b"bridleway" => 1150,
            _ => 950,
        },
        b"living_street" | b"pedestrian" | b"footway" => 900,
        b"minor" | b"residential" | b"unclassified" => 1000,
        b"service" => match service {
            b"alley" => 1020,
            b"parking_aisle" | b"driveway" => 1120,
            _ => 1060,
        },
        b"track" => 1080,
        b"tertiary" | b"tertiary_link" => 1060,
        b"secondary" | b"secondary_link" => 1120,
        b"primary" | b"primary_link" => 1160,
        _ => 1100,
    };

    Some((weight_milli, is_connector))
}

fn track_service_weight(service: &[u8], base: u16) -> u16 {
    match service {
        b"" => base,
        b"crossover" => base.saturating_add(70),
        b"siding" => base.saturating_add(550),
        b"spur" | b"yard" => base.saturating_add(1650),
        _ => base.saturating_add(300),
    }
}

fn classify_rail_way(class: &[u8], subclass: &[u8], service: &[u8]) -> Option<(u16, u8)> {
    if class == b"rail" && matches!(subclass, b"rail" | b"narrow_gauge" | b"light_rail" | b"") {
        let base = if subclass == b"light_rail" { 1080 } else { 1000 };
        let w = track_service_weight(service, base);
        let flags = if service.is_empty() { SEG_FLAG_MAJOR } else { 0 };
        return Some((w, flags));
    }
    if class == b"transit" && subclass == b"light_rail" {
        let w = track_service_weight(service, 1120);
        let flags = if service.is_empty() { SEG_FLAG_MAJOR } else { 0 };
        return Some((w, flags));
    }
    None
}

fn classify_tram_way(class: &[u8], subclass: &[u8], service: &[u8]) -> Option<(u16, u8)> {
    if matches!(class, b"transit" | b"rail") && matches!(subclass, b"tram" | b"light_rail") {
        let base = if subclass == b"tram" { 1000 } else { 1060 };
        let w = track_service_weight(service, base);
        let flags = if service.is_empty() { SEG_FLAG_MAJOR } else { 0 };
        return Some((w, flags));
    }
    None
}

fn classify_subway_way(class: &[u8], subclass: &[u8], service: &[u8]) -> Option<(u16, u8)> {
    if matches!(class, b"transit" | b"rail") && matches!(subclass, b"subway" | b"monorail") {
        let w = track_service_weight(service, 1000);
        let flags = if service.is_empty() { SEG_FLAG_MAJOR } else { 0 };
        return Some((w, flags));
    }
    None
}

fn classify_bus_way(
    class: &[u8],
    subclass: &[u8],
    access: &[u8],
    service: &[u8],
) -> Option<(u16, u8)> {
    if class.ends_with(b"_construction") {
        return None;
    }
    if matches!(
        service,
        b"driveway" | b"parking_aisle" | b"alley" | b"emergency_access"
    ) {
        return None;
    }

    let restricted = matches!(access, b"no" | b"private" | b"customers" | b"delivery");
    let mut flags = if restricted { SEG_FLAG_RESTRICTED } else { 0 };

    if class == b"busway" || subclass == b"busway" {
        flags |= SEG_FLAG_BUSWAY | SEG_FLAG_MAJOR;
        return Some((920, flags));
    }

    let weight = match class {
        b"primary" | b"primary_link" => {
            flags |= SEG_FLAG_MAJOR;
            1000
        }
        b"secondary" | b"secondary_link" => {
            flags |= SEG_FLAG_MAJOR;
            1020
        }
        b"trunk" | b"trunk_link" => {
            flags |= SEG_FLAG_MAJOR;
            1040
        }
        b"tertiary" | b"tertiary_link" => {
            flags |= SEG_FLAG_MAJOR;
            1050
        }
        b"motorway" | b"motorway_link" => 1080,
        // W OpenMapTiles buspasy, TAT i pętle autobusowe są eksportowane jako
        // class=service (często z access=no) bez subtagu driveway/parking_aisle.
        b"service" => {
            if restricted {
                flags |= SEG_FLAG_BUSWAY;
                1080
            } else {
                1140
            }
        }
        b"minor" | b"residential" | b"unclassified" | b"living_street" => {
            if restricted {
                // Ulice z ruchem wyłącznie dla komunikacji miejskiej (np. Trakt Królewski, Basztowa).
                1100
            } else {
                1220
            }
        }
        _ => return None,
    };

    Some((weight, flags))
}

#[allow(clippy::too_many_arguments)]
fn emit_ring_segments(
    ring: &[(i32, i32)],
    gtype: u32,
    weight_milli: u16,
    layer: i8,
    brunnel: u8,
    oneway: i8,
    base_flags: u8,
    is_connector: bool,
    allow_polygon_chords: bool,
    out: &mut Vec<RawSeg>,
) {
    if ring.len() < 2 {
        return;
    }
    let last_edge = ring.len() - 2;
    for i in 0..ring.len() - 1 {
        let (x1, y1) = ring[i];
        let (x2, y2) = ring[i + 1];
        if x1 == x2 && y1 == y2 {
            continue;
        }
        let mut flags = base_flags;
        if i == 0 {
            flags |= SEG_FLAG_P1_END;
        }
        if i == last_edge {
            flags |= SEG_FLAG_P2_END;
        }
        out.push(RawSeg {
            x1,
            y1,
            x2,
            y2,
            weight_milli,
            layer,
            brunnel,
            oneway,
            flags,
            is_connector,
        });
    }
    if allow_polygon_chords && gtype == 3 && (4..=40).contains(&ring.len()) {
        let mut min_x = i32::MAX;
        let mut max_x = i32::MIN;
        let mut min_y = i32::MAX;
        let mut max_y = i32::MIN;
        for &(x, y) in ring {
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
        }
        if (max_x - min_x) <= 450 && (max_y - min_y) <= 450 {
            let n = ring.len() - 1;
            if n >= 4 {
                let mut cx = 0_i64;
                let mut cy = 0_i64;
                for &(x, y) in &ring[..n] {
                    cx += i64::from(x);
                    cy += i64::from(y);
                }
                let center_x = (cx / (n as i64)) as i32;
                let center_y = (cy / (n as i64)) as i32;
                let step = (n / 8).max(1);
                for idx in (0..n).step_by(step) {
                    let (vx, vy) = ring[idx];
                    if vx != center_x || vy != center_y {
                        out.push(RawSeg {
                            x1: vx,
                            y1: vy,
                            x2: center_x,
                            y2: center_y,
                            weight_milli,
                            layer,
                            brunnel,
                            oneway: 0,
                            flags: base_flags | SEG_FLAG_P1_END | SEG_FLAG_P2_END,
                            is_connector: true,
                        });
                    }
                }
            }
        }
    }
}

struct ParsedTileLayers {
    foot: Vec<RawSeg>,
    rail: Vec<RawSeg>,
    tram: Vec<RawSeg>,
    subway: Vec<RawSeg>,
    bus: Vec<RawSeg>,
}

fn parse_mvt_transportation_all(tx: i32, ty: i32, mvt_bytes: &[u8]) -> ParsedTileLayers {
    let mut parsed = ParsedTileLayers {
        foot: Vec::with_capacity(4096),
        rail: Vec::with_capacity(256),
        tram: Vec::with_capacity(256),
        subway: Vec::with_capacity(64),
        bus: Vec::with_capacity(2048),
    };
    let mut pos = 0;

    while pos < mvt_bytes.len() {
        let Some((tag, p1)) = read_varint(mvt_bytes, pos) else {
            break;
        };
        pos = p1;
        let field = tag >> 3;
        let wire = tag & 7;
        if field == 3 && wire == 2 {
            let Some((len, p2)) = read_varint(mvt_bytes, pos) else {
                break;
            };
            let Ok(l) = usize::try_from(len) else {
                break;
            };
            let Some(end) = p2.checked_add(l) else {
                break;
            };
            if end > mvt_bytes.len() {
                break;
            }
            let layer_buf = &mvt_bytes[p2..end];
            pos = end;

            if !is_layer_named(layer_buf, b"transportation") {
                continue;
            }

            let mut extent = DEFAULT_EXTENT;
            let mut keys: Vec<&[u8]> = Vec::with_capacity(24);
            let mut vals: Vec<MvtVal<'_>> = Vec::with_capacity(64);
            let mut feats: Vec<&[u8]> = Vec::with_capacity(1024);

            let mut lp = 0;
            while lp < layer_buf.len() {
                let Some((ltag, lp1)) = read_varint(layer_buf, lp) else {
                    break;
                };
                lp = lp1;
                let lfield = ltag >> 3;
                let lwire = ltag & 7;
                match (lfield, lwire) {
                    (2, 2) | (3, 2) | (4, 2) => {
                        let Some((flen, lp2)) = read_varint(layer_buf, lp) else {
                            break;
                        };
                        let Ok(fl) = usize::try_from(flen) else {
                            break;
                        };
                        let Some(fend) = lp2.checked_add(fl) else {
                            break;
                        };
                        if fend > layer_buf.len() {
                            break;
                        }
                        let sub = &layer_buf[lp2..fend];
                        lp = fend;
                        if lfield == 2 {
                            feats.push(sub);
                        } else if lfield == 3 {
                            keys.push(sub);
                        } else {
                            vals.push(parse_mvt_value(sub));
                        }
                    }
                    (5, 0) => {
                        let Some((ext, lp2)) = read_varint(layer_buf, lp) else {
                            break;
                        };
                        lp = lp2;
                        if ext > 0 && ext <= 65536 {
                            extent = ext as i32;
                        }
                    }
                    _ => {
                        let Some(next) = skip_field(layer_buf, lwire, lp) else {
                            break;
                        };
                        lp = next;
                    }
                }
            }

            let base_gx = tx * DEFAULT_EXTENT;
            let base_gy = ty * DEFAULT_EXTENT;
            let mut ring_buf: Vec<(i32, i32)> = Vec::with_capacity(64);

            for feat in feats {
                let mut fp = 0;
                let mut gtype = 0_u32;
                let mut tags_slice: &[u8] = &[];
                let mut geom_slice: &[u8] = &[];

                while fp < feat.len() {
                    let Some((ftag, fp1)) = read_varint(feat, fp) else {
                        break;
                    };
                    fp = fp1;
                    let ffield = ftag >> 3;
                    let fwire = ftag & 7;
                    match (ffield, fwire) {
                        (3, 0) => {
                            let Some((gt, fp2)) = read_varint(feat, fp) else {
                                break;
                            };
                            fp = fp2;
                            gtype = gt as u32;
                        }
                        (2, 2) | (4, 2) => {
                            let Some((slen, fp2)) = read_varint(feat, fp) else {
                                break;
                            };
                            let Ok(sl) = usize::try_from(slen) else {
                                break;
                            };
                            let Some(send) = fp2.checked_add(sl) else {
                                break;
                            };
                            if send > feat.len() {
                                break;
                            }
                            if ffield == 2 {
                                tags_slice = &feat[fp2..send];
                            } else {
                                geom_slice = &feat[fp2..send];
                            }
                            fp = send;
                        }
                        _ => {
                            let Some(next) = skip_field(feat, fwire, fp) else {
                                break;
                            };
                            fp = next;
                        }
                    }
                }

                if gtype != 2 && gtype != 3 {
                    continue;
                }

                let mut class: &[u8] = &[];
                let mut subclass: &[u8] = &[];
                let mut foot: &[u8] = &[];
                let mut access: &[u8] = &[];
                let mut service: &[u8] = &[];
                let mut brunnel: &[u8] = &[];
                let mut layer_val: i8 = 0;
                let mut oneway_val: i8 = 0;
                let mut ramp = false;

                let mut tp = 0;
                while tp < tags_slice.len() {
                    let Some((k_idx, tp1)) = read_varint(tags_slice, tp) else {
                        break;
                    };
                    let Some((v_idx, tp2)) = read_varint(tags_slice, tp1) else {
                        break;
                    };
                    tp = tp2;
                    let Some(&k_name) = keys.get(k_idx as usize) else {
                        continue;
                    };
                    let Some(&v_val) = vals.get(v_idx as usize) else {
                        continue;
                    };
                    match (k_name, v_val) {
                        (b"class", MvtVal::Str(s)) => class = s,
                        (b"subclass", MvtVal::Str(s)) => subclass = s,
                        (b"foot", MvtVal::Str(s)) => foot = s,
                        (b"access", MvtVal::Str(s)) => access = s,
                        (b"service", MvtVal::Str(s)) => service = s,
                        (b"brunnel", MvtVal::Str(s)) => brunnel = s,
                        (b"layer", MvtVal::Int(n)) => {
                            layer_val = n.clamp(-10, 10) as i8;
                        }
                        (b"oneway", MvtVal::Int(n)) => {
                            oneway_val = if n > 0 {
                                1
                            } else if n < 0 {
                                -1
                            } else {
                                0
                            };
                        }
                        (b"oneway", MvtVal::Bool(b)) => {
                            if b {
                                oneway_val = 1;
                            }
                        }
                        (b"ramp", MvtVal::Bool(b)) => ramp = b,
                        (b"ramp", MvtVal::Int(n)) => ramp = n != 0,
                        _ => {}
                    }
                }

                let foot_cls =
                    classify_pedestrian_way(class, subclass, foot, access, service, brunnel, ramp);
                let rail_cls = if gtype == 2 {
                    classify_rail_way(class, subclass, service)
                } else {
                    None
                };
                let tram_cls = if gtype == 2 {
                    classify_tram_way(class, subclass, service)
                } else {
                    None
                };
                let subway_cls = if gtype == 2 {
                    classify_subway_way(class, subclass, service)
                } else {
                    None
                };
                let bus_cls = if gtype == 2 {
                    classify_bus_way(class, subclass, access, service)
                } else {
                    None
                };

                if foot_cls.is_none()
                    && rail_cls.is_none()
                    && tram_cls.is_none()
                    && subway_cls.is_none()
                    && bus_cls.is_none()
                {
                    continue;
                }

                let br_code = brunnel_code(brunnel);
                let mut cx = 0_i32;
                let mut cy = 0_i32;
                let mut gp = 0;
                ring_buf.clear();

                let to_global = |lx: i32, ly: i32| -> (i32, i32) {
                    if extent == DEFAULT_EXTENT {
                        (base_gx + lx, base_gy + ly)
                    } else {
                        (
                            base_gx + (lx * DEFAULT_EXTENT) / extent,
                            base_gy + (ly * DEFAULT_EXTENT) / extent,
                        )
                    }
                };

                let flush_ring = |ring: &[(i32, i32)], parsed: &mut ParsedTileLayers| {
                    if ring.len() < 2 {
                        return;
                    }
                    if let Some((w, is_conn)) = foot_cls {
                        emit_ring_segments(
                            ring,
                            gtype,
                            w,
                            layer_val,
                            br_code,
                            0,
                            0,
                            is_conn,
                            true,
                            &mut parsed.foot,
                        );
                    }
                    if let Some((w, flags)) = rail_cls {
                        emit_ring_segments(
                            ring,
                            gtype,
                            w,
                            layer_val,
                            br_code,
                            oneway_val,
                            flags,
                            false,
                            false,
                            &mut parsed.rail,
                        );
                    }
                    if let Some((w, flags)) = tram_cls {
                        emit_ring_segments(
                            ring,
                            gtype,
                            w,
                            layer_val,
                            br_code,
                            oneway_val,
                            flags,
                            false,
                            false,
                            &mut parsed.tram,
                        );
                    }
                    if let Some((w, flags)) = subway_cls {
                        emit_ring_segments(
                            ring,
                            gtype,
                            w,
                            layer_val,
                            br_code,
                            oneway_val,
                            flags,
                            false,
                            false,
                            &mut parsed.subway,
                        );
                    }
                    if let Some((w, flags)) = bus_cls {
                        emit_ring_segments(
                            ring,
                            gtype,
                            w,
                            layer_val,
                            br_code,
                            oneway_val,
                            flags,
                            false,
                            false,
                            &mut parsed.bus,
                        );
                    }
                };

                while gp < geom_slice.len() {
                    let Some((cmd_int, gp1)) = read_varint(geom_slice, gp) else {
                        break;
                    };
                    gp = gp1;
                    let cmd = (cmd_int & 7) as u32;
                    let count = (cmd_int >> 3) as usize;
                    if cmd == 1 {
                        for _ in 0..count {
                            flush_ring(&ring_buf, &mut parsed);
                            ring_buf.clear();
                            let Some((dx, gp2)) = read_varint(geom_slice, gp) else {
                                gp = geom_slice.len();
                                break;
                            };
                            let Some((dy, gp3)) = read_varint(geom_slice, gp2) else {
                                gp = geom_slice.len();
                                break;
                            };
                            gp = gp3;
                            cx += unzigzag32(dx as u32);
                            cy += unzigzag32(dy as u32);
                            ring_buf.push(to_global(cx, cy));
                        }
                    } else if cmd == 2 {
                        for _ in 0..count {
                            let Some((dx, gp2)) = read_varint(geom_slice, gp) else {
                                gp = geom_slice.len();
                                break;
                            };
                            let Some((dy, gp3)) = read_varint(geom_slice, gp2) else {
                                gp = geom_slice.len();
                                break;
                            };
                            gp = gp3;
                            cx += unzigzag32(dx as u32);
                            cy += unzigzag32(dy as u32);
                            ring_buf.push(to_global(cx, cy));
                        }
                    } else if cmd == 7 {
                        if let Some(&first) = ring_buf.first() {
                            ring_buf.push(first);
                        }
                    } else {
                        break;
                    }
                }
                flush_ring(&ring_buf, &mut parsed);
            }
        } else {
            let Some(next) = skip_field(mvt_bytes, wire, pos) else {
                break;
            };
            pos = next;
        }
    }

    parsed
}

fn pre_split_tile_segments(
    tx: i32,
    ty: i32,
    raw_segs: &[RawSeg],
    allow_diamond_crossings: bool,
) -> Vec<SplitSeg> {
    if raw_segs.is_empty() {
        return Vec::new();
    }

    const GRID_DIM: usize = 68;
    const CELL_SHIFT: i32 = 6; // 64 units per cell
    const SNAP_DIST_SQ: i64 = 36; // 6 units (~2.2m)

    let origin_x = tx * DEFAULT_EXTENT - 128;
    let origin_y = ty * DEFAULT_EXTENT - 128;
    let cell_coord = |v: i32, origin: i32| -> usize {
        (((v - origin) >> CELL_SHIFT).clamp(0, (GRID_DIM as i32) - 1)) as usize
    };

    let mut grid: Vec<Vec<u32>> = vec![Vec::new(); GRID_DIM * GRID_DIM];
    for (idx, s) in raw_segs.iter().enumerate() {
        let x0 = cell_coord(s.x1.min(s.x2) - 6, origin_x);
        let x1 = cell_coord(s.x1.max(s.x2) + 6, origin_x);
        let y0 = cell_coord(s.y1.min(s.y2) - 6, origin_y);
        let y1 = cell_coord(s.y1.max(s.y2) + 6, origin_y);
        for gx in x0..=x1 {
            let row = gx * GRID_DIM;
            for gy in y0..=y1 {
                grid[row + gy].push(idx as u32);
            }
        }
    }

    let mut splits: Vec<Vec<(f32, i32, i32)>> = vec![Vec::new(); raw_segs.len()];
    let mut seen_stamp = vec![0_u32; raw_segs.len()];
    let mut stamp = 0_u32;

    let bx0 = tx * DEFAULT_EXTENT;
    let bx1 = (tx + 1) * DEFAULT_EXTENT;
    let by0 = ty * DEFAULT_EXTENT;
    let by1 = (ty + 1) * DEFAULT_EXTENT;

    for i in 0..raw_segs.len() {
        let a = raw_segs[i];
        let adx = f64::from(a.x2 - a.x1);
        let ady = f64::from(a.y2 - a.y1);
        let alen_sq = adx * adx + ady * ady;
        if alen_sq < 0.5 {
            continue;
        }
        let alen = alen_sq.sqrt();

        // Split at tile boundaries so adjacent tiles share exact border coordinates.
        if (a.x2 - a.x1) != 0 {
            for bx in [bx0, bx1] {
                let t = f64::from(bx - a.x1) / adx;
                if t > 0.001 && t < 0.999 {
                    let iy = (f64::from(a.y1) + t * ady).round() as i32;
                    splits[i].push((t as f32, bx, iy));
                }
            }
        }
        if (a.y2 - a.y1) != 0 {
            for by in [by0, by1] {
                let t = f64::from(by - a.y1) / ady;
                if t > 0.001 && t < 0.999 {
                    let ix = (f64::from(a.x1) + t * adx).round() as i32;
                    splits[i].push((t as f32, ix, by));
                }
            }
        }

        let ax_min = a.x1.min(a.x2) - 6;
        let ax_max = a.x1.max(a.x2) + 6;
        let ay_min = a.y1.min(a.y2) - 6;
        let ay_max = a.y1.max(a.y2) + 6;

        let gx0 = cell_coord(ax_min, origin_x);
        let gx1 = cell_coord(ax_max, origin_x);
        let gy0 = cell_coord(ay_min, origin_y);
        let gy1 = cell_coord(ay_max, origin_y);

        stamp = stamp.wrapping_add(1);
        if stamp == 0 {
            seen_stamp.fill(0);
            stamp = 1;
        }

        for gx in gx0..=gx1 {
            let row = gx * GRID_DIM;
            for gy in gy0..=gy1 {
                for &j_u32 in &grid[row + gy] {
                    let j = j_u32 as usize;
                    if j <= i || seen_stamp[j] == stamp {
                        continue;
                    }
                    seen_stamp[j] = stamp;

                    let b = raw_segs[j];
                    if b.x1.max(b.x2) < ax_min
                        || b.x1.min(b.x2) > ax_max
                        || b.y1.max(b.y2) < ay_min
                        || b.y1.min(b.y2) > ay_max
                    {
                        continue;
                    }

                    let bdx = f64::from(b.x2 - b.x1);
                    let bdy = f64::from(b.y2 - b.y1);
                    let blen_sq = bdx * bdx + bdy * bdy;
                    if blen_sq < 0.5 {
                        continue;
                    }

                    let same_level = a.layer == b.layer && a.brunnel == b.brunnel;

                    // Proper crossing on the same layer & brunnel.
                    // Dla torów nie tniemy płaskich krzyżowań pod kątem prostym (~63..117 st.),
                    // bo pociąg ani tramwaj nie może na nich skręcić.
                    if same_level {
                        let denom = adx * bdy - ady * bdx;
                        if denom.abs() > 1e-6 {
                            let allow_split = if allow_diamond_crossings {
                                true
                            } else {
                                let cos_abs =
                                    ((adx * bdx + ady * bdy) / (alen * blen_sq.sqrt())).abs();
                                cos_abs >= 0.45
                            };
                            if allow_split {
                                let dx = f64::from(b.x1 - a.x1);
                                let dy = f64::from(b.y1 - a.y1);
                                let t = (dx * bdy - dy * bdx) / denom;
                                let u = (dx * ady - dy * adx) / denom;
                                if t > 0.002 && t < 0.998 && u > 0.002 && u < 0.998 {
                                    let ix = (f64::from(a.x1) + t * adx).round() as i32;
                                    let iy = (f64::from(a.y1) + t * ady).round() as i32;
                                    splits[i].push((t as f32, ix, iy));
                                    splits[j].push((u as f32, ix, iy));
                                }
                            }
                        }
                    }

                    // T-junctions: endpoints of b onto a, and endpoints of a onto b.
                    if same_level || a.is_connector || b.is_connector {
                        for (px, py) in [(b.x1, b.y1), (b.x2, b.y2)] {
                            let t =
                                (f64::from(px - a.x1) * adx + f64::from(py - a.y1) * ady) / alen_sq;
                            if t > 0.01 && t < 0.99 {
                                let cx = (f64::from(a.x1) + t * adx).round() as i32;
                                let cy = (f64::from(a.y1) + t * ady).round() as i32;
                                let ddx = i64::from(px - cx);
                                let ddy = i64::from(py - cy);
                                if ddx * ddx + ddy * ddy <= SNAP_DIST_SQ {
                                    splits[i].push((t as f32, px, py));
                                }
                            }
                        }

                        for (px, py) in [(a.x1, a.y1), (a.x2, a.y2)] {
                            let u =
                                (f64::from(px - b.x1) * bdx + f64::from(py - b.y1) * bdy) / blen_sq;
                            if u > 0.01 && u < 0.99 {
                                let cx = (f64::from(b.x1) + u * bdx).round() as i32;
                                let cy = (f64::from(b.y1) + u * bdy).round() as i32;
                                let ddx = i64::from(px - cx);
                                let ddy = i64::from(py - cy);
                                if ddx * ddx + ddy * ddy <= SNAP_DIST_SQ {
                                    splits[j].push((u as f32, px, py));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut out = Vec::with_capacity(raw_segs.len() * 2);
    let mut pts_buf: Vec<(f32, i32, i32)> = Vec::with_capacity(16);

    for (i, s) in raw_segs.iter().enumerate() {
        if splits[i].is_empty() {
            out.push(SplitSeg {
                x1: s.x1,
                y1: s.y1,
                x2: s.x2,
                y2: s.y2,
                weight_milli: s.weight_milli,
                layer: s.layer,
                brunnel: s.brunnel,
                oneway: s.oneway,
                flags: s.flags,
            });
            continue;
        }
        pts_buf.clear();
        pts_buf.push((0.0, s.x1, s.y1));
        pts_buf.extend_from_slice(&splits[i]);
        pts_buf.push((1.0, s.x2, s.y2));
        pts_buf.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal));

        let last_win = pts_buf.len().saturating_sub(2);
        let static_flags = s.flags & !(SEG_FLAG_P1_END | SEG_FLAG_P2_END);
        for (wi, w) in pts_buf.windows(2).enumerate() {
            let (_, x1, y1) = w[0];
            let (_, x2, y2) = w[1];
            if x1 == x2 && y1 == y2 {
                continue;
            }
            let mut flags = static_flags;
            if wi == 0 && (s.flags & SEG_FLAG_P1_END) != 0 {
                flags |= SEG_FLAG_P1_END;
            }
            if wi == last_win && (s.flags & SEG_FLAG_P2_END) != 0 {
                flags |= SEG_FLAG_P2_END;
            }
            out.push(SplitSeg {
                x1,
                y1,
                x2,
                y2,
                weight_milli: s.weight_milli,
                layer: s.layer,
                brunnel: s.brunnel,
                oneway: s.oneway,
                flags,
            });
        }
    }

    out
}

#[inline]
pub fn lat_lon_to_global_grid(lat: f64, lon: f64) -> (i32, i32) {
    let total = f64::from((1_i32 << TILE_ZOOM) * DEFAULT_EXTENT);
    let gx = ((lon + 180.0) / 360.0) * total;
    let rad = lat.to_radians();
    let gy = ((1.0 - (rad.tan() + 1.0 / rad.cos()).ln() / std::f64::consts::PI) * 0.5) * total;
    (gx.round() as i32, gy.round() as i32)
}

#[inline]
pub fn global_grid_to_lat_lon(gx: f64, gy: f64) -> (f64, f64) {
    let total = f64::from((1_i32 << TILE_ZOOM) * DEFAULT_EXTENT);
    let lon = (gx / total) * 360.0 - 180.0;
    let n = std::f64::consts::PI - (2.0 * std::f64::consts::PI * gy) / total;
    let lat = n.sinh().atan().to_degrees();
    (lat, lon)
}

#[derive(Clone, Copy)]
struct HeapItem {
    f_cost: f64,
    g_cost: f64,
    node: usize,
}

impl PartialEq for HeapItem {
    fn eq(&self, other: &Self) -> bool {
        self.f_cost == other.f_cost && self.node == other.node
    }
}

impl Eq for HeapItem {}

impl PartialOrd for HeapItem {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for HeapItem {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .f_cost
            .partial_cmp(&self.f_cost)
            .unwrap_or(Ordering::Equal)
            .then_with(|| self.node.cmp(&other.node))
    }
}

#[derive(Clone, Copy)]
struct SnapEdge {
    u: usize,
    v: usize,
    weight_milli: u16,
    px: f64,
    py: f64,
}

fn try_route_foot_with_margin(
    tiles: &[CachedFootTile],
    g_waypoints: &[(i32, i32)],
    margin: i32,
) -> Option<Vec<(f64, f64)>> {
    let mut min_x = i32::MAX;
    let mut max_x = i32::MIN;
    let mut min_y = i32::MAX;
    let mut max_y = i32::MIN;
    for &(gx, gy) in g_waypoints {
        min_x = min_x.min(gx);
        max_x = max_x.max(gx);
        min_y = min_y.min(gy);
        max_y = max_y.max(gy);
    }
    min_x -= margin;
    max_x += margin;
    min_y -= margin;
    max_y += margin;

    let mut node_grid: HashMap<i64, Vec<usize>> = HashMap::with_capacity(4096);
    let mut nodes: Vec<(i32, i32)> = Vec::with_capacity(4096);
    let mut adj: Vec<Vec<(usize, f64)>> = Vec::with_capacity(4096);
    let mut edges: Vec<(usize, usize, u16)> = Vec::with_capacity(6144);

    fn get_or_insert_node(
        x: i32,
        y: i32,
        node_grid: &mut HashMap<i64, Vec<usize>>,
        nodes: &mut Vec<(i32, i32)>,
        adj: &mut Vec<Vec<(usize, f64)>>,
    ) -> usize {
        let bx = x >> 2;
        let by = y >> 2;
        for dx in -1..=1 {
            for dy in -1..=1 {
                let key = (i64::from(bx + dx) << 32) | i64::from((by + dy) as u32);
                if let Some(bucket) = node_grid.get(&key) {
                    for &id in bucket {
                        let (nx, ny) = nodes[id];
                        let ddx = i64::from(nx - x);
                        let ddy = i64::from(ny - y);
                        if ddx * ddx + ddy * ddy <= 9 {
                            return id;
                        }
                    }
                }
            }
        }
        let id = nodes.len();
        nodes.push((x, y));
        adj.push(Vec::with_capacity(4));
        let key = (i64::from(bx) << 32) | i64::from(by as u32);
        node_grid.entry(key).or_default().push(id);
        id
    }

    for tile in tiles {
        let tx_min = tile.tx * DEFAULT_EXTENT - 128;
        let tx_max = (tile.tx + 1) * DEFAULT_EXTENT + 128;
        let ty_min = tile.ty * DEFAULT_EXTENT - 128;
        let ty_max = (tile.ty + 1) * DEFAULT_EXTENT + 128;
        if tx_max < min_x || tx_min > max_x || ty_max < min_y || ty_min > max_y {
            continue;
        }
        for s in &tile.segs {
            if s.x1.max(s.x2) < min_x
                || s.x1.min(s.x2) > max_x
                || s.y1.max(s.y2) < min_y
                || s.y1.min(s.y2) > max_y
            {
                continue;
            }
            let u = get_or_insert_node(s.x1, s.y1, &mut node_grid, &mut nodes, &mut adj);
            let v = get_or_insert_node(s.x2, s.y2, &mut node_grid, &mut nodes, &mut adj);
            if u == v {
                continue;
            }
            let dx = f64::from(nodes[v].0 - nodes[u].0);
            let dy = f64::from(nodes[v].1 - nodes[u].1);
            let len = dx.hypot(dy);
            let cost = len * (f64::from(s.weight_milli) * 0.001);
            adj[u].push((v, cost));
            adj[v].push((u, cost));
            edges.push((u, v, s.weight_milli));
        }
    }

    if nodes.is_empty() || edges.is_empty() {
        return None;
    }

    let mut comp = vec![u32::MAX; nodes.len()];
    let mut comp_sizes: Vec<usize> = Vec::new();
    let mut queue: Vec<usize> = Vec::with_capacity(1024);

    for start in 0..nodes.len() {
        if comp[start] != u32::MAX {
            continue;
        }
        let cid = comp_sizes.len() as u32;
        let mut sz = 0_usize;
        comp[start] = cid;
        queue.clear();
        queue.push(start);
        while let Some(u) = queue.pop() {
            sz += 1;
            for &(v, _) in &adj[u] {
                if comp[v] == u32::MAX {
                    comp[v] = cid;
                    queue.push(v);
                }
            }
        }
        comp_sizes.push(sz);
    }

    let main_comp = comp_sizes
        .iter()
        .enumerate()
        .max_by_key(|&(_, sz)| *sz)
        .map(|(cid, _)| cid as u32)?;

    let snap_to_comp = |gx: i32, gy: i32, target_comp: u32| -> Option<SnapEdge> {
        let fx = f64::from(gx);
        let fy = f64::from(gy);
        let mut best_d2 = f64::INFINITY;
        let mut best: Option<SnapEdge> = None;

        for &(u, v, w) in &edges {
            if comp[u] != target_comp {
                continue;
            }
            let x1 = f64::from(nodes[u].0);
            let y1 = f64::from(nodes[u].1);
            let x2 = f64::from(nodes[v].0);
            let y2 = f64::from(nodes[v].1);
            let dx = x2 - x1;
            let dy = y2 - y1;
            let len_sq = dx * dx + dy * dy;
            let t = if len_sq > 0.0 {
                (((fx - x1) * dx + (fy - y1) * dy) / len_sq).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let px = x1 + t * dx;
            let py = y1 + t * dy;
            let d2 = (fx - px) * (fx - px) + (fy - py) * (fy - py);
            if d2 < best_d2 {
                best_d2 = d2;
                best = Some(SnapEdge {
                    u,
                    v,
                    weight_milli: w,
                    px,
                    py,
                });
            }
        }
        best
    };

    let mut full_grid_path: Vec<(f64, f64)> = Vec::with_capacity(128);
    let mut dist = vec![f64::INFINITY; nodes.len()];
    let mut prev = vec![usize::MAX; nodes.len()];
    let mut heap = BinaryHeap::new();

    for leg_idx in 0..g_waypoints.len() - 1 {
        let (fx, fy) = g_waypoints[leg_idx];
        let (tx, ty) = g_waypoints[leg_idx + 1];

        let s1 = snap_to_comp(fx, fy, main_comp)?;
        let s2 = snap_to_comp(tx, ty, main_comp)?;

        let same_edge = (s1.u == s2.u && s1.v == s2.v) || (s1.u == s2.v && s1.v == s2.u);
        if same_edge {
            if leg_idx == 0 {
                full_grid_path.push((s1.px, s1.py));
            }
            full_grid_path.push((s2.px, s2.py));
            continue;
        }

        dist.fill(f64::INFINITY);
        prev.fill(usize::MAX);
        heap.clear();

        let w1 = f64::from(s1.weight_milli) * 0.001;
        let w2 = f64::from(s2.weight_milli) * 0.001;

        let g_u1 = (f64::from(nodes[s1.u].0) - s1.px).hypot(f64::from(nodes[s1.u].1) - s1.py) * w1;
        let g_v1 = (f64::from(nodes[s1.v].0) - s1.px).hypot(f64::from(nodes[s1.v].1) - s1.py) * w1;

        let heuristic = |n: usize| -> f64 {
            let nx = f64::from(nodes[n].0);
            let ny = f64::from(nodes[n].1);
            (nx - s2.px).hypot(ny - s2.py) * 0.89
        };

        dist[s1.u] = g_u1;
        heap.push(HeapItem {
            f_cost: g_u1 + heuristic(s1.u),
            g_cost: g_u1,
            node: s1.u,
        });

        if g_v1 < dist[s1.v] {
            dist[s1.v] = g_v1;
            heap.push(HeapItem {
                f_cost: g_v1 + heuristic(s1.v),
                g_cost: g_v1,
                node: s1.v,
            });
        }

        while let Some(HeapItem {
            g_cost, node: u, ..
        }) = heap.pop()
        {
            if g_cost > dist[u] {
                continue;
            }
            if dist[s2.u].is_finite() && dist[s2.v].is_finite() {
                let best_goal = dist[s2.u].min(dist[s2.v]);
                if g_cost > best_goal + 64.0 {
                    break;
                }
            }
            let p_node = prev[u];
            let (ux, uy) = nodes[u];

            for &(v, base_cost) in &adj[u] {
                let mut step_cost = base_cost;
                if p_node != usize::MAX && p_node != v {
                    let (px, py) = nodes[p_node];
                    let (vx, vy) = nodes[v];
                    let dx1 = f64::from(ux - px);
                    let dy1 = f64::from(uy - py);
                    let dx2 = f64::from(vx - ux);
                    let dy2 = f64::from(vy - uy);
                    let l1 = dx1.hypot(dy1);
                    let l2 = dx2.hypot(dy2);
                    if l1 > 1.0 && l2 > 1.0 {
                        let cos_a = ((dx1 * dx2 + dy1 * dy2) / (l1 * l2)).clamp(-1.0, 1.0);
                        if cos_a < 0.7 {
                            step_cost += (0.7 - cos_a) * 1.5;
                        }
                    }
                }
                let ng = g_cost + step_cost;
                if ng < dist[v] {
                    dist[v] = ng;
                    prev[v] = u;
                    heap.push(HeapItem {
                        f_cost: ng + heuristic(v),
                        g_cost: ng,
                        node: v,
                    });
                }
            }
        }

        let cost_via_u = dist[s2.u]
            + (f64::from(nodes[s2.u].0) - s2.px).hypot(f64::from(nodes[s2.u].1) - s2.py) * w2;
        let cost_via_v = dist[s2.v]
            + (f64::from(nodes[s2.v].0) - s2.px).hypot(f64::from(nodes[s2.v].1) - s2.py) * w2;

        let mut cur = if cost_via_u <= cost_via_v { s2.u } else { s2.v };
        if !dist[cur].is_finite() {
            return None;
        }

        let mut leg_pts: Vec<(f64, f64)> = Vec::with_capacity(64);
        leg_pts.push((s2.px, s2.py));
        while cur != usize::MAX {
            leg_pts.push((f64::from(nodes[cur].0), f64::from(nodes[cur].1)));
            cur = prev[cur];
        }
        leg_pts.push((s1.px, s1.py));
        leg_pts.reverse();

        if leg_idx > 0 && !full_grid_path.is_empty() {
            leg_pts.remove(0);
        }
        full_grid_path.extend_from_slice(&leg_pts);
    }

    let cleaned = smooth_micro_jogs(&full_grid_path, true);
    if cleaned.len() < 2 {
        return None;
    }

    Some(
        cleaned
            .into_iter()
            .map(|(gx, gy)| global_grid_to_lat_lon(gx, gy))
            .collect(),
    )
}

#[derive(Clone, Copy)]
struct TransitNode {
    x: i32,
    y: i32,
    layer: i8,
    brunnel: u8,
    is_endpoint: bool,
}

#[derive(Clone, Copy)]
struct HalfEdge {
    from: usize,
    to: usize,
    twin: usize,
    len: f64,
    cost: f64,
    ux: f64,
    uy: f64,
    weight_milli: u16,
    flags: u8,
    is_reverse_oneway: bool,
}

#[derive(Clone, Copy)]
struct SnapCand {
    edge: usize,
    t: f64,
    px: f64,
    py: f64,
    dist: f64,
    snap_cost: f64,
    comp: u32,
}

#[derive(Clone)]
struct HopChoice {
    prev_cand: usize,
    pts: Vec<(f64, f64)>,
}

fn turn_penalty_transit(profile: RouteProfile, e1: &HalfEdge, e2: &HalfEdge) -> f64 {
    if e2.from == e1.to && e2.to == e1.from {
        return match profile {
            RouteProfile::Bus => 2200.0,
            RouteProfile::Tram => 4500.0,
            RouteProfile::Rail | RouteProfile::Subway => 12000.0,
            RouteProfile::Foot => 40.0,
        };
    }

    let cos_a = (e1.ux * e2.ux + e1.uy * e2.uy).clamp(-1.0, 1.0);
    let long_pair = e1.len > 4.5 && e2.len > 4.5;

    match profile {
        RouteProfile::Bus => {
            if cos_a < -0.5 {
                360.0
            } else if cos_a < 0.35 && long_pair {
                45.0
            } else if cos_a < 0.75 {
                (0.75 - cos_a) * 18.0
            } else {
                0.0
            }
        }
        RouteProfile::Tram => {
            if cos_a < -0.3 {
                2400.0
            } else if cos_a < 0.25 && long_pair {
                320.0
            } else if cos_a < 0.65 {
                (0.65 - cos_a) * 28.0
            } else {
                0.0
            }
        }
        RouteProfile::Rail | RouteProfile::Subway => {
            if cos_a < 0.0 {
                9000.0
            } else if cos_a < 0.55 && long_pair {
                1200.0
            } else if cos_a < 0.8 {
                (0.8 - cos_a) * 45.0
            } else {
                0.0
            }
        }
        RouteProfile::Foot => 0.0,
    }
}

fn snap_bias_for_edge(profile: RouteProfile, e: &HalfEdge) -> f64 {
    match profile {
        RouteProfile::Bus => {
            let mut bias = if (e.flags & SEG_FLAG_BUSWAY) != 0 {
                0.0
            } else if (e.flags & SEG_FLAG_MAJOR) != 0 {
                2.0
            } else if e.weight_milli <= 1140 {
                16.0
            } else {
                26.0
            };
            if e.is_reverse_oneway {
                bias += if (e.flags & SEG_FLAG_RESTRICTED) != 0 {
                    12.0
                } else {
                    42.0
                };
            }
            bias
        }
        RouteProfile::Tram | RouteProfile::Rail | RouteProfile::Subway => {
            if e.weight_milli <= 1150 {
                0.0
            } else if e.weight_milli <= 1750 {
                30.0
            } else {
                120.0
            }
        }
        RouteProfile::Foot => 0.0,
    }
}

fn snap_radii(profile: RouteProfile) -> (f64, f64) {
    match profile {
        RouteProfile::Bus => (280.0, 560.0),
        RouteProfile::Tram => (220.0, 460.0),
        RouteProfile::Subway => (480.0, 820.0),
        RouteProfile::Rail => (560.0, 920.0),
        RouteProfile::Foot => (400.0, 800.0),
    }
}

fn min_heuristic_weight(profile: RouteProfile) -> f64 {
    match profile {
        RouteProfile::Bus => 0.90,
        _ => 0.98,
    }
}

fn try_route_transit_with_margin(
    tiles: &[CachedFootTile],
    g_waypoints: &[(i32, i32)],
    margin: i32,
    profile: RouteProfile,
) -> Option<Vec<(f64, f64)>> {
    let mut min_x = i32::MAX;
    let mut max_x = i32::MIN;
    let mut min_y = i32::MAX;
    let mut max_y = i32::MIN;
    for &(gx, gy) in g_waypoints {
        min_x = min_x.min(gx);
        max_x = max_x.max(gx);
        min_y = min_y.min(gy);
        max_y = max_y.max(gy);
    }
    min_x -= margin;
    max_x += margin;
    min_y -= margin;
    max_y += margin;

    let mut node_grid: HashMap<i64, Vec<usize>> = HashMap::with_capacity(4096);
    let mut nodes: Vec<TransitNode> = Vec::with_capacity(4096);
    let mut out_edges: Vec<Vec<usize>> = Vec::with_capacity(4096);
    let mut half_edges: Vec<HalfEdge> = Vec::with_capacity(8192);
    let mut edge_dedup: HashMap<(usize, usize), usize> = HashMap::with_capacity(6144);

    fn get_or_insert_transit_node(
        x: i32,
        y: i32,
        layer: i8,
        brunnel: u8,
        is_endpoint: bool,
        node_grid: &mut HashMap<i64, Vec<usize>>,
        nodes: &mut Vec<TransitNode>,
        out_edges: &mut Vec<Vec<usize>>,
    ) -> usize {
        let bx = x >> 2;
        let by = y >> 2;
        for dx in -1..=1 {
            for dy in -1..=1 {
                let key = (i64::from(bx + dx) << 32) | i64::from((by + dy) as u32);
                if let Some(bucket) = node_grid.get(&key) {
                    for &id in bucket {
                        let n = nodes[id];
                        let ddx = i64::from(n.x - x);
                        let ddy = i64::from(n.y - y);
                        let d2 = ddx * ddx + ddy * ddy;
                        if d2 > 9 {
                            continue;
                        }
                        let same_level = n.layer == layer && n.brunnel == brunnel;
                        let abutment_join =
                            (n.is_endpoint && is_endpoint) || (d2 <= 1 && (n.is_endpoint || is_endpoint));
                        if same_level || abutment_join {
                            if is_endpoint && !n.is_endpoint {
                                nodes[id].is_endpoint = true;
                            }
                            return id;
                        }
                    }
                }
            }
        }
        let id = nodes.len();
        nodes.push(TransitNode {
            x,
            y,
            layer,
            brunnel,
            is_endpoint,
        });
        out_edges.push(Vec::with_capacity(4));
        let key = (i64::from(bx) << 32) | i64::from(by as u32);
        node_grid.entry(key).or_default().push(id);
        id
    }

    let make_edge_cost = |len: f64, weight_milli: u16, flags: u8, is_reverse_oneway: bool| -> f64 {
        let mut c = len * (f64::from(weight_milli) * 0.001);
        if is_reverse_oneway {
            match profile {
                RouteProfile::Bus => {
                    // Miękka kara za jazdę pod prąd jednokierunkowej:
                    // 2.8x na drogach głównych (dwujezdniowe i ronda),
                    // 1.25x na buspasach i korytarzach access=no,
                    // 1.65x na ulicach lokalnych (kontrapasy autobusowe bez objazdów bocznymi zaułkami).
                    let mult = if (flags & (SEG_FLAG_RESTRICTED | SEG_FLAG_BUSWAY)) != 0 {
                        1.25
                    } else if (flags & SEG_FLAG_MAJOR) != 0 {
                        2.8
                    } else {
                        1.65
                    };
                    c *= mult;
                }
                RouteProfile::Tram => {
                    c *= 2.0;
                }
                _ => {}
            }
        }
        c
    };

    for tile in tiles {
        let tx_min = tile.tx * DEFAULT_EXTENT;
        let tx_max = (tile.tx + 1) * DEFAULT_EXTENT;
        let ty_min = tile.ty * DEFAULT_EXTENT;
        let ty_max = (tile.ty + 1) * DEFAULT_EXTENT;
        if tx_max + 128 < min_x
            || tx_min - 128 > max_x
            || ty_max + 128 < min_y
            || ty_min - 128 > max_y
        {
            continue;
        }
        let segs = match profile {
            RouteProfile::Rail => &tile.rails,
            RouteProfile::Tram => &tile.trams,
            RouteProfile::Subway => &tile.subways,
            RouteProfile::Bus => &tile.buses,
            RouteProfile::Foot => &tile.segs,
        };
        for s in segs {
            if s.x1.max(s.x2) < min_x
                || s.x1.min(s.x2) > max_x
                || s.y1.max(s.y2) < min_y
                || s.y1.min(s.y2) > max_y
            {
                continue;
            }
            // Pomijamy duble z bufora sąsiedniego kafelka (krawędzie są już pocięte na granicy).
            let mx = (s.x1 + s.x2) / 2;
            let my = (s.y1 + s.y2) / 2;
            if mx < tx_min - 2 || mx > tx_max + 2 || my < ty_min - 2 || my > ty_max + 2 {
                continue;
            }
            let u = get_or_insert_transit_node(
                s.x1,
                s.y1,
                s.layer,
                s.brunnel,
                (s.flags & SEG_FLAG_P1_END) != 0,
                &mut node_grid,
                &mut nodes,
                &mut out_edges,
            );
            let v = get_or_insert_transit_node(
                s.x2,
                s.y2,
                s.layer,
                s.brunnel,
                (s.flags & SEG_FLAG_P2_END) != 0,
                &mut node_grid,
                &mut nodes,
                &mut out_edges,
            );
            if u == v {
                continue;
            }
            let key = if u < v { (u, v) } else { (v, u) };
            let dx = f64::from(nodes[v].x - nodes[u].x);
            let dy = f64::from(nodes[v].y - nodes[u].y);
            let len = dx.hypot(dy);
            if len < 0.25 {
                continue;
            }
            let ux = dx / len;
            let uy = dy / len;
            let fwd_rev = s.oneway < 0;
            let bwd_rev = s.oneway > 0;
            let fwd_cost = make_edge_cost(len, s.weight_milli, s.flags, fwd_rev);
            let bwd_cost = make_edge_cost(len, s.weight_milli, s.flags, bwd_rev);

            if let Some(&existing_fwd) = edge_dedup.get(&key) {
                let existing_bwd = half_edges[existing_fwd].twin;
                let (e_uv, e_vu) = if half_edges[existing_fwd].from == u {
                    (existing_fwd, existing_bwd)
                } else {
                    (existing_bwd, existing_fwd)
                };
                if fwd_cost < half_edges[e_uv].cost {
                    half_edges[e_uv].cost = fwd_cost;
                    half_edges[e_uv].weight_milli = s.weight_milli;
                    half_edges[e_uv].flags = s.flags;
                    half_edges[e_uv].is_reverse_oneway = fwd_rev;
                }
                if bwd_cost < half_edges[e_vu].cost {
                    half_edges[e_vu].cost = bwd_cost;
                    half_edges[e_vu].weight_milli = s.weight_milli;
                    half_edges[e_vu].flags = s.flags;
                    half_edges[e_vu].is_reverse_oneway = bwd_rev;
                }
                continue;
            }

            let fwd_id = half_edges.len();
            let bwd_id = fwd_id + 1;
            half_edges.push(HalfEdge {
                from: u,
                to: v,
                twin: bwd_id,
                len,
                cost: fwd_cost,
                ux,
                uy,
                weight_milli: s.weight_milli,
                flags: s.flags,
                is_reverse_oneway: fwd_rev,
            });
            half_edges.push(HalfEdge {
                from: v,
                to: u,
                twin: fwd_id,
                len,
                cost: bwd_cost,
                ux: -ux,
                uy: -uy,
                weight_milli: s.weight_milli,
                flags: s.flags,
                is_reverse_oneway: bwd_rev,
            });
            out_edges[u].push(fwd_id);
            out_edges[v].push(bwd_id);
            edge_dedup.insert(key, fwd_id);
        }
    }

    if nodes.is_empty() || half_edges.is_empty() {
        return None;
    }

    // Spójne składowe z rozmiarem (bez narzucania wyłącznie największej w bboxie).
    let mut comp = vec![u32::MAX; nodes.len()];
    let mut comp_size: Vec<usize> = Vec::new();
    let mut queue: Vec<usize> = Vec::with_capacity(1024);
    for start in 0..nodes.len() {
        if comp[start] != u32::MAX {
            continue;
        }
        let cid = comp_size.len() as u32;
        comp[start] = cid;
        let mut cnt = 1_usize;
        queue.clear();
        queue.push(start);
        while let Some(u) = queue.pop() {
            for &eid in &out_edges[u] {
                let v = half_edges[eid].to;
                if comp[v] == u32::MAX {
                    comp[v] = cid;
                    cnt += 1;
                    queue.push(v);
                }
            }
        }
        comp_size.push(cnt);
    }

    let graph_has_large = comp_size.iter().copied().max().unwrap_or(0) >= 16;
    let (base_radius, fallback_radius) = snap_radii(profile);
    let max_cands = 14_usize;
    let dedup_dist = match profile {
        RouteProfile::Bus => 48.0,
        _ => 32.0,
    };

    let collect_candidates = |gx: i32, gy: i32| -> Vec<SnapCand> {
        let fx = f64::from(gx);
        let fy = f64::from(gy);
        let mut raw: Vec<SnapCand> = Vec::with_capacity(48);

        for radius in [base_radius, fallback_radius] {
            raw.clear();
            let r2 = radius * radius;
            let mut has_substantial = false;
            for (eid, e) in half_edges.iter().enumerate() {
                let n1 = nodes[e.from];
                let n2 = nodes[e.to];
                let x1 = f64::from(n1.x);
                let y1 = f64::from(n1.y);
                let x2 = f64::from(n2.x);
                let y2 = f64::from(n2.y);
                if fx < x1.min(x2) - radius
                    || fx > x1.max(x2) + radius
                    || fy < y1.min(y2) - radius
                    || fy > y1.max(y2) + radius
                {
                    continue;
                }
                let dx = x2 - x1;
                let dy = y2 - y1;
                let len_sq = dx * dx + dy * dy;
                let t = if len_sq > 0.0 {
                    (((fx - x1) * dx + (fy - y1) * dy) / len_sq).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let px = x1 + t * dx;
                let py = y1 + t * dy;
                let d2 = (fx - px) * (fx - px) + (fy - py) * (fy - py);
                if d2 > r2 {
                    continue;
                }
                let d = d2.sqrt();
                let cid = comp[e.from];
                let csize = comp_size[cid as usize];
                if csize >= 16 {
                    has_substantial = true;
                }
                let tiny_penalty = if csize < 12 { 350.0 } else { 0.0 };
                let snap_cost = d * 1.45 + snap_bias_for_edge(profile, e) + tiny_penalty;
                raw.push(SnapCand {
                    edge: eid,
                    t,
                    px,
                    py,
                    dist: d,
                    snap_cost,
                    comp: cid,
                });
            }
            if !raw.is_empty() && (!graph_has_large || has_substantial) {
                break;
            }
        }

        if raw.is_empty() {
            return raw;
        }
        raw.sort_by(|a, b| a.snap_cost.partial_cmp(&b.snap_cost).unwrap_or(Ordering::Equal));

        let mut kept: Vec<SnapCand> = Vec::with_capacity(max_cands + 2);
        for c in &raw {
            let ce = &half_edges[c.edge];
            let dup = kept.iter().any(|k| {
                if k.comp != c.comp {
                    return false;
                }
                let ke = &half_edges[k.edge];
                if ke.is_reverse_oneway != ce.is_reverse_oneway {
                    return false;
                }
                if (ke.flags & (SEG_FLAG_BUSWAY | SEG_FLAG_RESTRICTED))
                    != (ce.flags & (SEG_FLAG_BUSWAY | SEG_FLAG_RESTRICTED))
                {
                    return false;
                }
                let dot = ce.ux * ke.ux + ce.uy * ke.uy;
                dot > 0.85 && (k.px - c.px).hypot(k.py - c.py) < dedup_dist
            });
            if !dup {
                kept.push(*c);
                if kept.len() >= max_cands {
                    break;
                }
            }
        }
        // Jeśli pierwsze sloty zapełniła jedna bocznica, dorzuć do 2 kandydatów z innych większych składowych.
        let mut extra_comps = 0_usize;
        for c in &raw {
            if extra_comps >= 2 {
                break;
            }
            if comp_size[c.comp as usize] < 16 {
                continue;
            }
            if kept.iter().any(|k| k.comp == c.comp) {
                continue;
            }
            kept.push(*c);
            extra_comps += 1;
        }
        kept
    };

    let n_stops = g_waypoints.len();
    let mut stop_cands: Vec<Vec<SnapCand>> = Vec::with_capacity(n_stops);
    for &(gx, gy) in g_waypoints {
        let cands = collect_candidates(gx, gy);
        if cands.is_empty() {
            return None;
        }
        stop_cands.push(cands);
    }

    // Viterbi DP po kolejnych przystankach z wykorzystaniem wieloźródłowego A* po półkrawędziach.
    let mut dp_costs: Vec<Vec<f64>> = Vec::with_capacity(n_stops);
    dp_costs.push(stop_cands[0].iter().map(|c| c.snap_cost).collect());
    let mut back_choices: Vec<Vec<Option<HopChoice>>> = Vec::with_capacity(n_stops);
    back_choices.push(vec![None; stop_cands[0].len()]);

    let mut edge_dist = vec![f64::INFINITY; half_edges.len()];
    let mut edge_prev = vec![usize::MAX; half_edges.len()];
    let mut edge_origin = vec![usize::MAX; half_edges.len()];
    let mut touched: Vec<usize> = Vec::with_capacity(1024);
    let mut heap: BinaryHeap<HeapItem> = BinaryHeap::with_capacity(1024);
    let min_w = min_heuristic_weight(profile);

    for step in 0..n_stops - 1 {
        let from_cands = &stop_cands[step];
        let to_cands = &stop_cands[step + 1];
        let from_dp = &dp_costs[step];
        let (tx, ty) = g_waypoints[step + 1];
        let ft_x = f64::from(tx);
        let ft_y = f64::from(ty);
        let max_cand_d = to_cands.iter().map(|c| c.dist).fold(0.0_f64, f64::max);

        let mut target_map: HashMap<usize, Vec<usize>> = HashMap::with_capacity(to_cands.len());
        for (bi, bc) in to_cands.iter().enumerate() {
            target_map.entry(bc.edge).or_default().push(bi);
        }

        let mut best_target_g = vec![f64::INFINITY; to_cands.len()];
        let mut best_target_prev_edge = vec![usize::MAX; to_cands.len()];
        let mut best_target_origin = vec![usize::MAX; to_cands.len()];
        let mut best_target_same_edge = vec![false; to_cands.len()];

        // 1) Bezpośredni ruch naprzód po tej samej półkrawędzi.
        for (ai, ac) in from_cands.iter().enumerate() {
            if !from_dp[ai].is_finite() {
                continue;
            }
            if let Some(bis) = target_map.get(&ac.edge) {
                let e = &half_edges[ac.edge];
                for &bi in bis {
                    let bc = &to_cands[bi];
                    if bc.t >= ac.t - 1e-6 {
                        let g = from_dp[ai] + (bc.t - ac.t).max(0.0) * e.cost;
                        if g < best_target_g[bi] {
                            best_target_g[bi] = g;
                            best_target_prev_edge[bi] = usize::MAX;
                            best_target_origin[bi] = ai;
                            best_target_same_edge[bi] = true;
                        }
                    }
                }
            }
        }

        // 2) Wieloźródłowe A* od wszystkich osiągalnych kandydatów przystanku `step`.
        for &eid in &touched {
            edge_dist[eid] = f64::INFINITY;
            edge_prev[eid] = usize::MAX;
            edge_origin[eid] = usize::MAX;
        }
        touched.clear();
        heap.clear();

        let heuristic_node = |nid: usize| -> f64 {
            let n = nodes[nid];
            let d = (f64::from(n.x) - ft_x).hypot(f64::from(n.y) - ft_y);
            (d - max_cand_d).max(0.0) * min_w
        };

        for (ai, ac) in from_cands.iter().enumerate() {
            if !from_dp[ai].is_finite() {
                continue;
            }
            let e = &half_edges[ac.edge];
            let g0 = from_dp[ai] + (1.0 - ac.t) * e.cost;
            if g0 < edge_dist[ac.edge] {
                if !edge_dist[ac.edge].is_finite() {
                    touched.push(ac.edge);
                }
                edge_dist[ac.edge] = g0;
                edge_prev[ac.edge] = usize::MAX;
                edge_origin[ac.edge] = ai;
                heap.push(HeapItem {
                    f_cost: g0 + heuristic_node(e.to),
                    g_cost: g0,
                    node: ac.edge,
                });
            }
        }

        let mut min_target_g = best_target_g.iter().copied().fold(f64::INFINITY, f64::min);
        let mut expansions = 0_usize;
        const MAX_EXPANSIONS: usize = 50_000;

        while let Some(HeapItem {
            f_cost,
            g_cost,
            node: eid,
        }) = heap.pop()
        {
            if g_cost > edge_dist[eid] {
                continue;
            }
            if min_target_g.is_finite() && f_cost > min_target_g + 700.0 {
                break;
            }
            expansions += 1;
            if expansions > MAX_EXPANSIONS && min_target_g.is_finite() {
                break;
            }

            let e1 = half_edges[eid];
            let orig = edge_origin[eid];
            let u = e1.to;

            for &next_eid in &out_edges[u] {
                let e2 = half_edges[next_eid];
                let turn_pen = turn_penalty_transit(profile, &e1, &e2);

                if let Some(bis) = target_map.get(&next_eid) {
                    for &bi in bis {
                        let bc = &to_cands[bi];
                        let arr_g = g_cost + turn_pen + bc.t * e2.cost;
                        if arr_g < best_target_g[bi] {
                            best_target_g[bi] = arr_g;
                            best_target_prev_edge[bi] = eid;
                            best_target_origin[bi] = orig;
                            best_target_same_edge[bi] = false;
                            if arr_g < min_target_g {
                                min_target_g = arr_g;
                            }
                        }
                    }
                }

                let ng = g_cost + turn_pen + e2.cost;
                if ng < edge_dist[next_eid] {
                    if !edge_dist[next_eid].is_finite() {
                        touched.push(next_eid);
                    }
                    edge_dist[next_eid] = ng;
                    edge_prev[next_eid] = eid;
                    edge_origin[next_eid] = orig;
                    heap.push(HeapItem {
                        f_cost: ng + heuristic_node(e2.to),
                        g_cost: ng,
                        node: next_eid,
                    });
                }
            }
        }

        if !min_target_g.is_finite() {
            return None;
        }

        let mut next_dp = vec![f64::INFINITY; to_cands.len()];
        let mut next_choices: Vec<Option<HopChoice>> = vec![None; to_cands.len()];

        for (bi, bc) in to_cands.iter().enumerate() {
            if !best_target_g[bi].is_finite() {
                continue;
            }
            let ai = best_target_origin[bi];
            if ai == usize::MAX {
                continue;
            }
            let ac = &from_cands[ai];
            let mut hop_pts: Vec<(f64, f64)> = Vec::with_capacity(32);

            if best_target_same_edge[bi] {
                hop_pts.push((ac.px, ac.py));
                hop_pts.push((bc.px, bc.py));
            } else {
                hop_pts.push((bc.px, bc.py));
                let target_start_node = half_edges[bc.edge].from;
                hop_pts.push((
                    f64::from(nodes[target_start_node].x),
                    f64::from(nodes[target_start_node].y),
                ));
                let mut cur_e = best_target_prev_edge[bi];
                while cur_e != usize::MAX {
                    let prev_e = edge_prev[cur_e];
                    if prev_e == usize::MAX {
                        break;
                    }
                    let n = nodes[half_edges[cur_e].from];
                    hop_pts.push((f64::from(n.x), f64::from(n.y)));
                    cur_e = prev_e;
                }
                hop_pts.push((ac.px, ac.py));
                hop_pts.reverse();
            }

            next_dp[bi] = best_target_g[bi] + bc.snap_cost;
            next_choices[bi] = Some(HopChoice {
                prev_cand: ai,
                pts: hop_pts,
            });
        }

        dp_costs.push(next_dp);
        back_choices.push(next_choices);
    }

    let last_dp = dp_costs.last()?;
    let (mut cur_b, &best_final) = last_dp
        .iter()
        .enumerate()
        .min_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(Ordering::Equal))?;
    if !best_final.is_finite() {
        return None;
    }

    let mut hop_segments: Vec<Vec<(f64, f64)>> = Vec::with_capacity(n_stops - 1);
    for step in (1..n_stops).rev() {
        let choice = back_choices[step][cur_b].as_ref()?;
        hop_segments.push(choice.pts.clone());
        cur_b = choice.prev_cand;
    }
    hop_segments.reverse();

    // Weryfikacja braku absurdalnego objazdu na pojedynczym odcinku między przystankami.
    for (idx, seg) in hop_segments.iter().enumerate() {
        let (x1, y1) = g_waypoints[idx];
        let (x2, y2) = g_waypoints[idx + 1];
        let crow = f64::from(x2 - x1).hypot(f64::from(y2 - y1));
        let mut path_len = 0.0_f64;
        for w in seg.windows(2) {
            path_len += (w[1].0 - w[0].0).hypot(w[1].1 - w[0].1);
        }
        let max_allowed = match profile {
            RouteProfile::Bus => (crow * 3.1 + 1100.0).max(2000.0),
            RouteProfile::Tram => (crow * 3.4 + 1000.0).max(1800.0),
            RouteProfile::Rail | RouteProfile::Subway => (crow * 3.6 + 1500.0).max(2600.0),
            RouteProfile::Foot => f64::INFINITY,
        };
        if crow > 60.0 && path_len > max_allowed {
            return None;
        }
    }

    let mut full_grid_path: Vec<(f64, f64)> = Vec::with_capacity(256);
    for seg in hop_segments {
        for pt in seg {
            if let Some(&(lx, ly)) = full_grid_path.last() {
                if (pt.0 - lx).hypot(pt.1 - ly) < 0.8 {
                    continue;
                }
            }
            full_grid_path.push(pt);
        }
    }

    let cleaned = clean_transit_polyline(&full_grid_path);
    if cleaned.len() < 2 {
        return None;
    }

    Some(
        cleaned
            .into_iter()
            .map(|(gx, gy)| global_grid_to_lat_lon(gx, gy))
            .collect(),
    )
}

fn clean_transit_polyline(pts: &[(f64, f64)]) -> Vec<(f64, f64)> {
    if pts.len() <= 2 {
        return pts.to_vec();
    }

    // 1) Deduplikacja punktów poniżej 1.2 jednostki (~0.45 m).
    let mut dedup: Vec<(f64, f64)> = Vec::with_capacity(pts.len());
    for &(x, y) in pts {
        if let Some(&(lx, ly)) = dedup.last() {
            if (x - lx).hypot(y - ly) < 1.2 {
                continue;
            }
        }
        dedup.push((x, y));
    }
    if dedup.len() <= 2 {
        return dedup;
    }

    // 2) Usuwanie drobnych szpilek tam-i-z-powrotem (do ~35 m = 92 jednostki).
    let mut no_spurs: Vec<(f64, f64)> = Vec::with_capacity(dedup.len());
    for pt in dedup {
        no_spurs.push(pt);
        while no_spurs.len() >= 3 {
            let n = no_spurs.len();
            let a = no_spurs[n - 3];
            let b = no_spurs[n - 2];
            let c = no_spurs[n - 1];
            let d_ab = (b.0 - a.0).hypot(b.1 - a.1);
            let d_bc = (c.0 - b.0).hypot(c.1 - b.1);
            let d_ac = (c.0 - a.0).hypot(c.1 - a.1);
            if d_ab > 0.5 && d_bc > 0.5 {
                let cos_a = ((b.0 - a.0) * (c.0 - b.0) + (b.1 - a.1) * (c.1 - b.1)) / (d_ab * d_bc);
                if cos_a < -0.92 && d_ab.min(d_bc) < 92.0 && d_ac < d_ab.max(d_bc) + 4.0 {
                    // Usuń szpilkę B; jeśli A i C pokrywają się, usuń też C.
                    no_spurs.remove(n - 2);
                    if d_ac < 3.0 {
                        no_spurs.pop();
                    }
                    continue;
                }
            }
            break;
        }
    }

    smooth_micro_jogs(&no_spurs, false)
}

fn smooth_micro_jogs(pts: &[(f64, f64)], densify: bool) -> Vec<(f64, f64)> {
    if pts.len() <= 2 {
        return pts.to_vec();
    }
    let mut dedup: Vec<(f64, f64)> = Vec::with_capacity(pts.len());
    for &(x, y) in pts {
        if let Some(&(lx, ly)) = dedup.last() {
            if (x - lx).hypot(y - ly) < 1.2 {
                continue;
            }
        }
        dedup.push((x, y));
    }
    if dedup.len() < 2 {
        if let (Some(&first), Some(&last)) = (pts.first(), pts.last()) {
            return vec![first, last];
        }
        return pts.to_vec();
    }

    let mut out: Vec<(f64, f64)> = Vec::with_capacity(dedup.len());
    out.push(dedup[0]);
    let mut i = 1;
    while i + 1 < dedup.len() {
        let (px, py) = *out.last().unwrap_or(&dedup[0]);
        let (cx, cy) = dedup[i];
        let (nx, ny) = dedup[i + 1];
        let d1 = (cx - px).hypot(cy - py);
        let d2 = (nx - cx).hypot(ny - cy);
        if d1 < 5.0 || d2 < 5.0 {
            let ux = cx - px;
            let uy = cy - py;
            let vx = nx - cx;
            let vy = ny - cy;
            let denom = d1 * d2;
            if denom > 0.1 {
                let cos_a = (ux * vx + uy * vy) / denom;
                if cos_a > 0.96 || (d1 < 3.5 && d2 < 3.5) {
                    i += 1;
                    continue;
                }
            }
        }
        out.push((cx, cy));
        i += 1;
    }
    if let Some(&last) = dedup.last() {
        out.push(last);
    }

    if !densify {
        return out;
    }

    let mut dense: Vec<(f64, f64)> = Vec::with_capacity(out.len() * 2);
    dense.push(out[0]);
    for w in out.windows(2) {
        let (x1, y1) = w[0];
        let (x2, y2) = w[1];
        let d = (x2 - x1).hypot(y2 - y1);
        if d > 42.0 {
            let steps = (d / 32.0).ceil() as usize;
            for s in 1..steps {
                let t = (s as f64) / (steps as f64);
                dense.push((x1 + t * (x2 - x1), y1 + t * (y2 - y1)));
            }
        }
        dense.push((x2, y2));
    }
    dense
}

pub fn route_foot_waypoints(waypoints: &[(f64, f64)]) -> Option<Vec<(f64, f64)>> {
    route_waypoints_with_profile(waypoints, RouteProfile::Foot)
}

pub fn route_waypoints_with_profile(
    waypoints: &[(f64, f64)],
    profile: RouteProfile,
) -> Option<Vec<(f64, f64)>> {
    if waypoints.len() < 2 {
        return None;
    }
    let g_waypoints: Vec<(i32, i32)> = waypoints
        .iter()
        .map(|&(lat, lon)| lat_lon_to_global_grid(lat, lon))
        .collect();

    let Ok(guard) = tile_registry().lock() else {
        return None;
    };
    if guard.is_empty() {
        return None;
    }

    match profile {
        RouteProfile::Foot => {
            if let Some(path) = try_route_foot_with_margin(&guard, &g_waypoints, 1400) {
                return Some(path);
            }
            try_route_foot_with_margin(&guard, &g_waypoints, 3200)
        }
        _ => {
            if let Some(path) = try_route_transit_with_margin(&guard, &g_waypoints, 1600, profile) {
                return Some(path);
            }
            try_route_transit_with_margin(&guard, &g_waypoints, 3800, profile)
        }
    }
}

pub fn execute_foot_route_bytes(req: &[u8]) -> Vec<u8> {
    if req.len() < 8 {
        return encode_status(-2);
    }
    let magic = u32::from_le_bytes([req[0], req[1], req[2], req[3]]);
    let profile = match magic {
        FOOT_QUERY_MAGIC => RouteProfile::Foot,
        RAIL_QUERY_MAGIC => RouteProfile::Rail,
        TRAM_QUERY_MAGIC => RouteProfile::Tram,
        SUBW_QUERY_MAGIC => RouteProfile::Subway,
        BUS_QUERY_MAGIC => RouteProfile::Bus,
        _ => return encode_status(-2),
    };
    let count = u32::from_le_bytes([req[4], req[5], req[6], req[7]]) as usize;
    if count < 2 || req.len() < 8 + count * 16 {
        return encode_status(-2);
    }
    let mut waypoints = Vec::with_capacity(count);
    let mut offset = 8;
    for _ in 0..count {
        let lat = f64::from_le_bytes([
            req[offset],
            req[offset + 1],
            req[offset + 2],
            req[offset + 3],
            req[offset + 4],
            req[offset + 5],
            req[offset + 6],
            req[offset + 7],
        ]);
        let lon = f64::from_le_bytes([
            req[offset + 8],
            req[offset + 9],
            req[offset + 10],
            req[offset + 11],
            req[offset + 12],
            req[offset + 13],
            req[offset + 14],
            req[offset + 15],
        ]);
        offset += 16;
        if !lat.is_finite() || !lon.is_finite() {
            return encode_status(-2);
        }
        waypoints.push((lat, lon));
    }

    let Some(coords) = route_waypoints_with_profile(&waypoints, profile) else {
        return encode_status(-1);
    };

    let mut out = Vec::with_capacity(8 + coords.len() * 16);
    out.extend_from_slice(&0_i32.to_le_bytes());
    out.extend_from_slice(&(coords.len() as u32).to_le_bytes());
    for (lat, lon) in coords {
        out.extend_from_slice(&lat.to_le_bytes());
        out.extend_from_slice(&lon.to_le_bytes());
    }
    out
}

fn encode_status(status: i32) -> Vec<u8> {
    let mut out = Vec::with_capacity(8);
    out.extend_from_slice(&status.to_le_bytes());
    out.extend_from_slice(&0_u32.to_le_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push_varint(buf: &mut Vec<u8>, mut val: u64) {
        loop {
            let mut byte = (val & 0x7f) as u8;
            val >>= 7;
            if val != 0 {
                byte |= 0x80;
            }
            buf.push(byte);
            if val == 0 {
                break;
            }
        }
    }

    fn zigzag32(n: i32) -> u64 {
        ((n << 1) ^ (n >> 31)) as u32 as u64
    }

    struct TestFeature<'a> {
        class: &'a [u8],
        subclass: &'a [u8],
        service: &'a [u8],
        access: &'a [u8],
        brunnel: &'a [u8],
        layer: i64,
        oneway: i64,
        pts: &'a [(i32, i32)],
    }

    fn build_custom_mvt_tile(features: &[TestFeature<'_>]) -> Vec<u8> {
        let mut layer = Vec::new();
        push_varint(&mut layer, (1 << 3) | 2);
        push_varint(&mut layer, 14);
        layer.extend_from_slice(b"transportation");

        push_varint(&mut layer, (5 << 3) | 0);
        push_varint(&mut layer, 4096);

        let keys: [&[u8]; 7] = [
            b"class",
            b"subclass",
            b"service",
            b"access",
            b"brunnel",
            b"layer",
            b"oneway",
        ];
        for k in keys {
            push_varint(&mut layer, (3 << 3) | 2);
            push_varint(&mut layer, k.len() as u64);
            layer.extend_from_slice(k);
        }

        let mut val_bufs: Vec<Vec<u8>> = Vec::new();
        fn add_str_val(val_bufs: &mut Vec<Vec<u8>>, s: &[u8]) -> usize {
            let mut v = Vec::new();
            push_varint(&mut v, (1 << 3) | 2);
            push_varint(&mut v, s.len() as u64);
            v.extend_from_slice(s);
            let idx = val_bufs.len();
            val_bufs.push(v);
            idx
        }
        fn add_int_val(val_bufs: &mut Vec<Vec<u8>>, n: i64) -> usize {
            let mut v = Vec::new();
            push_varint(&mut v, (6 << 3) | 0);
            let zz = ((n << 1) ^ (n >> 63)) as u64;
            push_varint(&mut v, zz);
            let idx = val_bufs.len();
            val_bufs.push(v);
            idx
        }

        let mut encoded_feats: Vec<Vec<u8>> = Vec::new();
        for f in features {
            let mut tags = Vec::new();
            let pairs: [(usize, usize); 7] = [
                (0, add_str_val(&mut val_bufs, f.class)),
                (1, add_str_val(&mut val_bufs, f.subclass)),
                (2, add_str_val(&mut val_bufs, f.service)),
                (3, add_str_val(&mut val_bufs, f.access)),
                (4, add_str_val(&mut val_bufs, f.brunnel)),
                (5, add_int_val(&mut val_bufs, f.layer)),
                (6, add_int_val(&mut val_bufs, f.oneway)),
            ];
            for (ki, vi) in pairs {
                push_varint(&mut tags, ki as u64);
                push_varint(&mut tags, vi as u64);
            }

            let mut geom = Vec::new();
            if !f.pts.is_empty() {
                push_varint(&mut geom, (1 << 3) | 1);
                push_varint(&mut geom, zigzag32(f.pts[0].0));
                push_varint(&mut geom, zigzag32(f.pts[0].1));
                if f.pts.len() > 1 {
                    push_varint(&mut geom, (((f.pts.len() - 1) as u64) << 3) | 2);
                    for w in f.pts.windows(2) {
                        push_varint(&mut geom, zigzag32(w[1].0 - w[0].0));
                        push_varint(&mut geom, zigzag32(w[1].1 - w[0].1));
                    }
                }
            }

            let mut feat = Vec::new();
            push_varint(&mut feat, (2 << 3) | 2);
            push_varint(&mut feat, tags.len() as u64);
            feat.extend_from_slice(&tags);
            push_varint(&mut feat, (3 << 3) | 0);
            push_varint(&mut feat, 2);
            push_varint(&mut feat, (4 << 3) | 2);
            push_varint(&mut feat, geom.len() as u64);
            feat.extend_from_slice(&geom);
            encoded_feats.push(feat);
        }

        for v in val_bufs {
            push_varint(&mut layer, (4 << 3) | 2);
            push_varint(&mut layer, v.len() as u64);
            layer.extend_from_slice(&v);
        }
        for feat in encoded_feats {
            push_varint(&mut layer, (2 << 3) | 2);
            push_varint(&mut layer, feat.len() as u64);
            layer.extend_from_slice(&feat);
        }

        let mut tile = Vec::new();
        push_varint(&mut tile, (3 << 3) | 2);
        push_varint(&mut tile, layer.len() as u64);
        tile.extend_from_slice(&layer);
        tile
    }

    fn build_synthetic_mvt_tile(class: &[u8], subclass: &[u8]) -> Vec<u8> {
        let lines: [&[(i32, i32)]; 6] = [
            &[(1000, 1000), (2000, 1000)],
            &[(1000, 1500), (2000, 1500)],
            &[(1000, 2000), (2000, 2000)],
            &[(1000, 1000), (1000, 2000)],
            &[(1500, 1000), (1500, 2000)],
            &[(2000, 1000), (2000, 2000)],
        ];
        let feats: Vec<TestFeature<'_>> = lines
            .iter()
            .map(|pts| TestFeature {
                class,
                subclass,
                service: b"",
                access: b"",
                brunnel: b"",
                layer: 0,
                oneway: 0,
                pts,
            })
            .collect();
        build_custom_mvt_tile(&feats)
    }

    fn make_tile(tx: i32, ty: i32, mvt: &[u8]) -> CachedFootTile {
        let parsed = parse_mvt_transportation_all(tx, ty, mvt);
        CachedFootTile {
            tx,
            ty,
            segs: pre_split_tile_segments(tx, ty, &parsed.foot, true),
            rails: pre_split_tile_segments(tx, ty, &parsed.rail, false),
            trams: pre_split_tile_segments(tx, ty, &parsed.tram, false),
            subways: pre_split_tile_segments(tx, ty, &parsed.subway, false),
            buses: pre_split_tile_segments(tx, ty, &parsed.bus, true),
        }
    }

    #[test]
    fn parses_synthetic_mvt_and_routes_l_turn() {
        clear_foot_tiles();
        let mvt = build_synthetic_mvt_tile(b"path", b"footway");
        let tx = 8967;
        let ty = 5477;
        assert!(load_foot_tile(tx, ty, &mvt));
        assert!(has_foot_tile(tx, ty));

        let p_start = global_grid_to_lat_lon(
            f64::from(tx * 4096 + 1000),
            f64::from(ty * 4096 + 1000),
        );
        let p_corner = global_grid_to_lat_lon(
            f64::from(tx * 4096 + 1500),
            f64::from(ty * 4096 + 1000),
        );
        let p_end = global_grid_to_lat_lon(
            f64::from(tx * 4096 + 1500),
            f64::from(ty * 4096 + 2000),
        );

        let route = route_foot_waypoints(&[p_start, p_corner, p_end]).expect("route found");
        assert!(route.len() >= 3);
        assert!((route[0].0 - p_start.0).abs() < 1e-4);
        let last = route[route.len() - 1];
        assert!((last.0 - p_end.0).abs() < 1e-4);
    }

    #[test]
    fn rail_profile_follows_tracks_and_excludes_streets() {
        let tx = 8967;
        let ty = 5477;
        // Dwa tory połączone łukiem (nie pod kątem prostym na płaskim skrzyżowaniu).
        let tracks = build_custom_mvt_tile(&[
            TestFeature {
                class: b"rail",
                subclass: b"rail",
                service: b"",
                access: b"",
                brunnel: b"",
                layer: 0,
                oneway: 0,
                pts: &[(1000, 1000), (1600, 1000), (1850, 1150), (2000, 1400), (2000, 2000)],
            },
            TestFeature {
                class: b"primary",
                subclass: b"",
                service: b"",
                access: b"",
                brunnel: b"",
                layer: 0,
                oneway: 0,
                pts: &[(1000, 1000), (2000, 2000)],
            },
        ]);
        let tile = make_tile(tx, ty, &tracks);
        assert!(!tile.rails.is_empty());
        let start = (tx * 4096 + 1000, ty * 4096 + 1000);
        let end = (tx * 4096 + 2000, ty * 4096 + 2000);
        let route = try_route_transit_with_margin(&[tile], &[start, end], 1400, RouteProfile::Rail)
            .expect("rail route");
        // Musi przejść przez łuk (1600, 1000), a nie na skróty drogą po przekątnej (1500, 1500).
        let passes_curve = route.iter().any(|&(lat, lon)| {
            let (gx, gy) = lat_lon_to_global_grid(lat, lon);
            (gx - (tx * 4096 + 1600)).abs() < 40 && (gy - (ty * 4096 + 1000)).abs() < 40
        });
        assert!(passes_curve, "train must follow curved rail track, not road shortcut");
    }

    #[test]
    fn tram_profile_uses_only_tram_tracks_and_ignores_diamond_crossing() {
        let tx = 8967;
        let ty = 5477;
        // Krzyżowanie 90 stopni dwóch torów bez łuku + równoległa ulica.
        let mvt = build_custom_mvt_tile(&[
            TestFeature {
                class: b"transit",
                subclass: b"tram",
                service: b"",
                access: b"",
                brunnel: b"",
                layer: 0,
                oneway: 0,
                pts: &[(1000, 1500), (2000, 1500)],
            },
            TestFeature {
                class: b"transit",
                subclass: b"tram",
                service: b"",
                access: b"",
                brunnel: b"",
                layer: 0,
                oneway: 0,
                pts: &[(1500, 1000), (1500, 2000)],
            },
            TestFeature {
                class: b"primary",
                subclass: b"",
                service: b"",
                access: b"",
                brunnel: b"",
                layer: 0,
                oneway: 0,
                pts: &[(1000, 1500), (1500, 1500), (1500, 2000)],
            },
        ]);
        let tile = make_tile(tx, ty, &mvt);
        let a = (tx * 4096 + 1050, ty * 4096 + 1500);
        let b = (tx * 4096 + 1950, ty * 4096 + 1500);
        let c = (tx * 4096 + 1500, ty * 4096 + 1950);

        // Wzdłuż jednej linii tramwajowej działa.
        let straight =
            try_route_transit_with_margin(&[tile], &[a, b], 1400, RouteProfile::Tram)
                .expect("straight tram route");
        assert!(straight.len() >= 2);

        // Skręt 90 stopni na płaskim skrzyżowaniu bez zwrotnicy nie może przeskoczyć na poprzeczny tor.
        let tile2 = make_tile(tx, ty, &mvt);
        let cross = try_route_transit_with_margin(&[tile2], &[a, c], 1400, RouteProfile::Tram);
        assert!(cross.is_none(), "tram cannot jump 90 deg at a diamond crossing without switch");
    }

    #[test]
    fn bus_profile_picks_right_carriageway_and_ignores_driveway_spurs() {
        let tx = 8967;
        let ty = 5477;
        // Dwujezdniowa arteria: y=1500 jednokierunkowa w prawo (+x), y=1530 w lewo (-x),
        // oraz boczny wjazd (driveway) bliżej przystanku pośredniego niż sama jezdnia.
        let mvt = build_custom_mvt_tile(&[
            TestFeature {
                class: b"primary",
                subclass: b"",
                service: b"",
                access: b"",
                brunnel: b"",
                layer: 0,
                oneway: 1,
                pts: &[(1000, 1500), (2500, 1500)],
            },
            TestFeature {
                class: b"primary",
                subclass: b"",
                service: b"",
                access: b"",
                brunnel: b"",
                layer: 0,
                oneway: 1,
                pts: &[(2500, 1530), (1000, 1530)],
            },
            TestFeature {
                class: b"service",
                subclass: b"",
                service: b"driveway",
                access: b"",
                brunnel: b"",
                layer: 0,
                oneway: 0,
                pts: &[(1750, 1500), (1750, 1380)],
            },
        ]);
        let tile = make_tile(tx, ty, &mvt);
        // Przystanki idące na wschód (+x), przy czym środkowy pin leży lekko na północy przy wjeździe (driveway).
        let s0 = (tx * 4096 + 1100, ty * 4096 + 1518);
        let s1 = (tx * 4096 + 1750, ty * 4096 + 1465);
        let s2 = (tx * 4096 + 2400, ty * 4096 + 1518);

        let route =
            try_route_transit_with_margin(&[tile], &[s0, s1, s2], 1400, RouteProfile::Bus)
                .expect("bus route");
        for (lat, lon) in &route {
            let (_gx, gy) = lat_lon_to_global_grid(*lat, *lon);
            let ly = gy - ty * 4096;
            assert!(
                (ly - 1500).abs() <= 4,
                "bus must stay on eastbound carriageway y=1500, got ly={ly}"
            );
        }
    }

    #[test]
    fn bus_profile_does_not_uturn_when_first_stop_is_closer_to_opposite_carriageway() {
        // Dwujezdniowa aleja: jezdnia zachodnia (oneway=1, E->W) na y=2000 ma gęste krótkie
        // odcinki (węzły skrzyżowań), jezdnia wschodnia (oneway=1, W->E) na y=2060 (~22 m dalej).
        // Przystanek początkowy stoi bliżej jezdni zachodniej (y=2015), a autobus jedzie na wschód:
        // deduplikacja kandydatów nie może wypchnąć jezdni wschodniej z listy kandydatów.
        let tx = 8968i32;
        let ty = 5478i32;
        let mut owned_pts: Vec<Vec<(i32, i32)>> = Vec::new();
        for i in 0..8 {
            let x1 = 1500 - i * 80;
            let x2 = x1 - 80;
            owned_pts.push(vec![(x1, 2000), (x2, 2000)]);
        }
        let mut feats: Vec<TestFeature<'_>> = owned_pts
            .iter()
            .map(|pts| TestFeature {
                class: b"primary",
                subclass: b"",
                service: b"",
                access: b"",
                brunnel: b"",
                layer: 0,
                oneway: 1,
                pts: pts.as_slice(),
            })
            .collect();
        feats.push(TestFeature {
            class: b"minor",
            subclass: b"",
            service: b"",
            access: b"",
            brunnel: b"",
            layer: 0,
            oneway: 0,
            pts: &[(1200, 1900), (1200, 2000), (1200, 2060), (1200, 2160)],
        });
        feats.push(TestFeature {
            class: b"primary",
            subclass: b"",
            service: b"",
            access: b"",
            brunnel: b"",
            layer: 0,
            oneway: 0,
            pts: &[(860, 2000), (860, 2060)],
        });
        feats.push(TestFeature {
            class: b"primary",
            subclass: b"",
            service: b"",
            access: b"",
            brunnel: b"",
            layer: 0,
            oneway: 1,
            pts: &[(860, 2060), (1200, 2060), (2600, 2060)],
        });

        let mvt = build_custom_mvt_tile(&feats);
        let tile = make_tile(tx, ty, &mvt);
        let s0 = (tx * 4096 + 1200, ty * 4096 + 2015);
        let s1 = (tx * 4096 + 1800, ty * 4096 + 2055);
        let s2 = (tx * 4096 + 2500, ty * 4096 + 2055);
        let route =
            try_route_transit_with_margin(&[tile], &[s0, s1, s2], 1400, RouteProfile::Bus)
                .expect("bus route should start on eastbound carriageway");

        for (lat, lon) in &route {
            let (gx, _gy) = lat_lon_to_global_grid(*lat, *lon);
            let lx = gx - tx * 4096;
            assert!(
                lx >= 1185,
                "bus should not drive west to make a U-turn; got lx={lx}"
            );
        }
    }

    #[test]
    fn bus_profile_uses_busway_and_access_no_corridor() {
        let tx = 8967;
        let ty = 5477;
        let mvt = build_custom_mvt_tile(&[
            TestFeature {
                class: b"service",
                subclass: b"",
                service: b"",
                access: b"no",
                brunnel: b"",
                layer: 0,
                oneway: 0,
                pts: &[(1000, 1500), (2200, 1500)],
            },
            TestFeature {
                class: b"secondary",
                subclass: b"",
                service: b"",
                access: b"",
                brunnel: b"",
                layer: 0,
                oneway: 0,
                pts: &[(1000, 1500), (1000, 2200), (2200, 2200), (2200, 1500)],
            },
        ]);
        let tile = make_tile(tx, ty, &mvt);
        let s0 = (tx * 4096 + 1050, ty * 4096 + 1500);
        let s1 = (tx * 4096 + 2150, ty * 4096 + 1500);
        let route =
            try_route_transit_with_margin(&[tile], &[s0, s1], 1400, RouteProfile::Bus)
                .expect("busway route");
        for (lat, lon) in &route {
            let (_gx, gy) = lat_lon_to_global_grid(*lat, *lon);
            let ly = gy - ty * 4096;
            assert!(
                (ly - 1500).abs() <= 4,
                "bus must take direct access=no busway, got ly={ly}"
            );
        }
    }

    #[test]
    fn subway_profile_routes_on_tunnel_tracks_ignoring_larger_surface_network() {
        let tx = 8967;
        let ty = 5477;
        let mvt = build_custom_mvt_tile(&[
            TestFeature {
                class: b"transit",
                subclass: b"subway",
                service: b"",
                access: b"",
                brunnel: b"tunnel",
                layer: -2,
                oneway: 0,
                pts: &[(1000, 1200), (2000, 1200)],
            },
            // Większa osobna linia metra w tym samym kafelku (inna spójna składowa).
            TestFeature {
                class: b"transit",
                subclass: b"subway",
                service: b"",
                access: b"",
                brunnel: b"tunnel",
                layer: -2,
                oneway: 0,
                pts: &[(1000, 2600), (1500, 2600), (2000, 2600), (2500, 2600), (3000, 2600)],
            },
        ]);
        let tile = make_tile(tx, ty, &mvt);
        let s0 = (tx * 4096 + 1050, ty * 4096 + 1230);
        let s1 = (tx * 4096 + 1950, ty * 4096 + 1180);
        let route =
            try_route_transit_with_margin(&[tile], &[s0, s1], 1400, RouteProfile::Subway)
                .expect("subway route");
        for (lat, lon) in &route {
            let (_gx, gy) = lat_lon_to_global_grid(*lat, *lon);
            let ly = gy - ty * 4096;
            assert!((ly - 1200).abs() <= 4, "subway must stay on its own line y=1200, got ly={ly}");
        }
    }
}
