// Lokalny magazyn GTFS w expo-sqlite (v57 API: openDatabaseAsync).
// Telefon nie trzyma rozkładu w Mapach jak serwer — pyta SQLite z indeksami,
// więc stop_times (~mln wierszy) nie musi wchodzić w całości do RAM.
//
// Schemat celowo minimalny (tylko to, czego potrzebuje routing/search):
// stops / routes / trips / stop_times / calendar / calendar_dates / meta.

import * as SQLite from 'expo-sqlite';
import { distanceMeters } from '../gtfs/geo';
import { fuzzyMatch } from '../gtfs/fuzzy';
import { getActiveCityIdSync } from '../cities/active';
import { DEFAULT_CITY_ID } from '../cities/registry';
import type { GtfsCalendar, GtfsRoute, GtfsStop, GtfsStopTime, GtfsTrip } from '../gtfs/types';

/**
 * Nazwa pliku bazy rozkładu — jedna na miasto.
 *
 * Domyślne miasto (Wrocław) zachowuje starą nazwę bez sufiksu. To celowe:
 * użytkownicy aplikacji przed dodaniem wielu miast mają już pobrany i
 * zaimportowany rozkład w `kilometr-gtfs.db`. Podmiana nazwy zmusiłaby ich do
 * ponownego pobrania ~46 MB, a nic w tym rozkładzie nie przestał być aktualny.
 * Nowe miasta dostają bazę z sufiksem.
 */
export function gtfsDbName(cityId: string): string {
  return cityId === DEFAULT_CITY_ID ? 'kilometr-gtfs.db' : `kilometr-gtfs-${cityId}.db`;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function initDb(): Promise<SQLite.SQLiteDatabase> {
      const db = await SQLite.openDatabaseAsync(gtfsDbName(getActiveCityIdSync()));
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
          seq INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_stoptimes_trip ON stop_times (trip_id, seq);
        CREATE INDEX IF NOT EXISTS idx_stoptimes_stop ON stop_times (stop_id, dep_sec);
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

export function getGtfsDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    const p = initDb();
    dbPromise = p;
    // Nie trzymaj odrzuconego promise'a — następne wywołanie próbuje od nowa
    // zamiast zwracać w kółko ten sam błąd (widoczne w logach jako wieczne
    // "[LocalGtfsStore] Initializing..." bez "Loaded").
    p.catch(() => {
      if (dbPromise === p) dbPromise = null;
    });
  }
  return dbPromise;
}

/**
 * Zapomnij uchwyt do bazy. Wywoływane przy zmianie miasta — inaczej
 * `getGtfsDb()` zwróciłby uchwyt do bazy poprzedniego miasta i planer
 * planowałby trasy po wrocławskich przystankach w aplikacji ustawionej na
 * Kraków. Stary uchwyt zostaje do zamknięcia przez SQLite (drobnym zwrotem).
 */
export function resetGtfsDb(): void {
  const p = dbPromise;
  dbPromise = null;
  void p
    ?.then((db) => db.closeAsync())
    .catch(() => {
      // uchwyt mógł być już zamknięty — nic nie zgłaszamy
    });
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getGtfsDb();
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getGtfsDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

export async function prepareForBulkImport(): Promise<void> {
  const db = await getGtfsDb();
  await db.execAsync(`
    PRAGMA synchronous = OFF;
    DROP INDEX IF EXISTS idx_stoptimes_trip;
    DROP INDEX IF EXISTS idx_stoptimes_stop;
  `);
}

export async function finishBulkImport(): Promise<void> {
  const db = await getGtfsDb();
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_stoptimes_trip ON stop_times (trip_id, seq);
    CREATE INDEX IF NOT EXISTS idx_stoptimes_stop ON stop_times (stop_id, dep_sec);
    PRAGMA synchronous = NORMAL;
  `);
}

export async function importStops(stops: GtfsStop[]): Promise<void> {
  if (stops.length === 0) return;
  const db = await getGtfsDb();
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

export async function importRoutes(routes: GtfsRoute[]): Promise<void> {
  if (routes.length === 0) return;
  const db = await getGtfsDb();
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

export async function importTrips(trips: GtfsTrip[]): Promise<void> {
  if (trips.length === 0) return;
  const db = await getGtfsDb();
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

export async function importCalendar(cals: GtfsCalendar[]): Promise<void> {
  if (cals.length === 0) return;
  const db = await getGtfsDb();
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

export async function importCalendarDates(rows: { service_id: string; date: string; exception_type: number }[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getGtfsDb();
  const CHUNK_SIZE = 50;
  await db.withTransactionAsync(async () => {
    // UWAGA: celowo bez `DELETE` przed wstawieniem. Ta funkcja bywa wołana
    // raz na feed, a import miasta czyści tabele RAZ na początku
    // (`clearGtfsTables`). Kasowanie tutaj gubiłoby wyjątki kalendarza
    // poprzednich feedów — przy Krakowie (3 feedy) zostałyby tylko
    // wyjątki z ostatniego archiwum.
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
export async function importStopTimesBatch(batch: GtfsStopTime[]): Promise<void> {
  if (batch.length === 0) return;
  const db = await getGtfsDb();
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

export async function clearGtfsTables(): Promise<void> {
  const db = await getGtfsDb();
  await db.execAsync(
    'DELETE FROM stop_times; DELETE FROM trips; DELETE FROM stops; DELETE FROM routes; DELETE FROM calendar; DELETE FROM calendar_dates;',
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

/** Najbliższe przystanki — bounding box w SQL, dokładny Haversine w JS. */
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
  /** liczba obsłużonych odjazdów — przystanki z większą wagą wyżej */
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
  const db = await getGtfsDb();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = await db.getAllAsync<{ stop_id: string; code: string; name: string; lat: number; lon: number; weight: number }>(
    'SELECT stop_id, code, name, lat, lon, weight FROM stops WHERE norm LIKE ? LIMIT 120',
    like,
  );
  const scored: StopSearchHit[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.name)) continue;
    const m = fuzzyMatch(q, r.name);
    if (m.matches) {
      seen.add(r.name);
      scored.push({ stop_id: r.stop_id, code: r.code, name: r.name, lat: r.lat, lon: r.lon, score: m.score, weight: r.weight ?? 0 });
    }
  }
  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 12) return b.score - a.score;
    return b.weight - a.weight;
  });
  return scored.slice(0, limit);
}

/**
 * Waga przystanku = liczba obsłużonych odjazdów (stop_times).
 * Jednorazowo po imporcie; idx_stoptimes_stop robi to szybko natywnie.
 */
export async function computeStopWeights(): Promise<number> {
  try {
    const db = await getGtfsDb();
    await db.execAsync(
      'UPDATE stops SET weight = (SELECT COUNT(*) FROM stop_times WHERE stop_times.stop_id = stops.stop_id)'
    );
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

/** Atomowa podmiana indeksu POI (Overpass → SQLite). */
export async function replacePois(rows: PoiRow[]): Promise<void> {
  const db = await getGtfsDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM pois');
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params: (string | number | null)[] = [];
      for (const r of chunk) {
        params.push(r.osm_id, r.kind, r.category, r.name, r.norm_name, r.address, r.lat, r.lon, r.street, r.district);
      }
      await db.runAsync(
        'INSERT OR REPLACE INTO pois (osm_id, kind, category, name, norm_name, address, lat, lon, street, district) VALUES ' + placeholders,
        ...params,
      );
    }
  });
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
 * Samo zawężenie — szybko nawet na tysiącach wierszy.
 */
export async function findPoiCandidates(query: string, limit = 60): Promise<PoiRow[]> {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return [];
  const db = await getGtfsDb();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  return db.getAllAsync<PoiRow>(
    'SELECT osm_id, kind, category, name, norm_name, address, lat, lon, street, district FROM pois WHERE norm_name LIKE ? LIMIT 60',
    like,
  );
}

/** Serwisy kursujące w dany dzień (0 = niedziela), z wyjątkami calendar_dates. */export async function getActiveServices(weekday: number, dateStr?: string): Promise<Set<string>> {
  const db = await getGtfsDb();
  const day = ((weekday % 7) + 7) % 7;
  const col = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][day];
  const rows = await db.getAllAsync<{ service_id: string }>(`SELECT service_id FROM calendar WHERE ${col} > 0`);
  const active = new Set(rows.map((r) => r.service_id));
  if (active.size === 0) {
    // Pusty kalendarz = wszystko zawsze (jak serwer).
    const all = await db.getAllAsync<{ service_id: string }>('SELECT DISTINCT service_id FROM trips');
    for (const r of all) active.add(r.service_id);
  }
  if (dateStr) {
    const ex = await db.getAllAsync<{ service_id: string; exc: number }>(
      'SELECT service_id, exc FROM calendar_dates WHERE date = ?',
      dateStr,
    );
    for (const r of ex) {
      if (r.exc === 1) active.add(r.service_id);
      else if (r.exc === 2) active.delete(r.service_id);
    }
  }
  return active;
}

/** route_ids dla oznaczenia linii ("4", "K") — case-insensitive. */
export async function getRouteIdsByShortName(shortName: string): Promise<string[]> {
  const db = await getGtfsDb();
  const key = shortName.trim().toUpperCase();
  const rows = await db.getAllAsync<{ route_id: string; short: string }>('SELECT route_id, short FROM routes');
  return rows.filter((r) => r.short.trim().toUpperCase() === key).map((r) => r.route_id);
}

/** Czasy kursu posortowane po stop_sequence (do list rozwijanych + RAPTOR-a). */
export async function getTripStopTimes(tripId: string): Promise<
  { stop_id: string; arr_sec: number; dep_sec: number; seq: number }[]
> {
  const db = await getGtfsDb();
  return db.getAllAsync('SELECT stop_id, arr_sec, dep_sec, seq FROM stop_times WHERE trip_id = ? ORDER BY seq ASC', tripId);
}

export async function getGtfsStats(): Promise<{ stops: number; routes: number; trips: number; stopTimes: number }> {
  const db = await getGtfsDb();
  const s = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stops');
  const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM routes');
  const t = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM trips');
  const st = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stop_times');
  return { stops: s?.n ?? 0, routes: r?.n ?? 0, trips: t?.n ?? 0, stopTimes: st?.n ?? 0 };
}
