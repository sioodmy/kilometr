#!/usr/bin/env node
/**
 * build-station-amenities.mjs: pobiera z Overpassa udogodnienia w promieniu 50 m
 * od stacji kolejowych w Polsce (toalety, gastronomia, sklepy, kawiarnie,
 * piekarnie, apteki, bankomaty, przechowalnie bagażu) i zapisuje wynik
 * do cloudflare/data/station-amenities.json.
 *
 * Użycie: node cloudflare/scripts/build-station-amenities.mjs [--zip=plik.zip] [--limit=N]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_OVERPASS_MIRRORS, fetchOverpassElements, overpassMirrors } from './overpass.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = join(ROOT, 'data', 'station-amenities.json');
const FEED_URL = 'https://mkuran.pl/gtfs/polish_trains.zip';
const UA = 'KilometrStationAmenities/1.0 (https://github.com/sioodmy/kilometr)';

export const DEFAULT_RADIUS_M = 50;
const BUILDING_MATCH_MAX_M = 150;
const STATION_NODE_MAX_M = 100;

/**
 * Stała kolejność kluczy udogodnień dworca (najważniejsze pierwsze).
 * Musi być identyczna z STATION_AMENITY_ORDER w build-polska.mjs i src/services/stationAmenities.ts.
 */
export const STATION_AMENITY_ORDER = [
  'toilets',
  'gastronomy',
  'shop',
  'cafe',
  'bakery',
  'pharmacy',
  'atm',
  'luggage',
];

const GASTRONOMY_AMENITIES = new Set([
  'restaurant',
  'fast_food',
  'food_court',
  'pub',
  'bar',
  'ice_cream',
  'bistro',
]);

const SHOP_TYPES = new Set([
  'supermarket',
  'convenience',
  'mall',
  'department_store',
  'kiosk',
  'newsagent',
  'general',
  'greengrocer',
  'beverages',
  'books',
  'chemist',
  'cosmetics',
  'variety_store',
]);

const BAKERY_TYPES = new Set(['bakery', 'pastry', 'confectionery']);
const CAFE_SHOPS = new Set(['coffee', 'tea']);

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        q = !q;
      }
    } else if (c === ',' && !q) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Wyciąga stacje nadrzędne (location_type=1) z zawartości stops.txt. */
export function parseStationsCsv(content) {
  const lines = content.split(/\r?\n/);
  if (lines.length < 2) return [];
  let header = lines[0];
  if (header.charCodeAt(0) === 0xfeff) header = header.slice(1);
  const idx = Object.fromEntries(parseCsvLine(header).map((h, i) => [h.trim(), i]));
  const stations = new Map();
  const fallback = new Map();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const r = parseCsvLine(line);
    const id = r[idx.stop_id];
    const name = r[idx.stop_name] || '';
    const lat = Number(r[idx.stop_lat]);
    const lon = Number(r[idx.stop_lon]);
    const type = r[idx.location_type];
    const parent = r[idx.parent_station] || id;
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (type === '1') {
      stations.set(id, { stopId: id, name, lat, lon });
    } else if (parent && !stations.has(parent) && !fallback.has(parent)) {
      fallback.set(parent, { stopId: parent, name, lat, lon });
    }
  }
  for (const [id, s] of fallback) {
    if (!stations.has(id)) stations.set(id, s);
  }
  return [...stations.values()];
}

/** Mapuje tagi OSM na klucze udogodnień dworca. */
export function classifyStationElement(tags, includeStationTags = false) {
  if (!tags || typeof tags !== 'object') return [];
  const out = [];
  const amenity = tags.amenity;
  const shop = tags.shop;

  if (amenity === 'toilets') {
    out.push('toilets');
  } else if (
    includeStationTags &&
    (tags.railway === 'station' || tags.building === 'train_station') &&
    (tags.toilets === 'yes' || tags.toilets === 'designated')
  ) {
    out.push('toilets');
  }

  if (GASTRONOMY_AMENITIES.has(amenity)) out.push('gastronomy');
  if (SHOP_TYPES.has(shop)) out.push('shop');
  if (amenity === 'cafe' || CAFE_SHOPS.has(shop)) out.push('cafe');
  if (BAKERY_TYPES.has(shop)) out.push('bakery');
  if (amenity === 'pharmacy') out.push('pharmacy');
  if (amenity === 'atm' || (amenity === 'bank' && tags.atm === 'yes')) out.push('atm');
  if (amenity === 'luggage_locker' || tags.luggage_storage === 'yes') out.push('luggage');

  return out;
}

/** Odległość Haversine w metrach. */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function elementCoords(el) {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function extractBuildingRings(el) {
  const rings = [];
  if (Array.isArray(el.geometry) && el.geometry.length >= 2) {
    rings.push(el.geometry);
  } else if (Array.isArray(el.members)) {
    const outer = el.members.filter((m) => m.role !== 'inner' && Array.isArray(m.geometry) && m.geometry.length >= 2);
    const list = outer.length > 0 ? outer : el.members.filter((m) => Array.isArray(m.geometry) && m.geometry.length >= 2);
    for (const m of list) rings.push(m.geometry);
  }
  return rings;
}

function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Odległość punktu od poligonu/obrysu budynku w metrach (0 m w środku). */
export function pointToRingsDistanceM(lat, lon, rings) {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const ring of rings) {
    const pts = ring.map((p) => ({
      x: (p.lon - lon) * 111320 * cosLat,
      y: (p.lat - lat) * 110574,
    }));
    if (pts.length >= 3 && pointInPolygon(0, 0, pts)) return 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = pointToSegmentDist(0, 0, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      if (d < best) best = d;
    }
    if (pts.length >= 3) {
      const d = pointToSegmentDist(
        0,
        0,
        pts[pts.length - 1].x,
        pts[pts.length - 1].y,
        pts[0].x,
        pts[0].y,
      );
      if (d < best) best = d;
    }
  }
  return best;
}

/** Dopasowuje elementy Overpassa do listy stacji w zadanym promieniu. */
export function collectStationAmenities(stations, elements, radiusM = DEFAULT_RADIUS_M) {
  const buildings = [];
  const stationNodes = [];
  const pois = [];

  for (const el of elements) {
    const tags = el.tags;
    if (!tags) continue;
    if (tags.building === 'train_station') {
      const rings = extractBuildingRings(el);
      if (rings.length > 0) {
        let minLat = Infinity;
        let maxLat = -Infinity;
        let minLon = Infinity;
        let maxLon = -Infinity;
        for (const ring of rings) {
          for (const p of ring) {
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
            if (p.lon < minLon) minLon = p.lon;
            if (p.lon > maxLon) maxLon = p.lon;
          }
        }
        buildings.push({ rings, tags, minLat, maxLat, minLon, maxLon });
        continue;
      }
    }
    const coords = elementCoords(el);
    if (!coords) continue;
    if (tags.railway === 'station') {
      stationNodes.push({ ...coords, tags });
    }
    const keys = classifyStationElement(tags, false);
    if (keys.length > 0) {
      pois.push({ ...coords, keys });
    }
  }

  const result = {};
  for (const station of stations) {
    const matched = new Set();

    let bestBuilding = null;
    let bestBuildingDist = BUILDING_MATCH_MAX_M;
    for (const b of buildings) {
      if (
        station.lat < b.minLat - 0.0025 ||
        station.lat > b.maxLat + 0.0025 ||
        station.lon < b.minLon - 0.004 ||
        station.lon > b.maxLon + 0.004
      ) {
        continue;
      }
      const d = pointToRingsDistanceM(station.lat, station.lon, b.rings);
      if (d <= bestBuildingDist) {
        bestBuildingDist = d;
        bestBuilding = b;
      }
    }
    if (bestBuilding) {
      for (const k of classifyStationElement(bestBuilding.tags, true)) matched.add(k);
    }

    for (const sn of stationNodes) {
      if (Math.abs(sn.lat - station.lat) > 0.002 || Math.abs(sn.lon - station.lon) > 0.003) continue;
      if (haversineMeters(station.lat, station.lon, sn.lat, sn.lon) <= STATION_NODE_MAX_M) {
        for (const k of classifyStationElement(sn.tags, true)) matched.add(k);
      }
    }

    const latMin = (bestBuilding ? Math.min(station.lat, bestBuilding.minLat) : station.lat) - 0.0012;
    const latMax = (bestBuilding ? Math.max(station.lat, bestBuilding.maxLat) : station.lat) + 0.0012;
    const lonMin = (bestBuilding ? Math.min(station.lon, bestBuilding.minLon) : station.lon) - 0.002;
    const lonMax = (bestBuilding ? Math.max(station.lon, bestBuilding.maxLon) : station.lon) + 0.002;

    for (const poi of pois) {
      if (poi.lat < latMin || poi.lat > latMax || poi.lon < lonMin || poi.lon > lonMax) continue;
      const nearStop = haversineMeters(station.lat, station.lon, poi.lat, poi.lon) <= radiusM;
      const nearBuilding =
        bestBuilding !== null && pointToRingsDistanceM(poi.lat, poi.lon, bestBuilding.rings) <= radiusM;
      if (nearStop || nearBuilding) {
        for (const k of poi.keys) matched.add(k);
      }
    }

    if (matched.size > 0) {
      result[station.stopId] = STATION_AMENITY_ORDER.filter((k) => matched.has(k));
    }
  }
  return result;
}

/** Dzieli stacje na kafle 0.5° (a gęste węzły na 0.25°), żeby Overpass nie przekroczył limitu. */
export function groupStationCells(stations, stepDeg = 0.5, maxPerCell = 45) {
  const byCell = new Map();
  for (const s of stations) {
    const key = `${Math.floor(s.lat / stepDeg)},${Math.floor(s.lon / stepDeg)}`;
    let list = byCell.get(key);
    if (!list) {
      list = [];
      byCell.set(key, list);
    }
    list.push(s);
  }
  const cells = [];
  for (const list of byCell.values()) {
    if (list.length > maxPerCell && stepDeg > 0.25) {
      cells.push(...groupStationCells(list, stepDeg / 2, maxPerCell));
    } else {
      cells.push(list);
    }
  }
  return cells;
}

function cellBbox(stations) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const s of stations) {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lon < minLon) minLon = s.lon;
    if (s.lon > maxLon) maxLon = s.lon;
  }
  return {
    south: minLat - 0.003,
    west: minLon - 0.005,
    north: maxLat + 0.003,
    east: maxLon + 0.005,
  };
}

export function buildCellOverpassQuery(bbox) {
  const b = `${bbox.south.toFixed(5)},${bbox.west.toFixed(5)},${bbox.north.toFixed(5)},${bbox.east.toFixed(5)}`;
  return (
    `[out:json][timeout:45];` +
    `(way["building"="train_station"](${b});relation["building"="train_station"](${b});)->.b;` +
    `.b out geom;` +
    `(nwr["railway"="station"](${b});` +
    `nwr["amenity"~"^(toilets|restaurant|fast_food|cafe|food_court|pub|bar|ice_cream|pharmacy|atm|luggage_locker)$"](${b});` +
    `nwr["shop"~"^(supermarket|convenience|bakery|pastry|confectionery|kiosk|newsagent|mall|department_store|coffee|tea|books|beverages|chemist|cosmetics|general|greengrocer|variety_store)$"](${b});` +
    `nwr["luggage_storage"="yes"](${b}););` +
    `out center tags;`
  );
}

async function loadStopsTxt(zipArg) {
  let zipPath = zipArg;
  let cleanupDir = null;
  if (!zipPath) {
    cleanupDir = join(tmpdir(), `kilometr-station-amenities-${Date.now()}`);
    mkdirSync(cleanupDir, { recursive: true });
    zipPath = join(cleanupDir, 'polish_trains.zip');
    console.log(`[station-amenities] pobieram ${FEED_URL}...`);
    const res = await fetch(FEED_URL, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} @ ${FEED_URL}`);
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  }
  const workDir = join(tmpdir(), `kilometr-station-stops-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  try {
    execFileSync('unzip', ['-o', '-q', zipPath, 'stops.txt', '-d', workDir], { stdio: 'ignore' });
    return readFileSync(join(workDir, 'stops.txt'), 'utf8');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    if (cleanupDir) rmSync(cleanupDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const zipArg = args.find((a) => a.startsWith('--zip='))?.slice(6);
  const limitArg = Number(args.find((a) => a.startsWith('--limit='))?.slice(8) || 0);
  const mirrors = overpassMirrors(process.env.OVERPASS_URL);

  const stopsContent = await loadStopsTxt(zipArg);
  const stations = parseStationsCsv(stopsContent);
  const cells = groupStationCells(stations);
  const totalCells = limitArg > 0 ? Math.min(limitArg, cells.length) : cells.length;
  console.log(`[station-amenities] stacji: ${stations.length}, kafli: ${totalCells}/${cells.length}`);

  const merged = {};
  if (existsSync(OUT_FILE) && limitArg > 0) {
    const prev = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
    Object.assign(merged, prev.stations || {});
  }

  for (let i = 0; i < totalCells; i++) {
    const cellStations = cells[i];
    const query = buildCellOverpassQuery(cellBbox(cellStations));
    let elements = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        elements = await fetchOverpassElements({
          query,
          mirrors: attempt === 0 ? mirrors : DEFAULT_OVERPASS_MIRRORS.slice(attempt),
          userAgent: UA,
          timeoutMs: 45_000,
          hedgeMs: 12_000,
        });
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    const cellHits = collectStationAmenities(cellStations, elements, DEFAULT_RADIUS_M);
    Object.assign(merged, cellHits);
    if ((i + 1) % 20 === 0 || i + 1 === totalCells) {
      console.log(
        `[station-amenities] postęp ${i + 1}/${totalCells} (stacji z udogodnieniami: ${Object.keys(merged).length})`,
      );
    }
  }

  const sorted = Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => a.localeCompare(b, 'en')),
  );
  const payload = {
    builtAt: new Date().toISOString(),
    radiusM: DEFAULT_RADIUS_M,
    stationCount: Object.keys(sorted).length,
    stations: sorted,
  };
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + '\n');
  console.log(`[station-amenities] zapisano ${Object.keys(sorted).length} stacji do ${OUT_FILE}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[station-amenities] błąd:', err);
    process.exit(1);
  });
}
