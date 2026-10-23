#![forbid(unsafe_code)]

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::sync::{Mutex, OnceLock};

pub const FOOT_QUERY_MAGIC: u32 = 0x464F_4F54; // "FOOT"
const RAIL_QUERY_MAGIC: u32 = 0x5241_494C;
const TILE_ZOOM: u32 = 14;
const DEFAULT_EXTENT: i32 = 4096;
const MAX_CACHED_TILES: usize = 48;

#[derive(Clone, Copy)]
struct RawSeg {
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
    weight_milli: u16,
    layer: i8,
    is_connector: bool,
}

#[derive(Clone, Copy)]
pub struct SplitSeg {
    pub x1: i32,
    pub y1: i32,
    pub x2: i32,
    pub y2: i32,
    pub weight_milli: u16,
}

struct CachedFootTile {
    tx: i32,
    ty: i32,
    segs: Vec<SplitSeg>,
    rails: Vec<SplitSeg>,
}

static FOOT_TILES: OnceLock<Mutex<Vec<CachedFootTile>>> = OnceLock::new();

fn tile_registry() -> &'static Mutex<Vec<CachedFootTile>> {
    FOOT_TILES.get_or_init(|| Mutex::new(Vec::with_capacity(16)))
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
    let raw_segs = parse_mvt_transportation(tx, ty, mvt_bytes, false);
    let split_segs = pre_split_tile_segments(tx, ty, &raw_segs);
    let rails = pre_split_tile_segments(tx, ty, &parse_mvt_transportation(tx, ty, mvt_bytes, true));
    let Ok(mut guard) = tile_registry().lock() else {
        return false;
    };
    if let Some(pos) = guard.iter().position(|t| t.tx == tx && t.ty == ty) {
        let mut entry = guard.remove(pos);
        entry.segs = split_segs;
        entry.rails = rails;
        guard.push(entry);
        return true;
    }
    if guard.len() >= MAX_CACHED_TILES {
        guard.remove(0);
    }
    guard.push(CachedFootTile {
        tx,
        ty,
        segs: split_segs,
        rails,
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

fn emit_ring_segments(
    ring: &[(i32, i32)],
    gtype: u32,
    weight_milli: u16,
    layer: i8,
    is_connector: bool,
    out: &mut Vec<RawSeg>,
) {
    if ring.len() < 2 {
        return;
    }
    for i in 0..ring.len() - 1 {
        let (x1, y1) = ring[i];
        let (x2, y2) = ring[i + 1];
        if x1 == x2 && y1 == y2 {
            continue;
        }
        out.push(RawSeg {
            x1,
            y1,
            x2,
            y2,
            weight_milli,
            layer,
            is_connector,
        });
    }
    // For pedestrian polygons (squares/plazas), add chords across the ring
    // so routes can cross open plazas naturally instead of hugging walls.
    if gtype == 3 && (4..=40).contains(&ring.len()) {
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
                            is_connector: true,
                        });
                    }
                }
            }
        }
    }
}

fn parse_mvt_transportation(tx: i32, ty: i32, mvt_bytes: &[u8], rail: bool) -> Vec<RawSeg> {
    let mut raw_segs = Vec::with_capacity(8192);
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
                        (b"ramp", MvtVal::Bool(b)) => ramp = b,
                        (b"ramp", MvtVal::Int(n)) => ramp = n != 0,
                        _ => {}
                    }
                }

                let classification = if rail {
                    (class == b"rail" && matches!(subclass, b"rail" | b"narrow_gauge"))
                        .then_some((1000, false))
                } else {
                    classify_pedestrian_way(class, subclass, foot, access, service, brunnel, ramp)
                };
                let Some((weight_milli, is_connector)) = classification else {
                    continue;
                };

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

                while gp < geom_slice.len() {
                    let Some((cmd_int, gp1)) = read_varint(geom_slice, gp) else {
                        break;
                    };
                    gp = gp1;
                    let cmd = (cmd_int & 7) as u32;
                    let count = (cmd_int >> 3) as usize;
                    if cmd == 1 {
                        for _ in 0..count {
                            emit_ring_segments(
                                &ring_buf,
                                gtype,
                                weight_milli,
                                layer_val,
                                is_connector,
                                &mut raw_segs,
                            );
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
                emit_ring_segments(
                    &ring_buf,
                    gtype,
                    weight_milli,
                    layer_val,
                    is_connector,
                    &mut raw_segs,
                );
            }
        } else {
            let Some(next) = skip_field(mvt_bytes, wire, pos) else {
                break;
            };
            pos = next;
        }
    }

    raw_segs
}

fn pre_split_tile_segments(tx: i32, ty: i32, raw_segs: &[RawSeg]) -> Vec<SplitSeg> {
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

                    // Proper crossing on the same layer.
                    if a.layer == b.layer {
                        let denom = adx * bdy - ady * bdx;
                        if denom.abs() > 1e-6 {
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

                    // T-junctions: endpoints of b onto a, and endpoints of a onto b.
                    if a.layer == b.layer || a.is_connector || b.is_connector {
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

                        let blen_sq = bdx * bdx + bdy * bdy;
                        if blen_sq >= 0.5 {
                            for (px, py) in [(a.x1, a.y1), (a.x2, a.y2)] {
                                let u = (f64::from(px - b.x1) * bdx + f64::from(py - b.y1) * bdy)
                                    / blen_sq;
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
            });
            continue;
        }
        pts_buf.clear();
        pts_buf.push((0.0, s.x1, s.y1));
        pts_buf.extend_from_slice(&splits[i]);
        pts_buf.push((1.0, s.x2, s.y2));
        pts_buf.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal));

        for w in pts_buf.windows(2) {
            let (_, x1, y1) = w[0];
            let (_, x2, y2) = w[1];
            if x1 == x2 && y1 == y2 {
                continue;
            }
            out.push(SplitSeg {
                x1,
                y1,
                x2,
                y2,
                weight_milli: s.weight_milli,
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

fn try_route_with_margin(
    tiles: &[CachedFootTile],
    g_waypoints: &[(i32, i32)],
    margin: i32,
    rail: bool,
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

    // Weld vertices within 3 units (~1.1m).
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
        for s in if rail { &tile.rails } else { &tile.segs } {
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

    // Identify connected components so we snap waypoints to a mutually reachable component.
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
        if rail && best_d2 > 800.0_f64.powi(2) {
            return None;
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

        // Direct on-edge walk if both endpoints snap to the same edge.
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

        while let Some(HeapItem { g_cost, node: u, .. }) = heap.pop() {
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
                // Subtle turn smoothness penalty (Organic Maps style) so collinear streets beat staircase paths.
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

        let cost_via_u =
            dist[s2.u] + (f64::from(nodes[s2.u].0) - s2.px).hypot(f64::from(nodes[s2.u].1) - s2.py) * w2;
        let cost_via_v =
            dist[s2.v] + (f64::from(nodes[s2.v].0) - s2.px).hypot(f64::from(nodes[s2.v].1) - s2.py) * w2;

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

    let cleaned = if rail { full_grid_path } else { smooth_micro_jogs(&full_grid_path) };
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

fn smooth_micro_jogs(pts: &[(f64, f64)]) -> Vec<(f64, f64)> {
    if pts.len() <= 2 {
        return pts.to_vec();
    }
    // 1) Deduplicate points closer than 1.2 grid units (~0.45m).
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

    // 2) Collapse tiny quantization steps (< 5 units ~ 1.8m) when the surrounding segments align.
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
                // Nearly collinear or a tiny quantization step
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

    // 3) Densify long straight segments (> 42 grid units ~ 16m) so vertex spacing matches OSRM overview=full.
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
    route_waypoints(waypoints, false)
}

fn route_waypoints(waypoints: &[(f64, f64)], rail: bool) -> Option<Vec<(f64, f64)>> {
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

    if let Some(path) = try_route_with_margin(&guard, &g_waypoints, 1400, rail) {
        return Some(path);
    }
    try_route_with_margin(&guard, &g_waypoints, 3200, rail)
}

pub fn execute_foot_route_bytes(req: &[u8]) -> Vec<u8> {
    if req.len() < 8 {
        return encode_status(-2);
    }
    let magic = u32::from_le_bytes([req[0], req[1], req[2], req[3]]);
    if magic != FOOT_QUERY_MAGIC && magic != RAIL_QUERY_MAGIC {
        return encode_status(-2);
    }
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

    let Some(coords) = route_waypoints(&waypoints, magic == RAIL_QUERY_MAGIC) else {
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

    fn build_synthetic_mvt_tile(class: &[u8], subclass: &[u8]) -> Vec<u8> {
        // Synthetic OpenMapTiles `transportation` layer with a street grid:
        // Horizontal roads at y = 1000, 1500, 2000; vertical roads at x = 1000, 1500, 2000.
        let mut layer = Vec::new();
        // field 1: name = "transportation"
        push_varint(&mut layer, (1 << 3) | 2);
        push_varint(&mut layer, 14);
        layer.extend_from_slice(b"transportation");

        // field 5: extent = 4096
        push_varint(&mut layer, (5 << 3) | 0);
        push_varint(&mut layer, 4096);

        // field 3: key 0 = "class", key 1 = "subclass"
        for k in [b"class".as_slice(), b"subclass".as_slice()] {
            push_varint(&mut layer, (3 << 3) | 2);
            push_varint(&mut layer, k.len() as u64);
            layer.extend_from_slice(k);
        }

        for v in [class, subclass] {
            let mut vbuf = Vec::new();
            push_varint(&mut vbuf, (1 << 3) | 2);
            push_varint(&mut vbuf, v.len() as u64);
            vbuf.extend_from_slice(v);
            push_varint(&mut layer, (4 << 3) | 2);
            push_varint(&mut layer, vbuf.len() as u64);
            layer.extend_from_slice(&vbuf);
        }

        let lines = [
            ((1000, 1000), (2000, 1000)),
            ((1000, 1500), (2000, 1500)),
            ((1000, 2000), (2000, 2000)),
            ((1000, 1000), (1000, 2000)),
            ((1500, 1000), (1500, 2000)),
            ((2000, 1000), (2000, 2000)),
        ];

        for ((x1, y1), (x2, y2)) in lines {
            let mut feat = Vec::new();
            // tags: [0, 0, 1, 1]
            let mut tags = Vec::new();
            push_varint(&mut tags, 0);
            push_varint(&mut tags, 0);
            push_varint(&mut tags, 1);
            push_varint(&mut tags, 1);
            push_varint(&mut feat, (2 << 3) | 2);
            push_varint(&mut feat, tags.len() as u64);
            feat.extend_from_slice(&tags);

            // gtype = 2 (LineString)
            push_varint(&mut feat, (3 << 3) | 0);
            push_varint(&mut feat, 2);

            // geom: MoveTo(1), dx1, dy1, LineTo(1), dx2, dy2
            let mut geom = Vec::new();
            push_varint(&mut geom, (1 << 3) | 1);
            push_varint(&mut geom, zigzag32(x1));
            push_varint(&mut geom, zigzag32(y1));
            push_varint(&mut geom, (1 << 3) | 2);
            push_varint(&mut geom, zigzag32(x2 - x1));
            push_varint(&mut geom, zigzag32(y2 - y1));
            push_varint(&mut feat, (4 << 3) | 2);
            push_varint(&mut feat, geom.len() as u64);
            feat.extend_from_slice(&geom);

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
        let tracks = build_synthetic_mvt_tile(b"rail", b"rail");
        let streets = build_synthetic_mvt_tile(b"minor", b"residential");
        assert!(parse_mvt_transportation(tx, ty, &streets, true).is_empty());
        assert!(parse_mvt_transportation(tx, ty, &tracks, false).is_empty());
        let rails = pre_split_tile_segments(tx, ty, &parse_mvt_transportation(tx, ty, &tracks, true));
        let tiles = [CachedFootTile { tx, ty, segs: Vec::new(), rails }];
        let start = (tx * 4096 + 1000, ty * 4096 + 1000);
        let end = (tx * 4096 + 2000, ty * 4096 + 2000);
        let route = try_route_with_margin(&tiles, &[start, end], 1400, true).expect("rail route");
        assert!(route.len() > 2);
        for (lat, lon) in route {
            let (x, y) = lat_lon_to_global_grid(lat, lon);
            assert!([1000, 1500, 2000].contains(&(x - tx * 4096))
                || [1000, 1500, 2000].contains(&(y - ty * 4096)));
        }
        assert!(try_route_with_margin(&tiles, &[start, end], 1400, false).is_none());
        let far = (start.0 - 2000, start.1 - 2000);
        assert!(try_route_with_margin(&tiles, &[far, end], 3200, true).is_none());
    }
}
