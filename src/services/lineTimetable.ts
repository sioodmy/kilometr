import type { LegMode } from '../types/models';
import { getGtfsDb } from './gtfsDatabase';

export interface TransitLine {
  routeId: string;
  shortName: string;
  longName: string;
  mode: LegMode;
}

export interface LineStop {
  id: string;
  name: string;
  code: string;
  departures: number[];
}

export interface LinePattern {
  id: string;
  headsign: string;
  stops: LineStop[];
}

interface RouteRow {
  route_id: string;
  short: string;
  long_name: string;
  type: number;
}

function toLine(row: RouteRow): TransitLine {
  const mode: LegMode =
    row.type === 0
      ? 'tram'
      : row.type === 1
        ? 'subway'
        : row.type === 2
          ? 'train'
          : row.type === 11
            ? 'trolleybus'
            : row.type === 6 || row.type === 7
              ? 'cable'
              : 'bus';
  return { routeId: row.route_id, shortName: row.short, longName: row.long_name, mode };
}

export async function searchTransitLines(query: string): Promise<TransitLine[]> {
  const q = query.trim();
  if (!q || q.length > 16) return [];
  const db = await getGtfsDb();
  const rows = await db.getAllAsync<RouteRow>(
    'SELECT route_id, short, long_name, type FROM routes WHERE short = ? COLLATE NOCASE ORDER BY type, route_id',
    q,
  );
  return rows.map(toLine);
}

export function timetableToday(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day']
    .map((key) => parts.find((part) => part.type === key)?.value)
    .join('');
}

export function shiftTimetableDate(date: string, days: number): string {
  const value = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10).replaceAll('-', '');
}

export function timetableClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

interface TimetableTrip {
  trip_id: string;
  headsign: string;
  direction: number;
}

interface TimetableTime {
  trip_id: string;
  stop_id: string;
  name: string;
  code: string;
  seq: number;
  dep_sec: number;
}

/** Rozdziela objazdy i skrócone kursy według pełnej kolejności przystanków. */
function buildLinePatterns(trips: TimetableTrip[], times: TimetableTime[]): LinePattern[] {
  const byTrip = new Map<string, TimetableTime[]>();
  for (const time of times) {
    const group = byTrip.get(time.trip_id) ?? [];
    group.push(time);
    byTrip.set(time.trip_id, group);
  }
  const patterns = new Map<string, { pattern: LinePattern; count: number }>();
  for (const trip of trips) {
    const stops = byTrip.get(trip.trip_id);
    if (!stops?.length) continue;
    stops.sort((a, b) => a.seq - b.seq);
    const headsign = trip.headsign.trim() || stops[stops.length - 1].name;
    const id = JSON.stringify([trip.direction, headsign, stops.map((stop) => stop.stop_id)]);
    let group = patterns.get(id);
    if (!group) {
      group = {
        count: 0,
        pattern: {
          id,
          headsign,
          stops: stops.map((stop) => ({
            id: stop.stop_id,
            name: stop.name,
            code: stop.code,
            departures: [],
          })),
        },
      };
      patterns.set(id, group);
    }
    group.count++;
    stops.forEach((stop, index) => group.pattern.stops[index].departures.push(stop.dep_sec));
  }
  return [...patterns.values()]
    .sort((a, b) => b.count - a.count || a.pattern.id.localeCompare(b.pattern.id))
    .map(({ pattern }) => {
      for (const stop of pattern.stops) {
        stop.departures = [...new Set(stop.departures)].sort((a, b) => a - b);
      }
      return pattern;
    });
}

export async function loadLineTimetable(
  routeId: string,
  date: string,
): Promise<{
  line: TransitLine | null;
  patterns: LinePattern[];
}> {
  const db = await getGtfsDb();
  const route = await db.getFirstAsync<RouteRow>(
    'SELECT route_id, short, long_name, type FROM routes WHERE route_id = ?',
    routeId,
  );
  if (!route) return { line: null, patterns: [] };
  const weekday = new Date(
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00Z`,
  ).getUTCDay();
  const column = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][weekday];
  const calendar = await db.getAllAsync<{ service_id: string }>(
    `SELECT service_id FROM calendar WHERE ${column} > 0 AND (start_date = '' OR start_date <= ?) AND (end_date = '' OR end_date >= ?)`,
    date,
    date,
  );
  const total = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM calendar');
  const trips = await db.getAllAsync<TimetableTrip & { service_id: string }>(
    'SELECT trip_id, service_id, headsign, direction FROM trips WHERE route_id = ?',
    routeId,
  );
  const exceptions = await db.getAllAsync<{ service_id: string; exc: number }>(
    'SELECT service_id, exc FROM calendar_dates WHERE date = ?',
    date,
  );
  const active = new Set(calendar.map((row) => row.service_id));
  if (!total?.n) {
    const dated = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM calendar_dates');
    if (!dated?.n) for (const trip of trips) active.add(trip.service_id);
  }
  for (const exception of exceptions) {
    if (exception.exc === 1) active.add(exception.service_id);
    else if (exception.exc === 2) active.delete(exception.service_id);
  }
  const activeTrips = trips.filter((trip) => active.has(trip.service_id));
  if (!activeTrips.length) return { line: toLine(route), patterns: [] };
  const services = [...new Set(activeTrips.map((trip) => trip.service_id))];
  const times = await db.getAllAsync<TimetableTime>(
    `SELECT st.trip_id, st.stop_id, st.seq, st.dep_sec, s.name, s.code
     FROM trips t JOIN stop_times st ON st.trip_id = t.trip_id JOIN stops s ON s.stop_id = st.stop_id
     WHERE t.route_id = ? AND t.service_id IN (${services.map(() => '?').join(',')})`,
    routeId,
    ...services,
  );
  return { line: toLine(route), patterns: buildLinePatterns(activeTrips, times) };
}
