// Lokalny magazyn GTFS w expo-sqlite (v57 API: openDatabaseAsync).
// Telefon nie trzyma rozkładu w Mapach jak serwer — pyta SQLite z indeksami,
// więc stop_times (~mln wierszy) nie musi wchodzić w całości do RAM.
//
// Schemat celowo minimalny (tylko to, czego potrzebuje routing/search):
// stops / routes / trips / stop_times / calendar / calendar_dates / meta.

import * as SQLite from 'expo-sqlite';
import { distanceMeters } from '../gtfs/geo';
import { fuzzyMatch } from '../gtfs/fuzzy';
import type { GtfsCalendar, GtfsRoute, GtfsStop, GtfsStopTime, GtfsTrip } from '../gtfs/types';

export const GTFS_DB_NAME = 'kilometr-gtfs.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getGtfsDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(GTFS_DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS stops (
          stop_id TEXT PRIMARY KEY NOT NULL,
          code TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          norm TEXT NOT NULL
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
      `);
      return db;
    })();
  }
  return dbPromise;
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

export async function importStops(stops: GtfsStop[]): Promise<void> {
  if (stops.length === 0) return;
  const db = await getGtfsDb();
  await db.withTransactionAsync(async () => {
    for (const s of stops) {
      await db.runAsync(
        'INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)',
        s.stop_id,
        s.stop_code,
        s.stop_name,
        s.stop_lat,
        s.stop_lon,
        s.normalized_name,
      );
    }
  });
}

export async function importRoutes(routes: GtfsRoute[]): Promise<void> {
  if (routes.length === 0) return;
  const db = await getGtfsDb();
  await db.withTransactionAsync(async () => {
    for (const r of routes) {
      await db.runAsync(
        'INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)',
        r.route_id,
        r.route_short_name,
        r.route_long_name,
        r.route_type,
      );
    }
  });
}

export async function importTrips(trips: GtfsTrip[]): Promise<void> {
  if (trips.length === 0) return;
  const db = await getGtfsDb();
  await db.withTransactionAsync(async () => {
    for (const t of trips) {
      await db.runAsync(
        'INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)',
        t.trip_id,
        t.route_id,
        t.service_id,
        t.trip_headsign,
        t.direction_id,
        t.shape_id,
      );
    }
  });
}

export async function importCalendar(cals: GtfsCalendar[]): Promise<void> {
  if (cals.length === 0) return;
  const db = await getGtfsDb();
  await db.withTransactionAsync(async () => {
    for (const c of cals) {
      await db.runAsync(
        'INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
  });
}

export async function importCalendarDates(rows: { service_id: string; date: string; exception_type: number }[]): Promise<void> {
  const db = await getGtfsDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM calendar_dates');
    for (const r of rows) {
      await db.runAsync(
        'INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)',
        r.service_id,
        r.date,
        r.exception_type,
      );
    }
  });
}

/** Wrzuca porcję stop_times (z parseStopTimesBatched) w jednej transakcji. */
export async function importStopTimesBatch(batch: GtfsStopTime[]): Promise<void> {
  if (batch.length === 0) return;
  const db = await getGtfsDb();
  await db.withTransactionAsync(async () => {
    for (const st of batch) {
      await db.runAsync(
        'INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES (?, ?, ?, ?, ?)',
        st.trip_id,
        st.stop_id,
        st.arrival_sec,
        st.departure_sec,
        st.stop_sequence,
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
}

/**
 * Wyszukiwanie przystanków: tani LIKE w SQLite zawęża kandydatów,
 * a ranking robi fuzzyMatch w JS (jak serwer).
 */
export async function searchStops(query: string, limit = 8): Promise<StopSearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const db = await getGtfsDb();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = await db.getAllAsync<{ stop_id: string; code: string; name: string; lat: number; lon: number }>(
    'SELECT stop_id, code, name, lat, lon FROM stops WHERE norm LIKE ? LIMIT 120',
    like,
  );
  const scored: StopSearchHit[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.name)) continue;
    const m = fuzzyMatch(q, r.name);
    if (m.matches) {
      seen.add(r.name);
      scored.push({ stop_id: r.stop_id, code: r.code, name: r.name, lat: r.lat, lon: r.lon, score: m.score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Serwisy kursujące w dany dzień (0 = niedziela), z wyjątkami calendar_dates. */
export async function getActiveServices(weekday: number, dateStr?: string): Promise<Set<string>> {
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
