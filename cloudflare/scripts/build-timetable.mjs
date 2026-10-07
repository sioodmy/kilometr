#!/usr/bin/env node
/**
 * build-timetable.mjs — buduje prebuilt SQLite z rozkładów MPK + KD.
 *
 * Wejścia (publiczne, bez klucza):
 *   Open Data Wrocław — katalog GTFS + ZIP (MPK: tramwaje + autobusy)
 * Wejścia (wymagają PDP_API_KEY — sekret CI, nigdy do repo):
 *   PDP API (PLK): /data-version, /dictionaries/cities, /schedules/shortened
 *   (przewoźnik KD, stacje Wrocławia, okno 14 dni)
 *
 * Wyjścia (cloudflare/dist/):
 *   kilometr-gtfs.db  — baza w schemacie aplikacji (patrz SCHEMA_SQL niżej)
 *   manifest.json     — wersja, statystyki, sha256 bazy
 *
 * Wymagania: Node.js ≥ 22.5 (node:sqlite), program `unzip` w PATH
 * (linux/macos: standard; Windows: Git Bash / WSL). Zero zależności npm.
 *
 * Exit code: 0 = zbudowano, 2 = brak zmian (skip), 1 = błąd.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const DATA = join(ROOT, 'data');
const COORDS_FILE = process.env.KD_COORDS_FILE || join(DATA, 'kd-station-coords.json');
const DB_FILE = join(DIST, 'kilometr-gtfs.db');
const MANIFEST_FILE = join(DIST, 'manifest.json');

const MPK_CATALOGUE = 'https://api.open-data.cui.wroclaw.pl/od2/6/';
const MPK_DOWNLOAD_BASE = 'https://open-data.cui.wroclaw.pl/hdb/download';
const MPK_FALLBACK_URL = 'https://open-data.cui.wroclaw.pl/hdb/download/136/';
const MPK_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

const PDP_BASE = process.env.PDP_BASE_URL || 'https://pdp-api.plk-sa.pl';
const KD_WINDOW_DAYS = 14; // ≤ 31 (limit API: dateTo - dateFrom)
const KD_CARRIER = 'KD';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_UA = 'KilometrTimetableBot/1.0 (contact: dev@kilometr.local)';
// Wrocław: minLon, maxLat, maxLon, minLat
const WRO_BBOX = { minLon: 16.7, maxLat: 51.25, maxLon: 17.25, minLat: 50.95 };

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const WRITE_COORDS = args.has('--write-coords');
const PDP_API_KEY = process.env.PDP_API_KEY || '';
const PUBLIC_URL = (process.env.TIMETABLE_PUBLIC_URL || '').replace(/\/$/, '');

const log = (...m) => console.log('[build]', ...m);
const warn = (...m) => console.warn('[build] WARNING:', ...m);

/* ─── CSV (quote-aware, jak src/gtfs/csv.ts) ─────────────────────────── */

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function splitHeader(content) {
  const nl = content.indexOf('\n');
  let header = content.slice(0, nl === -1 ? undefined : nl);
  if (header.charCodeAt(0) === 0xfeff) header = header.slice(1);
  return { header: parseCsvLine(header.replace(/\r$/, '')), bodyPos: nl === -1 ? content.length : nl + 1 };
}

/** Iteruje wiersze bez rozcinania całości na tablicę (stop_times ~46 MB). */
function eachRow(content, fn) {
  const { header, bodyPos } = splitHeader(content);
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  let pos = bodyPos;
  const len = content.length;
  let n = 0;
  while (pos < len) {
    let nl = content.indexOf('\n', pos);
    if (nl === -1) nl = len;
    let line = content.slice(pos, nl);
    pos = nl + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line.trim()) continue;
    fn(parseCsvLine(line), idx);
    n++;
  }
  return { idx, rows: n };
}

function normalizePolish(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'l').trim();
}

function hmsToSec(hms) {
  const p = String(hms || '00:00:00').trim().split(':');
  return (Number(p[0]) || 0) * 3600 + (Number(p[1]) || 0) * 60 + (Number(p[2]) || 0);
}

function ymdCompact(iso) {
  return iso.replace(/-/g, '');
}

function isoDaysFromNow(offset) {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
}

/* ─── HTTP ────────────────────────────────────────────────────────────── */

async function fetchJson(url, headers = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchBuffer(url, headers = {}, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

/* ─── Schemat bazy — MUSI odpowiadać src/services/gtfsDatabase.ts ───────
 * (CREATE TABLE IF NOT EXISTS w aplikacji, więc prebuilt musi tworzyć
 * te same kolumny; kolumna weight liczona w buildzie). */

const SCHEMA_SQL = `
PRAGMA journal_mode = DELETE;
CREATE TABLE stops (
  stop_id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  norm TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_stops_latlon ON stops (lat, lon);
CREATE INDEX idx_stops_norm ON stops (norm);
CREATE INDEX idx_stops_weight ON stops (weight DESC);
CREATE TABLE routes (
  route_id TEXT PRIMARY KEY NOT NULL,
  short TEXT NOT NULL,
  long_name TEXT NOT NULL DEFAULT '',
  type INTEGER NOT NULL DEFAULT 3
);
CREATE INDEX idx_routes_short ON routes (short);
CREATE TABLE trips (
  trip_id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  headsign TEXT NOT NULL DEFAULT '',
  direction INTEGER NOT NULL DEFAULT 0,
  shape TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_trips_route ON trips (route_id);
CREATE INDEX idx_trips_service ON trips (service_id);
CREATE TABLE stop_times (
  trip_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  arr_sec INTEGER NOT NULL,
  dep_sec INTEGER NOT NULL,
  seq INTEGER NOT NULL
);
CREATE TABLE calendar (
  service_id TEXT PRIMARY KEY NOT NULL,
  mon INTEGER NOT NULL DEFAULT 0,
  tue INTEGER NOT NULL DEFAULT 0,
  wed INTEGER NOT NULL DEFAULT 0,
  thu INTEGER NOT NULL DEFAULT 0,
  fri INTEGER NOT NULL DEFAULT 0,
  sat INTEGER NOT NULL DEFAULT 0,
  sun INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT ''
);
CREATE TABLE calendar_dates (
  service_id TEXT NOT NULL,
  date TEXT NOT NULL,
  exc INTEGER NOT NULL
);
CREATE INDEX idx_caldate_date ON calendar_dates (date);
CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE pois (
  osm_id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL DEFAULT 'place',
  category TEXT NOT NULL DEFAULT 'place',
  name TEXT NOT NULL,
  norm_name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  street TEXT,
  district TEXT
);
CREATE INDEX idx_pois_norm ON pois (norm_name);
`;

/* ─── MPK: discovery ──────────────────────────────────────────────────── */

function parseEffectiveDate(name) {
  const m = /(\d{2})(\d{2})(\d{4})(?!\d)/.exec(name || '');
  if (!m) return null;
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function fmtDateUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

async function discoverMpk() {
  try {
    const cat = await fetchJson(MPK_CATALOGUE, { Accept: 'application/json' }, 15000);
    const ids = Array.isArray(cat.pliki) ? cat.pliki.slice(0, 5) : [];
    const now = Date.now();
    const cands = [];
    for (const id of ids) {
      const url = `${MPK_DOWNLOAD_BASE}/${id}/`;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        let filename = '';
        try {
          const head = await fetch(url, { method: 'HEAD', headers: MPK_UA, signal: ctrl.signal });
          const disp = head.headers.get('content-disposition') || '';
          const mm = /filename="?([^"]+)"?/.exec(disp);
          filename = mm ? mm[1] : '';
        } finally {
          clearTimeout(t);
        }
        cands.push({ id, url, filename, eff: parseEffectiveDate(filename) || 0 });
      } catch { /* pojedynczy kandydat może odpaść */ }
    }
    const inForce = cands.filter((c) => c.eff && c.eff <= now).sort((a, b) => b.eff - a.eff);
    if (inForce.length > 0) return { ...inForce[0], effectiveDate: fmtDateUTC(inForce[0].eff) };
    if (cands.length > 0) return { ...cands[0], effectiveDate: cands[0].eff ? fmtDateUTC(cands[0].eff) : 'unknown' };
  } catch (e) {
    warn('MPK discovery failed, fallback:', String(e));
  }
  return { id: 136, url: MPK_FALLBACK_URL, filename: '', effectiveDate: 'unknown' };
}

/* ─── PDP (KD): stacje Wrocławia → rozkład ────────────────────────────── */

function pdpHeaders() {
  return { 'X-API-Key': PDP_API_KEY, Accept: 'application/json' };
}

async function pdpDataVersion() {
  if (!PDP_API_KEY) return 'none';
  const v = await fetchJson(`${PDP_BASE}/api/v1/data-version`, pdpHeaders(), 20000);
  return v.schedulesVersion || v.dataVersion || 'unknown';
}

async function pdpWroclawStationIds() {
  const res = await fetchJson(`${PDP_BASE}/api/v1/dictionaries/cities?search=${encodeURIComponent('WROC')}`, pdpHeaders(), 20000);
  const cities = res.cities || [];
  const wro = cities.find((c) => String(c.name || '').toUpperCase() === 'WROCŁAW' || String(c.name || '').toUpperCase() === 'WROCLAW')
    || cities.find((c) => String(c.name || '').toUpperCase().includes('WROC'));
  if (!wro || !Array.isArray(wro.stationIds) || wro.stationIds.length === 0) {
    throw new Error('Nie znaleziono miasta WROCŁAW w /dictionaries/cities');
  }
  return wro;
}

async function pdpKdSchedules(stationIds) {
  const from = isoDaysFromNow(0);
  const to = isoDaysFromNow(KD_WINDOW_DAYS - 1);
  const q = new URLSearchParams({
    dateFrom: from, dateTo: to,
    stations: stationIds.join(','),
    carriersInclude: KD_CARRIER,
    dictionaries: 'true',
  });
  const res = await fetchJson(`${PDP_BASE}/api/v1/schedules/shortened?${q}`, pdpHeaders(), 90000);
  return { from, to, routes: res.rt || res.routes || [], dict: res.dc || res.dictionaries || {} };
}

/* ─── Nominatim (tylko brakujące współrzędne stacji KD) ───────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocodeStation(name) {
  const q = new URLSearchParams({
    q: `${name}, Wrocław, Polska`,
    format: 'json', limit: '3', addressdetails: '0',
    viewbox: `${WRO_BBOX.minLon},${WRO_BBOX.maxLat},${WRO_BBOX.maxLon},${WRO_BBOX.minLat}`,
    bounded: '1',
  });
  const res = await fetchJson(`${NOMINATIM}?${q}`, { 'User-Agent': NOMINATIM_UA }, 20000);
  if (!Array.isArray(res) || res.length === 0) return null;
  const hit = res.find((r) => {
    const lat = Number(r.lat), lon = Number(r.lon);
    return lat >= WRO_BBOX.minLat && lat <= WRO_BBOX.maxLat && lon >= WRO_BBOX.minLon && lon <= WRO_BBOX.maxLon;
  }) || res[0];
  return { lat: Number(hit.lat), lon: Number(hit.lon), display: hit.display_name || '' };
}

/* ─── Build ───────────────────────────────────────────────────────────── */

function todayCompact() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

async function main() {
  mkdirSync(DIST, { recursive: true });
  const work = join(tmpdir(), `kilometr-gtfs-${Date.now()}`);
  mkdirSync(work, { recursive: true });

  // 1. Zdalny manifest (skip, gdy nic się nie zmieniło — oszczędzamy limity).
  let remote = null;
  if (PUBLIC_URL && !FORCE) {
    try {
      remote = await fetchJson(`${PUBLIC_URL}/manifest.json`, {}, 15000);
      log('remote manifest version:', remote.version);
    } catch { log('brak zdalnego manifestu (pierwszy build?) — buduję pełny.'); }
  }

  // 2. MPK discovery + PDP data-version (tanie zapytania).
  const mpk = await discoverMpk();
  log('MPK:', mpk.filename || mpk.url, '| effective:', mpk.effectiveDate);
  let kdVersion = 'none';
  if (PDP_API_KEY) {
    try {
      kdVersion = await pdpDataVersion();
    } catch (e) {
      warn('PDP /data-version failed:', String(e), '— KD może być nieaktualne.');
      kdVersion = 'unknown';
    }
  } else {
    warn('brak PDP_API_KEY — sekcja KD zostanie pominięta (build MPK-only).');
  }
  log('KD schedulesVersion:', kdVersion);

  if (!FORCE && remote?.sources
    && remote.sources.mpk?.effectiveDate === mpk.effectiveDate
    && (remote.sources.kd?.schedulesVersion || 'none') === kdVersion) {
    log('brak zmian (MPK + KD) — skip buildu.');
    rmSync(work, { recursive: true, force: true });
    process.exit(2);
  }

  // 3. Pobieranie ZIP-a MPK + rozpakowanie (unzip z systemu — Node nie ma wbudowanego).
  const zipPath = join(work, 'gtfs.zip');
  log('pobieranie ZIP MPK…');
  const zipBuf = await fetchBuffer(mpk.url, MPK_UA, 180000);
  writeFileSync(zipPath, zipBuf);
  log('ZIP:', (zipBuf.length / 1048576).toFixed(1), 'MB');
  const txtDir = join(work, 'gtfs');
  mkdirSync(txtDir, { recursive: true });
  const NEEDED = ['stops.txt', 'routes.txt', 'calendar.txt', 'calendar_dates.txt', 'trips.txt', 'stop_times.txt'];
  try {
    execFileSync('unzip', ['-o', '-j', zipPath, ...NEEDED, '-d', txtDir], { stdio: 'pipe' });
  } catch {
    rmSync(work, { recursive: true, force: true });
    throw new Error('Brak programu `unzip` w PATH (linux/macos: standard; Windows: Git Bash/WSL).');
  }
  const readTxt = (n) => {
    try { return readFileSync(join(txtDir, n), 'utf8'); } catch { return null; }
  };

  // 4. Świeża baza.
  try { rmSync(DB_FILE, { force: true }); } catch {}
  for (const suf of ['-wal', '-shm', '-journal']) {
    try { rmSync(DB_FILE + suf, { force: true }); } catch {}
  }
  const db = new DatabaseSync(DB_FILE);
  db.exec(SCHEMA_SQL);
  db.exec('PRAGMA synchronous = OFF;');

  const counts = { stops: 0, routes: 0, trips: 0, stopTimes: 0, kdStations: 0, kdRoutes: 0, kdTrips: 0, kdStopTimes: 0 };

  // 5. MPK → tabele.
  const stopsTxt = readTxt('stops.txt');
  if (!stopsTxt) throw new Error('ZIP bez stops.txt — przerywam (nie nadpisuję R2 pustką).');
  {
    const ins = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    let i = 0;
    eachRow(stopsTxt, (c, idx) => {
      const id = (c[idx.stop_id] || '').trim();
      const name = (c[idx.stop_name] || '').trim();
      if (!id || !name) return;
      ins.run(id, (c[idx.stop_code] || '').trim(), name,
        Number(c[idx.stop_lat]) || 0, Number(c[idx.stop_lon]) || 0, normalizePolish(name));
      if (++i % 2000 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); }
      counts.stops++;
    });
    db.exec('COMMIT');
  }
  const routesTxt = readTxt('routes.txt');
  if (routesTxt) {
    const ins = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
    db.exec('BEGIN');
    eachRow(routesTxt, (c, idx) => {
      const id = (c[idx.route_id] || '').trim();
      if (!id) return;
      const raw = (c[idx.route_type] || '').trim();
      ins.run(id, (c[idx.route_short_name] || '').trim() || id, (c[idx.route_long_name] || '').trim(), raw !== '' && !isNaN(Number(raw)) ? Number(raw) : 3);
      counts.routes++;
    });
    db.exec('COMMIT');
  }
  const calTxt = readTxt('calendar.txt');
  if (calTxt) {
    const ins = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    eachRow(calTxt, (c, idx) => {
      const id = (c[idx.service_id] || '').trim();
      if (!id) return;
      ins.run(id, Number(c[idx.monday]) || 0, Number(c[idx.tuesday]) || 0, Number(c[idx.wednesday]) || 0,
        Number(c[idx.thursday]) || 0, Number(c[idx.friday]) || 0, Number(c[idx.saturday]) || 0, Number(c[idx.sunday]) || 0,
        (c[idx.start_date] || '').trim(), (c[idx.end_date] || '').trim());
    });
    db.exec('COMMIT');
  }
  const calDatesTxt = readTxt('calendar_dates.txt');
  {
    const rows = calDatesTxt ? [] : [];
    if (calDatesTxt) {
      eachRow(calDatesTxt, (c, idx) => {
        const id = (c[idx.service_id] || '').trim();
        if (id) rows.push([id, (c[idx.date] || '').trim(), Number(c[idx.exception_type]) || 0]);
      });
    }
    const ins = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
    db.exec('BEGIN');
    db.exec('DELETE FROM calendar_dates');
    for (const r of rows) ins.run(...r);
    db.exec('COMMIT');
  }
  const tripsTxt = readTxt('trips.txt');
  if (!tripsTxt) throw new Error('ZIP bez trips.txt — przerywam.');
  {
    const ins = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    let i = 0;
    eachRow(tripsTxt, (c, idx) => {
      const tid = (c[idx.trip_id] || '').trim();
      const rid = (c[idx.route_id] || '').trim();
      const sid = (c[idx.service_id] || '').trim();
      if (!tid || !rid || !sid) return;
      ins.run(tid, rid, sid, (c[idx.trip_headsign] || '').trim(), Number(c[idx.direction_id]) || 0, (c[idx.shape_id] || '').trim());
      if (++i % 5000 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); }
      counts.trips++;
    });
    db.exec('COMMIT');
  }
  const stTxt = readTxt('stop_times.txt');
  if (!stTxt) throw new Error('ZIP bez stop_times.txt — przerywam.');
  {
    const ins = db.prepare('INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES (?, ?, ?, ?, ?)');
    const { header } = splitHeader(stTxt);
    const ti = header.indexOf('trip_id'), ai = header.indexOf('arrival_time'),
      di = header.indexOf('departure_time'), si = header.indexOf('stop_id'), qi = header.indexOf('stop_sequence');
    let batch = 0;
    db.exec('BEGIN');
    let pos = stTxt.indexOf('\n') + 1;
    const len = stTxt.length;
    while (pos < len) {
      let nl = stTxt.indexOf('\n', pos);
      if (nl === -1) nl = len;
      let line = stTxt.slice(pos, nl);
      pos = nl + 1;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;
      // stop_times nie ma cudzysłowów — szybki split jak w aplikacji
      const c = line.split(',');
      const tid = (c[ti] || '').trim();
      if (!tid) continue;
      const arr = (c[ai] || '').trim() || '00:00:00';
      ins.run(tid, (c[si] || '').trim(), hmsToSec(arr), hmsToSec((c[di] || '').trim() || arr), Number(c[qi]) || 0);
      counts.stopTimes++;
      if (++batch >= 50000) { db.exec('COMMIT'); db.exec('BEGIN'); batch = 0; }
    }
    db.exec('COMMIT');
  }
  log(`MPK: stops=${counts.stops} routes=${counts.routes} trips=${counts.trips} stopTimes=${counts.stopTimes}`);

  // 6. KD z PDP API (pomijane bez klucza — build MPK-only).
  let kdInfo = { kind: 'pdp-api', skippedReason: PDP_API_KEY ? null : 'no-key' };
  if (PDP_API_KEY) {
    try {
      const wro = await pdpWroclawStationIds();
      log(`WROCŁAW: ${wro.stationIds.length} stacji w PDP`);
      const { from, to, routes, dict } = await pdpKdSchedules(wro.stationIds);
      const stationNames = {};
      for (const [k, v] of Object.entries(dict.stations || {})) {
        stationNames[k] = v.nm || v.name || `Stacja ${k}`;
      }
      // Współrzędne: cache w repo + Nominatim dla brakujących.
      let coords = { stations: {} };
      try {
        const raw = readFileSync(COORDS_FILE, 'utf8');
        coords = JSON.parse(raw);
        if (!coords.stations) coords.stations = {};
      } catch {}
      const unresolved = [];
      const ensureCoords = async (id, name) => {
        if (coords.stations[id]?.lat) return coords.stations[id];
        await sleep(1100); // uprzejmie dla Nominatim (max 1 req/s)
        try {
          const g = await geocodeStation(name);
          if (g) {
            coords.stations[id] = { name, lat: g.lat, lon: g.lon, updatedAt: new Date().toISOString().slice(0, 10) };
            log(`geocode OK: ${name} → ${g.lat.toFixed(5)},${g.lon.toFixed(5)}`);
            return coords.stations[id];
          }
        } catch (e) {
          warn(`geocode fail ${name}:`, String(e));
        }
        unresolved.push({ id, name });
        return null;
      };

      const insStop = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
      const insRoute = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
      const insTrip = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
      const insSt = db.prepare('INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES (?, ?, ?, ?, ?)');
      const insCal = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const insCalDate = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
      db.exec('BEGIN');
      const seenStops = new Set();
      const seenRoutes = new Set();
      for (const r of routes) {
        // Tylko przewoźnik KD (API filtruje, ale sprawdźmy dla pewności).
        if ((r.cc || r.carrierCode || '') !== KD_CARRIER) continue;
        const sid = r.sid ?? r.scheduleId;
        const oid = r.oid ?? r.orderId;
        const stops = r.st || r.stations || [];
        const dates = r.od || r.operatingDates || [];
        if (sid == null || oid == null || stops.length === 0 || dates.length === 0) continue;
        // Wszystkie postoje muszą mieć współrzędne, inaczej kurs bezużyteczny dla RAPTOR-a.
        let ok = true;
        for (const s of stops) {
          const id = String(s.id ?? s.stationId);
          const nm = stationNames[id] || `Stacja ${id}`;
          if (!seenStops.has(id)) {
            const geo = await ensureCoords(id, nm);
            if (!geo) { ok = false; break; }
            insStop.run(`KD:S:${id}`, id, nm, geo.lat, geo.lon, normalizePolish(nm));
            seenStops.add(id);
            counts.stops++;
            counts.kdStations++;
          }
        }
        if (!ok) continue;
        const num = String(r.nn ?? r.nationalNumber ?? r.nm ?? r.name ?? `${sid}/${oid}`);
        const routeId = `KD:R:${sid}:${oid}`;
        if (!seenRoutes.has(routeId)) {
          const first = stationNames[String(stops[0].id ?? stops[0].stationId)] || '';
          const last = stationNames[String(stops[stops.length - 1].id ?? stops[stops.length - 1].stationId)] || '';
          insRoute.run(routeId, num, first && last ? `${first} – ${last}` : `Koleje Dolnośląskie ${num}`, 2);
          seenRoutes.add(routeId);
          counts.routes++;
          counts.kdRoutes++;
          const svc = `KD:svc:${sid}:${oid}`;
          insCal.run(svc, 0, 0, 0, 0, 0, 0, 0, '', '');
        }
        const svc = `KD:svc:${sid}:${oid}`;
        const headsign = stationNames[String(stops[stops.length - 1].id ?? stops[stops.length - 1].stationId)] || '';
        for (const d of dates) {
          const dc = ymdCompact(d);
          const tripId = `KD:T:${sid}:${oid}:${dc}`;
          insTrip.run(tripId, routeId, svc, headsign, 0, '');
          counts.trips++;
          counts.kdTrips++;
          for (const s of stops) {
            const id = String(s.id ?? s.stationId);
            const arr = hmsToSec(s.atm ?? s.arrivalTime ?? '00:00:00') + (Number(s.ady ?? s.arrivalDay) || 0) * 86400;
            const dep = hmsToSec(s.dtm ?? s.departureTime ?? s.atm ?? s.arrivalTime ?? '00:00:00') + (Number(s.ddy ?? s.departureDay) || 0) * 86400;
            insSt.run(tripId, `KD:S:${id}`, arr, dep, Number(s.ord ?? s.orderNumber) || 0);
            counts.stopTimes++;
            counts.kdStopTimes++;
          }
          insCalDate.run(svc, dc, 1);
        }
      }
      db.exec('COMMIT');
      if (WRITE_COORDS) {
        writeFileSync(COORDS_FILE, JSON.stringify(coords, null, 2) + '\n');
        log('zapisano cache współrzędnych →', COORDS_FILE, '(przejrzyj diffa przed commitem!)');
      } else if (Object.keys(coords.stations).length === 0) {
        warn('brak cache współrzędnych i brak --write-coords — stacje KD pominięte; uruchom lokalnie z --write-coords i commituj data/kd-station-coords.json');
      }
      kdInfo = {
        kind: 'pdp-api', carrier: KD_CARRIER, windowFrom: from, windowTo: to,
        stations: seenStops.size, routes: seenRoutes.size, trips: counts.kdTrips,
        stopTimes: counts.kdStopTimes, schedulesVersion: kdVersion,
        unresolvedStations: unresolved,
      };
      log(`KD: stations=${seenStops.size} routes=${seenRoutes.size} trips=${counts.kdTrips} stopTimes=${counts.kdStopTimes}`);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      warn('sekcja KD nieudana:', String(e), '— build MPK-only.');
      kdInfo = { kind: 'pdp-api', skippedReason: `error: ${String(e).slice(0, 200)}` };
    }
  }

  // 7. Wagi, indeksy, meta, porządki.
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('CREATE INDEX IF NOT EXISTS idx_stoptimes_trip ON stop_times (trip_id, seq)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_stoptimes_stop ON stop_times (stop_id, dep_sec)');
  log('wagi przystanków…');
  db.exec('UPDATE stops SET weight = (SELECT COUNT(*) FROM stop_times WHERE stop_times.stop_id = stops.stop_id)');
  const version = `${todayCompact()}-mpk${(mpk.effectiveDate || 'unknown').replace(/-/g, '')}-kd${String(kdVersion).slice(0, 8)}`;
  const meta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  meta.run('timetable_version', version);
  meta.run('gtfs_imported_at', new Date().toISOString());
  meta.run('gtfs_source', 'network');
  meta.run('feeds', JSON.stringify({ mpk: mpk.effectiveDate, kd: kdVersion }));
  db.exec('VACUUM');
  const chk = db.prepare('PRAGMA integrity_check').get();
  const vals = chk ? Object.values(chk) : [];
  if (!vals.includes('ok')) throw new Error('integrity_check NIE przeszedł: ' + JSON.stringify(chk));
  const size = statSync(DB_FILE).size;
  const sha = createHash('sha256').update(readFileSync(DB_FILE)).digest('hex');
  db.close();
  rmSync(work, { recursive: true, force: true });

  const manifest = {
    version,
    builtAt: new Date().toISOString(),
    db: { path: 'db/kilometr-gtfs.db', sizeBytes: size, sha256: sha },
    sources: {
      mpk: {
        kind: 'gtfs-zip', catalogueUrl: MPK_CATALOGUE, downloadUrl: mpk.url,
        filename: mpk.filename || null, effectiveDate: mpk.effectiveDate,
        stops: counts.stops - counts.kdStations, routes: counts.routes - counts.kdRoutes,
        trips: counts.trips - counts.kdTrips, stopTimes: counts.stopTimes - counts.kdStopTimes,
      },
      kd: kdInfo,
    },
    stats: { stops: counts.stops, routes: counts.routes, trips: counts.trips, stopTimes: counts.stopTimes },
  };
  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n');
  log(`OK version=${version} size=${(size / 1048576).toFixed(1)} MB sha256=${sha.slice(0, 12)}…`);
  log(`artefakty: ${DB_FILE}, ${MANIFEST_FILE}`);
}

main().catch((e) => {
  console.error('[build] FATAL:', e?.stack || e);
  process.exit(1);
});
