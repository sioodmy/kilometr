import type { Leg } from '../types/models';
import { timeStringToSeconds } from '../gtfs/geo';
import { ZBIORKOM } from './gtfsConfig';
import { withTimeout } from './net';

interface ZbStation {
  stopId: string;
  gtfsIds: string[];
  name: string;
  lon?: number;
  lat?: number;
}

interface StationIndex {
  byStopId: Map<string, ZbStation>;
  byName: Map<string, ZbStation[]>;
}

export interface ZbRailDeparture {
  tripId: string;
  agency: string;
  line: string;
  color?: string;
  direction: string;
  trainNumber: string;
  trainName?: string;
  scheduledAt: number;
  delaySec: number;
  platform?: string;
  live: boolean;
  fetchedAt: number;
}

const DAY_SEC = 86400;
const DEPARTURES_TTL_MS = 20_000;
let stationsPromise: Promise<StationIndex> | null = null;
const departuresCache = new Map<string, { at: number; promise: Promise<ZbRailDeparture[]> }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchJson(url: string): Promise<unknown> {
  const timeout = withTimeout(ZBIORKOM.timeoutMs);
  try {
    const response = await fetch(url, { signal: timeout.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    timeout.dispose();
  }
}

function parseStation(value: unknown): ZbStation | null {
  if (!isRecord(value)) return null;
  const stopId = typeof value.gtfsId === 'string' ? value.gtfsId.split(',')[0]?.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!stopId || !name || value.city !== 'pkp') return null;
  const location = Array.isArray(value.location) ? value.location : [];
  const lon = typeof location[0] === 'number' ? location[0] : undefined;
  const lat = typeof location[1] === 'number' ? location[1] : undefined;
  return {
    stopId,
    gtfsIds: typeof value.gtfsId === 'string' ? value.gtfsId.split(',').map((id) => id.trim()) : [],
    name,
    lon,
    lat,
  };
}

async function loadStations(): Promise<StationIndex> {
  if (stationsPromise) return stationsPromise;
  stationsPromise = fetchJson('https://cdn.zbiorkom.live/stations.json')
    .then((raw) => {
      const byStopId = new Map<string, ZbStation>();
      const byName = new Map<string, ZbStation[]>();
      if (!isRecord(raw)) throw new Error('Nieprawidłowy katalog stacji');
      for (const entry of Object.values(raw)) {
        const station = parseStation(entry);
        if (!station) continue;
        for (const id of station.gtfsIds) byStopId.set(id, station);
        const key = normalized(station.name);
        const group = byName.get(key) ?? [];
        group.push(station);
        byName.set(key, group);
      }
      return { byStopId, byName };
    })
    .catch((error) => {
      stationsPromise = null;
      throw error;
    });
  return stationsPromise;
}

function parseDeparture(value: unknown, fetchedAt: number): ZbRailDeparture | null {
  if (!Array.isArray(value) || !Array.isArray(value[0]) || !Array.isArray(value[2])) return null;
  const trip = value[0];
  const route = trip[2];
  const stop = value[2];
  if (!Array.isArray(route) || typeof trip[0] !== 'string') return null;
  if (
    typeof route[2] !== 'string' ||
    typeof route[4] !== 'string' ||
    typeof trip[3] !== 'string' ||
    typeof trip[5] !== 'string' ||
    typeof stop[0] !== 'number'
  )
    return null;
  const shortName = trip[5].trim();
  const numberMatch = /^(\S+)(?:\s+(.+))?$/.exec(shortName);
  if (!numberMatch) return null;
  const delayMs = typeof stop[1] === 'number' && Number.isFinite(stop[1]) ? stop[1] : 0;
  const status = typeof stop[2] === 'number' ? stop[2] : 0;
  return {
    tripId: trip[0],
    agency: route[4],
    line: route[2],
    color: typeof route[6] === 'string' ? route[6] : undefined,
    direction: trip[3],
    trainNumber: numberMatch[1],
    trainName: numberMatch[2] || undefined,
    scheduledAt: stop[0],
    delaySec: Math.round(delayMs / 1000),
    platform: typeof stop[3] === 'string' && stop[3].trim() ? stop[3].trim() : undefined,
    live: status !== 3 && (value[1] !== null || delayMs !== 0),
    fetchedAt,
  };
}

async function fetchStationDepartures(stopId: string): Promise<ZbRailDeparture[]> {
  const cached = departuresCache.get(stopId);
  if (cached && Date.now() - cached.at < DEPARTURES_TTL_MS) return cached.promise;
  const at = Date.now();
  const promise = fetchJson(
    `${ZBIORKOM.baseUrl}/api6/pkp/stops/${encodeURIComponent(stopId)}?limit=100`,
  )
    .then((raw) => {
      if (!isRecord(raw) || !Array.isArray(raw.departures)) return [];
      return raw.departures.flatMap((entry) => {
        const departure = parseDeparture(entry, at);
        return departure ? [departure] : [];
      });
    })
    .catch((error) => {
      departuresCache.delete(stopId);
      throw error;
    });
  departuresCache.set(stopId, { at, promise });
  return promise;
}

function secondsOfDay(ms: number): number {
  const date = new Date(ms);
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

function scheduledLegSeconds(
  leg: Pick<Leg, 'departAt' | 'delaySec' | 'scheduledDepartureSec'>,
): number {
  const seconds =
    leg.scheduledDepartureSec ?? timeStringToSeconds(leg.departAt) - (leg.delaySec ?? 0);
  return ((seconds % DAY_SEC) + DAY_SEC) % DAY_SEC;
}

function timeDifference(a: number, b: number): number {
  const direct = Math.abs(a - b) % DAY_SEC;
  return Math.min(direct, DAY_SEC - direct);
}

function trainNumber(value?: string): string | undefined {
  return /(?:^|\s)(\d{1,7}(?:\/\d+)?)(?:\s|$)/.exec(value?.trim() ?? '')?.[1];
}

function baseTrainNumber(value?: string): string | undefined {
  return value?.split('/')[0];
}

function lineMatches(local: string | undefined, remote: string): boolean {
  if (!local) return false;
  const a = normalized(local);
  const b = normalized(remote);
  return a === b || a.endsWith(` ${b}`);
}

function matchRailDeparture(
  leg: Pick<Leg, 'line' | 'direction' | 'departAt' | 'delaySec' | 'scheduledDepartureSec'>,
  departures: ZbRailDeparture[],
): ZbRailDeparture | null {
  const localNumber = trainNumber(leg.line);
  const localDirection = normalized(leg.direction ?? '');
  let best: { departure: ZbRailDeparture; score: number } | null = null;
  for (const departure of departures) {
    const diff = timeDifference(scheduledLegSeconds(leg), secondsOfDay(departure.scheduledAt));
    if (diff > 120) continue;
    const remoteNumber = trainNumber(departure.trainNumber);
    const numberMatch =
      !!localNumber &&
      !!remoteNumber &&
      baseTrainNumber(localNumber) === baseTrainNumber(remoteNumber);
    if (localNumber && remoteNumber && !numberMatch) continue;
    const commercialMatch = lineMatches(leg.line, departure.line);
    const remoteDirection = normalized(departure.direction);
    const directionMatch =
      !!localDirection &&
      !!remoteDirection &&
      (localDirection === remoteDirection ||
        localDirection.includes(remoteDirection) ||
        remoteDirection.includes(localDirection));
    if (!numberMatch && !commercialMatch && !directionMatch) continue;
    const score =
      (numberMatch ? 1000 : 0) +
      (directionMatch ? 300 : 0) +
      (commercialMatch ? 200 : 0) +
      (departure.live ? 10 : 0) -
      diff;
    if (!best || score > best.score) best = { departure, score };
  }
  return best?.departure ?? null;
}

function nearestStation(stations: ZbStation[], leg: Leg): ZbStation | null {
  if (stations.length === 0) return null;
  if (leg.fromLat == null || leg.fromLon == null) return stations[0] ?? null;
  let best = stations[0];
  let bestDistance = Infinity;
  for (const station of stations) {
    if (station.lat == null || station.lon == null) continue;
    const distance = (station.lat - leg.fromLat) ** 2 + (station.lon - leg.fromLon) ** 2;
    if (distance < bestDistance) {
      best = station;
      bestDistance = distance;
    }
  }
  return best ?? null;
}

export function railLegKey(leg: Leg): string {
  return (
    leg.tripId ?? [leg.fromStopId, leg.scheduledDepartureSec ?? leg.departAt, leg.line].join(':')
  );
}

/** Pobiera peron, nazwę handlową i opóźnienie kursu z tablicy odjazdów zbiorkom.live. */
export async function fetchZbRailDepartures(legs: Leg[]): Promise<Map<string, ZbRailDeparture>> {
  const trains = legs.filter((leg) => leg.mode === 'train');
  const result = new Map<string, ZbRailDeparture>();
  if (trains.length === 0) return result;
  const stations = await loadStations();
  await Promise.all(
    trains.map(async (leg) => {
      try {
        const station =
          (leg.fromStopId ? stations.byStopId.get(leg.fromStopId) : undefined) ??
          nearestStation(stations.byName.get(normalized(leg.fromStop)) ?? [], leg);
        if (!station) return;
        const departures = await fetchStationDepartures(station.stopId);
        const match = matchRailDeparture(leg, departures);
        if (match) result.set(railLegKey(leg), match);
      } catch {
        // Brak danych dodatkowych nie może blokować rozkładu offline.
      }
    }),
  );
  return result;
}
