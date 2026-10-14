#!/usr/bin/env node
/**
 * build-timetable.mjs: buduje prebuilt SQLite per-miasto.
 *
 * Użycie: node build-timetable.mjs [--city=wroclaw|krakow|gzm] [--force] [--write-coords] [--allow-mpk-only]
 * Bez --city zachowuje się jak dawniej (Wrocław → cloudflare/dist/).
 * Z --city artefakty lądują w cloudflare/dist/{miasto}/, a manifest niesie
 * db.path z prefiksem miasta (klucze R2: {miasto}/manifest.json,
 * {miasto}/db/kilometr-gtfs.db).
 *
 * Wrocław:
 *   Open Data Wrocław — katalog GTFS + ZIP (MPK: tramwaje + autobusy)
 *   + PDP API (PLK): KD, stacje Wrocławia, okno 14 dni (wymaga PDP_API_KEY)
 * Kraków:
 *   ZTP Kraków: 3 statyczne ZIP-y GTFS (A: autobusy, T: tramwaje, M: reszta),
 *   mergowane prefiksami KRK:{A,T,M}. Bez PDP (małopolskie koleje siedzą
 *   we własnym publicznym GTFS Kolei Małopolskich, nie w PDP).
 *
 * Wyjścia (cloudflare/dist[/{miasto}]/):
 *   kilometr-gtfs.db  — baza w schemacie aplikacji (patrz SCHEMA_SQL niżej)
 *   manifest.json: miasto, wersja, statystyki, sha256 bazy
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

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const WRITE_COORDS = args.has('--write-coords');
const CITY_ARG = [...args].map((a) => /^--city=(.+)$/.exec(a)?.[1]).find(Boolean) || '';
const CITY = CITY_ARG === 'krakow' ? 'krakow' : CITY_ARG === 'gzm' ? 'gzm' : 'wroclaw';
/** Jawny --city przełącza output na dist/{miasto}/ (workflow); bez flagi legacy dist/. */
const CITY_SCOPED = CITY_ARG !== '';
const DIST = CITY_SCOPED ? join(ROOT, 'dist', CITY) : join(ROOT, 'dist');
const DATA = join(ROOT, 'data');
const COORDS_FILE = process.env.KD_COORDS_FILE || join(DATA, 'kd-station-coords.json');
const DB_FILE = join(DIST, 'kilometr-gtfs.db');
const MANIFEST_FILE = join(DIST, 'manifest.json');
// Ścieżka bazy w R2 i w URL-u Workera (legacy Wrocław: bez prefiksu miasta).
const DB_R2_PATH = CITY_SCOPED ? `${CITY}/db/kilometr-gtfs.db` : 'db/kilometr-gtfs.db';

const MPK_CATALOGUE = 'https://api.open-data.cui.wroclaw.pl/od2/6/';
const MPK_DOWNLOAD_BASE = 'https://open-data.cui.wroclaw.pl/hdb/download';
const MPK_FALLBACK_URL = 'https://open-data.cui.wroclaw.pl/hdb/download/136/';
const MPK_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/** Statyczne feedy ZTP Kraków (A: autobusy, T: tramwaje, M: pozostałe). */
const ZTP_FEEDS = [
  { prefix: 'A', url: 'https://gtfs.ztp.krakow.pl/GTFS_KRK_A.zip' },
  { prefix: 'T', url: 'https://gtfs.ztp.krakow.pl/GTFS_KRK_T.zip' },
  { prefix: 'M', url: 'https://gtfs.ztp.krakow.pl/GTFS_KRK_M.zip' },
];
const ZTP_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/**
 * Koleje Małopolskie: własny publiczny GTFS (SKA + reszta kolei
 * regionalnej, bez klucza). Trasy w feedzie to pociągi imienne
 * (HUBAL, LUXTORPEDA...), numer pociągu siedzi w trip_short_name
 * ("33142 HUBAL"), trasy w bazie grupujemy po numerze jak kursy KD.
 */
const KML_GTFS_URL = 'https://kolejemalopolskie.com.pl/rozklady_jazdy/kml-ska-gtfs.zip';
const KML_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/**
 * GZM: ZTM publikuje eksporty dzienne (CKAN, URL-e rotowane codziennie),
 * każdy pokrywa inny zakres dat. Bierzemy wszystkie ZIP-y z datasetu
 * i mergujemy prefiksami GZM:{i} (ten sam wzorzec co feedy ZTP Krakowa).
 * Dataset: otwartedane.metropoliagzm.pl, „GTFS wersja rozszerzona”.
 */
const GZM_CKAN_PACKAGE = 'https://otwartedane.metropoliagzm.pl/api/3/action/package_show?id=317435cc-0075-4d10-b8ef-6e9b0010e90a';
const GZM_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/**
 * Koleje Śląskie: publiczny roczny GTFS (bez klucza). Pociągi grupujemy
 * po numerze z trip_short_name jak KMŁ: brygada z live (zbiorkom, agencja
 * KS) to goły numer, a dopasowanie weryfikują nazwy/czasy postojów.
 */
const KS_GTFS_URL = 'https://koleje-ks.pl/gtfs/2025-2026.zip';
const KS_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/**
 * Kolej dalekobieżna i regionalna w GZM z PDP API (ten sam klucz co KD).
 * Metrobilet 30 honorowany w IC/EIC/EIP i PR na odcinkach między stacjami
 * GZM, więc do bazy trafiają tylko postoje na stacjach GZM (PDP i tak
 * zwraca wyłącznie stacje z zapytania). Grupowanie po numerze pociągu
 * jak KD: brygada z live to goły numer.
 */
const GZM_GMINAS = [
  'BĘDZIN', 'BIERUŃ', 'BOBROWNIKI', 'BOJSZOWY', 'BYTOM', 'CHEŁM ŚLĄSKI',
  'CHORZÓW', 'CZELADŹ', 'DĄBROWA GÓRNICZA', 'GIERAŁTOWICE', 'GLIWICE',
  'IMIELIN', 'KATOWICE', 'KNURÓW', 'KOBIÓR', 'LĘDZINY', 'ŁAZISKA GÓRNE',
  'MIERZĘCICE', 'MIKOŁÓW', 'MYSŁOWICE', 'OŻAROWICE', 'PIEKARY ŚLĄSKIE',
  'PILCHOWICE', 'PSARY', 'PYSKOWICE', 'RADZIONKÓW', 'RUDA ŚLĄSKA',
  'RUDZINIEC', 'SIEMIANOWICE ŚLĄSKIE', 'SIEWIERZ', 'SŁAWKÓW', 'SOSNOWIEC',
  'SOŚNICOWICE', 'ŚWIERKLANIEC', 'ŚWIĘTOCHŁOWICE', 'TARNOWSKIE GÓRY',
  'TYCHY', 'WOJKOWICE', 'WYRY', 'ZABRZE', 'ZBROSŁAWICE',
];
/**
 * Stacje GZM, których nie ma w słowniku cities PDP (mikro-przystanki
 * pod własnymi hasłami albo braki słownika): Katowice Gł., Pyrzowice
 * Lotnisko, Nowy Bieruń. Zweryfikowane ze słownikiem stations.
 */
const GZM_EXTRA_STATIONS = [73312, 265126, 77271];
/** Bbox GZM do geokodowania stacji (minLon, maxLat, maxLon, minLat jak Nominatim). */
const GZM_BBOX = { minLon: 18.3, maxLat: 50.6, maxLon: 19.8, minLat: 49.95 };

const PDP_BASE = process.env.PDP_BASE_URL || 'https://pdp-api.plk-sa.pl';
const KD_WINDOW_DAYS = 14; // ≤ 31 (limit API: dateTo - dateFrom)
const KD_CARRIER = 'KD';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_UA = 'KilometrTimetableBot/1.0 (contact: dev@kilometr.local)';
// Wrocław: minLon, maxLat, maxLon, minLat
const WRO_BBOX = { minLon: 16.7, maxLat: 51.25, maxLon: 17.25, minLat: 50.95 };

const ALLOW_MPK_ONLY = args.has('--allow-mpk-only') || process.env.ALLOW_MPK_ONLY === '1';
/**
 * Realne KD jest DOMYŚLNIE wymagane we Wrocławiu: build bez KD albo
 * z niepełnym KD kończy się błędem, żeby do R2 (a więc i do APK) nigdy nie
 * trafiła baza MPK-only ani atrapa. Jedyny świadomy wyjątek to jawne
 * --allow-mpk-only (lokalne testy / diagnostyka), które nigdy nie leci w cronie.
 * Kraków nie ma sekcji KD wcale (małopolskie koleje siedzą w GTFS ZTP).
 */
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

/** Tani fingerprint feedu (do skipu buildu): Last-Modified albo ETag. */
async function headVersion(url, headers = {}) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { method: 'HEAD', headers, signal: ctrl.signal });
      if (!res.ok) return '';
      return res.headers.get('last-modified') || res.headers.get('etag') || '';
    } finally {
      clearTimeout(t);
    }
  } catch {
    return '';
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

/**
 * Eksporty dzienne ZTM z CKAN: wszystkie ZIP-y datasetu posortowane po
 * dacie utworzenia (jak mirror TransportGZM-GTFS). Razem pokrywają ~14 dni;
 * każdy dostaje własny prefiks GZM:{i}, bo ten sam service_id/trip_id
 * występuje w kilku eksportach z innym zakresem dat.
 */
async function discoverGzmExports() {
  const pkg = await fetchJson(GZM_CKAN_PACKAGE, { Accept: 'application/json', ...GZM_UA }, 30000);
  const resources = Array.isArray(pkg?.result?.resources) ? pkg.result.resources : [];
  const zips = resources
    .filter((r) => (r.format || '').toUpperCase() === 'ZIP' || /\.zip$/i.test(r.name || ''))
    .filter((r) => r.url)
    .sort((a, b) => (String(a.created || '') < String(b.created || '') ? -1 : 1));
  return zips.map((r, i) => ({
    label: `ZTM-${i}`,
    url: r.url,
    prefix: `GZM:${i}`,
    name: r.name || '',
    lastModified: r.last_modified || r.created || '',
  }));
}

/** YYYYMMDD -> Date UTC (bez strefy, kalendarz GTFS to daty lokalne). */
function ymdToDate(s) {
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))));
}

/** yyyymmdd z Date UTC. */
function dateToYmd(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Zwarty import eksportów dziennych ZTM (tylko GZM).
 *
 * Eksporty pokrywają rozłączne zakresy dat, ale trip_id się powtarzają
 * (ten sam kurs w różnych dniach). Zwykły merge prefiksami dałby ~4,4 mln
 * wierszy stop_times (~390 MB bazy). Tutaj: jeden wiersz kursu na trip_id
 * z sumą dat ze wszystkich eksportów (serwis scalony przez calendar_dates),
 * więc baza ląduje w okolicy ~130 MB. Kurs, którego czasy zmieniono
 * w trakcie okna, dostaje osobny wariant z sufiksem (poprawność > rozmiar).
 */
function importGzmMerged(db, txtDirs, readers, counts, cityStops, cityStopIds) {
  // 1. Kalendarze -> konkretne daty per (eksport, serwis).
  const serviceDates = new Map(); // `${i}:${sid}` -> Set<yyyymmdd>
  for (let fi = 0; fi < txtDirs.length; fi++) {
    const readTxt = readers[fi];
    const calTxt = readTxt('calendar.txt');
    if (calTxt) {
      eachRow(calTxt, (c, idx) => {
        const sid = (c[idx.service_id] || '').trim();
        const start = (c[idx.start_date] || '').trim();
        const end = (c[idx.end_date] || '').trim();
        if (!sid || start.length !== 8 || end.length !== 8) return;
        const flags = [
          Number(c[idx.sunday]) || 0, Number(c[idx.monday]) || 0, Number(c[idx.tuesday]) || 0,
          Number(c[idx.wednesday]) || 0, Number(c[idx.thursday]) || 0, Number(c[idx.friday]) || 0,
          Number(c[idx.saturday]) || 0,
        ];
        const set = new Set();
        for (let d = ymdToDate(start); dateToYmd(d) <= end; d = new Date(d.getTime() + 86400000)) {
          if (flags[d.getUTCDay()]) set.add(dateToYmd(d));
        }
        serviceDates.set(`${fi}:${sid}`, set);
      });
    }
    const calDatesTxt = readTxt('calendar_dates.txt');
    if (calDatesTxt) {
      eachRow(calDatesTxt, (c, idx) => {
        const sid = (c[idx.service_id] || '').trim();
        const date = (c[idx.date] || '').trim();
        const exc = Number(c[idx.exception_type]) || 0;
        if (!sid || date.length !== 8) return;
        const key = `${fi}:${sid}`;
        if (!serviceDates.has(key)) serviceDates.set(key, new Set());
        if (exc === 1) serviceDates.get(key).add(date);
        else if (exc === 2) serviceDates.get(key).delete(date);
      });
    }
  }

  // 2. Przystanki i linie bez prefiksów (REPLACE deduplikuje między eksportami).
  for (let fi = 0; fi < txtDirs.length; fi++) {
    const readTxt = readers[fi];
    const stopsTxt = readTxt('stops.txt');
    if (!stopsTxt) throw new Error(`ZIP ${txtDirs[fi].label} bez stops.txt, przerywam (nie nadpisuję R2 pustką).`);
    const ins = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    eachRow(stopsTxt, (c, idx) => {
      const id = (c[idx.stop_id] || '').trim();
      const name = (c[idx.stop_name] || '').trim();
      if (!id || !name) return;
      const lat = Number(c[idx.stop_lat]) || 0;
      const lon = Number(c[idx.stop_lon]) || 0;
      const norm = normalizePolish(name);
      ins.run(id, (c[idx.stop_code] || '').trim(), name, lat, lon, norm);
      if (lat && lon && !cityStopIds.has(id)) {
        cityStopIds.add(id);
        cityStops.push({ id, norm, lat, lon });
      }
      counts.stops++;
    });
    db.exec('COMMIT');
    const routesTxt = readTxt('routes.txt');
    if (routesTxt) {
      const insR = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
      db.exec('BEGIN');
      eachRow(routesTxt, (c, idx) => {
        const id = (c[idx.route_id] || '').trim();
        if (!id) return;
        const raw = (c[idx.route_type] || '').trim();
        const num = raw !== '' && !isNaN(Number(raw)) ? Number(raw) : 3;
        insR.run(id, (c[idx.route_short_name] || '').trim() || id, (c[idx.route_long_name] || '').trim(), num);
        counts.routes++;
      });
      db.exec('COMMIT');
    }
  }

  // 3. Wystąpienia kursów per eksport (daty z kalendarza tego eksportu).
  const occ = new Map(); // tid -> Array<{route, headsign, direction, shape, dates:Set}>
  let skippedNoService = 0;
  for (let fi = 0; fi < txtDirs.length; fi++) {
    const tripsTxt = readers[fi]('trips.txt');
    if (!tripsTxt) throw new Error(`ZIP ${txtDirs[fi].label} bez trips.txt, przerywam.`);
    eachRow(tripsTxt, (c, idx) => {
      const tid = (c[idx.trip_id] || '').trim();
      const rid = (c[idx.route_id] || '').trim();
      const sid = (c[idx.service_id] || '').trim();
      if (!tid || !rid || !sid) return;
      const dates = serviceDates.get(`${fi}:${sid}`);
      if (!dates || dates.size === 0) { skippedNoService++; return; }
      if (!occ.has(tid)) occ.set(tid, []);
      occ.get(tid).push({
        fi,
        route: rid,
        headsign: (c[idx.trip_headsign] || '').trim(),
        direction: Number(c[idx.direction_id]) || 0,
        shape: (c[idx.shape_id] || '').trim(),
        dates,
      });
    });
  }
  if (skippedNoService > 0) log(`GZM: pominięto ${skippedNoService} kursów bez dat serwisu`);

  // 4. Warianty: ten sam trip_id o różnych czasach w różnych eksportach
  // (zmiana rozkładu w trakcie okna) nie może dzielić jednego wiersza.
  // Sygnatura = liczba postojów + pierwszy odjazd + ostatni przyjazd.
  const kept = new Map(); // wiersz trips -> {sig, dates:Set, data}
  let divergent = 0;
  for (let fi = 0; fi < txtDirs.length; fi++) {
    const stTxt = readers[fi]('stop_times.txt');
    if (!stTxt) throw new Error(`ZIP ${txtDirs[fi].label} bez stop_times.txt, przerywam.`);
    const { header } = splitHeader(stTxt);
    const ti = header.indexOf('trip_id'), ai = header.indexOf('arrival_time'),
      di = header.indexOf('departure_time'), si = header.indexOf('stop_id'), qi = header.indexOf('stop_sequence');
    const byTrip = new Map(); // tid -> {n, firstDep, lastArr}
    let pos = stTxt.indexOf('\n') + 1;
    const len = stTxt.length;
    while (pos < len) {
      let nl = stTxt.indexOf('\n', pos);
      if (nl === -1) nl = len;
      let line = stTxt.slice(pos, nl);
      pos = nl + 1;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;
      const c = line.split(',');
      const tid = (c[ti] || '').trim();
      if (!tid || !occ.has(tid)) continue;
      let g = byTrip.get(tid);
      if (!g) { g = { n: 0, firstDep: '', lastArr: '' }; byTrip.set(tid, g); }
      g.n++;
      const dep = (c[di] || '').trim() || (c[ai] || '').trim();
      const arr = (c[ai] || '').trim() || dep;
      if (!g.firstDep) g.firstDep = dep;
      g.lastArr = arr;
    }
    for (const [tid, g] of byTrip) {
      const sig = `${g.n}|${g.firstDep}|${g.lastArr}`;
      const list = occ.get(tid);
      const o = list.find((e) => e.fi === fi) ?? list[0];
      const cur = kept.get(tid);
      if (!cur) {
        kept.set(tid, { sig, dates: new Set(o.dates), data: o });
      } else if (cur.sig === sig) {
        for (const d of o.dates) cur.dates.add(d);
      } else {
        const alias = `${tid}#G${fi}`;
        if (!kept.has(alias)) {
          kept.set(alias, { sig, dates: new Set(o.dates), data: o });
          divergent++;
        } else {
          const ex = kept.get(alias);
          if (ex.sig === sig) for (const d of o.dates) ex.dates.add(d);
        }
      }
    }
  }
  if (divergent > 0) log(`GZM: ${divergent} kursów ze zmienionym rozkładem w trakcie okna (osobne warianty)`);

  // 5. Serwisy scalone: jeden serwis na unikalny zbiór dat (zwykle kilka
  // wzorców: robocze/soboty/niedziele). Daty dopisujemy przez
  // calendar_dates, więc getActiveServices działa bez zmian.
  const svcByDates = new Map(); // klucz dat -> service_id
  const insCal = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insCalDate = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
  const insTrip = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  for (const [key, k] of kept) {
    const sorted = [...k.dates].sort();
    const dkey = sorted.join(',');
    let svc = svcByDates.get(dkey);
    if (!svc) {
      svc = `GZM:SVC:${svcByDates.size}`;
      svcByDates.set(dkey, svc);
      insCal.run(svc, 0, 0, 0, 0, 0, 0, 0, sorted[0] ?? '', sorted[sorted.length - 1] ?? '');
      for (const d of sorted) insCalDate.run(svc, d, 1);
    }
    insTrip.run(key, k.data.route, svc, k.data.headsign, k.data.direction, k.data.shape);
    counts.trips++;
  }
  db.exec('COMMIT');
  log(`GZM: kursów po scaleniu=${kept.size} (serwisów=${svcByDates.size})`);

  // 6. Czasy: drugi przebieg po stop_times, tylko dla trzymanych wariantów.
  // Grupujemy wiersze kursu w mapie (jeden eksport naraz), bo plik nie
  // jest gwarantowanie posortowany po trip_id.
  const ins = db.prepare('INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES (?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  let batch = 0;
  // Ten sam wariant kursu występuje w kilku eksportach: wiersze wstawiamy
  // raz (pierwsze wystąpienie), reszta to duplikaty. Aliasy (#G{i}) są
  // unikalne per eksport, więc wchodzą zawsze.
  const inserted = new Set();
  for (let fi = 0; fi < txtDirs.length; fi++) {
    const stTxt = readers[fi]('stop_times.txt');
    if (!stTxt) throw new Error(`ZIP ${txtDirs[fi].label} bez stop_times.txt, przerywam.`);
    const { header } = splitHeader(stTxt);
    const ti = header.indexOf('trip_id'), ai = header.indexOf('arrival_time'),
      di = header.indexOf('departure_time'), si = header.indexOf('stop_id'), qi = header.indexOf('stop_sequence');
    const byTrip = new Map(); // tid -> Array<[stop_id, arr, dep, seq]>
    let pos = stTxt.indexOf('\n') + 1;
    const len = stTxt.length;
    while (pos < len) {
      let nl = stTxt.indexOf('\n', pos);
      if (nl === -1) nl = len;
      let line = stTxt.slice(pos, nl);
      pos = nl + 1;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;
      const c = line.split(',');
      const tid = (c[ti] || '').trim();
      if (!tid || (!kept.has(tid) && !kept.has(`${tid}#G${fi}`))) continue;
      const arr = (c[ai] || '').trim() || '00:00:00';
      if (!byTrip.has(tid)) byTrip.set(tid, []);
      byTrip.get(tid).push([(c[si] || '').trim(), hmsToSec(arr), hmsToSec((c[di] || '').trim() || arr), Number(c[qi]) || 0]);
    }
    for (const [tid, rows] of byTrip) {
      const sig = rows.length ? `${rows.length}|${secToHms(rows[0][2])}|${secToHms(rows[rows.length - 1][1])}` : '|';
      const base = kept.get(tid);
      const target = base && base.sig === sig ? tid : `${tid}#G${fi}`;
      if (!kept.has(target) || inserted.has(target)) continue;
      inserted.add(target);
      for (const r of rows) {
        ins.run(target, r[0], r[1], r[2], r[3]);
        counts.stopTimes++;
        if (++batch >= 50000) { db.exec('COMMIT'); db.exec('BEGIN'); batch = 0; }
      }
    }
  }
  db.exec('COMMIT');
  log(`GZM: stopTimes po scaleniu=${counts.stopTimes}`);
}

/** Sekundy -> "HH:MM:SS" (ten sam format co w GTFS, do porównania sygnatur). */
function secToHms(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Sygnatury kursów w stop_times: tid -> "postojów|pierwszyOdjazd|ostatniPrzyjazd". */
function tripSignatures(stTxt) {
  const { header } = splitHeader(stTxt);
  const ti = header.indexOf('trip_id'), ai = header.indexOf('arrival_time'),
    di = header.indexOf('departure_time');
  const acc = new Map(); // tid -> {n, firstDep, lastArr}
  let pos = stTxt.indexOf('\n') + 1;
  const len = stTxt.length;
  while (pos < len) {
    let nl = stTxt.indexOf('\n', pos);
    if (nl === -1) nl = len;
    let line = stTxt.slice(pos, nl);
    pos = nl + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line.trim()) continue;
    const c = line.split(',');
    const tid = (c[ti] || '').trim();
    if (!tid) continue;
    let g = acc.get(tid);
    if (!g) { g = { n: 0, firstDep: '', lastArr: '' }; acc.set(tid, g); }
    g.n++;
    const dep = (c[di] || '').trim() || (c[ai] || '').trim();
    const arr = (c[ai] || '').trim() || dep;
    if (!g.firstDep) g.firstDep = dep;
    g.lastArr = arr;
  }
  const out = new Map();
  for (const [tid, g] of acc) out.set(tid, `${g.n}|${g.firstDep}|${g.lastArr}`);
  return out;
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

/**
 * Stacje kolejowe GZM: unia stacji gmin członkowskich ze słownika cities
 * PDP plus kuratorowane wyjątki (stacje spoza słownika cities). Pojedynczy
 * błąd gminy nie kładzie całości, ale pusta lista to błąd buildu.
 */
async function pdpGzmStationIds() {
  const ids = new Set(GZM_EXTRA_STATIONS.map(Number));
  for (const g of GZM_GMINAS) {
    try {
      const res = await fetchJson(`${PDP_BASE}/api/v1/dictionaries/cities?search=${encodeURIComponent(g)}`, pdpHeaders(), 20000);
      const cities = res.cities || [];
      const hit = cities.find((c) => String(c.name || '').toUpperCase() === g) || cities[0];
      if (hit && Array.isArray(hit.stationIds)) {
        for (const id of hit.stationIds) ids.add(Number(id));
      } else {
        warn(`GZM miasta: brak stacji dla ${g}`);
      }
    } catch (e) {
      warn(`GZM miasta: ${g}: ${String(e).slice(0, 120)}`);
    }
  }
  return [...ids].filter((n) => Number.isFinite(n));
}

/** Rozkład IC/PR dla stacji GZM (okno jak KD, maks. 31 dni w API). */
async function pdpGzmRail(stationIds) {
  const from = isoDaysFromNow(0);
  const to = isoDaysFromNow(KD_WINDOW_DAYS - 1);
  const q = new URLSearchParams({
    dateFrom: from, dateTo: to,
    stations: stationIds.join(','),
    carriersInclude: 'IC,PR',
    dictionaries: 'true',
  });
  const res = await fetchJson(`${PDP_BASE}/api/v1/schedules/shortened?${q}`, pdpHeaders(), 120000);
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
async function geocodeStation(name, bbox = WRO_BBOX, placeHint = 'Wrocław, Polska') {
  const inBbox = (r) => {
    const lat = Number(r.lat), lon = Number(r.lon);
    return lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon;
  };
  const q = new URLSearchParams({
    q: `${name}, ${placeHint}`,
    format: 'json', limit: '5', addressdetails: '0',
    viewbox: `${bbox.minLon},${bbox.maxLat},${bbox.maxLon},${bbox.minLat}`,
    bounded: '1',
  });
  const res = await fetchJson(`${NOMINATIM}?${q}`, { 'User-Agent': NOMINATIM_UA }, 20000);
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
  log(`miasto: ${CITY} (output: ${DIST})`);
  // Realne KD jest wymagane we Wrocławiu, chyba że jawnie --allow-mpk-only.
  // Fail-fast zamiast pobierać MPK i dopiero potem odkryć brak klucza.
  // Kraków nie używa PDP wcale, więc klucza nie wymaga.
  if (CITY === 'wroclaw' && !PDP_API_KEY && !ALLOW_MPK_ONLY) {
    throw new Error('brak PDP_API_KEY: build wymaga realnych danych KD. Ustaw sekret PDP_API_KEY albo jawnie --allow-mpk-only (tylko diagnostyka).');
  }
  mkdirSync(DIST, { recursive: true });
  const work = join(tmpdir(), `kilometr-gtfs-${Date.now()}`);
  mkdirSync(work, { recursive: true });

  // 1. Zdalny manifest (skip, gdy nic się nie zmieniło — oszczędzamy limity).
  let remote = null;
  if (PUBLIC_URL && !FORCE) {
    try {
      remote = await fetchJson(`${PUBLIC_URL}/${CITY_SCOPED ? `${CITY}/` : ''}manifest.json`, {}, 15000);
      log('remote manifest version:', remote.version);
    } catch { log('brak zdalnego manifestu (pierwszy build?) — buduję pełny.'); }
  }

  // 2. Źródła GTFS per-miasto (tanie zapytania).
  // prefix chroni przed kolizją id między feedami (Kraków ma 3 ZIP-y,
  // GZM ma N eksportów dziennych z powtarzającymi się id).
  let gtfsSources = [];
  let mpk = null;
  let kdVersion = 'none';
  let ztpFingerprint = '';
  let kmlVersion = '';
  let gtmFingerprint = '';
  let ksVersion = '';
  let icprVersion = 'none';
  if (CITY === 'krakow') {
    for (const f of ZTP_FEEDS) {
      gtfsSources.push({ label: `ZTP-${f.prefix}`, url: f.url, prefix: `KRK:${f.prefix}`, headers: ZTP_UA });
    }
    const ztpVersions = [];
    for (const s of gtfsSources) {
      s.version = await headVersion(s.url, s.headers);
      ztpVersions.push(`${s.label}=${s.version || '?'}`);
    }
    ztpFingerprint = ztpVersions.join('|');
    kmlVersion = await headVersion(KML_GTFS_URL, KML_UA);
    log('ZTP:', ztpFingerprint, '| KMŁ:', kmlVersion || '?');
  } else if (CITY === 'gzm') {
    if (!PDP_API_KEY) {
      throw new Error('GZM wymaga PDP_API_KEY (IC/PR z PDP API), inaczej baza byłaby bez kolei.');
    }
    const exports = await discoverGzmExports();
    if (exports.length === 0) throw new Error('CKAN ZTM: brak eksportów ZIP, przerywam (nie nadpisuję R2 pustką).');
    for (const e of exports) {
      gtfsSources.push({ label: e.label, url: e.url, prefix: e.prefix, headers: GZM_UA, version: e.lastModified });
    }
    gtmFingerprint = exports.map((e) => `${e.name}|${e.lastModified}`).join(';');
    ksVersion = await headVersion(KS_GTFS_URL, KS_UA);
    log(`ZTM: ${exports.length} eksportów dziennych | KŚ:`, ksVersion || '?');
    try {
      icprVersion = await pdpDataVersion();
    } catch (e) {
      warn('PDP /data-version failed:', String(e), ', IC/PR mogą być nieaktualne.');
      icprVersion = 'unknown';
    }
    log('IC/PR schedulesVersion:', icprVersion);
  } else {
    mpk = await discoverMpk();
    log('MPK:', mpk.filename || mpk.url, '| effective:', mpk.effectiveDate);
    if (PDP_API_KEY) {
      try {
        kdVersion = await pdpDataVersion();
      } catch (e) {
        warn('PDP /data-version failed:', String(e), ', KD może być nieaktualne.');
        kdVersion = 'unknown';
      }
    }
    log('KD schedulesVersion:', kdVersion);
    gtfsSources = [{ label: 'MPK', url: mpk.url, prefix: '', headers: MPK_UA, version: mpk.effectiveDate }];
  }

  // Odcisk ZTP/KMŁ powstaje z Last-Modified/ETag. Gdy feed ich nie zwraca,
  // „odcisk” jest stały i nie wykryje zmiany rozkładu, więc skip byłby wieczny.
  // Wtedy (bez --force) budujemy na nowo zamiast pomijać.
  const ztpVersionsReliable = CITY !== 'krakow' || (gtfsSources.length > 0 && gtfsSources.every((s) => !!s.version));
  const kmlVersionReliable = CITY !== 'krakow' || !!kmlVersion;
  const gtmVersionsReliable = CITY !== 'gzm' || (gtfsSources.length > 0 && gtfsSources.every((s) => !!s.version));
  const ksVersionReliable = CITY !== 'gzm' || !!ksVersion;

  if (!FORCE && remote?.sources) {
    if (CITY === 'krakow' && remote.sources.ztp?.fingerprint === ztpFingerprint && ztpFingerprint) {
      // Ten sam ZTP wystarczy do skipu tylko wtedy, gdy zdalna baza faktycznie
      // ma Koleje Małopolskie. Manifest sprzed ich wdrożenia ma zgodny odcisk
      // ZTP, ale pociągów nie zawiera, więc bez tego warunku Kraków nigdy by
      // ich nie dostał.
      const remoteKmlReal =
        (remote.sources.kml?.version || null) === (kmlVersion || null) &&
        Number(remote.sources.kml?.stations || 0) > 0 &&
        Number(remote.sources.kml?.trips || 0) > 0;
      if (!ztpVersionsReliable || !kmlVersionReliable) {
        warn('feed bez Last-Modified/ETag, nie mogę wykryć zmian: przebudowuję zamiast skipować.');
      } else if (remoteKmlReal) {
        log('brak zmian (ZTP + KMŁ), skip buildu.');
        rmSync(work, { recursive: true, force: true });
        process.exit(2);
      } else {
        warn('zdalny manifest bez realnego KMŁ, przebudowuję zamiast skipować.');
      }
    }
    if (CITY === 'gzm' && remote.sources.ztm?.fingerprint === gtmFingerprint && gtmFingerprint) {
      // Ten sam zestaw eksportów ZTM wystarczy do skipu tylko wtedy, gdy
      // zdalna baza faktycznie ma Koleje Śląskie i IC/PR (manifest sprzed
      // ich wdrożenia ma zgodny odcisk, ale pociągów nie zawiera).
      const remoteKsReal =
        (remote.sources.ks?.version || null) === (ksVersion || null) &&
        Number(remote.sources.ks?.stations || 0) > 0 &&
        Number(remote.sources.ks?.trips || 0) > 0;
      const remoteIcPrReal =
        (remote.sources.ic?.schedulesVersion || null) === (icprVersion || null) &&
        (remote.sources.pr?.schedulesVersion || null) === (icprVersion || null) &&
        Number(remote.sources.ic?.trips || 0) > 0 &&
        Number(remote.sources.pr?.trips || 0) > 0;
      if (!gtmVersionsReliable || !ksVersionReliable) {
        warn('feed bez Last-Modified/ETag, nie mogę wykryć zmian: przebudowuję zamiast skipować.');
      } else if (remoteKsReal && remoteIcPrReal) {
        log('brak zmian (ZTM + KŚ + IC/PR), skip buildu.');
        rmSync(work, { recursive: true, force: true });
        process.exit(2);
      } else {
        warn('zdalny manifest bez realnych KŚ/IC/PR, przebudowuję zamiast skipować.');
      }
    }
    if (CITY === 'wroclaw'
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
  }

  // 3. Pobieranie ZIP-ów + rozpakowanie (unzip z systemu, Node nie ma wbudowanego).
  const NEEDED = ['stops.txt', 'routes.txt', 'calendar.txt', 'calendar_dates.txt', 'trips.txt', 'stop_times.txt'];
  const txtDirs = [];
  for (const [i, src] of gtfsSources.entries()) {
    const zipPath = join(work, `gtfs-${i}.zip`);
    log(`pobieranie ZIP ${src.label}…`);
    const zipBuf = await fetchBuffer(src.url, src.headers, 180000);
    writeFileSync(zipPath, zipBuf);
    log(`ZIP ${src.label}:`, (zipBuf.length / 1048576).toFixed(1), 'MB');
    const txtDir = join(work, `gtfs-${i}`);
    mkdirSync(txtDir, { recursive: true });
    // Niezerowy exit tolerujemy (np. brak opcjonalnego calendar.txt w feedzie:
    // unzip krzyczy "filename not matched", ale resztę wypakowuje). Brak
    // wymaganych plików wyłapią konkretne błędy przy imporcie niżej.
    try {
      execFileSync('unzip', ['-o', '-j', zipPath, ...NEEDED, '-d', txtDir], { stdio: 'pipe' });
    } catch (e) {
      if (e && (e.code === 'ENOENT' || /not found/i.test(String(e.message || '')))) {
        rmSync(work, { recursive: true, force: true });
        throw new Error('Brak programu `unzip` w PATH (linux/macos: standard; Windows: Git Bash/WSL).');
      }
      warn(`unzip dla ${src.label} zwrócił błąd (kontynuuję, zweryfikuję pliki):`, String((e && e.message) || e).slice(0, 160));
    }
    txtDirs.push({ dir: txtDir, prefix: src.prefix, label: src.label });
  }
  const readers = txtDirs.map(({ dir }) => (n) => {
    try { return readFileSync(join(dir, n), 'utf8'); } catch { return null; }
  });

  // 4. Świeża baza.
  try { rmSync(DB_FILE, { force: true }); } catch {}
  for (const suf of ['-wal', '-shm', '-journal']) {
    try { rmSync(DB_FILE + suf, { force: true }); } catch {}
  }
  const db = new DatabaseSync(DB_FILE);
  db.exec(SCHEMA_SQL);
  db.exec('PRAGMA synchronous = OFF;');

  const counts = { stops: 0, routes: 0, trips: 0, stopTimes: 0, kdStations: 0, kdRoutes: 0, kdTrips: 0, kdStopTimes: 0, kmlStations: 0, kmlRoutes: 0, kmlTrips: 0, kmlStopTimes: 0, ksStations: 0, ksRoutes: 0, ksTrips: 0, ksStopTimes: 0, icStations: 0, icRoutes: 0, icTrips: 0, icStopTimes: 0, prStations: 0, prRoutes: 0, prTrips: 0, prStopTimes: 0 };
  /** Przystanki miasta w pamięci (do liczenia przesiadek na kolej w kroku 6b). */
  const cityStops = [];
  const cityStopIds = new Set();

  // 5. GTFS → tabele. Kraków merguje 3 feedy: przystanki współdzielone
  // (REPLACE po stop_id), reszta id z prefiksem KRK:{A,T,M} (brak kolizji).
  // GZM merguje N eksportów dziennych zwartym importem (dedupe kursów).
  db.exec('DELETE FROM calendar_dates');
  if (CITY === 'gzm') {
    importGzmMerged(db, txtDirs, readers, counts, cityStops, cityStopIds);
  } else {
  for (let fi = 0; fi < txtDirs.length; fi++) {
    const { prefix, label } = txtDirs[fi];
    const readTxt = readers[fi];
    const P = (id) => (prefix ? `${prefix}:${id}` : id);
    const stopsTxt = readTxt('stops.txt');
    if (!stopsTxt) throw new Error(`ZIP ${label} bez stops.txt, przerywam (nie nadpisuję R2 pustką).`);
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
        if (lat && lon && !cityStopIds.has(id)) {
          cityStopIds.add(id);
          cityStops.push({ id, norm, lat, lon });
        }
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
        let num = raw !== '' && !isNaN(Number(raw)) ? Number(raw) : 3;
        // ZTP Kraków oznacza tramwaje rozszerzonym typem 900, sprowadzamy
        // do kanonicznego GTFS 0, żeby filtry tramwaj/autobus działały.
        if (CITY === 'krakow' && num === 900) num = 0;
        ins.run(P(id), (c[idx.route_short_name] || '').trim() || id, (c[idx.route_long_name] || '').trim(), num);
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
        ins.run(P(id), Number(c[idx.monday]) || 0, Number(c[idx.tuesday]) || 0, Number(c[idx.wednesday]) || 0,
          Number(c[idx.thursday]) || 0, Number(c[idx.friday]) || 0, Number(c[idx.saturday]) || 0, Number(c[idx.sunday]) || 0,
          (c[idx.start_date] || '').trim(), (c[idx.end_date] || '').trim());
      });
      db.exec('COMMIT');
    }
    const calDatesTxt = readTxt('calendar_dates.txt');
    if (calDatesTxt) {
      const rows = [];
      eachRow(calDatesTxt, (c, idx) => {
        const id = (c[idx.service_id] || '').trim();
        if (id) rows.push([P(id), (c[idx.date] || '').trim(), Number(c[idx.exception_type]) || 0]);
      });
      const ins = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
      db.exec('BEGIN');
      for (const r of rows) ins.run(...r);
      db.exec('COMMIT');
    }
    const tripsTxt = readTxt('trips.txt');
    if (!tripsTxt) throw new Error(`ZIP ${label} bez trips.txt, przerywam.`);
    {
      const ins = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      let i = 0;
      eachRow(tripsTxt, (c, idx) => {
        const tid = (c[idx.trip_id] || '').trim();
        const rid = (c[idx.route_id] || '').trim();
        const sid = (c[idx.service_id] || '').trim();
        if (!tid || !rid || !sid) return;
        ins.run(P(tid), P(rid), P(sid), (c[idx.trip_headsign] || '').trim(), Number(c[idx.direction_id]) || 0, (c[idx.shape_id] || '').trim());
        if (++i % 5000 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); }
        counts.trips++;
      });
      db.exec('COMMIT');
    }
    const stTxt = readTxt('stop_times.txt');
    if (!stTxt) throw new Error(`ZIP ${label} bez stop_times.txt, przerywam.`);
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
        // stop_times nie ma cudzysłowów, więc szybki split jak w aplikacji
        const c = line.split(',');
        const tid = (c[ti] || '').trim();
        if (!tid) continue;
        const arr = (c[ai] || '').trim() || '00:00:00';
        ins.run(P(tid), (c[si] || '').trim(), hmsToSec(arr), hmsToSec((c[di] || '').trim() || arr), Number(c[qi]) || 0);
        counts.stopTimes++;
        if (++batch >= 50000) { db.exec('COMMIT'); db.exec('BEGIN'); batch = 0; }
      }
      db.exec('COMMIT');
    }
    log(`${label}: routes=${counts.routes} trips=${counts.trips} stopTimes=${counts.stopTimes}`);
  }
  }
  // Przystanki liczone z dupami między feedami, przelicz na stan faktyczny.
  try {
    counts.stops = db.prepare('SELECT COUNT(*) AS n FROM stops').get().n;
  } catch {}
  log(`GTFS: stops=${counts.stops} routes=${counts.routes} trips=${counts.trips} stopTimes=${counts.stopTimes}`);

  // 6. Kolej regionalna: KD z PDP API (tylko Wrocław) albo Koleje
  // Małopolskie ze statycznego GTFS (tylko Kraków). Wspólny mianownik:
  // mapa stacji railGeo (do przesiadek w kroku 6b) i prefiks ID.
  const RAIL_PREFIX = CITY === 'krakow' ? 'KML' : CITY === 'gzm' ? 'KS' : 'KD';
  let kdInfo = CITY === 'wroclaw'
    ? { kind: 'pdp-api', skippedReason: PDP_API_KEY ? null : 'no-key' }
    : { kind: 'none', skippedReason: 'krakow-pdp-unused' };
  let kmlInfo = CITY === 'krakow'
    ? { kind: 'gtfs-zip', skippedReason: 'not-fetched-yet' }
    : { kind: 'none', skippedReason: 'wroclaw-no-kml' };
  let ksInfo = CITY === 'gzm'
    ? { kind: 'gtfs-zip', skippedReason: 'not-fetched-yet' }
    : { kind: 'none', skippedReason: 'only-gzm-has-ks' };
  let icInfo = CITY === 'gzm'
    ? { kind: 'pdp-api', skippedReason: 'not-fetched-yet' }
    : { kind: 'none', skippedReason: 'only-gzm-has-ic' };
  let prInfo = CITY === 'gzm'
    ? { kind: 'pdp-api', skippedReason: 'not-fetched-yet' }
    : { kind: 'none', skippedReason: 'only-gzm-has-pr' };
  /** Liczba stacji kolei bez współrzędnych (kursy z nimi są pomijane). */
  let unresolvedCount = 0;
  /** Stacje kolei ze współrzędnymi (do przesiadek w kroku 6b). */
  const railGeo = new Map();
  if (CITY === 'wroclaw' && PDP_API_KEY) {
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
            railGeo.set(id, { name: nm, lat: geo.lat, lon: geo.lon });
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

  // 6a. Koleje Małopolskie ze statycznego GTFS (tylko Kraków, bez klucza).
  // Trasy w bazie grupujemy po numerze pociągu (pierwszy token trip_short_name,
  // np. "33142" z "33142 HUBAL"), ten sam wzorzec co kursy KD: LineBadge
  // pokazuje numer, a live dopina się po numerze (brygada z zbiorkom).
  if (CITY === 'krakow') {
    const zipPath = join(work, 'kml.zip');
    log('pobieranie ZIP KMŁ…');
    const zipBuf = await fetchBuffer(KML_GTFS_URL, KML_UA, 180000);
    writeFileSync(zipPath, zipBuf);
    log('ZIP KMŁ:', (zipBuf.length / 1048576).toFixed(1), 'MB');
    const txtDir = join(work, 'kml');
    mkdirSync(txtDir, { recursive: true });
    // Jak wyżej: brak opcjonalnego calendar.txt to nie błąd unzip.
    try {
      execFileSync('unzip', ['-o', '-j', zipPath, ...NEEDED, '-d', txtDir], { stdio: 'pipe' });
    } catch (e) {
      if (e && (e.code === 'ENOENT' || /not found/i.test(String(e.message || '')))) {
        rmSync(work, { recursive: true, force: true });
        throw new Error('Brak programu `unzip` w PATH (linux/macos: standard; Windows: Git Bash/WSL).');
      }
      warn('unzip dla KMŁ zwrócił błąd (kontynuuję, zweryfikuję pliki):', String((e && e.message) || e).slice(0, 160));
    }
    const readKml = (n) => {
      try { return readFileSync(join(txtDir, n), 'utf8'); } catch { return null; }
    };
    const PS = (id) => `KML:S:${id}`;
    const PR = (id) => `KML:${id}`;
    const stopsTxt = readKml('stops.txt');
    if (!stopsTxt) throw new Error('ZIP KMŁ bez stops.txt, przerywam (nie nadpisuję R2 pustką).');
    {
      const ins = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      eachRow(stopsTxt, (c, idx) => {
        const id = (c[idx.stop_id] || '').trim();
        const name = (c[idx.stop_name] || '').trim();
        if (!id || !name) return;
        const lat = Number(c[idx.stop_lat]) || 0;
        const lon = Number(c[idx.stop_lon]) || 0;
        if (!lat || !lon) { unresolvedCount++; return; }
        ins.run(PS(id), (c[idx.stop_code] || '').trim(), titleCasePl(name), lat, lon, normalizePolish(name));
        railGeo.set(id, { name: titleCasePl(name), lat, lon });
        counts.stops++;
        counts.kmlStations++;
      });
      db.exec('COMMIT');
    }
    const tripsTxt = readKml('trips.txt');
    if (!tripsTxt) throw new Error('ZIP KMŁ bez trips.txt, przerywam.');
    const trainOf = new Map(); // numer pociągu -> { routeId, first, last }
    let skippedNoNumber = 0;
    {
      const insRoute = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
      const insTrip = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
      const insCal = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      eachRow(tripsTxt, (c, idx) => {
        const tid = (c[idx.trip_id] || '').trim();
        const sid = (c[idx.service_id] || '').trim();
        if (!tid || !sid) return;
        // Numer pociągu to pierwszy token trip_short_name ("33142" z "33142 HUBAL").
        // Sufiks wariantu ("/1" w "30710/1") odcinamy: live (brygada zbiorkom)
        // niesie goły numer, a kierunek i tak weryfikują nazwy/czasy postojów.
        const fullShort = (c[idx.trip_short_name] || '').trim();
        const rawNum = (fullShort.split(/\s/)[0] || '').trim();
        const num = rawNum.split('/')[0].trim();
        if (!num) { skippedNoNumber++; return; }
        const routeId = `KML:R:${num}`;
        const headsign = (c[idx.trip_headsign] || '').trim();
        if (!trainOf.has(num)) {
          const trainName = fullShort.slice(rawNum.length).trim() || headsign || num;
          insRoute.run(routeId, num, trainName, 2);
          trainOf.set(num, { routeId, name: trainName });
          counts.routes++;
          counts.kmlRoutes++;
          insCal.run(PR(sid), 0, 0, 0, 0, 0, 0, 0, '', '');
        }
        insTrip.run(PR(tid), routeId, PR(sid), headsign, Number(c[idx.direction_id]) || 0, (c[idx.shape_id] || '').trim());
        counts.trips++;
        counts.kmlTrips++;
      });
      db.exec('COMMIT');
    }
    if (skippedNoNumber > 0) log(`KMŁ: pominięto ${skippedNoNumber} kursów bez numeru pociągu`);
    const calDatesTxt = readKml('calendar_dates.txt');
    if (calDatesTxt) {
      const ins = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
      db.exec('BEGIN');
      eachRow(calDatesTxt, (c, idx) => {
        const id = (c[idx.service_id] || '').trim();
        if (id) ins.run(PR(id), (c[idx.date] || '').trim(), Number(c[idx.exception_type]) || 0);
      });
      db.exec('COMMIT');
    }
    const stTxt = readKml('stop_times.txt');
    if (!stTxt) throw new Error('ZIP KMŁ bez stop_times.txt, przerywam.');
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
        const c = line.split(',');
        const tid = (c[ti] || '').trim();
        if (!tid) continue;
        const arr = (c[ai] || '').trim() || '00:00:00';
        ins.run(PR(tid), PS((c[si] || '').trim()), hmsToSec(arr), hmsToSec((c[di] || '').trim() || arr), Number(c[qi]) || 0);
        counts.stopTimes++;
        counts.kmlStopTimes++;
        if (++batch >= 50000) { db.exec('COMMIT'); db.exec('BEGIN'); batch = 0; }
      }
      db.exec('COMMIT');
    }
    kmlInfo = {
      kind: 'gtfs-zip', url: KML_GTFS_URL, version: kmlVersion || null,
      stations: railGeo.size, routes: trainOf.size, trips: counts.kmlTrips,
      stopTimes: counts.kmlStopTimes, skippedTripsNoNumber: skippedNoNumber,
    };
    log(`KMŁ: stations=${railGeo.size} routes=${trainOf.size} trips=${counts.kmlTrips} stopTimes=${counts.kmlStopTimes}`);
  }

  // 6a2. Koleje Śląskie ze statycznego GTFS (tylko GZM, bez klucza).
  // Ten sam wzorzec co KMŁ: trasy grupujemy po numerze pociągu (pierwszy
  // token trip_short_name), live dopina się po numerze (brygada zbiorkom,
  // agencja KS). Numery parzyste "34052/34053" to obie strony kursu:
  // druga strona dostaje alias z sufiksem, żeby brygada wracała też.
  if (CITY === 'gzm') {
    const zipPath = join(work, 'ks.zip');
    log('pobieranie ZIP KŚ…');
    const zipBuf = await fetchBuffer(KS_GTFS_URL, KS_UA, 180000);
    writeFileSync(zipPath, zipBuf);
    log('ZIP KŚ:', (zipBuf.length / 1048576).toFixed(1), 'MB');
    const txtDir = join(work, 'ks');
    mkdirSync(txtDir, { recursive: true });
    try {
      execFileSync('unzip', ['-o', '-j', zipPath, ...NEEDED, '-d', txtDir], { stdio: 'pipe' });
    } catch (e) {
      if (e && (e.code === 'ENOENT' || /not found/i.test(String(e.message || '')))) {
        rmSync(work, { recursive: true, force: true });
        throw new Error('Brak programu `unzip` w PATH (linux/macos: standard; Windows: Git Bash/WSL).');
      }
      warn('unzip dla KŚ zwrócił błąd (kontynuuję, zweryfikuję pliki):', String((e && e.message) || e).slice(0, 160));
    }
    const readKs = (n) => {
      try { return readFileSync(join(txtDir, n), 'utf8'); } catch { return null; }
    };
    const PS = (id) => `KS:S:${id}`;
    const PR = (id) => `KS:${id}`;
    const stopsTxt = readKs('stops.txt');
    if (!stopsTxt) throw new Error('ZIP KŚ bez stops.txt, przerywam (nie nadpisuję R2 pustką).');
    {
      const ins = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      eachRow(stopsTxt, (c, idx) => {
        const id = (c[idx.stop_id] || '').trim();
        const name = (c[idx.stop_name] || '').trim();
        if (!id || !name) return;
        const lat = Number(c[idx.stop_lat]) || 0;
        const lon = Number(c[idx.stop_lon]) || 0;
        if (!lat || !lon) { unresolvedCount++; return; }
        ins.run(PS(id), (c[idx.stop_code] || '').trim(), titleCasePl(name), lat, lon, normalizePolish(name));
        railGeo.set(id, { name: titleCasePl(name), lat, lon });
        counts.stops++;
        counts.ksStations++;
      });
      db.exec('COMMIT');
    }
    const calTxt = readKs('calendar.txt');
    if (calTxt) {
      const ins = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      eachRow(calTxt, (c, idx) => {
        const id = (c[idx.service_id] || '').trim();
        if (!id) return;
        ins.run(PR(id), Number(c[idx.monday]) || 0, Number(c[idx.tuesday]) || 0, Number(c[idx.wednesday]) || 0,
          Number(c[idx.thursday]) || 0, Number(c[idx.friday]) || 0, Number(c[idx.saturday]) || 0, Number(c[idx.sunday]) || 0,
          (c[idx.start_date] || '').trim(), (c[idx.end_date] || '').trim());
      });
      db.exec('COMMIT');
    }
    const calDatesTxt = readKs('calendar_dates.txt');
    if (calDatesTxt) {
      const ins = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
      db.exec('BEGIN');
      eachRow(calDatesTxt, (c, idx) => {
        const id = (c[idx.service_id] || '').trim();
        if (id) ins.run(PR(id), (c[idx.date] || '').trim(), Number(c[idx.exception_type]) || 0);
      });
      db.exec('COMMIT');
    }
    const tripsTxt = readKs('trips.txt');
    if (!tripsTxt) throw new Error('ZIP KŚ bez trips.txt, przerywam.');
    const trainOf = new Map(); // numer pociągu -> routeId
    const ksAliases = new Map(); // trip_id -> dopisane aliasy (druga strona "a/b")
    let skippedNoNumber = 0;
    {
      const insRoute = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
      const insTrip = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      eachRow(tripsTxt, (c, idx) => {
        const tid = (c[idx.trip_id] || '').trim();
        const sid = (c[idx.service_id] || '').trim();
        if (!tid || !sid) return;
        const fullShort = (c[idx.trip_short_name] || '').trim();
        const nums = (fullShort.split(/\s/)[0] || '').split('/').map((s) => s.trim()).filter(Boolean);
        const num = nums[0] || '';
        if (!num) { skippedNoNumber++; return; }
        const headsign = (c[idx.trip_headsign] || '').trim();
        const direction = Number(c[idx.direction_id]) || 0;
        const shape = (c[idx.shape_id] || '').trim();
        const putTrip = (tripId, trainNum) => {
          const routeId = `KS:R:${trainNum}`;
          if (!trainOf.has(trainNum)) {
            insRoute.run(routeId, trainNum, headsign || trainNum, 2);
            trainOf.set(trainNum, routeId);
            counts.routes++;
            counts.ksRoutes++;
          }
          insTrip.run(PR(tripId), routeId, PR(sid), headsign, direction, shape);
          counts.trips++;
          counts.ksTrips++;
        };
        putTrip(tid, num);
        if (nums[1] && nums[1] !== num) {
          const alias = `${tid}#b`;
          putTrip(alias, nums[1]);
          if (!ksAliases.has(tid)) ksAliases.set(tid, []);
          ksAliases.get(tid).push(alias);
        }
      });
      db.exec('COMMIT');
    }
    if (skippedNoNumber > 0) log(`KŚ: pominięto ${skippedNoNumber} kursów bez numeru pociągu`);
    const stTxt = readKs('stop_times.txt');
    if (!stTxt) throw new Error('ZIP KŚ bez stop_times.txt, przerywam.');
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
        const c = line.split(',');
        const tid = (c[ti] || '').trim();
        if (!tid) continue;
        const arr = (c[ai] || '').trim() || '00:00:00';
        const ids = [tid, ...(ksAliases.get(tid) ?? [])];
        for (const id of ids) {
          ins.run(PR(id), PS((c[si] || '').trim()), hmsToSec(arr), hmsToSec((c[di] || '').trim() || arr), Number(c[qi]) || 0);
          counts.stopTimes++;
          counts.ksStopTimes++;
        }
        if (++batch >= 50000) { db.exec('COMMIT'); db.exec('BEGIN'); batch = 0; }
      }
      db.exec('COMMIT');
    }
    ksInfo = {
      kind: 'gtfs-zip', url: KS_GTFS_URL, version: ksVersion || null,
      stations: railGeo.size, routes: trainOf.size, trips: counts.ksTrips,
      stopTimes: counts.ksStopTimes, skippedTripsNoNumber: skippedNoNumber,
    };
    log(`KŚ: stations=${railGeo.size} routes=${trainOf.size} trips=${counts.ksTrips} stopTimes=${counts.ksStopTimes}`);
  }

  // 6a3. IC + Polregio z PDP API (tylko GZM, ten sam klucz co KD).
  // Kursy grupujemy po numerze pociągu (brygada z live to goły numer),
  // trasy po (sid, oid) jak KD. PDP zwraca tylko stacje z zapytania,
  // więc odcinki są z natury ucięte do GZM; kursy z <2 postojami
  // w GZM odrzucamy. Współrzędne najpierw z KŚ (te same fizyczne
  // stacje), brakujące geokodujemy jak KD.
  if (CITY === 'gzm') {
    const GZM_COORDS_FILE = process.env.GZM_COORDS_FILE || join(DATA, 'gzm-station-coords.json');
    const gzmIds = await pdpGzmStationIds();
    if (gzmIds.length === 0) throw new Error('GZM: pusta lista stacji (PDP cities), przerywam.');
    log(`GZM: ${gzmIds.length} stacji w PDP`);
    const gzmSet = new Set(gzmIds.map(String));
    const { from, to, routes, dict } = await pdpGzmRail(gzmIds);
    const stationNames = stationNamesFromDict(dict);
    const ksGeoByNorm = new Map();
    for (const g of railGeo.values()) ksGeoByNorm.set(normalizePolish(g.name), g);
    let coords = { stations: {} };
    try {
      const raw = readFileSync(GZM_COORDS_FILE, 'utf8');
      coords = JSON.parse(raw);
      if (!coords.stations) coords.stations = {};
    } catch {}
    for (const [id, c] of Object.entries(coords.stations)) {
      if (!stationNames[id] && c?.name) stationNames[id] = c.name;
    }
    log(`IC/PR: nazw stacji: ${Object.keys(stationNames).length} (ze słownika PDP + cache + KŚ)`);
    const unresolved = [];
    const unnamed = new Set();
    let skippedNoTimes = 0;
    let skippedOutside = 0;
    const ensureCoords = async (id, name) => {
      const known = ksGeoByNorm.get(normalizePolish(name));
      if (known) return known;
      if (coords.stations[id]?.lat) return coords.stations[id];
      await sleep(1100); // uprzejmie dla Nominatim (max 1 req/s)
      try {
        const g = await geocodeStation(name, GZM_BBOX, 'Polska');
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
    const perCc = { IC: { stations: 0, routes: 0, trips: 0, stopTimes: 0 }, PR: { stations: 0, routes: 0, trips: 0, stopTimes: 0 } };
    for (const r of routes) {
      const cc = (r.cc || r.carrierCode || '');
      if (cc !== 'IC' && cc !== 'PR') continue;
      const stat = perCc[cc];
      const sid = r.sid ?? r.scheduleId;
      const oid = r.oid ?? r.orderId;
      const dates = r.od || r.operatingDates || [];
      const stops = [...(r.st || r.stations || [])]
        .sort((a, b) => (Number(a.ord ?? a.orderNumber) || 0) - (Number(b.ord ?? b.orderNumber) || 0))
        .filter((s) => gzmSet.has(String(s.id ?? s.stationId)));
      if (sid == null || oid == null || dates.length === 0) continue;
      if (stops.length < 2) { skippedOutside++; continue; }
      const times = stops.map(stopTimesOf);
      if (times.some((t) => t === null)) { skippedNoTimes++; continue; }
      let ok = true;
      for (const s of stops) {
        const id = String(s.id ?? s.stationId);
        const nm = stationNames[id];
        if (!nm) { unnamed.add(id); ok = false; break; }
        if (!seenStops.has(`${cc}:${id}`)) {
          const geo = await ensureCoords(id, nm);
          if (!geo) { ok = false; break; }
          insStop.run(`${cc}:S:${id}`, id, nm, geo.lat, geo.lon, normalizePolish(nm));
          seenStops.add(`${cc}:${id}`);
          railGeo.set(`${cc}:S:${id}`, { stopId: `${cc}:S:${id}`, name: nm, lat: geo.lat, lon: geo.lon });
          counts.stops++;
          stat.stations++;
        }
      }
      if (!ok) continue;
      const num = String(r.nn ?? r.nationalNumber ?? r.nm ?? r.name ?? `${sid}/${oid}`);
      const routeId = `${cc}:R:${sid}:${oid}`;
      const svc = `${cc}:svc:${sid}:${oid}`;
      const firstName = stationNames[String(stops[0].id ?? stops[0].stationId)];
      const lastName = stationNames[String(stops[stops.length - 1].id ?? stops[stops.length - 1].stationId)];
      if (!seenRoutes.has(routeId)) {
        insRoute.run(routeId, num, `${firstName} – ${lastName}`, 2);
        seenRoutes.add(routeId);
        counts.routes++;
        stat.routes++;
        insCal.run(svc, 0, 0, 0, 0, 0, 0, 0, '', '');
      }
      for (const d of dates) {
        const dc = ymdCompact(d);
        const tripId = `${cc}:T:${sid}:${oid}:${dc}`;
        insTrip.run(tripId, routeId, svc, lastName, 0, '');
        counts.trips++;
        stat.trips++;
        for (let i = 0; i < stops.length; i++) {
          const id = String(stops[i].id ?? stops[i].stationId);
          insSt.run(tripId, `${cc}:S:${id}`, times[i].arr, times[i].dep, i + 1);
          counts.stopTimes++;
          stat.stopTimes++;
        }
        insCalDate.run(svc, dc, 1);
      }
    }
    db.exec('COMMIT');
    if (unnamed.size > 0) warn(`IC/PR: ${unnamed.size} stacji bez nazwy (brak w słowniku PDP i cache): ${[...unnamed].join(', ')}`);
    if (skippedNoTimes > 0) log(`IC/PR: pominięto ${skippedNoTimes} kursów bez pełnych czasów`);
    if (skippedOutside > 0) log(`IC/PR: pominięto ${skippedOutside} kursów z <2 postojami w GZM`);
    if (WRITE_COORDS) {
      writeFileSync(GZM_COORDS_FILE, JSON.stringify(coords, null, 2) + '\n');
      log('zapisano cache współrzędnych →', GZM_COORDS_FILE, '(przejrzyj diffa przed commitem!)');
    } else {
      log(`współrzędne GZM: ${Object.keys(coords.stations).length} z cache/geokodowania (nie zapisuję pliku bez --write-coords).`);
    }
    icInfo = {
      kind: 'pdp-api', carriers: 'IC', windowFrom: from, windowTo: to,
      stations: perCc.IC.stations, routes: perCc.IC.routes, trips: perCc.IC.trips,
      stopTimes: perCc.IC.stopTimes, schedulesVersion: icprVersion,
      unresolvedStations: unresolved, unnamedStations: [...unnamed],
      skippedTripsNoTimes: skippedNoTimes, skippedOutsideGzm: skippedOutside,
    };
    prInfo = {
      kind: 'pdp-api', carriers: 'PR', windowFrom: from, windowTo: to,
      stations: perCc.PR.stations, routes: perCc.PR.routes, trips: perCc.PR.trips,
      stopTimes: perCc.PR.stopTimes, schedulesVersion: icprVersion,
      unresolvedStations: unresolved, unnamedStations: [...unnamed],
      skippedTripsNoTimes: skippedNoTimes, skippedOutsideGzm: skippedOutside,
    };
    counts.icStations = perCc.IC.stations; counts.icRoutes = perCc.IC.routes;
    counts.icTrips = perCc.IC.trips; counts.icStopTimes = perCc.IC.stopTimes;
    counts.prStations = perCc.PR.stations; counts.prRoutes = perCc.PR.routes;
    counts.prTrips = perCc.PR.trips; counts.prStopTimes = perCc.PR.stopTimes;
    log(`IC: stations=${perCc.IC.stations} routes=${perCc.IC.routes} trips=${perCc.IC.trips} stopTimes=${perCc.IC.stopTimes}`);
    log(`PR: stations=${perCc.PR.stations} routes=${perCc.PR.routes} trips=${perCc.PR.trips} stopTimes=${perCc.PR.stopTimes}`);
  }

  // 6b. Przesiadki miasto<->kolej. Stacja kolejowa to nie słupek przy torach:
  // perony bywają schowane (Dworzec Główny: przystanek ~300 m od peronów
  // + hala i schody), więc linki liczymy hojnie. Aplikacja dokleja je do
  // footpaths i ZASTĘPUJE nimi gridowe linki między tymi samymi parami
  // (grid liczy sam dystans w linii prostej — bez zapasu na peron).
  let interchangeCount = 0;
  if (railGeo.size > 0 && cityStops.length > 0) {
    const links = new Map(); // "a|b" (posortowane) -> { a, b, walkSec }
    const link = (a, b, walkSec) => {
      const [x, y] = a < b ? [a, b] : [b, a];
      const k = `${x}|${y}`;
      const prev = links.get(k);
      if (!prev || walkSec > prev.walkSec) links.set(k, { a: x, b: y, walkSec });
    };
    const computed = (distM) => Math.max(INTERCHANGE_MIN_SEC, Math.round(distM * IX_WALK_DETOUR / IX_WALK_SPEED_MPS));
    for (const [kid, g] of railGeo) {
      // IC/PR niosą pełny stop_id w geolokalizacji (prefiks per przewoźnik),
      // reszta (KD/KML/KS) buduje go z RAIL_PREFIX jak dotąd.
      const kStopId = g.stopId ?? `${RAIL_PREFIX}:S:${kid}`;
      const isGlowny = normalizePolish(g.name).includes('glowny');
      for (const m of cityStops) {
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
      for (const l of links.values()) ins.run(l.a, l.b, l.walkSec, CITY === 'krakow' ? 'kml-ztp' : CITY === 'gzm' ? 'ks-ztm' : 'mpk-kd');
      db.exec('COMMIT');
      interchangeCount = links.size;
    }
    log(`interchanges kolej<->miasto: ${interchangeCount} (stacji kolei: ${railGeo.size})`);
    if (railGeo.size > 0 && interchangeCount === 0) {
      warn('zero linków przesiadkowych: stacje kolei bez połączenia z miastem (sprawdź współrzędne!)');
    }
  }
  if (kdInfo && !kdInfo.skippedReason) kdInfo.interchanges = interchangeCount;
  if (kmlInfo && !kmlInfo.skippedReason) kmlInfo.interchanges = interchangeCount;
  if (ksInfo && !ksInfo.skippedReason) ksInfo.interchanges = interchangeCount;
  if (icInfo && !icInfo.skippedReason) icInfo.interchanges = interchangeCount;
  if (prInfo && !prInfo.skippedReason) prInfo.interchanges = interchangeCount;

  // 6c. Twarda bramka, tylko Wrocław: bez pełnego, realnego KD nie
  // nadpisujemy R2. Baza MPK-only albo z niekompletnym KD to dokładnie ta
  // atrapa, której nie chcemy w APK. Wszystkie cztery sekcje muszą być niepuste.
  if (CITY === 'wroclaw' && !ALLOW_MPK_ONLY) {
    const problems = [];
    if (counts.kdStations === 0) problems.push('0 stacji KD');
    if (counts.kdRoutes === 0) problems.push('0 tras KD');
    if (counts.kdTrips === 0) problems.push('0 kursów KD');
    if (interchangeCount === 0) problems.push('0 przesiadek MPK<->KD');
    // Zdegenerowane współrzędne (dawniej: 30 stacji w 4 punktach) psują przesiadki.
    const uniqueKdCoords = new Set([...railGeo.values()].map((g) => `${g.lat.toFixed(5)},${g.lon.toFixed(5)}`)).size;
    if (railGeo.size >= 2 && uniqueKdCoords < railGeo.size * 0.9) {
      problems.push(`współrzędne KD zdegenerowane (${uniqueKdCoords} różnych punktów dla ${railGeo.size} stacji)`);
    }
    const kdPlaceholderNames = [...railGeo.values()].filter((g) => /^Stacja \d+$/.test(g.name)).length;
    if (kdPlaceholderNames > 0) problems.push(`${kdPlaceholderNames} stacji KD z zastępczą nazwą "Stacja NNN"`);
    if (problems.length > 0) {
      rmSync(work, { recursive: true, force: true });
      throw new Error(`niepełne realne KD (${problems.join(', ')}): nie publikuję bazy. Napraw źródło KD (klucz/współrzędne) albo użyj --allow-mpk-only tylko do diagnostyki.`);
    }
    if (unresolvedCount > 0) {
      warn(`KD: ${unresolvedCount} stacji bez współrzędnych, część kursów pominięta (uzupełnij cache: --write-coords).`);
    }
  }

  // 6d. Twarda bramka, Kraków: baza bez pełnych Kolei Małopolskich
  // (albo bez przesiadek na nie) nie nadpisuje R2.
  if (CITY === 'krakow') {
    const problems = [];
    if (counts.kmlStations === 0) problems.push('0 stacji KMŁ');
    if (counts.kmlRoutes === 0) problems.push('0 tras KMŁ');
    if (counts.kmlTrips === 0) problems.push('0 kursów KMŁ');
    if (interchangeCount === 0) problems.push('0 przesiadek KMŁ<->ZTP');
    if (problems.length > 0) {
      rmSync(work, { recursive: true, force: true });
      throw new Error(`niepełne KMŁ (${problems.join(', ')}): nie publikuję bazy.`);
    }
  }

  // 6e. Twarda bramka, GZM: baza bez pełnych Kolei Śląskich, IC albo
  // Polregio (albo bez przesiadek na kolej) nie nadpisuje R2.
  if (CITY === 'gzm') {
    const problems = [];
    if (counts.ksStations === 0) problems.push('0 stacji KŚ');
    if (counts.ksRoutes === 0) problems.push('0 tras KŚ');
    if (counts.ksTrips === 0) problems.push('0 kursów KŚ');
    if (counts.icStations === 0) problems.push('0 stacji IC');
    if (counts.icTrips === 0) problems.push('0 kursów IC');
    if (counts.prStations === 0) problems.push('0 stacji PR');
    if (counts.prTrips === 0) problems.push('0 kursów PR');
    if (interchangeCount === 0) problems.push('0 przesiadek kolej<->ZTM');
    if (problems.length > 0) {
      rmSync(work, { recursive: true, force: true });
      throw new Error(`niepełne koleje GZM (${problems.join(', ')}): nie publikuję bazy.`);
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
  const version = CITY === 'krakow'
    ? `${todayCompact()}-krk${createHash('sha256').update(`${ztpFingerprint}|${kmlVersion}`).digest('hex').slice(0, 8)}`
    : CITY === 'gzm'
      ? `${todayCompact()}-gzm${createHash('sha256').update(`${gtmFingerprint}|${ksVersion}|${icprVersion}`).digest('hex').slice(0, 8)}`
      : `${todayCompact()}-mpk${(mpk.effectiveDate || 'unknown').replace(/-/g, '')}-kd${String(kdVersion).slice(0, 8)}`;
  const meta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  meta.run('timetable_version', version);
  meta.run('gtfs_imported_at', new Date().toISOString());
  meta.run('gtfs_source', 'network');
  meta.run('feeds', JSON.stringify(CITY === 'krakow' ? { ztp: ztpFingerprint, kml: kmlVersion } : CITY === 'gzm' ? { ztm: gtmFingerprint, ks: ksVersion, icpr: icprVersion } : { mpk: mpk.effectiveDate, kd: kdVersion }));
  db.exec('VACUUM');
  const chk = db.prepare('PRAGMA integrity_check').get();
  const vals = chk ? Object.values(chk) : [];
  if (!vals.includes('ok')) throw new Error('integrity_check NIE przeszedł: ' + JSON.stringify(chk));
  // Pusta baza (padnięte ZIP-y) nigdy nie leci do R2, niezależnie od miasta.
  const guard = db.prepare('SELECT (SELECT COUNT(*) FROM stops) AS s, (SELECT COUNT(*) FROM trips) AS t, (SELECT COUNT(*) FROM stop_times) AS st').get();
  if (!guard || guard.s <= 0 || guard.t <= 0 || guard.st <= 0) {
    throw new Error(`pusta baza (stops=${guard?.s} trips=${guard?.t} times=${guard?.st}): nie publikuję.`);
  }
  const size = statSync(DB_FILE).size;
  const sha = createHash('sha256').update(readFileSync(DB_FILE)).digest('hex');
  db.close();
  rmSync(work, { recursive: true, force: true });

  const manifest = {
    version,
    builtAt: new Date().toISOString(),
    city: CITY,
    db: { path: DB_R2_PATH, sizeBytes: size, sha256: sha },
    sources: CITY === 'krakow'
      ? {
          ztp: {
            kind: 'gtfs-zip', feeds: ZTP_FEEDS.map((f) => f.url),
            fingerprint: ztpFingerprint,
            stops: counts.stops - counts.kmlStations, routes: counts.routes - counts.kmlRoutes,
            trips: counts.trips - counts.kmlTrips, stopTimes: counts.stopTimes - counts.kmlStopTimes,
          },
          kml: kmlInfo,
        }
      : CITY === 'gzm'
      ? {
          ztm: {
            kind: 'gtfs-ckan-daily', dataset: GZM_CKAN_PACKAGE,
            fingerprint: gtmFingerprint,
            stops: counts.stops - counts.ksStations - counts.icStations - counts.prStations,
            routes: counts.routes - counts.ksRoutes - counts.icRoutes - counts.prRoutes,
            trips: counts.trips - counts.ksTrips - counts.icTrips - counts.prTrips,
            stopTimes: counts.stopTimes - counts.ksStopTimes - counts.icStopTimes - counts.prStopTimes,
          },
          ks: ksInfo,
          ic: icInfo,
          pr: prInfo,
        }
      : {
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
