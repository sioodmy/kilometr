import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { classifyOsmLandmark, formatStreetLocative } from './polish-grammar.mjs';
import { VERIFIED_HUB_OVERRIDES } from './hub-overrides.mjs';
import { generateWarsawMetroEntrances } from './metro-entrances.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const CACHE_DIR = path.join(ROOT_DIR, 'cloudflare/.cache');
const DATA_DIR = path.join(ROOT_DIR, 'cloudflare/data');
const SRC_DATA_DIR = path.join(ROOT_DIR, 'src/data');

const CITY_CONFIGS = {
  warszawa: {
    zips: ['gtfs-warszawa.zip'],
    tsFile: 'stopHintsWarszawa.ts',
    tsExport: 'STOP_HINTS_WARSZAWA',
  },
  wroclaw: {
    zips: ['gtfs-wroclaw.zip'],
    tsFile: 'stopHintsWroclaw.ts',
    tsExport: 'STOP_HINTS_WROCLAW',
  },
  krakow: {
    zips: ['gtfs-krakow-A.zip', 'gtfs-krakow-T.zip', 'gtfs-krakow-M.zip'],
    tsFile: 'stopHintsKrakow.ts',
    tsExport: 'STOP_HINTS_KRAKOW',
  },
  poznan: {
    zips: ['gtfs-poznan.zip'],
    tsFile: 'stopHintsPoznan.ts',
    tsExport: 'STOP_HINTS_POZNAN',
  },
  gzm: {
    zips: ['gtfs-gzm.zip'],
    tsFile: 'stopHintsGzm.ts',
    tsExport: 'STOP_HINTS_GZM',
  },
};

function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === ',' && !inQ) {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

function normalizePolish(s) {
  return String(s || '')
    .toLowerCase()
    .replace(
      /[ąćęłńóśźż]/g,
      (c) =>
        ({
          ą: 'a',
          ć: 'c',
          ę: 'e',
          ł: 'l',
          ń: 'n',
          ó: 'o',
          ś: 's',
          ź: 'z',
          ż: 'z',
        })[c] || c,
    );
}

function normalizeSlug(s) {
  return normalizePolish(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function classifyRouteType(rawType) {
  const t = Number(rawType);
  if (t === 0 || (t >= 900 && t <= 999)) return 'tram';
  if (t === 11 || t === 800) return 'trolleybus';
  if (t === 3 || (t >= 700 && t <= 799)) return 'bus';
  if (t === 1 || (t >= 400 && t <= 405)) return 'subway';
  if (t === 2 || (t >= 100 && t <= 199)) return 'rail';
  return 'other';
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Konwertuje przesunięcie (lat, lon) względem punktu odniesienia na lokalne metry (E, N). */
function toLocalMeters(lat, lon, refLat, refLon) {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((refLat * Math.PI) / 180);
  return [(lon - refLon) * mLon, (lat - refLat) * mLat];
}

/** Odległość punktu P(0,0) od odcinka AB w metrach oraz wektor kierunkowy odcinka. */
function pointToSegmentMetrics(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) {
    return { dist: Math.hypot(ax, ay), ux: 0, uy: 0, len: 0 };
  }
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const px = ax + t * dx;
  const py = ay + t * dy;
  const len = Math.sqrt(len2);
  return { dist: Math.hypot(px, py), ux: dx / len, uy: dy / len, len };
}

/** Test przecięcia odcinków AB i CD w lokalnym układzie 2D. */
function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const ccw = (p1x, p1y, p2x, p2y, p3x, p3y) =>
    (p3y - p1y) * (p2x - p1x) - (p2y - p1y) * (p3x - p1x);
  const d1 = ccw(ax, ay, bx, by, cx, cy);
  const d2 = ccw(ax, ay, bx, by, dx, dy);
  const d3 = ccw(cx, cy, dx, dy, ax, ay);
  const d4 = ccw(cx, cy, dx, dy, bx, by);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function readZipText(zipPath, fileName) {
  const res = spawnSync('unzip', ['-p', zipPath, fileName], { maxBuffer: 120 * 1024 * 1024 });
  if (res.status !== 0) return '';
  return res.stdout.toString('utf8');
}

/**
 * Zwraca unikalny, stabilny klucz przystanku w `dataset.stops` (NIGDY goły 1-2 cyfrowy numer!).
 */
function canonicalStopKey(city, stop) {
  if (city === 'warszawa') {
    return stop.id; // 6-cyfrowe stop_id (np. "302702", "703706")
  }
  if (city === 'wroclaw') {
    if (stop.code && /^\d{4,}$/.test(stop.code)) return stop.code;
    return null;
  }
  if (city === 'krakow') {
    if (stop.code && /^\d+-\d+$/.test(stop.code)) return stop.code;
    return null;
  }
  if (city === 'poznan') {
    // Strip geohash: "poznan-glowny73-wqjhw" -> "poznan-glowny73"
    const m = stop.id.match(/^([a-z0-9-]+\d{2})-[a-z0-9]{4,6}$/i);
    if (m) return m[1];
    // Fallback z nazwy kończącej się na 2 cyfry: "Poznań Główny 73" -> "poznan-glowny73"
    const nm = stop.name.match(/^(.*?)\s+(\d{2})$/);
    if (nm) return `${normalizeSlug(nm[1])}${nm[2]}`;
    return stop.id;
  }
  if (city === 'gzm') {
    if (stop.code && (stop.code.includes('-') || stop.code.length >= 5)) return stop.code;
    return null;
  }
  return stop.id;
}

/** Nazwa grupy przystankowej (do wykrywania przeciwległych słupków tego samego przystanku). */
function stopGroupName(city, stop) {
  let n = stop.name.trim();
  if (city === 'poznan') {
    n = n.replace(/\s+\d{2}$/, '');
  }
  return normalizeSlug(n);
}

/**
 * Ładuje pełny graf GTFS dla miasta (stops + routes + trips + streaming stop_times):
 * zwraca listę aktywnych przystanków naziemnych (bus/tram/trolleybus) z prawdziwym
 * trybem transportu, liczbą odjazdów i wektorem kierunku jazdy (vE, vN).
 */
async function loadGtfsCity(city) {
  const cfg = CITY_CONFIGS[city];
  const stopsByKey = new Map();
  const rawStopsById = new Map();

  for (const zipName of cfg.zips) {
    const zipPath = path.join(CACHE_DIR, zipName);
    if (!fs.existsSync(zipPath)) {
      throw new Error(`Brak pliku GTFS: ${zipPath}`);
    }

    const routeMode = new Map();
    const rText = readZipText(zipPath, 'routes.txt');
    const rLines = rText.split(/\r?\n/).filter(Boolean);
    if (rLines.length < 2) continue;
    const rH = parseCsvLine(rLines[0].replace(/^\uFEFF/, ''));
    const riId = rH.indexOf('route_id');
    const riType = rH.indexOf('route_type');
    for (let i = 1; i < rLines.length; i++) {
      const c = parseCsvLine(rLines[i]);
      routeMode.set(c[riId], classifyRouteType(c[riType]));
    }

    const tripMode = new Map();
    const tText = readZipText(zipPath, 'trips.txt');
    const tLines = tText.split(/\r?\n/).filter(Boolean);
    const tH = parseCsvLine(tLines[0].replace(/^\uFEFF/, ''));
    const tiId = tH.indexOf('trip_id');
    const tiR = tH.indexOf('route_id');
    for (let i = 1; i < tLines.length; i++) {
      const c = parseCsvLine(tLines[i]);
      tripMode.set(c[tiId], routeMode.get(c[tiR]) || 'other');
    }

    const localStops = new Map();
    const sText = readZipText(zipPath, 'stops.txt');
    const sLines = sText.split(/\r?\n/).filter(Boolean);
    const sH = parseCsvLine(sLines[0].replace(/^\uFEFF/, ''));
    const siId = sH.indexOf('stop_id');
    const siCode = sH.indexOf('stop_code');
    const siName = sH.indexOf('stop_name');
    const siLat = sH.indexOf('stop_lat');
    const siLon = sH.indexOf('stop_lon');
    const siSt = sH.indexOf('street_name');
    for (let i = 1; i < sLines.length; i++) {
      const c = parseCsvLine(sLines[i]);
      const lat = Number(c[siLat]);
      const lon = Number(c[siLon]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) continue;
      const s = {
        id: (c[siId] || '').trim(),
        code: siCode >= 0 ? (c[siCode] || '').trim() : '',
        name: (c[siName] || '').trim(),
        lat,
        lon,
        street: siSt >= 0 ? (c[siSt] || '').trim() : '',
      };
      if (!s.id || !s.name) continue;
      localStops.set(s.id, s);
      rawStopsById.set(s.id, s);
    }

    // Streaming stop_times.txt -> tryby + liczba odjazdów + wektor kierunku jazdy
    const child = spawn('unzip', ['-p', zipPath, 'stop_times.txt']);
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let iTrip = -1;
    let iStop = -1;
    let prevTrip = '';
    let prevStopId = '';

    const stopStats = new Map();
    const ensureStat = (sid) => {
      let st = stopStats.get(sid);
      if (!st) {
        st = { modes: new Set(), departures: 0, vecE: 0, vecN: 0, vecCount: 0 };
        stopStats.set(sid, st);
      }
      return st;
    };

    for await (const line of rl) {
      if (iTrip < 0) {
        const h = parseCsvLine(line.replace(/^\uFEFF/, ''));
        iTrip = h.indexOf('trip_id');
        iStop = h.indexOf('stop_id');
        continue;
      }
      if (!line) continue;
      const parts = line.split(',');
      const trip = parts[iTrip];
      const sid = parts[iStop];
      const mode = tripMode.get(trip);
      if (mode && localStops.has(sid)) {
        const st = ensureStat(sid);
        st.modes.add(mode);
        st.departures++;
      }
      if (trip === prevTrip && prevStopId && prevStopId !== sid) {
        const p1 = localStops.get(prevStopId);
        const p2 = localStops.get(sid);
        if (p1 && p2) {
          const [dx, dy] = toLocalMeters(p2.lat, p2.lon, p1.lat, p1.lon);
          const d = Math.hypot(dx, dy);
          if (d >= 40 && d <= 2500) {
            const st = ensureStat(prevStopId);
            st.vecE += dx / d;
            st.vecN += dy / d;
            st.vecCount++;
          }
        }
      }
      prevTrip = trip;
      prevStopId = sid;
    }

    // Scalenie statystyk według klucza kanonicznego (np. Kraków 802-01 ma bus w A.zip i tram w T.zip)
    for (const [sid, s] of localStops) {
      const stat = stopStats.get(sid);
      if (!stat || stat.departures === 0) continue;
      const key = canonicalStopKey(city, s);
      if (!key) continue;

      let entry = stopsByKey.get(key);
      if (!entry) {
        entry = {
          key,
          id: s.id,
          code: s.code,
          name: s.name,
          group: stopGroupName(city, s),
          lat: s.lat,
          lon: s.lon,
          gtfsStreet: s.street,
          modes: new Set(),
          departures: 0,
          vecE: 0,
          vecN: 0,
          vecCount: 0,
        };
        stopsByKey.set(key, entry);
      }
      for (const m of stat.modes) entry.modes.add(m);
      entry.departures += stat.departures;
      entry.vecE += stat.vecE;
      entry.vecN += stat.vecN;
      entry.vecCount += stat.vecCount;
      if (!entry.gtfsStreet && s.street) entry.gtfsStreet = s.street;
    }
  }

  // Wybierz wyłącznie przystanki naziemne (bus / tram / trolleybus) i znormalizuj wektor jazdy
  const activeStops = [];
  for (const s of stopsByKey.values()) {
    const hasSurface = s.modes.has('bus') || s.modes.has('tram') || s.modes.has('trolleybus');
    if (!hasSurface) continue;
    const mag = Math.hypot(s.vecE, s.vecN);
    if (s.vecCount >= 2 && mag > 0.25 * s.vecCount) {
      s.vE = s.vecE / mag;
      s.vN = s.vecN / mag;
      s.hasBearing = true;
    } else {
      s.vE = 0;
      s.vN = 0;
      s.hasBearing = false;
    }
    activeStops.push(s);
  }

  return { activeStops, stopsByKey };
}

/** Buduje indeks przestrzenny siatkowy (~160m oczko) dla błyskawicznych zapytań OSM. */
class SpatialGrid {
  constructor(cellDeg = 0.0015) {
    this.cellDeg = cellDeg;
    this.cells = new Map();
  }
  _key(lat, lon) {
    return `${Math.floor(lat / this.cellDeg)},${Math.floor(lon / this.cellDeg)}`;
  }
  add(lat, lon, item) {
    const k = this._key(lat, lon);
    let arr = this.cells.get(k);
    if (!arr) {
      arr = [];
      this.cells.set(k, arr);
    }
    arr.push(item);
  }
  query(lat, lon, radiusCells = 1) {
    const cLat = Math.floor(lat / this.cellDeg);
    const cLon = Math.floor(lon / this.cellDeg);
    const out = [];
    for (let dl = -radiusCells; dl <= radiusCells; dl++) {
      for (let dn = -radiusCells; dn <= radiusCells; dn++) {
        const arr = this.cells.get(`${cLat + dl},${cLon + dn}`);
        if (arr) {
          for (let i = 0; i < arr.length; i++) out.push(arr[i]);
        }
      }
    }
    return out;
  }
}

function loadOsmIndex(city) {
  const poisFile = path.join(CACHE_DIR, `${city}-osm-pois.json`);
  const roadsFile = path.join(CACHE_DIR, `${city}-osm-roads.json`);
  if (!fs.existsSync(poisFile) || !fs.existsSync(roadsFile)) {
    throw new Error(`Brak cache OSM dla ${city}. Uruchom: node cloudflare/scripts/cache-osm.mjs --city=${city}`);
  }

  const rawPois = JSON.parse(fs.readFileSync(poisFile, 'utf8'));
  const rawRoads = JSON.parse(fs.readFileSync(roadsFile, 'utf8'));

  const landmarkGrid = new SpatialGrid(0.0015);
  const platformGrid = new SpatialGrid(0.001);
  const railBridgeGrid = new SpatialGrid(0.001);
  const roadSegGrid = new SpatialGrid(0.0015);

  let acceptedPois = 0;
  for (const el of rawPois) {
    const t = el.tags || {};
    // 1. Platformy / przystanki OSM (bus_bay, shelter, level)
    if (
      t.public_transport === 'platform' ||
      t.highway === 'bus_stop' ||
      t.railway === 'tram_stop'
    ) {
      platformGrid.add(el.lat, el.lon, {
        lat: el.lat,
        lon: el.lon,
        busBay: t.bus_bay === 'yes' || t.bay === 'yes',
        underground: t.level === '-1' || t.layer === '-1' || t.tunnel === 'yes',
        tram: t.tram === 'yes' || t.railway === 'tram_stop',
        bus: t.bus === 'yes' || t.highway === 'bus_stop',
      });
    }

    // 2. Prawdziwe wiadukty kolejowe
    if (el.type === 'way' && (t.railway === 'rail' || t.railway === 'light_rail') && t.bridge === 'yes') {
      railBridgeGrid.add(el.lat, el.lon, { lat: el.lat, lon: el.lon });
      continue;
    }

    // 3. Kuratorowane POI
    const classified = classifyOsmLandmark(el);
    if (classified) {
      acceptedPois++;
      landmarkGrid.add(el.lat, el.lon, {
        lat: el.lat,
        lon: el.lon,
        ...classified,
      });
    }
  }

  // Indeks odcinków nazwanych dróg (do rozpoznawania ulicy + testu przecięcia osi jezdni)
  const HW_PENALTY = {
    trunk: 0,
    primary: 0,
    secondary: 1,
    tertiary: 2,
    unclassified: 5,
    residential: 6,
    living_street: 10,
    pedestrian: 8,
  };
  for (const w of rawRoads) {
    const geom = w.g;
    if (!Array.isArray(geom) || geom.length < 2) continue;
    const penalty = HW_PENALTY[w.hw] ?? 6;
    for (let i = 0; i < geom.length - 1; i++) {
      const [lat1, lon1] = geom[i];
      const [lat2, lon2] = geom[i + 1];
      const seg = { name: w.name, penalty, lat1, lon1, lat2, lon2 };
      const midLat = (lat1 + lat2) * 0.5;
      const midLon = (lon1 + lon2) * 0.5;
      roadSegGrid.add(midLat, midLon, seg);
      // Jeśli długi odcinek, dodaj też punkty końcowe
      if (Math.abs(lat2 - lat1) > 0.0012 || Math.abs(lon2 - lon1) > 0.0018) {
        roadSegGrid.add(lat1, lon1, seg);
        roadSegGrid.add(lat2, lon2, seg);
      }
    }
  }

  return { landmarkGrid, platformGrid, railBridgeGrid, roadSegGrid, acceptedPois };
}

/**
 * Dopasowuje słupek do ulicy i zwraca odcinki osi tej ulicy (w promieniu 55m)
 * do matematycznego testu strony ulicy.
 */
function snapStopToRoad(stop, roadSegGrid) {
  const nearbySegs = roadSegGrid.query(stop.lat, stop.lon, 1);
  let best = null;
  let bestScore = Infinity;
  const seen = new Set();

  for (const seg of nearbySegs) {
    if (seen.has(seg)) continue;
    seen.add(seg);
    const [ax, ay] = toLocalMeters(seg.lat1, seg.lon1, stop.lat, stop.lon);
    const [bx, by] = toLocalMeters(seg.lat2, seg.lon2, stop.lat, stop.lon);
    const m = pointToSegmentMetrics(ax, ay, bx, by);
    if (m.dist > 34) continue;

    let alignPenalty = 0;
    if (stop.hasBearing && m.len > 3) {
      const cosA = Math.abs(m.ux * stop.vE + m.uy * stop.vN);
      // Mocna kara za przecznicę prostopadłą do kierunku jazdy
      alignPenalty = (1 - cosA) * 20;
    }

    const score = m.dist + seg.penalty + alignPenalty;
    if (score < bestScore) {
      bestScore = score;
      best = { name: seg.name, dist: m.dist };
    }
  }

  // Zbierz odcinki osi dopasowanej ulicy (lub GTFS ulicy) w promieniu 60m
  const targetName = best?.name || stop.gtfsStreet || '';
  const targetNorm = normalizePolish(targetName);
  const roadCenterSegs = [];
  if (targetNorm) {
    for (const seg of seen) {
      if (normalizePolish(seg.name) !== targetNorm) continue;
      const [ax, ay] = toLocalMeters(seg.lat1, seg.lon1, stop.lat, stop.lon);
      const [bx, by] = toLocalMeters(seg.lat2, seg.lon2, stop.lat, stop.lon);
      if (Math.min(Math.hypot(ax, ay), Math.hypot(bx, by)) <= 65) {
        roadCenterSegs.push([ax, ay, bx, by]);
      }
    }
  }

  return {
    osmStreet: best?.name || null,
    roadCenterSegs,
  };
}

/** Formatuje prefiks typu przystanku WYŁĄCZNIE z prawdziwych danych GTFS + OSM. */
function buildStopTypePrefix(stop, osmPlatform) {
  const hasTram = stop.modes.has('tram');
  const hasBus = stop.modes.has('bus');
  const hasTrol = stop.modes.has('trolleybus');

  if (hasTram && hasBus) return 'Peron tramwajowo-autobusowy';
  if (hasTram) return 'Peron tramwajowy';
  if (hasTrol && !hasBus) return 'Przystanek trolejbusowy';
  if (osmPlatform?.busBay) return 'Zatoka autobusowa';
  return 'Przystanek autobusowy';
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Składa finalne 1 zdanie (<= 20 słów, bez powielania numeru słupka, naturalna polszczyzna).
 */
function assembleHint(prefix, streetPhrase, anchorPhrase) {
  let sentence = streetPhrase
    ? `${prefix} ${streetPhrase} ${anchorPhrase}.`
    : `${prefix} ${anchorPhrase}.`;
  sentence = sentence.replace(/\s+/g, ' ').trim();

  // Jeśli zdanie przekracza 19 słów, spróbuj bez nazwy ulicy (punkt orientacyjny jest ważniejszy niż ulica!)
  if (countWords(sentence) > 19 && streetPhrase) {
    sentence = `${prefix} ${anchorPhrase}.`.replace(/\s+/g, ' ').trim();
  }
  if (countWords(sentence) > 20 || sentence.length > 155) {
    return null;
  }
  return sentence;
}

/**
 * Weryfikuje ręczne nadpisania dla kluczowych węzłów z live GTFS.
 * Jeśli którykolwiek stop_id zniknął albo zmienił nazwę -> przerywa build z jasnym błędem!
 */
function verifyAndApplyHubOverrides(city, stopsByKey) {
  const overrides = VERIFIED_HUB_OVERRIDES[city] || {};
  const verified = new Map();

  for (const [key, spec] of Object.entries(overrides)) {
    const gtfsStop = stopsByKey.get(key);
    if (!gtfsStop) {
      throw new Error(
        `[HUB OVERRIDE ERROR] ${city}: klucz "${key}" (${spec.expectedName}) nie istnieje w aktualnym GTFS!`,
      );
    }
    const normActual = normalizePolish(gtfsStop.name);
    const normExpected = normalizePolish(spec.expectedName);
    if (!normActual.includes(normExpected) && !normExpected.includes(normActual)) {
      throw new Error(
        `[HUB OVERRIDE ERROR] ${city}: klucz "${key}" ma w GTFS nazwę "${gtfsStop.name}", oczekiwano "${spec.expectedName}"!`,
      );
    }
    verified.set(key, spec.hint);
  }
  return verified;
}

function writeBundledTs(city, dataset) {
  const cfg = CITY_CONFIGS[city];
  const tsPath = path.join(SRC_DATA_DIR, cfg.tsFile);
  const content = `import type { StopHintsDataset } from '../types/stopHints';\n\n/**\n * Statyczny fallback wskazówek przestrzennych dla miasta: ${city}.\n * Wygenerowany automatycznie z cloudflare/data/stop-hints-${city}.json (schemaVersion ${dataset.schemaVersion}).\n */\nexport const ${cfg.tsExport}: StopHintsDataset = ${JSON.stringify(dataset)};\n`;
  fs.writeFileSync(tsPath, content, 'utf8');
}

async function generateCity(city) {
  console.log(`\n========== GENEROWANIE: ${city.toUpperCase()} ==========`);
  const { activeStops, stopsByKey } = await loadGtfsCity(city);
  console.log(`[i] GTFS: ${activeStops.length} aktywnych przystanków naziemnych (bus/tram/trolejbus)`);

  const verifiedHubs = verifyAndApplyHubOverrides(city, stopsByKey);
  console.log(`[✓] Zweryfikowano ${verifiedHubs.size} ręcznych opisów kluczowych węzłów z GTFS`);

  const { landmarkGrid, platformGrid, railBridgeGrid, roadSegGrid, acceptedPois } =
    loadOsmIndex(city);
  console.log(`[i] OSM: ${acceptedPois} kuratorowanych punktów orientacyjnych po filtracji slopu`);

  // Grupuj przystanki według zespołu przystankowego (do wykrywania przeciwległych słupków)
  const groups = new Map();
  for (const s of activeStops) {
    let arr = groups.get(s.group);
    if (!arr) {
      arr = [];
      groups.set(s.group, arr);
    }
    arr.push(s);
  }

  const stopsOutput = {};
  const stats = {
    hubOverrides: 0,
    tier1: 0,
    tier2: 0,
    tier3: 0,
    opposite: 0,
    viaduct: 0,
    omittedNoAnchor: 0,
    siblingDisambiguated: 0,
  };

  for (const [, groupStops] of groups) {
    // 1. Zbierz kandydatów dla każdego słupka w zespole
    const perStopCandidates = new Map();

    for (const stop of groupStops) {
      if (verifiedHubs.has(stop.key)) {
        stopsOutput[stop.key] = verifiedHubs.get(stop.key);
        stats.hubOverrides++;
        continue;
      }

      // Dopasuj ulicę i platformę OSM
      const { osmStreet, roadCenterSegs } = snapStopToRoad(stop, roadSegGrid);
      const streetPhrase =
        formatStreetLocative(stop.gtfsStreet) || formatStreetLocative(osmStreet);

      const nearbyPlatforms = platformGrid.query(stop.lat, stop.lon, 1);
      let osmPlatform = null;
      let bestPlatDist = 22;
      for (const p of nearbyPlatforms) {
        const d = haversineMeters(stop.lat, stop.lon, p.lat, p.lon);
        if (d < bestPlatDist) {
          bestPlatDist = d;
          osmPlatform = p;
        }
      }

      const isTramOnly = stop.modes.has('tram') && !stop.modes.has('bus');
      const prefix = buildStopTypePrefix(stop, osmPlatform);

      // Sprawdź przeciwległe słupki w tym samym zespole (>14m i <250m od tego słupka)
      const oppositeSiblings = groupStops.filter((other) => {
        if (other.key === stop.key) return false;
        const d = haversineMeters(stop.lat, stop.lon, other.lat, other.lon);
        return d >= 14 && d <= 250;
      });

      // Zbierz kandydatów POI w pobliżu
      const nearbyPois = landmarkGrid.query(stop.lat, stop.lon, 1);
      const candidates = [];
      const seenKey = new Set();

      for (const poi of nearbyPois) {
        const dist = haversineMeters(stop.lat, stop.lon, poi.lat, poi.lon);
        if (dist > poi.maxDist) continue;

        const [dx, dy] = toLocalMeters(poi.lat, poi.lon, stop.lat, stop.lon);

        // Test przecięcia osi jezdni
        let crossesRoad = false;
        for (let i = 0; i < roadCenterSegs.length; i++) {
          const [ax, ay, bx, by] = roadCenterSegs[i];
          if (segmentsIntersect(0, 0, dx, dy, ax, ay, bx, by)) {
            crossesRoad = true;
            break;
          }
        }

        // Test prawej strony względem kierunku jazdy (ruch prawostronny w Polsce)
        const rightOffset = stop.hasBearing ? dx * stop.vN - dy * stop.vE : 0;

        // Czy ten POI leży wyraźnie bliżej przeciwległego słupka z tego samego zespołu?
        let closerToSibling = false;
        for (const sib of oppositeSiblings) {
          const dSib = haversineMeters(sib.lat, sib.lon, poi.lat, poi.lon);
          if (dSib + 6 < dist) {
            closerToSibling = true;
            break;
          }
        }

        // Wyznacz relację (near = po tej samej stronie, opposite = naprzeciwko po drugiej stronie ulicy)
        let relation = null;
        if (!crossesRoad && !closerToSibling) {
          if (!stop.hasBearing || isTramOnly) {
            // Tramwaje są na wysepce pośrodku drogi — dopuszczamy lekki offset boczny
            if (!stop.hasBearing || rightOffset >= -14) relation = 'near';
          } else if (rightOffset >= -5) {
            relation = 'near';
          }
        }

        if (!relation && poi.canBeOpposite && dist <= Math.min(poi.maxDist, 55)) {
          // Naprzeciwko tylko dla dużych/wyraźnych obiektów po przeciwnej stronie!
          if (crossesRoad || closerToSibling || (stop.hasBearing && rightOffset < -10)) {
            relation = 'opposite';
          }
        }

        if (!relation) continue;

        // Deduplikacja po kluczu POI + relacji
        const dedupKey = `${poi.key}:${relation}`;
        if (seenKey.has(dedupKey)) continue;
        seenKey.add(dedupKey);

        // Wynik jakości: niższy = lepszy (Tier 1 mocno preferowany, 'near' przed 'opposite', bliżej lepiej)
        const tierPenalty = poi.tier === 1 ? 0 : poi.tier === 2 ? 32 : 68;
        const relPenalty = relation === 'near' ? 0 : 28;
        const score = tierPenalty + relPenalty + dist;

        candidates.push({
          poi,
          relation,
          dist,
          score,
          phrase: relation === 'near' ? poi.nearPhrase : poi.oppositePhrase,
        });
      }

      // Sprawdź prawdziwy wiadukt kolejowy nad przystankiem
      let hasRailViaduct = false;
      const nearbyViaducts = railBridgeGrid.query(stop.lat, stop.lon, 1);
      for (const v of nearbyViaducts) {
        if (haversineMeters(stop.lat, stop.lon, v.lat, v.lon) <= 20) {
          hasRailViaduct = true;
          break;
        }
      }

      candidates.sort((a, b) => a.score - b.score);
      perStopCandidates.set(stop.key, {
        stop,
        prefix,
        streetPhrase,
        candidates,
        hasRailViaduct,
      });
    }

    // 2. Rozwiązywanie konfliktów między słupkami w tym samym zespole:
    //    Przeciwległe słupki (>14m od siebie) NIE MOGĄ dostać identycznej frazy "obok X"!
    //    Przetwarzamy słupki w kolejności najlepszego dopasowania (najbliższe POI wygrywa pierwszeństwo).
    const entries = [...perStopCandidates.values()].sort((a, b) => {
      const sa = a.candidates[0]?.score ?? 9999;
      const sb = b.candidates[0]?.score ?? 9999;
      return sa - sb;
    });

    const claimedNearByPoiKey = new Map(); // poi.key -> { lat, lon, stopKey }

    for (const item of entries) {
      const { stop, prefix, streetPhrase, candidates, hasRailViaduct } = item;
      let chosen = null;

      for (const cand of candidates) {
        if (cand.relation === 'near') {
          const prev = claimedNearByPoiKey.get(cand.poi.key);
          if (prev) {
            const sep = haversineMeters(stop.lat, stop.lon, prev.lat, prev.lon);
            // Jeśli ten słupek stoi fizycznie w tym samym miejscu (<14m, np. wspólny peron bus+tram we Wrocławiu) -> OK!
            if (sep >= 14) {
              // Przeciwległy słupek! Nie może dostać tego samego "obok X".
              stats.siblingDisambiguated++;
              continue;
            }
          }
        }
        chosen = cand;
        break;
      }

      // Jeśli wszystkie `near` były zajęte przez przeciwległy słupek, a najlepszy kandydat to Tier 1/2 z `canBeOpposite`,
      // użyj jawnego `naprzeciwko ...` (o ile jeszcze nie było użyte)
      if (!chosen && candidates.length > 0) {
        const top = candidates[0];
        if (top.poi.canBeOpposite && top.dist <= 55) {
          chosen = {
            ...top,
            relation: 'opposite',
            phrase: top.poi.oppositePhrase,
          };
        }
      }

      if (chosen) {
        const hint = assembleHint(prefix, streetPhrase, chosen.phrase);
        if (hint) {
          stopsOutput[stop.key] = hint;
          if (chosen.relation === 'near') {
            if (!claimedNearByPoiKey.has(chosen.poi.key)) {
              claimedNearByPoiKey.set(chosen.poi.key, {
                lat: stop.lat,
                lon: stop.lon,
                stopKey: stop.key,
              });
            }
            if (chosen.poi.tier === 1) stats.tier1++;
            else if (chosen.poi.tier === 2) stats.tier2++;
            else stats.tier3++;
          } else {
            stats.opposite++;
          }
          continue;
        }
      }

      if (hasRailViaduct) {
        const hint = assembleHint(prefix, streetPhrase, 'pod wiaduktem kolejowym');
        if (hint) {
          stopsOutput[stop.key] = hint;
          stats.viaduct++;
          continue;
        }
      }

      stats.omittedNoAnchor++;
    }
  }

  // Posortuj deterministycznie po kluczu
  const sortedStops = {};
  for (const k of Object.keys(stopsOutput).sort()) {
    sortedStops[k] = stopsOutput[k];
  }

  let metroEntrances;
  if (city === 'warszawa') {
    metroEntrances = generateWarsawMetroEntrances({
      zipPath: path.join(CACHE_DIR, CITY_CONFIGS[city].zips[0]),
      poisFile: path.join(CACHE_DIR, `${city}-osm-pois.json`),
      roadsFile: path.join(CACHE_DIR, `${city}-osm-roads.json`),
    });
  }

  const dataset = {
    schemaVersion: metroEntrances ? 3 : 2,
    city,
    generatedAt: new Date().toISOString(),
    stops: sortedStops,
    clusters: {},
    ...(metroEntrances ? { metroEntrances } : {}),
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const jsonPath = path.join(DATA_DIR, `stop-hints-${city}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(dataset, null, 2) + '\n', 'utf8');
  writeBundledTs(city, dataset);

  const total = Object.keys(sortedStops).length;
  console.log(
    `[✓] ${city}: zapisano ${total} wskazówek (hub=${stats.hubOverrides}, T1=${stats.tier1}, T2=${stats.tier2}, T3=${stats.tier3}, naprzeciwko=${stats.opposite}, wiadukt=${stats.viaduct}, pominięto_bez_POI=${stats.omittedNoAnchor}, rozdzielono_słupki=${stats.siblingDisambiguated})`,
  );
  if (metroEntrances) console.log(`    + wejścia metra: ${metroEntrances.length}`);
  console.log(`    -> ${path.relative(ROOT_DIR, jsonPath)} + src/data/${CITY_CONFIGS[city].tsFile}`);
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all') || !args.some((a) => a.startsWith('--city='));
  const cityArg = args.find((a) => a.startsWith('--city='))?.split('=')[1];
  const cities = all ? Object.keys(CITY_CONFIGS) : [cityArg];

  for (const city of cities) {
    if (!CITY_CONFIGS[city]) throw new Error(`Nieznane miasto: ${city}`);
    await generateCity(city);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[!] Błąd generatora stop-hints:', err);
    process.exit(1);
  });
}
