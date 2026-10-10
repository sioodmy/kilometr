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
/**
 * Realne KD jest DOMYŚLNIE wymagane: build bez KD albo z niepełnym KD kończy
 * się błędem, żeby do R2 (a więc i do APK) nigdy nie trafiła baza MPK-only
 * ani atrapa. Jedyny świadomy wyjątek to jawne --allow-mpk-only (lokalne
 * testy / diagnostyka), które nigdy nie leci w cronie.
 */
const ALLOW_MPK_ONLY = args.has('--allow-mpk-only') || process.env.ALLOW_MPK_ONLY === '1';
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

/** 'WROCŁAW GŁÓWNY' → 'Wrocław Główny' (PDP zwraca nazwy caps-lockiem). */
function titleCasePl(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s\-/()])([a-ząćęłńóśźż])/g, (m, pre, ch) => pre + ch.toUpperCase());
}

/**
 * Słownik stacji z odpowiedzi schedules: `dc.st` = { "60103": "Wrocław Główny" }
 * (ten sam kształt co `st` w /operations). Akceptujemy też `dc.stations`
 * i wartości-obiekty { nm | name }, bo PDP nie ma publicznego schematu `dc`.
 */
function stationNamesFromDict(dc) {
  const out = {};
  const raw = dc?.st || dc?.stations || {};
  for (const [id, v] of Object.entries(raw)) {
    const name = typeof v === 'string' ? v : (v?.nm || v?.name || '');
    if (name) out[id] = titleCasePl(name);
  }
  return out;
}

/**
 * Czas postoju z pól PDP (atm = przyjazd, dtm = odjazd, ady/ddy = przesunięcie
 * dnia). Stacja końcowa ma tylko jedną godzinę, więc brakującą bierzemy z
 * drugiej razem z jej dniem. Brak obu godzin = postój nieużywalny.
 */
function stopTimesOf(s) {
  const arrHms = s.atm ?? s.arrivalTime;
  const depHms = s.dtm ?? s.departureTime;
  if (!arrHms && !depHms) return null;
  const arr = arrHms ? hmsToSec(arrHms) + (Number(s.ady ?? s.arrivalDay) || 0) * 86400 : null;
  const dep = depHms ? hmsToSec(depHms) + (Number(s.ddy ?? s.departureDay) || 0) * 86400 : null;
  return { arr: arr ?? dep, dep: dep ?? arr };
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Przesiadki MPK<->KD (te same stałe co store.ts w aplikacji).
const INTERCHANGE_RADIUS_M = 600;
const INTERCHANGE_MIN_SEC = 120;
const IX_WALK_DETOUR = 1.15;
const IX_WALK_SPEED_MPS = 1.45;
/** Dworzec Główny: słupek jest ciutkę dalej od peronów (hala + schody),
 *  więc gwarantujemy link z zapasem, nawet spoza standardowego promienia. */
const GLOWNY_OVERRIDE_SEC = 600;
const GLOWNY_OVERRIDE_RADIUS_M = 1500;

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
/* Przesiadki MPK<->KD liczone w buildzie (stacja kolejowa to nie słupek:
   dojście na peron, schody, hala — patrz INTERCHANGE_* niżej). Aplikacja
   dokleja je do footpaths przy starcie (loadInterchanges). */
CREATE TABLE interchanges (
  from_stop_id TEXT NOT NULL,
  to_stop_id TEXT NOT NULL,
  walk_sec INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'mpk-kd'
);
CREATE INDEX idx_interchanges_from ON interchanges (from_stop_id);
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

/**
 * Współrzędne stacji KD z Nominatim. Tylko wyniki w bboxie Wrocławia:
 * PDP nie podaje lokalizacji, a stacje w zapytaniu są wyłącznie miejskie.
 * Wynik spoza bboxa to śmieć (kiedyś każda stacja dostała ten sam punkt),
 * więc go odrzucamy zamiast brać pierwszy z listy.
 */
async function geocodeStation(name) {
  const inBbox = (r) => {
    const lat = Number(r.lat), lon = Number(r.lon);
    return lat >= WRO_BBOX.minLat && lat <= WRO_BBOX.maxLat && lon >= WRO_BBOX.minLon && lon <= WRO_BBOX.maxLon;
  };
  const inWro = new URLSearchParams({
    q: `${name}, Wrocław, Polska`,
    format: 'json', limit: '5', addressdetails: '0',
    viewbox: `${WRO_BBOX.minLon},${WRO_BBOX.maxLat},${WRO_BBOX.maxLon},${WRO_BBOX.minLat}`,
    bounded: '1',
  });
  const res = await fetchJson(`${NOMINATIM}?${inWro}`, { 'User-Agent': NOMINATIM_UA }, 20000);
  const hits = Array.isArray(res) ? res.filter(inBbox) : [];
  // Dworzec to railway=station/halt, nie słupek bus_stop; preferujemy kolej.
  const rank = (r) => {
    const i = ['railway/station', 'railway/halt', 'railway/stop', 'railway/platform', 'railway/junction'].indexOf(`${r.class}/${r.type}`);
    return i === -1 ? 50 : i;
  };
  const hit = [...hits].sort((a, b) => rank(a) - rank(b))[0];
  if (!hit) return null;
  return { lat: Number(hit.lat), lon: Number(hit.lon), display: hit.display_name || '' };
}

/* ─── Build ───────────────────────────────────────────────────────────── */

function todayCompact() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

async function main() {
  // Realne KD jest wymagane, chyba że jawnie --allow-mpk-only. Fail-fast
  // zamiast pobierać MPK i dopiero potem odkryć brak klucza.
  if (!PDP_API_KEY && !ALLOW_MPK_ONLY) {
    throw new Error('brak PDP_API_KEY: build wymaga realnych danych KD. Ustaw sekret PDP_API_KEY albo jawnie --allow-mpk-only (tylko diagnostyka).');
  }
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
      warn('PDP /data-version failed:', String(e), ', KD może być nieaktualne.');
      kdVersion = 'unknown';
    }
  }
  log('KD schedulesVersion:', kdVersion);

  if (!FORCE && remote?.sources
    && remote.sources.mpk?.effectiveDate === mpk.effectiveDate
    && (remote.sources.kd?.schedulesVersion || 'none') === kdVersion) {
    // Gdy KD jest wymagane, skip tylko jeśli zdalna baza faktycznie je ma.
    // Inaczej wymuszamy przebudowę (stary manifest mógł być MPK-only/mock).
    const remoteKdReal = !ALLOW_MPK_ONLY
      && !remote.sources.kd?.skippedReason
      && Number(remote.sources.kd?.stations || 0) > 0
      && Number(remote.sources.kd?.trips || 0) > 0;
    if (ALLOW_MPK_ONLY || remoteKdReal) {
      log('brak zmian (MPK + KD), skip buildu.');
      rmSync(work, { recursive: true, force: true });
      process.exit(2);
    }
    warn('zdalny manifest bez realnego KD, przebudowuję zamiast skipować.');
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
  /** Przystanki MPK w pamięci (do liczenia przesiadek na KD w kroku 6b). */
  const mpkStops = [];

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
      const lat = Number(c[idx.stop_lat]) || 0;
      const lon = Number(c[idx.stop_lon]) || 0;
      const norm = normalizePolish(name);
      ins.run(id, (c[idx.stop_code] || '').trim(), name, lat, lon, norm);
      if (lat && lon) mpkStops.push({ id, norm, lat, lon });
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

  // 6. KD z PDP API. Domyślnie WYMAGANE (patrz fail-fast na starcie main).
  let kdInfo = { kind: 'pdp-api', skippedReason: PDP_API_KEY ? null : 'no-key' };
  /** Liczba stacji KD bez współrzędnych (kursy z nimi są pomijane). */
  let unresolvedCount = 0;
  /** Stacje KD ze współrzędnymi (do przesiadek w kroku 6b). */
  const kdGeo = new Map();
  if (PDP_API_KEY) {
    try {
      const wro = await pdpWroclawStationIds();
      log(`WROCŁAW: ${wro.stationIds.length} stacji w PDP`);
      const { from, to, routes, dict } = await pdpKdSchedules(wro.stationIds);
      // Współrzędne: cache w repo (trzyma też nazwy) + Nominatim dla brakujących.
      let coords = { stations: {} };
      try {
        const raw = readFileSync(COORDS_FILE, 'utf8');
        coords = JSON.parse(raw);
        if (!coords.stations) coords.stations = {};
      } catch {}
      // Nazwa: słownik z odpowiedzi PDP, a gdy go brak, nazwa z cache.
      const stationNames = stationNamesFromDict(dict);
      for (const [id, c] of Object.entries(coords.stations)) {
        if (!stationNames[id] && c?.name) stationNames[id] = c.name;
      }
      log(`KD: nazwy stacji: ${Object.keys(stationNames).length} (ze słownika PDP + cache)`);
      const unresolved = [];
      const unnamed = new Set();
      let skippedNoTimes = 0;
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
        const dates = r.od || r.operatingDates || [];
        // Kolejność postojów wg numeru z PDP, nie wg kolejności w tablicy.
        const stops = [...(r.st || r.stations || [])]
          .sort((a, b) => (Number(a.ord ?? a.orderNumber) || 0) - (Number(b.ord ?? b.orderNumber) || 0));
        if (sid == null || oid == null || dates.length === 0) continue;
        // Kurs z jednym postojem albo z postojem bez godziny nie da się przejechać w RAPTOR-ze.
        const times = stops.map(stopTimesOf);
        if (stops.length < 2 || times.some((t) => t === null)) { skippedNoTimes++; continue; }
        // Postój bez nazwy (brak w słowniku i cache) nie dostaje współrzędnych: kurs pomijamy.
        // Postój bez współrzędnych też wyklucza kurs.
        let ok = true;
        for (const s of stops) {
          const id = String(s.id ?? s.stationId);
          const nm = stationNames[id];
          if (!nm) { unnamed.add(id); ok = false; break; }
          if (!seenStops.has(id)) {
            const geo = await ensureCoords(id, nm);
            if (!geo) { ok = false; break; }
            insStop.run(`KD:S:${id}`, id, nm, geo.lat, geo.lon, normalizePolish(nm));
            seenStops.add(id);
            kdGeo.set(id, { name: nm, lat: geo.lat, lon: geo.lon });
            counts.stops++;
            counts.kdStations++;
          }
        }
        if (!ok) continue;
        const num = String(r.nn ?? r.nationalNumber ?? r.nm ?? r.name ?? `${sid}/${oid}`);
        const routeId = `KD:R:${sid}:${oid}`;
        const svc = `KD:svc:${sid}:${oid}`;
        const firstName = stationNames[String(stops[0].id ?? stops[0].stationId)];
        const lastName = stationNames[String(stops[stops.length - 1].id ?? stops[stops.length - 1].stationId)];
        if (!seenRoutes.has(routeId)) {
          insRoute.run(routeId, num, `${firstName} – ${lastName}`, 2);
          seenRoutes.add(routeId);
          counts.routes++;
          counts.kdRoutes++;
          insCal.run(svc, 0, 0, 0, 0, 0, 0, 0, '', '');
        }
        for (const d of dates) {
          const dc = ymdCompact(d);
          const tripId = `KD:T:${sid}:${oid}:${dc}`;
          insTrip.run(tripId, routeId, svc, lastName, 0, '');
          counts.trips++;
          counts.kdTrips++;
          for (let i = 0; i < stops.length; i++) {
            const id = String(stops[i].id ?? stops[i].stationId);
            insSt.run(tripId, `KD:S:${id}`, times[i].arr, times[i].dep, i + 1);
            counts.stopTimes++;
            counts.kdStopTimes++;
          }
          insCalDate.run(svc, dc, 1);
        }
      }
      db.exec('COMMIT');
      if (unnamed.size > 0) warn(`KD: ${unnamed.size} stacji bez nazwy (brak w słowniku PDP i cache): ${[...unnamed].join(', ')}`);
      if (skippedNoTimes > 0) log(`KD: pominięto ${skippedNoTimes} kursów bez pełnych czasów (<2 postoje albo brak godziny)`);
      if (WRITE_COORDS) {
        writeFileSync(COORDS_FILE, JSON.stringify(coords, null, 2) + '\n');
        log('zapisano cache współrzędnych →', COORDS_FILE, '(przejrzyj diffa przed commitem!)');
      } else {
        log(`współrzędne KD: ${Object.keys(coords.stations).length} z cache/geokodowania (nie zapisuję pliku bez --write-coords).`);
      }
      kdInfo = {
        kind: 'pdp-api', carrier: KD_CARRIER, windowFrom: from, windowTo: to,
        stations: seenStops.size, routes: seenRoutes.size, trips: counts.kdTrips,
        stopTimes: counts.kdStopTimes, schedulesVersion: kdVersion,
        unresolvedStations: unresolved,
        unnamedStations: [...unnamed],
        skippedTripsNoTimes: skippedNoTimes,
      };
      unresolvedCount = unresolved.length;
      log(`KD: stations=${seenStops.size} routes=${seenRoutes.size} trips=${counts.kdTrips} stopTimes=${counts.kdStopTimes}`);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      warn('sekcja KD nieudana:', String(e), '— build MPK-only.');
      kdInfo = { kind: 'pdp-api', skippedReason: `error: ${String(e).slice(0, 200)}` };
    }
  }

  // 6b. Przesiadki MPK<->KD. Stacja kolejowa to nie słupek przy torach:
  // perony bywają schowane (Dworzec Główny: przystanek ~300 m od peronów
  // + hala i schody), więc linki liczymy hojnie. Aplikacja dokleja je do
  // footpaths i ZASTĘPUJE nimi gridowe linki między tymi samymi parami
  // (grid liczy sam dystans w linii prostej — bez zapasu na peron).
  let interchangeCount = 0;
  if (kdGeo.size > 0 && mpkStops.length > 0) {
    const links = new Map(); // "a|b" (posortowane) -> { a, b, walkSec }
    const link = (a, b, walkSec) => {
      const [x, y] = a < b ? [a, b] : [b, a];
      const k = `${x}|${y}`;
      const prev = links.get(k);
      if (!prev || walkSec > prev.walkSec) links.set(k, { a: x, b: y, walkSec });
    };
    const computed = (distM) => Math.max(INTERCHANGE_MIN_SEC, Math.round(distM * IX_WALK_DETOUR / IX_WALK_SPEED_MPS));
    for (const [kid, g] of kdGeo) {
      const kStopId = `KD:S:${kid}`;
      const isGlowny = normalizePolish(g.name).includes('glowny');
      for (const m of mpkStops) {
        const dist = haversineM(g.lat, g.lon, m.lat, m.lon);
        if (dist <= INTERCHANGE_RADIUS_M) {
          // Dworzec Główny: słupki są blisko w linii prostej (~150 m), ale
          // pieszo to hala + przejście podziemne na perony — twardy zapas.
          const floor = isGlowny && m.norm.includes('dworzec glowny') ? GLOWNY_OVERRIDE_SEC : INTERCHANGE_MIN_SEC;
          link(kStopId, m.id, Math.max(floor, computed(dist)));
        } else if (isGlowny && dist <= GLOWNY_OVERRIDE_RADIUS_M && m.norm.includes('dworzec glowny')) {
          // Dalsze słupki Głównego (Dworcowa/Stawowa/MDK) — gwarantowany link
          // z zapasem, nawet spoza standardowego promienia.
          link(kStopId, m.id, Math.max(GLOWNY_OVERRIDE_SEC, computed(dist)));
        }
      }
    }
    if (links.size > 0) {
      const ins = db.prepare('INSERT INTO interchanges (from_stop_id, to_stop_id, walk_sec, kind) VALUES (?, ?, ?, ?)');
      db.exec('BEGIN');
      for (const l of links.values()) ins.run(l.a, l.b, l.walkSec, 'mpk-kd');
      db.exec('COMMIT');
      interchangeCount = links.size;
    }
    log(`interchanges MPK<->KD: ${interchangeCount} (stacji KD: ${kdGeo.size})`);
    if (kdGeo.size > 0 && interchangeCount === 0) {
      warn('zero linków przesiadkowych — stacje KD bez połączenia z MPK (sprawdź współrzędne w cache!)');
    }
  }
  if (kdInfo && !kdInfo.skippedReason) kdInfo.interchanges = interchangeCount;

  // 6c. Twarda bramka: bez pełnego, realnego KD nie nadpisujemy R2.
  // Baza MPK-only albo z niekompletnym KD to dokładnie ta atrapa, której
  // nie chcemy w APK. Wszystkie cztery sekcje muszą być niepuste.
  if (!ALLOW_MPK_ONLY) {
    const problems = [];
    if (counts.kdStations === 0) problems.push('0 stacji KD');
    if (counts.kdRoutes === 0) problems.push('0 tras KD');
    if (counts.kdTrips === 0) problems.push('0 kursów KD');
    if (interchangeCount === 0) problems.push('0 przesiadek MPK<->KD');
    // Zdegenerowane współrzędne (dawniej: 30 stacji w 4 punktach) psują przesiadki.
    const uniqueKdCoords = new Set([...kdGeo.values()].map((g) => `${g.lat.toFixed(5)},${g.lon.toFixed(5)}`)).size;
    if (kdGeo.size >= 2 && uniqueKdCoords < kdGeo.size * 0.9) {
      problems.push(`współrzędne KD zdegenerowane (${uniqueKdCoords} różnych punktów dla ${kdGeo.size} stacji)`);
    }
    const kdPlaceholderNames = [...kdGeo.values()].filter((g) => /^Stacja \d+$/.test(g.name)).length;
    if (kdPlaceholderNames > 0) problems.push(`${kdPlaceholderNames} stacji KD z zastępczą nazwą "Stacja NNN"`);
    if (problems.length > 0) {
      rmSync(work, { recursive: true, force: true });
      throw new Error(`niepełne realne KD (${problems.join(', ')}): nie publikuję bazy. Napraw źródło KD (klucz/współrzędne) albo użyj --allow-mpk-only tylko do diagnostyki.`);
    }
    if (unresolvedCount > 0) {
      warn(`KD: ${unresolvedCount} stacji bez współrzędnych, część kursów pominięta (uzupełnij cache: --write-coords).`);
    }
  }

  // 7. Wagi, indeksy, meta, porządki.
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('CREATE INDEX IF NOT EXISTS idx_stoptimes_trip ON stop_times (trip_id, seq)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_stoptimes_stop ON stop_times (stop_id, dep_sec)');
  log('wagi przystanków…');
  db.exec('UPDATE stops SET weight = (SELECT COUNT(*) FROM stop_times WHERE stop_times.stop_id = stops.stop_id)');
  // Statystyki planisty (sqlite_stat1): świeży plik nie ma historii zapytań,
  // więc PRAGMA optimize nic by nie dał — jawny ANALYZE robi to deterministycznie.
  // Na telefonie tego nie powtarzamy (import i tak jest ciężki, a indeksy wystarczą).
  log('analyze…');
  db.exec('ANALYZE');
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
