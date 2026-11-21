import type { LegMode } from '../types/models';
import { isFareBoundary } from '../gtfs/fareBoundary';
import { openGtfsDbHandle } from './gtfsDatabase';

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

export interface LineTimetableLookupOptions {
  tripId?: string;
  line?: string;
  mode?: LegMode;
  dbTarget?: string;
}

export interface LinePatternHint {
  direction?: string;
  fromStopId?: string;
  toStopId?: string;
  fromStop?: string;
  toStop?: string;
}

export interface TripSegmentIndices {
  fromIndex: number;
  toIndex: number;
}

interface TimetableMinuteEntry {
  minute: string;
  seconds: number;
}

export interface TimetableHourGroup {
  hour: number;
  displayHour: number;
  dayOffset: number;
  minutes: TimetableMinuteEntry[];
}

export interface NextDepartureInfo {
  seconds: number;
  minutesUntil: number;
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
  const db = await openGtfsDbHandle();
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

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const compactDateFormatters = new Map<string, Intl.DateTimeFormat>();

function getTimetableDateFormatter(locale: string): Intl.DateTimeFormat {
  const key = locale || 'pl';
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(key, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Warsaw',
      });
    } catch {
      formatter = new Intl.DateTimeFormat('pl', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Warsaw',
      });
    }
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

function getCompactDateFormatter(locale: string): Intl.DateTimeFormat {
  const key = locale || 'pl';
  let formatter = compactDateFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(key, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'Europe/Warsaw',
      });
    } catch {
      formatter = new Intl.DateTimeFormat('pl', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'Europe/Warsaw',
      });
    }
    compactDateFormatters.set(key, formatter);
  }
  return formatter;
}

function parseTimetableDate(date: string): Date {
  const raw = typeof date === 'string' && /^\d{8}$/.test(date) ? date : timetableToday();
  const parsed = new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    const today = timetableToday();
    return new Date(`${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}T12:00:00Z`);
  }
  return parsed;
}

/** Formatuje datę rozkładu (YYYYMMDD) z nazwą dnia tygodnia, z bezpiecznym fallbackiem do dzisiaj. */
export function formatTimetableDate(date: string, locale: string): string {
  try {
    const value = parseTimetableDate(date);
    return getTimetableDateFormatter(locale).format(value);
  } catch {
    const today = timetableToday();
    const fallbackDate = new Date(
      `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}T12:00:00Z`,
    );
    return getTimetableDateFormatter('pl').format(fallbackDate);
  }
}

/** Formatuje skróconą etykietę daty (np. "pt., 23 paź") do kompaktowego przełącznika dni. */
export function formatTimetableDateCompact(date: string, locale: string): string {
  try {
    const value = parseTimetableDate(date);
    return getCompactDateFormatter(locale).format(value);
  } catch {
    const today = timetableToday();
    const fallbackDate = new Date(
      `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}T12:00:00Z`,
    );
    return getCompactDateFormatter('pl').format(fallbackDate);
  }
}

/** Przesuwa datę rozkładu (YYYYMMDD) o wskazaną liczbę dni, z bezpiecznym fallbackiem do dzisiaj. */
export function shiftTimetableDate(date: string, days: number): string {
  const value = parseTimetableDate(date);
  const shift = Number.isFinite(days) ? days : 0;
  value.setUTCDate(value.getUTCDate() + shift);
  return value.toISOString().slice(0, 10).replaceAll('-', '');
}

export function timetableClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Zamienia godzinę zapisaną jako "HH:MM" na sekundy od północy. */
export function parseClockToSeconds(clock?: string): number | null {
  if (!clock) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 47 || m < 0 || m > 59) {
    return null;
  }
  return h * 3600 + m * 60;
}

function normalizeText(value?: string): string {
  if (!value) return '';
  return value
    .replace(/[łŁ]/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Zwraca indeks przystanku na trasie wariantu po identyfikatorze GTFS lub nazwie. */
function findTimetableStopIndex(
  stops: LineStop[],
  stopId?: string,
  stopName?: string,
): number {
  if (stopId) {
    const cleanHint = stopId.replace(/^stop-pl:/, '');
    const byId = stops.findIndex(
      (stop) =>
        stop.id === stopId ||
        (cleanHint !== stopId && stop.id.replace(/^stop-pl:/, '') === cleanHint),
    );
    if (byId >= 0) return byId;
  }
  const targetName = normalizeText(stopName);
  if (!targetName) return -1;
  return stops.findIndex((stop) => normalizeText(stop.name) === targetName);
}

/** Zlicza fizyczne przystanki na trasie wariantu, pomijając wirtualne granice stref biletowych. */
export function countPhysicalLineStops(stops: LineStop[]): number {
  let count = 0;
  for (const stop of stops) {
    if (!isFareBoundary(stop.name)) count++;
  }
  return count;
}

/** Zwraca indeks pierwszego fizycznego przystanku na trasie (z bezpiecznym fallbackiem do 0). */
export function firstPhysicalStopIndex(stops: LineStop[]): number {
  const idx = stops.findIndex((stop) => !isFareBoundary(stop.name));
  return idx >= 0 ? idx : stops.length > 0 ? 0 : -1;
}

/** Zwraca indeks ostatniego fizycznego przystanku na trasie (z bezpiecznym fallbackiem do końca). */
export function lastPhysicalStopIndex(stops: LineStop[]): number {
  for (let i = stops.length - 1; i >= 0; i--) {
    if (!isFareBoundary(stops[i].name)) return i;
  }
  return stops.length > 0 ? stops.length - 1 : -1;
}

/** Zwraca indeks sąsiedniego fizycznego przystanku w zadanym kierunku, pomijając granice stref. */
export function stepPhysicalStopIndex(
  stops: LineStop[],
  currentIndex: number,
  step: -1 | 1,
): number {
  for (let i = currentIndex + step; i >= 0 && i < stops.length; i += step) {
    if (!isFareBoundary(stops[i].name)) return i;
  }
  return -1;
}

/** Zwraca numer porządkowy (1-based) fizycznego przystanku dla paska nawigacji w arkuszu. */
export function physicalStopOrdinal(stops: LineStop[], index: number): number {
  let ordinal = 0;
  for (let i = 0; i <= index && i < stops.length; i++) {
    if (!isFareBoundary(stops[i].name)) ordinal++;
  }
  return ordinal;
}

/** Wyznacza indeksy odcinka podróży użytkownika (wsiadanie i wysiadanie) na trasie wariantu. */
export function findTripSegment(
  stops: LineStop[],
  hint: LinePatternHint,
): TripSegmentIndices | null {
  const fromIndex = findTimetableStopIndex(stops, hint.fromStopId, hint.fromStop);
  const toIndex = findTimetableStopIndex(stops, hint.toStopId, hint.toStop);
  if (fromIndex < 0 && toIndex < 0) return null;
  if (fromIndex >= 0 && toIndex >= 0 && toIndex <= fromIndex) {
    return { fromIndex, toIndex: -1 };
  }
  return { fromIndex, toIndex };
}

/** Grupuje posortowane odjazdy (w sekundach od północy) według godzin z zachowaniem dnia (+1 dzień). */
export function groupDeparturesByHour(departures: number[]): TimetableHourGroup[] {
  const groups = new Map<number, TimetableMinuteEntry[]>();
  const seenPerHour = new Map<number, Set<string>>();
  for (const seconds of departures) {
    const hour = Math.floor(seconds / 3600);
    const minute = timetableClock(seconds).slice(3);
    let seen = seenPerHour.get(hour);
    if (!seen) {
      seen = new Set<string>();
      seenPerHour.set(hour, seen);
    }
    if (seen.has(minute)) continue;
    seen.add(minute);
    const entries = groups.get(hour) ?? [];
    entries.push({ minute, seconds });
    groups.set(hour, entries);
  }
  return [...groups.entries()].map(([hour, minutes]) => ({
    hour,
    displayHour: hour % 24,
    dayOffset: Math.floor(hour / 24),
    minutes,
  }));
}

/** Zwraca najbliższy odjazd dla dzisiejszego rozkładu wraz z czasem pozostałym w minutach. */
export function findNextDeparture(
  departures: number[],
  nowSec: number,
  isToday: boolean,
): NextDepartureInfo | null {
  if (!isToday || departures.length === 0) return null;
  const threshold = nowSec - 30;
  for (const seconds of departures) {
    if (seconds >= threshold) {
      const minutesUntil = Math.max(0, Math.round((seconds - nowSec) / 60));
      return { seconds, minutesUntil };
    }
  }
  return null;
}

/** Zwraca listę najbliższych odjazdów (w sekundach) dla dzisiejszego rozkładu. */
export function getUpcomingDepartures(
  departures: number[],
  nowSec: number,
  isToday: boolean,
  limit = 3,
): number[] {
  if (!isToday || departures.length === 0 || limit <= 0) return [];
  const threshold = nowSec - 30;
  const upcoming: number[] = [];
  for (const seconds of departures) {
    if (seconds >= threshold) {
      upcoming.push(seconds);
      if (upcoming.length >= limit) break;
    }
  }
  return upcoming;
}

/** Wybiera wariant kierunku najbliższy wskazówce z karty połączenia. */
export function selectInitialPattern(
  patterns: LinePattern[],
  hint: LinePatternHint,
): LinePattern | undefined {
  if (!patterns.length) return undefined;
  const targetDir = normalizeText(hint.direction);
  const hasStopHint = Boolean(
    hint.fromStopId || hint.toStopId || hint.fromStop || hint.toStop,
  );
  if (!targetDir && !hasStopHint) return patterns[0];

  let best = patterns[0];
  let bestScore = -1;
  for (const pattern of patterns) {
    let score = 0;
    const headsign = normalizeText(pattern.headsign);
    const lastIdx = lastPhysicalStopIndex(pattern.stops);
    const terminal = normalizeText(lastIdx >= 0 ? pattern.stops[lastIdx]?.name : undefined);
    if (targetDir) {
      if (headsign === targetDir) score += 1000;
      else if (
        headsign &&
        (headsign.includes(targetDir) || targetDir.includes(headsign))
      ) {
        score += 400;
      }
      if (terminal && terminal === targetDir) score += 250;
    }

    const fromIdx = findTimetableStopIndex(pattern.stops, hint.fromStopId, hint.fromStop);
    const toIdx = findTimetableStopIndex(pattern.stops, hint.toStopId, hint.toStop);
    if (fromIdx >= 0 && toIdx > fromIdx) score += 500;
    else if (fromIdx >= 0 || toIdx >= 0) score += 100;

    if (score > bestScore) {
      bestScore = score;
      best = pattern;
    }
  }
  return bestScore > 0 ? best : patterns[0];
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
    const lastPhys = [...stops].reverse().find((stop) => !isFareBoundary(stop.name)) ?? stops[stops.length - 1];
    const headsign = trip.headsign.trim() || lastPhys.name;
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

async function resolveRouteRow(
  db: Awaited<ReturnType<typeof openGtfsDbHandle>>,
  routeId: string,
  options?: LineTimetableLookupOptions,
): Promise<RouteRow | null> {
  if (routeId) {
    const byId = await db.getFirstAsync<RouteRow>(
      'SELECT route_id, short, long_name, type FROM routes WHERE route_id = ?',
      routeId,
    );
    if (byId) return byId;
  }
  if (options?.tripId) {
    const byTrip = await db.getFirstAsync<RouteRow>(
      'SELECT r.route_id, r.short, r.long_name, r.type FROM trips t JOIN routes r ON r.route_id = t.route_id WHERE t.trip_id = ?',
      options.tripId,
    );
    if (byTrip) return byTrip;
  }
  const short = options?.line?.trim();
  if (short) {
    const rows = await db.getAllAsync<RouteRow>(
      'SELECT route_id, short, long_name, type FROM routes WHERE short = ? COLLATE NOCASE ORDER BY type, route_id',
      short,
    );
    if (rows.length > 0) {
      if (options?.mode) {
        const modeMatch = rows.find((row) => toLine(row).mode === options.mode);
        if (modeMatch) return modeMatch;
      }
      return rows[0];
    }
  }
  return null;
}

export async function loadLineTimetable(
  routeId: string,
  date: string,
  options?: LineTimetableLookupOptions,
): Promise<{
  line: TransitLine | null;
  patterns: LinePattern[];
}> {
  const db = await openGtfsDbHandle(
    options?.dbTarget === 'national' ? 'national' : undefined,
  );
  const route = await resolveRouteRow(db, routeId, options);
  if (!route) return { line: null, patterns: [] };
  const resolvedRouteId = route.route_id;
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
    resolvedRouteId,
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
    resolvedRouteId,
    ...services,
  );
  return { line: toLine(route), patterns: buildLinePatterns(activeTrips, times) };
}
