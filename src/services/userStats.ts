// Warstwa I/O dla statystyk uzytkownika: lekki dziennik przejazdow i odczyt
// wszystkich lokalnych kubelkow danych bez zadnych zapytan sieciowych.

import { CITIES, cityKey, type CityId } from '../cities';
import type { Connection, SavedPlace, SavedRoute } from '../types/models';
import { getActiveCityIdSync } from './cityStore';
import { kvGet, kvSet } from './storage';
import type { TripHistoryItem } from './smartRanking';
import {
  computeUserDataStats,
  connectionToJourneyLogEntry,
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
  const entries = await readJsonArray<JourneyLogEntry>(JOURNEY_LOG_KEY);
  // Dziennik trzyma tylko sledzone podroze. Stare wpisy 'viewed'/'saved' nie
  // wypychaja ich z limitu 400 wpisow i nie wracaja do statystyk.
  return entries.filter((entry) => entry?.source === 'tracked');
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
  const stored = entries.filter((entry) => entry?.source === 'tracked').slice(0, MAX_JOURNEY_LOG);
  await kvSet(JOURNEY_LOG_KEY, JSON.stringify(stored));
}

/**
 * Zapisuje rozpoczety przejazd do lokalnego dziennika statystyk.
 * Ponowne uruchomienie sledzenia tego samego kursu w oknie 2 godzin odswieza
 * wpis zamiast doliczac drugi przejazd.
 */
export function recordJourney(
  connection: Connection,
  cityId: CityId = getActiveCityIdSync(),
): Promise<void> {
  const entry = connectionToJourneyLogEntry(connection, cityId, 'tracked', Date.now());
  if (!entry) return Promise.resolve();

  writeQueue = writeQueue
    .then(async () => {
      const current = await readJourneyLog();
      const idx = current.findIndex(
        (existing) =>
          existing.id === entry.id && Math.abs(entry.ts - existing.ts) < VIEW_DEDUPE_MS,
      );
      const next: JourneyLogEntry[] =
        idx >= 0
          ? [entry, ...current.filter((_, i) => i !== idx)]
          : [entry, ...current];
      await saveJourneyLog(next);
    })
    .catch((err) => {
      console.warn('[UserStats] recordJourney failed:', err);
    });
  return writeQueue;
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
  const [journeyLog, places, savedRoutes, tripHistory, railTickets] = await Promise.all([
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
    readRailTickets(),
  ]);

  return computeUserDataStats({
    journeyLog,
    places: places.filter((p) => p.items.length > 0),
    savedRoutes: savedRoutes.filter((r) => r.items.length > 0),
    tripHistory: tripHistory.filter((h) => h.items.length > 0),
    railTickets,
    fallbackCityId: getActiveCityIdSync(),
  });
}

export type { JourneyLogEntry, UserDataStats };
