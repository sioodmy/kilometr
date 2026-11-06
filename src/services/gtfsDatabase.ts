// Lokalny magazyn GTFS w expo-sqlite (v57 API: openDatabaseAsync).
// Telefon nie trzyma rozkładu w Mapach jak serwer - pyta SQLite z indeksami,
// więc stop_times (~mln wierszy) nie musi wchodzić w całości do RAM.
//
// Schemat celowo minimalny (tylko to, czego potrzebuje routing/search):
// stops / routes / trips / stop_times / calendar / calendar_dates / meta.

import * as SQLite from 'expo-sqlite';
import { distanceMeters, normalizePolish } from '../gtfs/geo';
import { expandTokenSynonyms, fuzzyMatchBatch } from '../gtfs/fuzzy';
import type { GtfsCalendar, GtfsRoute, GtfsStop, GtfsStopTime, GtfsTrip } from '../gtfs/types';
import { getCity } from '../cities';
import { getActiveCityIdSync } from './cityStore';
import { isFareBoundary } from '../gtfs/fareBoundary';

/** Plik bazy dla miasta. Każde miasto ma osobny plik; zmiana nazwy oznacza
 *  świeży pobyt (nowy plik startuje pusty, więc wersja wymusza re-download). */
function gtfsDbName(cityId?: string): string {
  return getCity(cityId ?? getActiveCityIdSync()).dbFile;
}

/** Plik bazy aktywnego miasta (do podmiany po pobraniu). */
function currentGtfsDbName(): string {
  return gtfsDbName();
}

const dbPromises = new Map<string, Promise<SQLite.SQLiteDatabase>>();

async function initDb(name: string): Promise<SQLite.SQLiteDatabase> {
      const db = await SQLite.openDatabaseAsync(name);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 15000;
        CREATE TABLE IF NOT EXISTS stops (
          stop_id TEXT PRIMARY KEY NOT NULL,
          code TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          norm TEXT NOT NULL,
          weight INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_stops_latlon ON stops (lat, lon);
        CREATE INDEX IF NOT EXISTS idx_stops_norm ON stops (norm);
        CREATE TABLE IF NOT EXISTS routes (
          route_id TEXT PRIMARY KEY NOT NULL,
          short TEXT NOT NULL,
          long_name TEXT NOT NULL DEFAULT '',
          type INTEGER NOT NULL DEFAULT 3
        );
        CREATE INDEX IF NOT EXISTS idx_routes_short ON routes (short);
        CREATE TABLE IF NOT EXISTS trips (
          trip_id TEXT PRIMARY KEY NOT NULL,
          route_id TEXT NOT NULL,
          service_id TEXT NOT NULL,
          headsign TEXT NOT NULL DEFAULT '',
          direction INTEGER NOT NULL DEFAULT 0,
          shape TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_trips_route ON trips (route_id);
        CREATE INDEX IF NOT EXISTS idx_trips_service ON trips (service_id);
        CREATE TABLE IF NOT EXISTS stop_times (
          trip_id TEXT NOT NULL,
          stop_id TEXT NOT NULL,
          arr_sec INTEGER NOT NULL,
          dep_sec INTEGER NOT NULL,
          seq INTEGER NOT NULL,
          PRIMARY KEY (trip_id, seq)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS calendar (
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
        CREATE TABLE IF NOT EXISTS calendar_dates (
          service_id TEXT NOT NULL,
          date TEXT NOT NULL,
          exc INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_caldate_date ON calendar_dates (date);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS pois (
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
        CREATE INDEX IF NOT EXISTS idx_pois_norm ON pois (norm_name);
        CREATE TABLE IF NOT EXISTS addresses (
          osm_id TEXT PRIMARY KEY NOT NULL,
          street TEXT NOT NULL,
          house TEXT NOT NULL,
          locality TEXT NOT NULL DEFAULT '',
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          stop_m INTEGER,
          stop_w INTEGER
        );
      `);
      // Migracje istniejących baz (CREATE TABLE IF NOT EXISTS ich nie rusza).
      // Upewnij się, że kolumna weight istnieje w tabeli stops:
      try {
        await db.execAsync('ALTER TABLE stops ADD COLUMN weight INTEGER NOT NULL DEFAULT 0');
      } catch {
        // Ignoruj jeśli kolumna już istnieje
      }
      try {
        await db.execAsync('CREATE INDEX IF NOT EXISTS idx_stops_weight ON stops (weight DESC)');
      } catch (err) {
        console.warn('idx_stops_weight failed, rebuilding stops table:', err);
        await db.execAsync(`
          DROP TABLE IF EXISTS stops;
          CREATE TABLE stops (
            stop_id TEXT PRIMARY KEY NOT NULL,
            code TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            norm TEXT NOT NULL,
            weight INTEGER NOT NULL DEFAULT 0
          );
          CREATE INDEX IF NOT EXISTS idx_stops_latlon ON stops (lat, lon);
          CREATE INDEX IF NOT EXISTS idx_stops_norm ON stops (norm);
          CREATE INDEX IF NOT EXISTS idx_stops_weight ON stops (weight DESC);
        `);
      }
      return db;
}

function getGtfsDbByName(name: string): Promise<SQLite.SQLiteDatabase> {
  const existing = dbPromises.get(name);
  if (existing) return existing;
  const p = initDb(name);
  dbPromises.set(name, p);
  // Nie trzymaj odrzuconego promise'a, następne wywołanie próbuje od nowa
  // zamiast zwracać w kółko ten sam błąd (widoczne w logach jako wieczne
  // "[LocalGtfsStore] Initializing..." bez "Loaded").
  p.catch(() => {
    if (dbPromises.get(name) === p) dbPromises.delete(name);
  });
  return p;
}

/* ─── Baza ogólnopolska (kolej) ──────────────────────────────────────────
 * Osobny plik SQLite obok baz miast: kilometr-gtfs-polska.db z buildu
 * build-polska.mjs (dataset `polska` w R2). Wspólny schemat + kolumny
 * kolejowe (train_number/train_name/category/agency w trips, platform
 * w stop_times), więc magazyn routingu czyta ją tak samo jak miasto. */

export const NATIONAL_DB_FILE = 'kilometr-gtfs-polska.db';

let nationalSwapGate: Promise<void> | null = null;
let releaseNationalSwapGate: (() => void) | null = null;

/** Bramka podmiany pliku bazy krajowej (odpowiednik beginGtfsSwap). */
export function beginNationalDbSwap(): void {
  if (nationalSwapGate) return;
  nationalSwapGate = new Promise<void>((resolve) => {
    releaseNationalSwapGate = resolve;
  });
}

export function endNationalDbSwap(): void {
  const release = releaseNationalSwapGate;
  nationalSwapGate = null;
  releaseNationalSwapGate = null;
  release?.();
}

/** Uchwyt bazy ogólnopolskiej; czeka na ewentualną podmianę pliku. */
export function getNationalDb(): Promise<SQLite.SQLiteDatabase> {
  if (nationalSwapGate) {
    return nationalSwapGate.then(() => getNationalDb());
  }
  return getGtfsDbByName(NATIONAL_DB_FILE);
}

/** Zamyka TYLKO uchwyt bazy krajowej (przed podmianą pliku). */
export async function closeNationalDb(): Promise<void> {
  const p = dbPromises.get(NATIONAL_DB_FILE);
  if (!p) return;
  dbPromises.delete(NATIONAL_DB_FILE);
  try {
    const db = await p;
    await db.closeAsync();
  } catch {
    // best-effort: plik i tak podmieniamy
  }
}

/** Czy trwa podmiana pliku bazy krajowej (patrz beginNationalDbSwap). */
export function isNationalDbSwapPending(): boolean {
  return nationalSwapGate !== null;
}

/** Serwisy kursujące w danym dniu w konkretnej bazie (wspólne dla miasta i Polski). */
async function activeServicesForDb(
  db: SQLite.SQLiteDatabase,
  weekday: number,
  dateStr?: string,
): Promise<Set<string>> {
  const day = ((weekday % 7) + 7) % 7;
  const col = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][day];
  // Zakres dat jak w lineTimetable: bez niego stary i nowy rozkład z jednego
  // feedu jeżdżą naraz, a wygasły serwis nadal wygląda na aktywny.
  const rows = dateStr
    ? await db.getAllAsync<{ service_id: string }>(
        `SELECT service_id FROM calendar WHERE ${col} > 0 AND (start_date = '' OR start_date <= ?) AND (end_date = '' OR end_date >= ?)`,
        dateStr,
        dateStr,
      )
    : await db.getAllAsync<{ service_id: string }>(`SELECT service_id FROM calendar WHERE ${col} > 0`);
  const weekdayServices = rows.map((r) => r.service_id);
  const total = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM calendar');
  const calendarRowCount = total?.n ?? 0;
  const needsEverything = weekdayServices.length === 0 && (calendarRowCount === 0 || !dateStr);
  const allTripServices = needsEverything
    ? (await db.getAllAsync<{ service_id: string }>('SELECT DISTINCT service_id FROM trips')).map(
        (r) => r.service_id,
      )
    : [];
  const dateExceptions = dateStr
    ? await db.getAllAsync<{ service_id: string; exc: number }>(
        'SELECT service_id, exc FROM calendar_dates WHERE date = ?',
        dateStr,
      )
    : [];
  return resolveActiveServices(weekdayServices, calendarRowCount, !!dateStr, allTripServices, dateExceptions);
}

/** Serwisy bazy ogólnopolskiej w danym dniu (feed PLK: tylko calendar_dates). */
export async function getNationalActiveServices(weekday: number, dateStr?: string): Promise<Set<string>> {
  const db = await getNationalDb();
  return activeServicesForDb(db, weekday, dateStr);
}

export async function getNationalMeta(key: string): Promise<string | null> {
  const db = await getNationalDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setNationalMeta(key: string, value: string): Promise<void> {
  const db = await getNationalDb();
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
}

/** Ostatni dzień rozkładu kolejowego (YYYYMMDD) albo null. */
export async function getNationalTimetableEndDate(): Promise<string | null> {
  const db = await getNationalDb();
  const cd = await db.getFirstAsync<{ d: string | null }>(
    'SELECT MAX(date) AS d FROM calendar_dates WHERE exc = 1',
  );
  return cd?.d ?? null;
}

export interface NationalStation {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  weight: number;
}

/** Czy plik bazy krajowej istnieje i ma stacje (tani EXISTS, bez ładowania). */
export async function hasNationalDb(): Promise<boolean> {
  try {
    const db = await getNationalDb();
    const row = await db.getFirstAsync<{ n: number }>('SELECT EXISTS(SELECT 1 FROM stops) AS n');
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Wyszukiwarka stacji kolejowych: SQL LIKE zawęża kandydatów (~3k stacji),
 * ranking robi fuzzyMatch jak w searchStops. Waga = liczba odjazdów,
 * więc "Główny" wygrywa z "Główny Towarowy".
 */
export async function searchNationalStations(query: string, limit = 8): Promise<NationalStation[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = normalizePolish(q).split(/[\s,./()\\-]+/).filter(Boolean);
  if (!tokens.length) return [];

  const clauses: string[] = [];
  const params: string[] = [];
  for (const token of tokens) {
    const variants = expandTokenSynonyms(token).filter((v) => v.length >= 2);
    const list = variants.length ? variants : [token];
    clauses.push(`(${list.map(() => 'norm LIKE ?').join(' OR ')})`);
    for (const v of list) params.push(`%${v.replace(/[%_]/g, '')}%`);
  }

  const db = await getNationalDb();
  const rows = await db.getAllAsync<{ stop_id: string; name: string; lat: number; lon: number; weight: number }>(
    `SELECT stop_id, name, lat, lon, weight FROM stops WHERE ${clauses.join(' AND ')} LIMIT 120`,
    ...params,
  );
  const matches = fuzzyMatchBatch(q, rows.map((r) => r.name));
  const scored: Array<NationalStation & { score: number }> = [];
  for (let i = 0; i < rows.length; i++) {
    const m = matches[i];
    if (!m?.matches) continue;
    const r = rows[i];
    scored.push({ stop_id: r.stop_id, name: r.name, lat: r.lat, lon: r.lon, weight: r.weight ?? 0, score: m.score });
  }
  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 12) return b.score - a.score;
    return b.weight - a.weight;
  });
  return scored.slice(0, limit).map(({ stop_id, name, lat, lon, weight }) => ({ stop_id, name, lat, lon, weight }));
}

/** Najbliższe stacje kolejowe (do startu "z najbliższej stacji" poza miastem). */
export async function findNearestNationalStations(
  lat: number,
  lon: number,
  maxDistanceM = 30000,
  limit = 5,
): Promise<NationalStation[]> {
  const db = await getNationalDb();
  const latRange = maxDistanceM / 111000;
  const lonRange = maxDistanceM / (111000 * Math.cos((lat * Math.PI) / 180));
  const rows = await db.getAllAsync<{ stop_id: string; name: string; lat: number; lon: number; weight: number }>(
    'SELECT stop_id, name, lat, lon, weight FROM stops WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?',
    lat - latRange,
    lat + latRange,
    lon - lonRange,
    lon + lonRange,
  );
  return rows
    .map((r) => ({ ...r, distanceM: distanceMeters(lat, lon, r.lat, r.lon) }))
    .filter((r) => r.distanceM <= maxDistanceM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}


export function getGtfsDb(): Promise<SQLite.SQLiteDatabase> {
  // W trakcie podmiany pliku (delete+move) nie wolno otwierać bazy: uchwyt
  // trafiłby w usunięty plik. Czekamy na bramkę, potem otwieramy świeży plik.
  if (swapGate) {
    return swapGate.then(() => getGtfsDb());
  }
  // Baza jest per-miasto: każde miasto ma własny plik, więc zmiana miasta
  // nigdy nie nadpisuje danych drugiego (mieszkasz w jednym, studiujesz w drugim).
  return getGtfsDbByName(currentGtfsDbName());
}

/** Uchwyt bazy wskazanego miasta; bez `cityId` aktywna baza (jak getGtfsDb). */
function getDbForCity(cityId?: string): Promise<SQLite.SQLiteDatabase> {
  return cityId ? getGtfsDbByName(gtfsDbName(cityId)) : getGtfsDb();
}

// Bramka podmiany pliku bazy. Ustawiana na czas close→delete→move, żeby żaden
// równoległy getGtfsDb() (np. z UI) nie otworzył usuwanego pliku.
let swapGate: Promise<void> | null = null;
let releaseSwapGate: (() => void) | null = null;

export function beginGtfsSwap(): void {
  if (swapGate) return;
  swapGate = new Promise<void>((resolve) => {
    releaseSwapGate = resolve;
  });
}

export function endGtfsSwap(): void {
  const release = releaseSwapGate;
  swapGate = null;
  releaseSwapGate = null;
  release?.();
}

/**
 * Zamyka uchwyt bazy (przed podmianą pliku .db na nowy z serwera).
 * Po replace plik trzeba otworzyć od nowa - zrobi to getGtfsDb().
 * Bez zamknięcia nadpisany plik = `database disk image is malformed`
 * albo blokada na Androidzie.
 */
export async function closeGtfsDb(): Promise<void> {
  const entries = Array.from(dbPromises.entries());
  dbPromises.clear();
  for (const [, p] of entries) {
    try {
      const db = await p;
      await db.closeAsync();
    } catch {
      // best-effort: plik i tak podmieniamy, a initDb otworzy od nowa
    }
  }
}

/** Znacznik kompletnego importu; bez niego dane w bazie są częściowe. */
export const GTFS_IMPORT_COMPLETE_META = 'gtfs_import_complete';

/** Zapis mety w bazie wskazanego miasta; bez `cityId` w aktywnej. */
export async function setMeta(key: string, value: string, cityId?: string): Promise<void> {
  const db = await getDbForCity(cityId);
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
}

export async function getMeta(key: string, cityId?: string): Promise<string | null> {
  const db = await getDbForCity(cityId);
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

export async function prepareForBulkImport(cityId?: string): Promise<void> {
  const db = await getDbForCity(cityId);
  await db.execAsync(`
    PRAGMA synchronous = OFF;
    DROP INDEX IF EXISTS idx_stoptimes_trip;
  `);
}

export async function finishBulkImport(cityId?: string): Promise<void> {
  const db = await getDbForCity(cityId);
  // Klucz (trip_id, seq) nowych tabel WITHOUT ROWID pokrywa zapytania
  // po kursach. Legacy (rowid) odtwarzamy idx_trip po re-imporcie.
  const t = await db.getFirstAsync<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stop_times'",
  );
  const clustered = (t?.sql ?? '').toUpperCase().includes('WITHOUT ROWID');
  await db.execAsync(`
    ${clustered ? '' : 'CREATE INDEX IF NOT EXISTS idx_stoptimes_trip ON stop_times (trip_id, seq);'}
    PRAGMA synchronous = NORMAL;
  `);
}

export async function importStops(stops: GtfsStop[], cityId?: string): Promise<void> {
  if (stops.length === 0) return;
  const db = await getDbForCity(cityId);
  const CHUNK_SIZE = 50;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < stops.length; i += CHUNK_SIZE) {
      const chunk = stops.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const params: (string | number)[] = [];
      for (const s of chunk) {
        params.push(s.stop_id, s.stop_code, s.stop_name, s.stop_lat, s.stop_lon, s.normalized_name);
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES ${placeholders}`,
        ...params,
      );
    }
  });
}

export async function importRoutes(routes: GtfsRoute[], cityId?: string): Promise<void> {
  if (routes.length === 0) return;
  const db = await getDbForCity(cityId);
  const CHUNK_SIZE = 50;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < routes.length; i += CHUNK_SIZE) {
      const chunk = routes.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
      const params: (string | number)[] = [];
      for (const r of chunk) {
        params.push(r.route_id, r.route_short_name, r.route_long_name, r.route_type);
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES ${placeholders}`,
        ...params,
      );
    }
  });
}

export async function importTrips(trips: GtfsTrip[], cityId?: string): Promise<void> {
  if (trips.length === 0) return;
  const db = await getDbForCity(cityId);
  const CHUNK_SIZE = 50;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < trips.length; i += CHUNK_SIZE) {
      const chunk = trips.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const params: (string | number)[] = [];
      for (const t of chunk) {
        params.push(t.trip_id, t.route_id, t.service_id, t.trip_headsign, t.direction_id, t.shape_id);
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES ${placeholders}`,
        ...params,
      );
    }
  });
}

export async function importCalendar(cals: GtfsCalendar[], cityId?: string): Promise<void> {
  if (cals.length === 0) return;
  const db = await getDbForCity(cityId);
  const CHUNK_SIZE = 50;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < cals.length; i += CHUNK_SIZE) {
      const chunk = cals.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params: (string | number)[] = [];
      for (const c of chunk) {
        params.push(
          c.service_id,
          c.monday,
          c.tuesday,
          c.wednesday,
          c.thursday,
          c.friday,
          c.saturday,
          c.sunday,
          c.start_date,
          c.end_date,
        );
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES ${placeholders}`,
        ...params,
      );
    }
  });
}

export async function importCalendarDates(rows: { service_id: string; date: string; exception_type: number }[], cityId?: string): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDbForCity(cityId);
  const CHUNK_SIZE = 50;
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM calendar_dates');
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?, ?, ?)').join(', ');
      const params: (string | number)[] = [];
      for (const r of chunk) {
        params.push(r.service_id, r.date, r.exception_type);
      }
      await db.runAsync(
        `INSERT INTO calendar_dates (service_id, date, exc) VALUES ${placeholders}`,
        ...params,
      );
    }
  });
}

/** Wrzuca porcję stop_times (z parseStopTimesBatched) w wielowierszowych INSERT-ach. */
export async function importStopTimesBatch(batch: GtfsStopTime[], cityId?: string): Promise<void> {
  if (batch.length === 0) return;
  const db = await getDbForCity(cityId);
  const CHUNK_SIZE = 100;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
      const chunk = batch.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const params: (string | number)[] = [];
      for (const st of chunk) {
        params.push(st.trip_id, st.stop_id, st.arrival_sec, st.departure_sec, st.stop_sequence);
      }
      await db.runAsync(
        `INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES ${placeholders}`,
        ...params,
      );
    }
  });
}

/**
 * Czyści rozkład w bazie wskazanego miasta (domyślnie aktywnego) razem
 * ze znacznikiem kompletności. Partial import nie może udawać gotowej bazy.
 */
export async function clearGtfsTables(cityId?: string): Promise<void> {
  const db = await getDbForCity(cityId);
  await db.execAsync(
    `DELETE FROM stop_times; DELETE FROM trips; DELETE FROM stops; DELETE FROM routes; DELETE FROM calendar; DELETE FROM calendar_dates;
     DELETE FROM meta WHERE key IN ('${GTFS_IMPORT_COMPLETE_META}', 'gtfs_imported_at', 'timetable_version', 'gtfs_source');`,
  );
}

export interface NearestStopRow {
  stop_id: string;
  code: string;
  name: string;
  lat: number;
  lon: number;
  distanceM: number;
}

/** Najbliższe przystanki - bounding box w SQL, dokładny Haversine w JS. */
export async function findNearestStops(
  lat: number,
  lon: number,
  maxDistanceM = 800,
  limit = 12,
): Promise<NearestStopRow[]> {
  const db = await getGtfsDb();
  const latRange = maxDistanceM / 111000;
  const lonRange = maxDistanceM / (111000 * Math.cos((lat * Math.PI) / 180));
  const rows = await db.getAllAsync<{
    stop_id: string;
    code: string;
    name: string;
    lat: number;
    lon: number;
  }>(
    'SELECT stop_id, code, name, lat, lon FROM stops WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT 400',
    lat - latRange,
    lat + latRange,
    lon - lonRange,
    lon + lonRange,
  );
  return rows
    .filter((r) => !isFareBoundary(r.name))
    .map((r) => ({ ...r, distanceM: Math.round(distanceMeters(lat, lon, r.lat, r.lon)) }))
    .filter((r) => r.distanceM <= maxDistanceM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

export interface StopSearchHit {
  stop_id: string;
  code: string;
  name: string;
  lat: number;
  lon: number;
  score: number;
  /** liczba obsłużonych odjazdów - przystanki z większą wagą wyżej */
  weight: number;
}

/**
 * Wyszukiwanie przystanków: tani LIKE w SQLite zawęża kandydatów,
 * a ranking robi fuzzyMatch w JS (jak serwer). Znacząca różnica
 * w dopasowaniu tekstu wygrywa, w przeciwnym razie popularność
 * przystanku (waga = liczba odjazdów).
 */
export async function searchStops(query: string, limit = 8): Promise<StopSearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = normalizePolish(q).split(/[\s,./()\\-]+/).filter(Boolean);
  if (!tokens.length) return [];

  // Prefiltr SQL jest tańszy niż fuzzy na całej tabeli, ale nie może gubić
  // skrótów: "PL. GRUNWALDZKI" nie zawiera "plac grun", więc każde słowo
  // dopasowujemy osobno (AND) z wariantami synonimów (OR), np. plac/pl.
  const clauses: string[] = [];
  const params: string[] = [];
  for (const token of tokens) {
    const variants = expandTokenSynonyms(token).filter((v) => v.length >= 2);
    const list = variants.length ? variants : [token];
    clauses.push(`(${list.map(() => 'norm LIKE ?').join(' OR ')})`);
    for (const v of list) params.push(`%${v.replace(/[%_]/g, '')}%`);
  }

  const db = await getGtfsDb();
  const rows = await db.getAllAsync<{ stop_id: string; code: string; name: string; lat: number; lon: number; weight: number }>(
    `SELECT stop_id, code, name, lat, lon, weight FROM stops WHERE ${clauses.join(' AND ')} LIMIT 120`,
    ...params,
  );
  const scored: StopSearchHit[] = [];
  const seen = new Set<string>();
  const uniqueRows = rows.filter((r) => {
    if (isFareBoundary(r.name)) return false;
    if (seen.has(r.name)) return false;
    seen.add(r.name);
    return true;
  });
  const matches = fuzzyMatchBatch(q, uniqueRows.map((r) => r.name));
  for (let i = 0; i < uniqueRows.length; i++) {
    const m = matches[i];
    if (!m?.matches) continue;
    const r = uniqueRows[i];
    scored.push({ stop_id: r.stop_id, code: r.code, name: r.name, lat: r.lat, lon: r.lon, score: m.score, weight: r.weight ?? 0 });
  }
  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 12) return b.score - a.score;
    return b.weight - a.weight;
  });
  return scored.slice(0, limit);
}

/**
 * Waga przystanku = liczba obsłużonych odjazdów (stop_times).
 * Jednorazowo po imporcie; GROUP BY jednym skanem, bez indeksu po stop_id.
 */
export async function computeStopWeights(cityId?: string): Promise<number> {
  try {
    const db = await getDbForCity(cityId);
    await db.execAsync(`
      UPDATE stops SET weight = 0;
      UPDATE stops SET weight = agg.c
        FROM (SELECT stop_id, COUNT(*) AS c FROM stop_times GROUP BY stop_id) AS agg
        WHERE agg.stop_id = stops.stop_id;
    `);
    const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stops WHERE weight > 0');
    return row?.n ?? 0;
  } catch (err) {
    console.warn('[GtfsDatabase] computeStopWeights failed:', err);
    return 0;
  }
}

/** Czy wagi są już policzone (false po imporcie / na starych bazach). */
export async function needsStopWeights(): Promise<boolean> {
  try {
    const db = await getGtfsDb();
    const s = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stops');
    if (!s || s.n === 0) return false;
    const w = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stops WHERE weight > 0');
    return (w?.n ?? 0) === 0;
  } catch {
    return false;
  }
}

export interface PoiRow {
  osm_id: string;
  kind: string;
  category: string;
  name: string;
  norm_name: string;
  address: string;
  lat: number;
  lon: number;
  street: string | null;
  district: string | null;
}

export async function poiCount(): Promise<number> {
  try {
    const db = await getGtfsDb();
    const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM pois');
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Kandydaci POI po tanim LIKE (ranking robi JS: fuzzy + kara za dystans).
 * Samo zawężenie - szybko nawet na tysiącach wierszy.
 */
export async function findPoiCandidates(query: string, limit = 60): Promise<PoiRow[]> {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return [];
  const normQ = normalizePolish(q);
  const tokens = normQ.split(/[\s,./()\\-]+/).filter((t) => t.length >= 2);
  const db = await getGtfsDb();

  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (tokens.length > 1) {
    for (const token of tokens) {
      const variants = expandTokenSynonyms(token).filter((v) => v.length >= 2);
      const list = variants.length ? variants : [token];
      clauses.push(`(${list.map(() => 'norm_name LIKE ?').join(' OR ')})`);
      for (const v of list) params.push(`%${v.replace(/[%_]/g, '')}%`);
    }
  } else {
    const clean = normQ.replace(/[%_\s\-./()]/g, '');
    clauses.push('(norm_name LIKE ? OR replace(norm_name, " ", "") LIKE ?)');
    params.push(`%${clean}%`, `%${clean}%`);
  }

  params.push(limit);
  return db.getAllAsync<PoiRow>(
    `SELECT osm_id, kind, category, name, norm_name, address, lat, lon, street, district FROM pois WHERE ${clauses.join(' AND ')} LIMIT ?`,
    ...params,
  );
}

/**
 * Decyzja o zestawie aktywnych serwisów (czysta, testowalna).
 *
 * Brak flag w danym dniu przy niepustej tabeli calendar to feed date-scoped
 * (eksporty dzienne GZM/WTP i ZDiT trzymają daty wyłącznie w calendar_dates):
 * bez tego piątek aktywował wszystkie serwisy i planer pokazywał kursy
 * weekendowe obok roboczych. Fallback „wszystko” zostaje dla zupełnie pustego
 * kalendarza albo braku daty (stare bazy z ZIP-a; ta sama semantyka co serwer).
 */
export function resolveActiveServices(
  weekdayServices: readonly string[],
  calendarRowCount: number,
  hasDate: boolean,
  allTripServices: readonly string[],
  dateExceptions: readonly { service_id: string; exc: number }[],
): Set<string> {
  const active = new Set(weekdayServices);
  if (active.size === 0 && (calendarRowCount === 0 || !hasDate)) {
    for (const id of allTripServices) active.add(id);
  }
  for (const r of dateExceptions) {
    if (r.exc === 1) active.add(r.service_id);
    else if (r.exc === 2) active.delete(r.service_id);
  }
  return active;
}

/** Serwisy kursujące w dany dzień (0 = niedziela), z wyjątkami calendar_dates. */
export async function getActiveServices(weekday: number, dateStr?: string): Promise<Set<string>> {
  const db = await getGtfsDb();
  return activeServicesForDb(db, weekday, dateStr);
}

/**
 * Ostatni dzień, w którym jeszcze kursuje każde źródło rozkładu (YYYYMMDD).
 * Bierzemy wcześniejszy koniec z calendar i calendar_dates: kolej z samych
 * calendar_dates kończy się zwykle przed MPK. Null, gdy baza nie ma dat.
 */
export async function getTimetableEndDate(): Promise<string | null> {
  const db = await getGtfsDb();
  const cal = await db.getFirstAsync<{ d: string | null }>(
    "SELECT MAX(end_date) AS d FROM calendar WHERE end_date <> ''",
  );
  const cd = await db.getFirstAsync<{ d: string | null }>(
    'SELECT MAX(date) AS d FROM calendar_dates WHERE exc = 1',
  );
  return [cal?.d, cd?.d].filter((v): v is string => !!v).sort()[0] ?? null;
}

/** Czasy kursu posortowane po stop_sequence (do list rozwijanych + RAPTOR-a). */
export async function getTripStopTimes(tripId: string): Promise<
  { stop_id: string; arr_sec: number; dep_sec: number; seq: number }[]
> {
  const db = await getGtfsDb();
  return db.getAllAsync('SELECT stop_id, arr_sec, dep_sec, seq FROM stop_times WHERE trip_id = ? ORDER BY seq ASC', tripId);
}

/**
 * Stan bazy do statusu danych (ekran główny pyta co 30 s). COUNT(*) na
 * stop_times to skan ponad miliona wierszy, więc tu wystarcza EXISTS.
 */
export async function getGtfsPresence(): Promise<{ stops: number; trips: number; hasStopTimes: boolean }> {
  const db = await getGtfsDb();
  const s = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stops');
  const t = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM trips');
  const st = await db.getFirstAsync<{ n: number }>('SELECT EXISTS(SELECT 1 FROM stop_times) AS n');
  return { stops: s?.n ?? 0, trips: t?.n ?? 0, hasStopTimes: (st?.n ?? 0) > 0 };
}

export async function getGtfsStats(): Promise<{ stops: number; routes: number; trips: number; stopTimes: number }> {
  const db = await getGtfsDb();
  const s = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stops');
  const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM routes');
  const t = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM trips');
  const st = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stop_times');
  return { stops: s?.n ?? 0, routes: r?.n ?? 0, trips: t?.n ?? 0, stopTimes: st?.n ?? 0 };
}

/**
 * Czy baza zawiera pociągi (route_type 2 = KD z prebuilt). Przełącznik
 * w ustawieniach gaśnie, gdy rozkład nie ma pociągów (stara baza z ZIP-a).
 */
export async function hasTrainRoutes(): Promise<boolean> {
  try {
    const db = await getGtfsDb();
    const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM routes WHERE type = 2');
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
