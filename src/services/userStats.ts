// Warstwa I/O dla statystyk uzytkownika: lekki dziennik przejazdow i odczyt
// wszystkich lokalnych kubelkow danych bez zadnych zapytan sieciowych.

import { CITIES, cityKey, suggestCityForCoords, type CityId } from '../cities';
import type { Connection, SavedPlace, SavedRoute } from '../types/models';
import { getActiveCityIdSync } from './cityStore';
import { kvGet, kvSet } from './storage';
import type { TripHistoryItem } from './smartRanking';
import {
  computeUserDataStats,
  connectionToJourneyLogEntry,
  type CachedConnectionsInput,
  type JourneyLogEntry,
  type JourneyLogSource,
  type RailTicketSummaryInput,
  type UserDataStats,
} from './userStatsModel';

const JOURNEY_LOG_KEY = 'kilometr.journey_log.v1';
const MAX_JOURNEY_LOG = 400;
const VIEW_DEDUPE_MS = 2 * 3600 * 1000;

const SOURCE_PRIORITY: Record<JourneyLogSource, number> = {
  viewed: 1,
  saved: 2,
  tracked: 3,
};

let writeQueue: Promise<void> = Promise.resolve();

async function readJsonArray<T>(key: string): Promise<T[]> {
  try {
    const raw = await kvGet(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export async function readJourneyLog(): Promise<JourneyLogEntry[]> {
  return readJsonArray<JourneyLogEntry>(JOURNEY_LOG_KEY);
}

export function mergeJourneyLogs(
  current: JourneyLogEntry[],
  incoming: JourneyLogEntry[],
): JourneyLogEntry[] {
  const byKey = new Map<string, JourneyLogEntry>();
  const add = (entry: JourneyLogEntry) => {
    const bucket = Math.floor(entry.ts / VIEW_DEDUPE_MS);
    const key = `${entry.id}@${bucket}`;
    const prev = byKey.get(key);
    if (!prev || SOURCE_PRIORITY[entry.source] > SOURCE_PRIORITY[prev.source]) {
      byKey.set(key, entry);
    }
  };
  for (const item of current) add(item);
  for (const item of incoming) add(item);
  return [...byKey.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_JOURNEY_LOG);
}

export async function saveJourneyLog(entries: JourneyLogEntry[]): Promise<void> {
  await kvSet(JOURNEY_LOG_KEY, JSON.stringify(entries.slice(0, MAX_JOURNEY_LOG)));
}

/**
 * Zapisuje przejazd do lokalnego dziennika statystyk.
 * Deduplikuje wielokrotne podglady tego samego kursu w oknie 2 godzin i podbija
 * priorytet, gdy uzytkownik zapisze trase albo uruchomi sledzenie.
 */
export function recordJourney(
  connection: Connection,
  source: JourneyLogSource,
  cityId: CityId = getActiveCityIdSync(),
): Promise<void> {
  const entry = connectionToJourneyLogEntry(connection, cityId, source, Date.now());
  if (!entry) return Promise.resolve();

  writeQueue = writeQueue
    .then(async () => {
      const current = await readJourneyLog();
      const idx = current.findIndex(
        (existing) =>
          existing.id === entry.id && Math.abs(entry.ts - existing.ts) < VIEW_DEDUPE_MS,
      );
      let next: JourneyLogEntry[];
      if (idx >= 0) {
        const prev = current[idx];
        if (SOURCE_PRIORITY[entry.source] >= SOURCE_PRIORITY[prev.source]) {
          next = [entry, ...current.filter((_, i) => i !== idx)];
        } else {
          return;
        }
      } else {
        next = [entry, ...current];
      }
      await saveJourneyLog(next);
    })
    .catch((err) => {
      console.warn('[UserStats] recordJourney failed:', err);
    });
  return writeQueue;
}

async function readCachedConnections(): Promise<CachedConnectionsInput[]> {
  try {
    const raw = await kvGet('kilometr.cache.connections.v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<
      string,
      { savedAt?: number; data?: Connection[] }
    >;
    if (!parsed || typeof parsed !== 'object') return [];
    const out: CachedConnectionsInput[] = [];
    const activeFallback = getActiveCityIdSync();
    for (const [key, entry] of Object.entries(parsed)) {
      if (!Array.isArray(entry?.data) || entry.data.length === 0) continue;
      const [fromLat, fromLon] = key.split('|').map(Number);
      const cityId = suggestCityForCoords(fromLat, fromLon)?.id ?? activeFallback;
      out.push({
        cityId,
        savedAt: typeof entry.savedAt === 'number' ? entry.savedAt : Date.now(),
        connections: entry.data,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function readRecentLinesAllCities(): Promise<{ city: CityId; lines: string[] }[]> {
  const out: { city: CityId; lines: string[] }[] = [];
  await Promise.all(
    CITIES.map(async (city) => {
      try {
        const raw = await kvGet(cityKey('kilometr.recent_route_lines.v1', city.id));
        if (!raw) return;
        const parsed = JSON.parse(raw) as Record<string, number>;
        if (!parsed || typeof parsed !== 'object') return;
        const lines = Object.entries(parsed)
          .sort((a, b) => b[1] - a[1])
          .map(([line]) => line);
        if (lines.length > 0) out.push({ city: city.id, lines });
      } catch {
        // best-effort
      }
    }),
  );
  return out;
}

async function readRailTickets(): Promise<RailTicketSummaryInput[]> {
  try {
    const raw = await kvGet('rail_tickets:index');
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
      .map((t) => ({
        id: String(t.id ?? ''),
        connectionId: typeof t.connectionId === 'string' ? t.connectionId : undefined,
        addedAt: typeof t.addedAt === 'number' ? t.addedAt : Date.now(),
        trainNumber: typeof t.trainNumber === 'string' ? t.trainNumber : undefined,
        fromStation: typeof t.fromStation === 'string' ? t.fromStation : undefined,
        toStation: typeof t.toStation === 'string' ? t.toStation : undefined,
      }))
      .filter((t) => Boolean(t.id));
  } catch {
    return [];
  }
}

export async function loadUserDataStats(): Promise<UserDataStats> {
  const cityIds = CITIES.map((c) => c.id);
  const [
    journeyLog,
    places,
    savedRoutes,
    tripHistory,
    cachedConnections,
    recentLines,
    railTickets,
  ] = await Promise.all([
    readJourneyLog(),
    Promise.all(
      cityIds.map(async (city) => ({
        city,
        items: await readJsonArray<SavedPlace>(cityKey('kilometr.places', city)),
      })),
    ),
    Promise.all(
      cityIds.map(async (city) => ({
        city,
        items: await readJsonArray<SavedRoute>(cityKey('kilometr.saved_routes', city)),
      })),
    ),
    Promise.all(
      cityIds.map(async (city) => ({
        city,
        items: await readJsonArray<TripHistoryItem>(cityKey('kilometr.trip_history', city)),
      })),
    ),
    readCachedConnections(),
    readRecentLinesAllCities(),
    readRailTickets(),
  ]);

  return computeUserDataStats({
    journeyLog,
    places: places.filter((p) => p.items.length > 0),
    savedRoutes: savedRoutes.filter((r) => r.items.length > 0),
    tripHistory: tripHistory.filter((h) => h.items.length > 0),
    cachedConnections,
    recentLines,
    railTickets,
    fallbackCityId: getActiveCityIdSync(),
  });
}

export type { JourneyLogEntry, UserDataStats };
