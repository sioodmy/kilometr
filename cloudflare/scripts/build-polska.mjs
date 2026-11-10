#!/usr/bin/env node
/**
 * build-polska.mjs: buduje ogólnopolską bazę kolejową kilometr-gtfs-polska.db.
 *
 * Użycie: node cloudflare/scripts/build-polska.mjs [--force]
 * Artefakty: cloudflare/dist/polska/{kilometr-gtfs-polska.db,.gz,manifest.json}.
 * Klucze R2: polska/manifest.json + polska/db/kilometr-gtfs-polska.db.gz.
 *
 * Źródło: mkuran.pl/gtfs/polish_trains.zip (wszystkie koleje w Polsce:
 * IC/EIC/EIP/EC, PolRegio, KM, KW, KŚ, KMŁ, ŁKA, SKM, SKMT, Arriva, Leo,
 * RegioJet + KD). Tylko route_type 2 (ZKA, czyli zastępcze autobusy,
 * wypadają). Baza jest OGÓLNOPOLSKA i nie scalamy jej z bazami miast:
 * aplikacja trzyma dwa osobne magazyny i skleja podróże na poziomie planera.
 *
 * Normalizacja: routing po stacjach (parent_station), nie po peronach.
 * Peron zostaje jako kolumna platform w stop_times (do wyświetlania).
 * Bez normalizacji każdy kurs dostawał własny wzorzec RAPTOR-a (peron+tor
 * w stop_id), co rozdmuchiwało liczbę wzorców z ~1,2k do ~1,9k wycinku.
 *
 * Wszystkie id z prefiksem `pl:`, więc nigdy nie kolidują z id miast.
 * Schemat wspólny z build-timetable.mjs (store aplikacji czyta oba tak samo):
 * stops/routes/trips/stop_times/calendar/calendar_dates/meta + bloby
 * wzorców kursów (seq/arr/dep) + blob footpaths + wagi przystanków.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const DIST = join(ROOT, 'dist', 'polska');
const DB_FILE = join(DIST, 'kilometr-gtfs-polska.db');
const DB_GZ_FILE = join(DIST, 'kilometr-gtfs-polska.db.gz');
const MANIFEST_FILE = join(DIST, 'manifest.json');
const DB_R2_PATH = 'polska/db/kilometr-gtfs-polska.db.gz';

const FEED_URL = 'https://mkuran.pl/gtfs/polish_trains.zip';
const UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };
const PUBLIC_URL = process.env.TIMETABLE_PUBLIC_URL || 'https://data.kilometr.app';
/** Rewizja schematu bazy: podbicie wymusza re-download na telefonach
 *  (wersja z fingerprintu feedu nie zmienia się, dopóki PLK nie ruszy rozkładu). */
const SCHEMA_REV = 4;

const FORCE = new Set(process.argv.slice(2)).has('--force');

function log(msg) {
  console.log(`[polska] ${msg}`);
}

/* ─── CSV (quote-aware, jak src/gtfs/csv.ts) ─────────────────────────── */

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
      } else q = !q;
    } else if (c === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function eachRow(content, fn) {
  const nl = content.indexOf('\n');
  let header = content.slice(0, nl === -1 ? undefined : nl);
  if (header.charCodeAt(0) === 0xfeff) header = header.slice(1);
  const idx = Object.fromEntries(
    parseCsvLine(header.replace(/\r$/, '')).map((h, i) => [h.trim(), i]),
  );
  let pos = nl === -1 ? content.length : nl + 1;
  const len = content.length;
  while (pos < len) {
    let eol = content.indexOf('\n', pos);
    if (eol === -1) eol = len;
    let line = content.slice(pos, eol);
    pos = eol + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line.trim()) continue;
    fn(parseCsvLine(line), idx);
  }
  return idx;
}

function normalizePolish(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .trim();
}

function hmsToSec(hms) {
  const p = String(hms || '00:00:00')
    .trim()
    .split(':');
  return (Number(p[0]) || 0) * 3600 + (Number(p[1]) || 0) * 60 + (Number(p[2]) || 0);
}

/* ─── Udogodnienia składu (vagonweb) ──────────────────────────────────── */

/**
 * Kolejność bitów w trip_amenities.bits. Musi być identyczna z
 * RAIL_AMENITY_ORDER w src/services/railAmenities.ts oraz z UDOGODNIENIA_UI
 * w scripts/vagonweb/scrape_vagonweb.py.
 */
const AMENITY_ORDER = [
  'klimatyzacja',
  'gniazdka_230V',
  'gniazdka_usb',
  'wifi',
  'wagon_restauracyjny',
  'bar',
  'przewoz_rowerow',
  'dostepny_wozkarze',
  'miejsca_lezace',
  'miejsca_sypialne',
  'strefa_ciszy',
];

/**
 * Kod przewoźnika vagonweb -> agency_id feedu PLK. Ta sama mapa jest
 * w scripts/vagonweb/scrape_vagonweb.py (VAGONWEB_AGENCY).
 */
const VAGONWEB_AGENCY = {
  PKPIC: 'IC',
  PREG: 'PR',
  RJPL: 'RJ',
  LEPL: 'LE',
  SKMWA: 'SKM',
  KSL: 'KŚ',
  SKPL: 'SKPL',
};

function encodeAmenities(keys) {
  let bits = 0;
  for (const key of keys || []) {
    const i = AMENITY_ORDER.indexOf(key);
    if (i >= 0) bits |= 1 << i;
  }
  return bits;
}

/**
 * Wczytuje cloudflare/data/rail-amenities.json (wyjście scrapera vagonweb)
 * i zwraca mapę `agency|numer` -> { bits, numbers }. Brak pliku nie wywraca
 * buildu: baza powstaje wtedy bez tabeli udogodnień.
 */
function readAmenitiesFile() {
  const file = join(DATA, 'rail-amenities.json');
  if (!existsSync(file)) {
    log('brak data/rail-amenities.json - buduję bez udogodnień składu');
    return null;
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const byKey = new Map();
  for (const entry of raw.pociagi || []) {
    const agency = VAGONWEB_AGENCY[entry.agency] || entry.agency || '';
    const number = String(entry.numer || '').trim();
    if (!agency || !number) continue;
    const bits = encodeAmenities(entry.udogodnienia);
    if (!bits) continue;
    byKey.set(`${agency}|${number}`, {
      bits,
      numbers: entry.liczby && Object.keys(entry.liczby).length ? JSON.stringify(entry.liczby) : '',
    });
  }
  log(`udogodnienia: ${byKey.size} pociągów z pliku (${raw.rok ?? '?'})`);
  return byKey;
}

/* ─── HTTP ────────────────────────────────────────────────────────────── */

async function headVersion(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { method: 'HEAD', headers: UA, signal: ctrl.signal });
      if (!res.ok) return '';
      return res.headers.get('last-modified') || res.headers.get('etag') || '';
    } finally {
      clearTimeout(t);
    }
  } catch {
    return '';
  }
}

async function fetchBuffer(url, timeoutMs = 180000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

/* ─── Schemat: wspólny z aplikacją + kolumny kolejowe ─────────────────── */

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
CREATE TABLE routes (
  route_id TEXT PRIMARY KEY NOT NULL,
  short TEXT NOT NULL,
  long_name TEXT NOT NULL DEFAULT '',
  type INTEGER NOT NULL DEFAULT 3
);
CREATE TABLE trips (
  trip_id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  headsign TEXT NOT NULL DEFAULT '',
  direction INTEGER NOT NULL DEFAULT 0,
  shape TEXT NOT NULL DEFAULT '',
  train_number TEXT NOT NULL DEFAULT '',
  train_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  agency TEXT NOT NULL DEFAULT ''
);
CREATE TABLE stop_times (
  trip_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  arr_sec INTEGER NOT NULL,
  dep_sec INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  track TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (trip_id, seq)
) WITHOUT ROWID;
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
CREATE TABLE trip_amenities (
  trip_id TEXT PRIMARY KEY NOT NULL,
  bits INTEGER NOT NULL,
  numbers TEXT NOT NULL DEFAULT ''
);
`;

/* ─── Build ───────────────────────────────────────────────────────────── */

async function main() {
  mkdirSync(DIST, { recursive: true });

  // Skip buildu, gdy feed bez zmian i manifest już leży na R2 (jak per-miasto).
  const fingerprint = await headVersion(FEED_URL);
  const todayCompact = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const version = `${todayCompact}-plk${createHash('sha256')
    .update(fingerprint || String(Date.now()))
    .digest('hex')
    .slice(0, 8)}r${SCHEMA_REV}`;
  if (!FORCE) {
    try {
      const remote = await (
        await fetch(`${PUBLIC_URL}/polska/manifest.json`, {
          headers: { Accept: 'application/json' },
        })
      ).json();
      if (remote?.version === version) {
        log(`feed bez zmian (${version}), skip.`);
        process.exit(2);
      }
    } catch {
      // brak zdalnego manifestu (pierwszy build) - jedziemy dalej.
    }
  }

  log(`pobieram ${FEED_URL}…`);
  const zip = await fetchBuffer(FEED_URL);
  const work = join(tmpdir(), `kilometr-polska-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const zipPath = join(work, 'pl.zip');
  writeFileSync(zipPath, zip);
  // Rozpakowanie: systemowy unzip, a gdy go nie ma (Ubuntu runner ma,
  // ale lokalnie bywa różnie) fflate z node_modules.
  let unpacked = false;
  try {
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', work], { stdio: 'ignore' });
    unpacked = true;
  } catch {
    const { unzipSync } = await import('fflate');
    const files = unzipSync(new Uint8Array(zip));
    for (const [name, bytes] of Object.entries(files)) {
      const target = join(work, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    unpacked = true;
  }
  if (!unpacked) throw new Error('nie udało się rozpakować feedu PLK');
  const read = (name) => {
    try {
      return readFileSync(join(work, name), 'utf8');
    } catch {
      return '';
    }
  };

  // 1. Stacje: parent_station jako przystanek routingu; peron tylko jako
  //    kolumna w stop_times. Feed ma stacje (location_type 1) i perony (0).
  const parentOf = new Map(); // stop_id -> parent station id
  const stations = new Map(); // parent id -> { name, lat, lon }
  const platformCode = new Map(); // peron id -> platform_code
  eachRow(read('stops.txt'), (r, idx) => {
    const id = r[idx.stop_id];
    const type = r[idx.location_type];
    const parent = r[idx.parent_station] || id;
    if (type === '1') {
      stations.set(id, {
        name: r[idx.stop_name],
        lat: Number(r[idx.stop_lat]),
        lon: Number(r[idx.stop_lon]),
      });
      parentOf.set(id, id);
    } else {
      parentOf.set(id, parent);
      if (r[idx.platform_code]) platformCode.set(id, r[idx.platform_code]);
      if (!stations.has(parent)) {
        stations.set(parent, {
          name: r[idx.stop_name],
          lat: Number(r[idx.stop_lat]),
          lon: Number(r[idx.stop_lon]),
        });
      }
    }
  });
  log(`stacje: ${stations.size}, peronów: ${platformCode.size}`);

  // 2. Trasy: tylko kolej (route_type 2); ZKA (3) wypada.
  const railRoutes = new Map(); // route_id -> { short, long, agency }
  eachRow(read('routes.txt'), (r, idx) => {
    if (Number(r[idx.route_type]) !== 2) return;
    railRoutes.set(r[idx.route_id], {
      short: r[idx.route_short_name] || r[idx.agency_id],
      long: r[idx.route_long_name] || '',
      agency: r[idx.agency_id] || '',
    });
  });
  log(`trasy kolejowe: ${railRoutes.size}`);

  // 3. Kursy: liczba/kategoria/nazwa pociągu.
  const trips = new Map(); // trip_id -> { routeId, serviceId, headsign, dir, num, name, cat, shapeId }
  eachRow(read('trips.txt'), (r, idx) => {
    const routeId = r[idx.route_id];
    const route = railRoutes.get(routeId);
    if (!route) return;
    const num = r[idx.plk_train_number] || r[idx.trip_short_name] || '';
    trips.set(r[idx.trip_id], {
      routeId,
      serviceId: r[idx.service_id],
      headsign: r[idx.trip_headsign] || route.long,
      dir: Number(r[idx.direction_id]) || 0,
      num,
      name: r[idx.plk_train_name] || '',
      cat: r[idx.plk_category_code] || route.short,
      shapeId: r[idx.shape_id] || '',
    });
  });
  log(`kursy: ${trips.size}`);

  // 4. stop_times: normalizacja peronów do stacji + peron do kolumny.
  //    Jedna stacja może pojawić się w kursie dwa razy (przez parenta) -
  //    zostawiamy, RAPTOR to trawi jak przystanek pośredni.
  const timesByTrip = new Map();
  eachRow(read('stop_times.txt'), (r, idx) => {
    const tid = r[idx.trip_id];
    const trip = trips.get(tid);
    if (!trip) return;
    const arr = hmsToSec(r[idx.arrival_time]);
    const dep = hmsToSec(r[idx.departure_time]);
    const stopRaw = r[idx.stop_id];
    const parent = parentOf.get(stopRaw);
    if (!parent || !stations.has(parent)) return;
    let list = timesByTrip.get(tid);
    if (!list) {
      list = [];
      timesByTrip.set(tid, list);
    }
    const platCode = platformCode.get(stopRaw) || '';
    const trackFromStop = platCode.match(/t\.\s*(\S+)/i)?.[1] || '';
    list.push({
      seq: Number(r[idx.stop_sequence]) || 0,
      stopId: parent,
      arr,
      dep,
      platform: r[idx.platform] || platCode || '',
      track: (idx.track !== undefined && idx.track >= 0 ? r[idx.track] : '') || trackFromStop || '',
    });
  });

  // 5. Baza.
  rmSync(DB_FILE, { force: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec(SCHEMA_SQL);
  db.exec('PRAGMA synchronous = OFF;');

  const insStop = db.prepare(
    'INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.exec('BEGIN');
  for (const [id, s] of stations) {
    insStop.run(`pl:${id}`, '', s.name, s.lat, s.lon, normalizePolish(s.name));
  }
  db.exec('COMMIT');

  const insRoute = db.prepare(
    'INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, 2)',
  );
  db.exec('BEGIN');
  for (const [id, r] of railRoutes) {
    insRoute.run(`pl:${id}`, r.short, r.long);
  }
  db.exec('COMMIT');

  // Kalendarz: feed ma TYLKO calendar_dates. Wstawiamy wiersz calendar z
  // flagami 0 i zakresem dat serwisu (wzorzec z importStaticRailFeed),
  // żeby resolveActiveServices w aplikacji nie aktywował wszystkich
  // serwisów naraz: puste flagi + niepusta tabela = tylko wyjątki dat.
  const serviceDates = new Map(); // serviceId -> Set dat
  eachRow(read('calendar_dates.txt'), (r, idx) => {
    const sid = r[idx.service_id];
    const exc = Number(r[idx.exception_type]);
    if (exc === 1) {
      let set = serviceDates.get(sid);
      if (!set) {
        set = new Set();
        serviceDates.set(sid, set);
      }
      set.add(r[idx.date]);
    }
  });
  const insCal = db.prepare(
    'INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, 0, 0, 0, 0, 0, 0, 0, ?, ?)',
  );
  const insCalDate = db.prepare(
    'INSERT OR REPLACE INTO calendar_dates (service_id, date, exc) VALUES (?, ?, 1)',
  );
  db.exec('BEGIN');
  for (const [sid, dates] of serviceDates) {
    const sorted = [...dates].sort();
    insCal.run(`pl:${sid}`, sorted[0], sorted[sorted.length - 1]);
    for (const d of sorted) insCalDate.run(`pl:${sid}`, d);
  }
  db.exec('COMMIT');
  log(`serwisy: ${serviceDates.size}`);

  const insTrip = db.prepare(
    'INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape, train_number, train_name, category, agency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insTime = db.prepare(
    'INSERT OR REPLACE INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq, platform, track) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  let stopTimesCount = 0;
  db.exec('BEGIN');
  for (const [tid, trip] of trips) {
    const list = timesByTrip.get(tid);
    if (!list || list.length < 2) continue;
    list.sort((a, b) => a.seq - b.seq);
    const route = railRoutes.get(trip.routeId);
    insTrip.run(
      `pl:${tid}`,
      `pl:${trip.routeId}`,
      `pl:${trip.serviceId}`,
      trip.headsign,
      trip.dir,
      `pl:${trip.shapeId}`,
      trip.num,
      trip.name,
      trip.cat,
      route?.agency ?? '',
    );
    for (const row of list) {
      insTime.run(
        `pl:${tid}`,
        `pl:${row.stopId}`,
        row.arr,
        row.dep,
        row.seq,
        row.platform,
        row.track,
      );
      stopTimesCount++;
    }
  }
  db.exec('COMMIT');
  log(`stop_times: ${stopTimesCount}`);

  // 5b. Udogodnienia składu: dopasowanie do kursów po agency + numerze pociągu.
  //     Numer w vagonweb bywa złożony ("113/41006/7"), w feedzie PLK jest
  //     pierwszy człon, więc próbujemy też wariantów (jak trainNumberVariants).
  const amenities = readAmenitiesFile();
  if (amenities) {
    const insAmenity = db.prepare(
      'INSERT OR REPLACE INTO trip_amenities (trip_id, bits, numbers) VALUES (?, ?, ?)',
    );
    let matched = 0;
    db.exec('BEGIN');
    for (const [tid, trip] of trips) {
      const list = timesByTrip.get(tid);
      if (!list || list.length < 2) continue;
      const route = railRoutes.get(trip.routeId);
      const agency = route?.agency ?? '';
      if (!agency || !trip.num) continue;
      const variants = new Set([trip.num]);
      for (const part of String(trip.num).split('/')) {
        if (part.trim()) variants.add(part.trim());
      }
      for (const num of variants) {
        const hit = amenities.get(`${agency}|${num}`);
        if (!hit) continue;
        insAmenity.run(`pl:${tid}`, hit.bits, hit.numbers);
        matched++;
        break;
      }
    }
    db.exec('COMMIT');
    log(`udogodnienia: dopasowano ${matched} kursów`);
  }

  // 6. Wagi stacji (ranking wyszukiwarki: liczba odjazdów).
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(
    'UPDATE stops SET weight = agg.c FROM (SELECT stop_id, COUNT(*) AS c FROM stop_times GROUP BY stop_id) AS agg WHERE agg.stop_id = stops.stop_id',
  );

  // 6b. Geometria torów: shapes.txt feedu PLK (~1.5 m punktów). Jedna krotka
  // na shape_id, punkty spakowane jako pary f32 LE (lat, lon) w kolejności
  // sekwencji. Aplikacja tnie shape między stacjami wsiadania i wysiadania
  // (patrz routeGeometry.ts), więc mapa rysuje pociąg po torach, a nie
  // prostą przez pola.
  {
    log('geometria torów (shapes)…');
    db.exec('CREATE TABLE shapes (shape_id TEXT PRIMARY KEY NOT NULL, pts BLOB NOT NULL)');
    const wanted = new Set([...trips.values()].map((t) => t.shapeId).filter(Boolean));
    const insShape = db.prepare('INSERT OR REPLACE INTO shapes (shape_id, pts) VALUES (?, ?)');
    let curId = null;
    let lats = [];
    let lons = [];
    let shapeCount = 0;
    let pointCount = 0;
    const flush = () => {
      if (curId === null) return;
      const n = lats.length;
      const buf = Buffer.allocUnsafe(n * 8);
      for (let i = 0; i < n; i++) {
        buf.writeFloatLE(lats[i], i * 8);
        buf.writeFloatLE(lons[i], i * 8 + 4);
      }
      insShape.run(curId, buf);
      shapeCount++;
      curId = null;
      lats = [];
      lons = [];
    };
    db.exec('BEGIN');
    eachRow(read('shapes.txt'), (r, idx) => {
      const id = r[idx.shape_id];
      if (id !== curId) {
        flush();
        if (!wanted.has(id)) {
          curId = null;
          return;
        }
        curId = id;
      }
      if (curId === null) return;
      lats.push(Number(r[idx.shape_pt_lat]));
      lons.push(Number(r[idx.shape_pt_lon]));
      pointCount++;
    });
    flush();
    db.exec('COMMIT');
    log(`  shapes: ${shapeCount} (${(pointCount / 1048576).toFixed(1)} mln punktów)`);
  }

  // 7. Bloby wzorców kursów: ref = pozycja stop_id po ORDER BY stop_id
  //    (store aplikacji liczy tę samą kolejność z tabeli stops).
  db.exec('ALTER TABLE trips ADD COLUMN start_sec INTEGER');
  db.exec('ALTER TABLE trips ADD COLUMN end_sec INTEGER');
  db.exec('ALTER TABLE trips ADD COLUMN seq_blob BLOB');
  db.exec('ALTER TABLE trips ADD COLUMN arr_blob BLOB');
  db.exec('ALTER TABLE trips ADD COLUMN dep_blob BLOB');
  {
    const refOf = new Map();
    db.prepare('SELECT stop_id FROM stops ORDER BY stop_id')
      .all()
      .forEach((r, i) => refOf.set(r.stop_id, i));
    const upd = db.prepare(
      'UPDATE trips SET seq_blob = ?, arr_blob = ?, dep_blob = ?, start_sec = ?, end_sec = ? WHERE trip_id = ?',
    );
    let curId = null;
    let seqs = [];
    let arrs = [];
    let deps = [];
    let minDep = Infinity;
    let maxArr = -Infinity;
    const flush = () => {
      if (curId === null) return;
      const n = seqs.length;
      const sb = Buffer.allocUnsafe(n * 4);
      const ab = Buffer.allocUnsafe(n * 4);
      const dbuf = Buffer.allocUnsafe(n * 4);
      for (let i = 0; i < n; i++) {
        sb.writeInt32LE(seqs[i], i * 4);
        ab.writeInt32LE(arrs[i], i * 4);
        dbuf.writeInt32LE(deps[i], i * 4);
      }
      upd.run(sb, ab, dbuf, minDep, maxArr, curId);
      curId = null;
      seqs = [];
      arrs = [];
      deps = [];
      minDep = Infinity;
      maxArr = -Infinity;
    };
    db.exec('BEGIN');
    for (const r of db
      .prepare('SELECT trip_id, stop_id, arr_sec, dep_sec FROM stop_times ORDER BY trip_id, seq')
      .iterate()) {
      if (r.trip_id !== curId) {
        flush();
        curId = r.trip_id;
      }
      const ref = refOf.get(r.stop_id);
      if (ref === undefined) continue;
      seqs.push(ref);
      arrs.push(r.arr_sec);
      deps.push(r.dep_sec);
      if (r.dep_sec < minDep) minDep = r.dep_sec;
      if (r.arr_sec > maxArr) maxArr = r.arr_sec;
    }
    flush();
    db.exec('COMMIT');
  }
  db.exec('CREATE INDEX idx_trips_time ON trips (service_id, start_sec)');

  // 8. Footpaths blob: ta sama siatka co store.ts (stacje w promieniu 800 m,
  //    np. Warszawa Centralna/Śródmieście). Format identyczny jak per-miasto.
  {
    const GRID_DEG_LAT = 0.001;
    const GRID_DEG_LON = 0.0015;
    const SEARCH_RADIUS = 8;
    const MAX_TRANSFER_METERS = 800;
    const MIN_FOOTPATH_SEC = 45;
    const WALK_DETOUR_FACTOR = 1.15;
    const WALK_SPEED_MPS = 1.45;
    const footDist = (lat1, lon1, lat2, lon2) => {
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return 6371000 * c;
    };
    const stopRows = db.prepare('SELECT stop_id, lat, lon FROM stops ORDER BY rowid').all();
    const refOf = new Map();
    db.prepare('SELECT stop_id FROM stops ORDER BY stop_id')
      .all()
      .forEach((r, i) => refOf.set(r.stop_id, i));
    const grid = new Map();
    for (const s of stopRows) {
      const key = `${Math.floor(s.lon / GRID_DEG_LON)},${Math.floor(s.lat / GRID_DEG_LAT)}`;
      let cell = grid.get(key);
      if (!cell) {
        cell = [];
        grid.set(key, cell);
      }
      cell.push(s);
    }
    const parts = [];
    let totalEdges = 0;
    for (const s1 of stopRows) {
      const gx = Math.floor(s1.lon / GRID_DEG_LON);
      const gy = Math.floor(s1.lat / GRID_DEG_LAT);
      const edges = [];
      for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
        for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
          const cell = grid.get(`${gx + dx},${gy + dy}`);
          if (!cell) continue;
          for (const s2 of cell) {
            if (s1.stop_id === s2.stop_id) continue;
            const dist = footDist(s1.lat, s1.lon, s2.lat, s2.lon);
            if (dist <= MAX_TRANSFER_METERS) {
              edges.push([
                refOf.get(s2.stop_id),
                Math.round(dist),
                Math.max(
                  MIN_FOOTPATH_SEC,
                  Math.round((dist * WALK_DETOUR_FACTOR) / WALK_SPEED_MPS),
                ),
              ]);
            }
          }
        }
      }
      if (edges.length === 0) continue;
      parts.push([refOf.get(s1.stop_id), edges]);
      totalEdges += edges.length;
    }
    let words = 2;
    for (const [, edges] of parts) words += 2 + edges.length * 3;
    const buf = Buffer.alloc(words * 4);
    let w = 0;
    buf.writeUInt32LE(0x464f4f54, w);
    w += 4;
    buf.writeUInt32LE(stopRows.length, w);
    w += 4;
    for (const [fromRef, edges] of parts) {
      buf.writeUInt32LE(fromRef, w);
      w += 4;
      buf.writeUInt32LE(edges.length, w);
      w += 4;
      for (const [toRef, dist, dur] of edges) {
        buf.writeUInt32LE(toRef, w);
        w += 4;
        buf.writeUInt32LE(dist, w);
        w += 4;
        buf.writeUInt32LE(dur, w);
        w += 4;
      }
    }
    db.exec('CREATE TABLE footpaths (id INTEGER PRIMARY KEY, blob BLOB NOT NULL)');
    db.prepare('INSERT INTO footpaths (id, blob) VALUES (1, ?)').run(buf);
    log(`footpaths: ${totalEdges} krawędzi`);
  }

  db.exec('ANALYZE');

  // 9. Meta, walidacja, manifest.
  const meta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  meta.run('timetable_version', version);
  meta.run('gtfs_imported_at', new Date().toISOString());
  meta.run('gtfs_source', 'network');
  meta.run('feeds', JSON.stringify({ plk: fingerprint || null }));

  db.exec('VACUUM');
  const chk = db.prepare('PRAGMA integrity_check').get();
  const vals = chk ? Object.values(chk) : [];
  if (!vals.includes('ok'))
    throw new Error('integrity_check NIE przeszedł: ' + JSON.stringify(chk));
  const guard = db
    .prepare(
      'SELECT (SELECT COUNT(*) FROM stops) AS s, (SELECT COUNT(*) FROM trips) AS t, (SELECT COUNT(*) FROM stop_times) AS st',
    )
    .get();
  if (!guard || guard.s <= 0 || guard.t <= 0 || guard.st <= 0) {
    throw new Error(
      `pusta baza (stops=${guard?.s} trips=${guard?.t} times=${guard?.st}): nie publikuję.`,
    );
  }
  const stats = {
    stops: guard.s,
    routes: db.prepare('SELECT COUNT(*) AS n FROM routes').get().n,
    trips: guard.t,
    stopTimes: guard.st,
  };
  const uncompressedSize = statSync(DB_FILE).size;
  db.close();
  rmSync(work, { recursive: true, force: true });

  log('kompresja gzip (level 9)…');
  const rawDb = readFileSync(DB_FILE);
  const gzBuf = gzipSync(rawDb, { level: 9 });
  writeFileSync(DB_GZ_FILE, gzBuf);
  const gzSize = statSync(DB_GZ_FILE).size;
  const gzSha = createHash('sha256').update(gzBuf).digest('hex');
  log(
    `  raw: ${(uncompressedSize / 1048576).toFixed(1)} MB -> gz: ${(gzSize / 1048576).toFixed(1)} MB`,
  );

  const manifest = {
    version,
    builtAt: new Date().toISOString(),
    city: 'polska',
    db: {
      path: DB_R2_PATH,
      sizeBytes: gzSize,
      sha256: gzSha,
      uncompressedSizeBytes: uncompressedSize,
    },
    sources: {
      plk: {
        kind: 'gtfs-zip',
        url: FEED_URL,
        fingerprint: fingerprint || null,
        ...stats,
      },
    },
    stats,
  };
  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n');
  log(`artefakty: ${DB_GZ_FILE}, ${DB_FILE}, ${MANIFEST_FILE}`);
  log(`manifest: version=${version} gz=${(gzSize / 1048576).toFixed(1)} MB`);
}

// Eksporty dla testów; uruchomienie buildu tylko przy bezpośrednim wywołaniu.
export { AMENITY_ORDER, VAGONWEB_AGENCY, encodeAmenities };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[polska] build failed:', err);
    process.exit(1);
  });
}
