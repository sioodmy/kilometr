#!/usr/bin/env node
/**
 * build-platform-sides.mjs: pobiera z Overpassa geometrię torów i peronów
 * przy stacjach kolejowych w Polsce i wyznacza azymut od toru w stronę peronu
 * (0..359° albo -1 przy peronach po obu stronach toru).
 *
 * Wynik zapisuje do cloudflare/data/station-platform-sides.json, skąd
 * build-polska.mjs pakuje go do tabeli `platform_sides` w bazie `polska`.
 *
 * Użycie: node cloudflare/scripts/build-platform-sides.mjs [--zip=plik.zip] [--limit=N]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_OVERPASS_MIRRORS, fetchOverpassElements, overpassMirrors } from './overpass.mjs';
import { groupStationCells, parseStationsCsv } from './build-station-amenities.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = join(ROOT, 'data', 'station-platform-sides.json');
const FEED_URL = 'https://mkuran.pl/gtfs/polish_trains.zip';
const UA = 'KilometrPlatformSides/1.0 (https://github.com/sioodmy/kilometr)';

export const BOTH_SIDES_BEARING = -1;

const STATION_RADIUS_M = 190;
const MAX_PLATFORM_DIST_M = 6.5;
const BOTH_SIDES_MAX_DIST_M = 5.5;
const SIDE_MARGIN_M = 1.8;
const MIN_LENGTH_M = 15;
const MIN_CONCENTRATION_R = 0.92;
const SUBSEGMENT_MAX_M = 18;

const ROMAN_TO_ARABIC = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12',
};

/** Normalizuje oznaczenie peronu (spójnie z src/services/trainDoorSide.ts). */
export function normalizePlatformKey(raw) {
  if (!raw) return '';
  let s = String(raw)
    .trim()
    .toLowerCase()
    .replace(/^(?:peron|platform|per\.?)\s+/i, '')
    .replace(/\s+/g, '');
  if (!s) return '';
  const romanMatch = s.match(/^(xii|xi|ix|x|viii|vii|vi|iv|v|iii|ii|i)([a-z]?)$/);
  if (romanMatch && ROMAN_TO_ARABIC[romanMatch[1]]) {
    s = `${ROMAN_TO_ARABIC[romanMatch[1]]}${romanMatch[2]}`;
  }
  return s.replace(/^0+(\d)/, '$1');
}

/** Normalizuje oznaczenie toru (spójnie z src/services/trainDoorSide.ts). */
export function normalizeTrackKey(raw) {
  if (!raw) return '';
  const s = String(raw)
    .trim()
    .toLowerCase()
    .replace(/^(?:tor|track)\s+/i, '')
    .replace(/\s+/g, '');
  if (!s) return '';
  return s.replace(/^0+(\d)/, '$1');
}

/** Wyciąga numer peronu z tagów `railway=platform` (pomija `platform_edge` i listy torów `1;2`). */
export function extractPlatformRef(tags) {
  if (!tags || tags.railway !== 'platform') return '';
  const name = String(tags.name || '');
  const nameMatch = name.match(/\bperon\s+(xii|xi|ix|x|viii|vii|vi|iv|v|iii|ii|i|\d{1,2})([a-z]?)\b/i);
  if (nameMatch) return normalizePlatformKey(`${nameMatch[1]}${nameMatch[2] || ''}`);

  const localRef = String(tags.local_ref || '').trim();
  if (/^(?:xii|xi|ix|x|viii|vii|vi|iv|v|iii|ii|i|\d{1,2})[a-z]?$/i.test(localRef)) {
    return normalizePlatformKey(localRef);
  }

  const ref = String(tags.ref || '').trim();
  if (ref && !/[;,/]/.test(ref) && /^(?:xii|xi|ix|x|viii|vii|vi|iv|v|iii|ii|i|\d{1,2})[a-z]?$/i.test(ref)) {
    return normalizePlatformKey(ref);
  }
  return '';
}

function isHeavyRailPlatform(tags) {
  if (!tags) return false;
  if (tags.railway !== 'platform' && tags.railway !== 'platform_edge') return false;
  if (tags.train === 'yes') return true;
  if (
    tags.tram === 'yes' ||
    tags.bus === 'yes' ||
    tags.trolleybus === 'yes' ||
    tags.light_rail === 'yes' ||
    tags.subway === 'yes'
  ) {
    return false;
  }
  return true;
}

function isPassengerRail(tags) {
  if (!tags || tags.railway !== 'rail') return false;
  if (tags.usage === 'industrial' || tags.usage === 'military') return false;
  if (tags.service === 'yard' || tags.service === 'crossover') return false;
  return true;
}

function layersCompatible(railTags, platTags) {
  if (railTags?.layer == null || platTags?.layer == null) return true;
  const r = Number(railTags.layer);
  const p = Number(platTags.layer);
  if (!Number.isFinite(r) || !Number.isFinite(p)) return true;
  return r === p;
}

function extractGeometries(el) {
  if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2) {
    return [el.geometry];
  }
  if (el.type === 'relation' && Array.isArray(el.members)) {
    return el.members
      .filter((m) => Array.isArray(m.geometry) && m.geometry.length >= 2)
      .map((m) => m.geometry);
  }
  return [];
}

function geomBbox(pts) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

function toLocalXY(lat, lon, lat0, lon0, cosLat) {
  return [(lon - lon0) * 111320 * cosLat, (lat - lat0) * 110574];
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), cx, cy };
}

function closestPointOnPolyline(px, py, xyPts) {
  let best = { dist: Infinity, cx: 0, cy: 0 };
  for (let i = 0; i < xyPts.length - 1; i++) {
    const r = closestPointOnSegment(
      px,
      py,
      xyPts[i][0],
      xyPts[i][1],
      xyPts[i + 1][0],
      xyPts[i + 1][1],
    );
    if (r.dist < best.dist) best = r;
  }
  return best;
}

function subdivideSegment(ax, ay, bx, by) {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return [];
  const steps = Math.max(1, Math.ceil(len / SUBSEGMENT_MAX_M));
  const out = [];
  for (let s = 0; s < steps; s++) {
    const t0 = s / steps;
    const t1 = (s + 1) / steps;
    const x0 = ax + (bx - ax) * t0;
    const y0 = ay + (by - ay) * t0;
    const x1 = ax + (bx - ax) * t1;
    const y1 = ay + (by - ay) * t1;
    out.push({
      mx: (x0 + x1) / 2,
      my: (y0 + y1) / 2,
      ux: (bx - ax) / len,
      uy: (by - ay) / len,
      len: len / steps,
    });
  }
  return out;
}

function summarizeBearingVotes(votes) {
  let oneLen = 0;
  let bothLen = 0;
  let sx = 0;
  let sy = 0;
  for (const v of votes) {
    if (v.side === 'both') {
      bothLen += v.len;
    } else if (v.side === 'one') {
      oneLen += v.len;
      const rad = (v.deg * Math.PI) / 180;
      sx += Math.sin(rad) * v.len;
      sy += Math.cos(rad) * v.len;
    }
  }
  if (oneLen < MIN_LENGTH_M && bothLen < MIN_LENGTH_M) return null;
  if (bothLen >= MIN_LENGTH_M && bothLen > oneLen * 0.35) {
    return BOTH_SIDES_BEARING;
  }
  if (oneLen < MIN_LENGTH_M) return null;
  const R = Math.hypot(sx, sy) / oneLen;
  if (R < MIN_CONCENTRATION_R) return null;
  return (Math.round((Math.atan2(sx, sy) * 180) / Math.PI) + 360) % 360;
}

/**
 * Wylicza mapę `{ "t:<tor>": bearing, "p:<peron>": bearing, "*": bearing }`
 * dla listy stacji na podstawie elementów zwróconych przez Overpass.
 */
export function computeStationPlatformSides(stations, elements) {
  const rails = [];
  const platforms = [];

  for (const el of elements) {
    const tags = el.tags;
    if (!tags) continue;
    if (isPassengerRail(tags)) {
      for (const geom of extractGeometries(el)) {
        rails.push({ geom, tags, box: geomBbox(geom) });
      }
    } else if (isHeavyRailPlatform(tags)) {
      for (const geom of extractGeometries(el)) {
        platforms.push({
          geom,
          tags,
          box: geomBbox(geom),
          platRef: extractPlatformRef(tags),
        });
      }
    }
  }

  const out = {};
  const latPad = STATION_RADIUS_M / 110574 + 0.0005;

  for (const station of stations) {
    const cosLat = Math.cos((station.lat * Math.PI) / 180);
    const lonPad = STATION_RADIUS_M / (111320 * cosLat) + 0.0008;

    const nearPlatforms = [];
    for (const p of platforms) {
      if (
        station.lat < p.box.minLat - latPad ||
        station.lat > p.box.maxLat + latPad ||
        station.lon < p.box.minLon - lonPad ||
        station.lon > p.box.maxLon + lonPad
      ) {
        continue;
      }
      const xy = p.geom.map((pt) => toLocalXY(pt.lat, pt.lon, station.lat, station.lon, cosLat));
      nearPlatforms.push({ xy, tags: p.tags, platRef: p.platRef });
    }
    if (nearPlatforms.length === 0) continue;

    const nearRails = [];
    for (const r of rails) {
      if (
        station.lat < r.box.minLat - latPad ||
        station.lat > r.box.maxLat + latPad ||
        station.lon < r.box.minLon - lonPad ||
        station.lon > r.box.maxLon + lonPad
      ) {
        continue;
      }
      const xy = r.geom.map((pt) => toLocalXY(pt.lat, pt.lon, station.lat, station.lon, cosLat));
      nearRails.push({
        xy,
        tags: r.tags,
        trackKey: normalizeTrackKey(r.tags['railway:track_ref']),
      });
    }
    if (nearRails.length === 0) continue;

    const votesByTrack = new Map();
    const votesByPlatform = new Map();
    const allVotes = [];

    for (const rail of nearRails) {
      for (let i = 0; i < rail.xy.length - 1; i++) {
        const subs = subdivideSegment(
          rail.xy[i][0],
          rail.xy[i][1],
          rail.xy[i + 1][0],
          rail.xy[i + 1][1],
        );
        for (const seg of subs) {
          if (Math.hypot(seg.mx, seg.my) > STATION_RADIUS_M) continue;

          let minLeft = Infinity;
          let minRight = Infinity;
          let leftPlatRef = '';
          let rightPlatRef = '';

          for (const plat of nearPlatforms) {
            if (!layersCompatible(rail.tags, plat.tags)) continue;
            const c = closestPointOnPolyline(seg.mx, seg.my, plat.xy);
            if (c.dist > MAX_PLATFORM_DIST_M) continue;
            const vx = c.cx - seg.mx;
            const vy = c.cy - seg.my;
            const cross = seg.ux * vy - seg.uy * vx; // >0 lewo, <0 prawo
            if (cross > 0 && c.dist < minLeft) {
              minLeft = c.dist;
              leftPlatRef = plat.platRef;
            } else if (cross < 0 && c.dist < minRight) {
              minRight = c.dist;
              rightPlatRef = plat.platRef;
            }
          }

          const hasLeft = minLeft <= MAX_PLATFORM_DIST_M;
          const hasRight = minRight <= MAX_PLATFORM_DIST_M;
          if (!hasLeft && !hasRight) continue;

          let vote = null;
          let winningPlatRef = '';
          if (
            minLeft <= BOTH_SIDES_MAX_DIST_M &&
            minRight <= BOTH_SIDES_MAX_DIST_M &&
            Math.abs(minLeft - minRight) < SIDE_MARGIN_M
          ) {
            vote = { side: 'both', len: seg.len };
          } else if (hasLeft && (!hasRight || minLeft + SIDE_MARGIN_M <= minRight)) {
            const deg = ((Math.atan2(-seg.uy, seg.ux) * 180) / Math.PI + 360) % 360;
            vote = { side: 'one', deg, len: seg.len };
            winningPlatRef = leftPlatRef;
          } else if (hasRight && (!hasLeft || minRight + SIDE_MARGIN_M <= minLeft)) {
            const deg = ((Math.atan2(seg.uy, -seg.ux) * 180) / Math.PI + 360) % 360;
            vote = { side: 'one', deg, len: seg.len };
            winningPlatRef = rightPlatRef;
          }
          if (!vote) continue;

          allVotes.push(vote);
          if (rail.trackKey) {
            let list = votesByTrack.get(rail.trackKey);
            if (!list) {
              list = [];
              votesByTrack.set(rail.trackKey, list);
            }
            list.push(vote);
          }
          if (winningPlatRef && vote.side === 'one') {
            let list = votesByPlatform.get(winningPlatRef);
            if (!list) {
              list = [];
              votesByPlatform.set(winningPlatRef, list);
            }
            list.push(vote);
          }
        }
      }
    }

    const stationEntries = {};
    for (const [trackKey, votes] of votesByTrack) {
      const b = summarizeBearingVotes(votes);
      if (b !== null) stationEntries[`t:${trackKey}`] = b;
    }
    for (const [platRef, votes] of votesByPlatform) {
      // Peron wyspowy dostaje głosy z obu stron (przeciwne azymuty -> R ~ 0),
      // więc summarizeBearingVotes automatycznie go odrzuca.
      const b = summarizeBearingVotes(votes);
      if (b !== null && b !== BOTH_SIDES_BEARING) {
        stationEntries[`p:${platRef}`] = b;
      }
    }
    const stationDefault = summarizeBearingVotes(allVotes);
    if (stationDefault !== null && stationDefault !== BOTH_SIDES_BEARING) {
      stationEntries['*'] = stationDefault;
    }

    if (Object.keys(stationEntries).length > 0) {
      out[station.stopId] = stationEntries;
    }
  }

  return out;
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
    south: minLat - 0.004,
    west: minLon - 0.006,
    north: maxLat + 0.004,
    east: maxLon + 0.006,
  };
}

export function buildPlatformSidesOverpassQuery(bbox) {
  const b = `${bbox.south.toFixed(5)},${bbox.west.toFixed(5)},${bbox.north.toFixed(5)},${bbox.east.toFixed(5)}`;
  return (
    `[out:json][timeout:60];` +
    `(way["railway"="platform"](${b});` +
    `way["railway"="platform_edge"](${b});` +
    `relation["railway"="platform"](${b});)->.p;` +
    `(.p;way["railway"="rail"](around.p:10););` +
    `out geom tags;`
  );
}

async function loadStopsTxt(zipArg) {
  let zipPath = zipArg;
  let cleanupDir = null;
  if (!zipPath) {
    cleanupDir = join(tmpdir(), `kilometr-platform-sides-${Date.now()}`);
    mkdirSync(cleanupDir, { recursive: true });
    zipPath = join(cleanupDir, 'polish_trains.zip');
    console.log(`[platform-sides] pobieram ${FEED_URL}...`);
    const res = await fetch(FEED_URL, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} @ ${FEED_URL}`);
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  }
  const workDir = join(tmpdir(), `kilometr-platform-stops-${Date.now()}`);
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
  const concurrency = Math.max(
    1,
    Math.min(6, Number(args.find((a) => a.startsWith('--concurrency='))?.slice(14) || 3)),
  );
  const resume = args.includes('--resume');
  const mirrors = overpassMirrors(process.env.OVERPASS_URL);

  const stopsContent = await loadStopsTxt(zipArg);
  const allStations = parseStationsCsv(stopsContent);
  // Polska + stacje przygraniczne (bez pojedynczych odległych stacji międzynarodowych w Europie).
  const stations = allStations.filter(
    (s) => s.lat >= 48.5 && s.lat <= 55.1 && s.lon >= 13.5 && s.lon <= 24.5,
  );
  const cells = groupStationCells(stations, 0.75, 50);
  const totalCells = limitArg > 0 ? Math.min(limitArg, cells.length) : cells.length;
  console.log(
    `[platform-sides] stacji PL+granica: ${stations.length}/${allStations.length}, kafli: ${totalCells}/${cells.length}, równoległość: ${concurrency}`,
  );

  const merged = {};
  if (existsSync(OUT_FILE) && (limitArg > 0 || resume)) {
    const prev = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
    Object.assign(merged, prev.stations || {});
  }

  const writeSnapshot = () => {
    const sortedStations = Object.fromEntries(
      Object.entries(merged).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })),
    );
    const entryCount = Object.values(sortedStations).reduce(
      (sum, entries) => sum + Object.keys(entries).length,
      0,
    );
    mkdirSync(dirname(OUT_FILE), { recursive: true });
    writeFileSync(
      OUT_FILE,
      `${JSON.stringify(
        {
          builtAt: new Date().toISOString(),
          stationCount: Object.keys(sortedStations).length,
          entryCount,
          stations: sortedStations,
        },
        null,
        2,
      )}\n`,
    );
    return { stationCount: Object.keys(sortedStations).length, entryCount };
  };

  let nextIdx = 0;
  let done = 0;
  let failed = 0;

  const worker = async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= totalCells) return;
      const cellStations = cells[i];
      if (resume && cellStations.every((s) => Object.prototype.hasOwnProperty.call(merged, s.stopId))) {
        done++;
        continue;
      }
      const query = buildPlatformSidesOverpassQuery(cellBbox(cellStations));
      let elements = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          elements = await fetchOverpassElements({
            query,
            mirrors: mirrors.length > 0 ? mirrors : DEFAULT_OVERPASS_MIRRORS,
            userAgent: UA,
            timeoutMs: 35_000,
            hedgeMs: 10_000,
          });
          break;
        } catch (err) {
          console.warn(
            `[platform-sides] kafel ${i + 1}/${totalCells} próba ${attempt}: ${err.message}`,
          );
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      if (!elements) {
        failed++;
        console.warn(`[platform-sides] pominięto kafel ${i + 1}/${totalCells}`);
      } else {
        const partial = computeStationPlatformSides(cellStations, elements);
        Object.assign(merged, partial);
      }
      done++;
      if (done % 15 === 0 || done === totalCells) {
        const snap = writeSnapshot();
        console.log(
          `[platform-sides] postęp ${done}/${totalCells} kafli, dopasowano ${snap.stationCount} stacji (${snap.entryCount} wpisów, pominiętych: ${failed})`,
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const finalSnap = writeSnapshot();
  console.log(
    `[platform-sides] zapisano ${finalSnap.stationCount} stacji (${finalSnap.entryCount} wpisów) -> ${OUT_FILE}`,
  );
}

const isCli =
  process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isCli) {
  main().catch((err) => {
    console.error('[platform-sides] BŁĄD:', err);
    process.exit(1);
  });
}
