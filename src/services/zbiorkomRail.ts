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

async function loadStations(): Promise<StationIndex> {
  if (stationsPromise) return stationsPromise;
  stationsPromise = fetchJson(`${ZBIORKOM.baseUrl}/api6-open/pkp/stops`)
    .then((raw) => {
      const byStopId = new Map<string, ZbStation>();
      const byName = new Map<string, ZbStation[]>();
      if (!isRecord(raw) || !Array.isArray(raw.stops))
        throw new Error('Nieprawidłowy katalog stacji');
      for (const entry of raw.stops) {
        if (!Array.isArray(entry)) continue;
        const stopId = typeof entry[0] === 'string' ? entry[0] : '';
        const name = typeof entry[2] === 'string' ? entry[2].trim() : '';
        if (!stopId || !name) continue;
        const loc = Array.isArray(entry[4]) ? entry[4] : [];
        const lon = typeof loc[0] === 'number' ? loc[0] : undefined;
        const lat = typeof loc[1] === 'number' ? loc[1] : undefined;
        const station: ZbStation = {
          stopId,
          gtfsIds: [stopId],
          name,
          lon,
          lat,
        };
        byStopId.set(stopId, station);
        const key = normalized(name);
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
  if (!isRecord(value)) return null;
  const trip = isRecord(value.trip) ? value.trip : null;
  const route = trip && isRecord(trip.route) ? trip.route : null;
  const shortName = typeof trip?.shortName === 'string' ? trip.shortName.trim() : '';
  const numberMatch = /^(\S+)(?:\s+(.+))?$/.exec(shortName);
  if (!numberMatch) return null;

  const scheduledDeparture =
    typeof value.scheduledDeparture === 'number' ? value.scheduledDeparture : 0;
  const delayMs = typeof value.delay === 'number' && Number.isFinite(value.delay) ? value.delay : 0;
  const isRealtime = value.isRealtime === true;
  const isCancelled = value.isCancelled === true;
  const platform =
    typeof value.platform === 'string' && value.platform.trim() ? value.platform.trim() : undefined;

  return {
    tripId: typeof trip?.id === 'string' ? trip.id : '',
    agency: typeof route?.agency === 'string' ? route.agency : '',
    line: typeof route?.name === 'string' ? route.name : '',
    color: typeof route?.color === 'string' ? route.color : undefined,
    direction: typeof trip?.headsign === 'string' ? trip.headsign : '',
    trainNumber: numberMatch[1],
    trainName: numberMatch[2] || undefined,
    scheduledAt: scheduledDeparture,
    delaySec: Math.round(delayMs / 1000),
    platform,
    live: !isCancelled && (isRealtime || delayMs !== 0),
    fetchedAt,
  };
}

async function fetchStationDepartures(stopId: string): Promise<ZbRailDeparture[]> {
  const cached = departuresCache.get(stopId);
  if (cached && Date.now() - cached.at < DEPARTURES_TTL_MS) return cached.promise;
  const at = Date.now();
  const promise = fetchJson(
    `${ZBIORKOM.baseUrl}/api6-open/pkp/stops/${encodeURIComponent(stopId)}?limit=100`,
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

function selectBestStation(stations: ZbStation[], leg: Leg): ZbStation | undefined {
  if (stations.length <= 1) return stations[0];
  if (leg.fromLat == null || leg.fromLon == null) return stations[0];
  let best: ZbStation | undefined;
  let minDistance = Infinity;
  for (const station of stations) {
    if (station.lat == null || station.lon == null) continue;
    const dLat = station.lat - leg.fromLat;
    const dLon = station.lon - leg.fromLon;
    const distance = dLat * dLat + dLon * dLon;
    if (distance < minDistance) {
      minDistance = distance;
      best = station;
    }
  }
  return best ?? stations[0];
}

async function resolveStation(index: StationIndex, leg: Leg): Promise<ZbStation | undefined> {
  if (leg.fromStopId) {
    const station = index.byStopId.get(leg.fromStopId);
    if (station) return station;
  }
  const byName = index.byName.get(normalized(leg.fromStop));
  if (byName?.length) return selectBestStation(byName, leg);
  return undefined;
}

function matchDeparture(departures: ZbRailDeparture[], leg: Leg): ZbRailDeparture | undefined {
  const targetSeconds = scheduledLegSeconds(leg);
  const targetNumber = leg.trainNumber?.trim();
  const targetDirection = normalized(leg.direction ?? leg.toStop);

  const matchedByNumber = targetNumber
    ? departures.find((departure) => departure.trainNumber === targetNumber)
    : undefined;

  let best: ZbRailDeparture | undefined = matchedByNumber;
  let minDiff = matchedByNumber
    ? timeDifference(secondsOfDay(matchedByNumber.scheduledAt), targetSeconds)
    : Infinity;

  if (minDiff <= 300) return best;

  for (const departure of departures) {
    const diff = timeDifference(secondsOfDay(departure.scheduledAt), targetSeconds);
    if (diff > 900) continue;
    const matchesDirection = normalized(departure.direction).includes(targetDirection);
    const score = diff + (matchesDirection ? 0 : 300);
    if (score < minDiff) {
      minDiff = score;
      best = departure;
    }
  }

  return minDiff <= 600 ? best : undefined;
}

export function railLegKey(leg: Pick<Leg, 'fromStop' | 'toStop' | 'departAt' | 'line'>): string {
  return `${leg.line ?? ''}|${leg.fromStop}|${leg.toStop}|${leg.departAt}`;
}

export async function fetchZbRailDepartures(
  legs: readonly Leg[],
): Promise<Map<string, ZbRailDeparture>> {
  const trainLegs = legs.filter((leg) => leg.mode === 'train');
  if (trainLegs.length === 0) return new Map();

  const index = await loadStations();
  const legsByStation = new Map<string, Leg[]>();

  for (const leg of trainLegs) {
    const station = await resolveStation(index, leg);
    if (!station) continue;
    const list = legsByStation.get(station.stopId) ?? [];
    list.push(leg);
    legsByStation.set(station.stopId, list);
  }

  const results = new Map<string, ZbRailDeparture>();
  await Promise.all(
    Array.from(legsByStation.entries()).map(async ([stopId, stationLegs]) => {
      try {
        const departures = await fetchStationDepartures(stopId);
        for (const leg of stationLegs) {
          const departure = matchDeparture(departures, leg);
          if (departure) results.set(railLegKey(leg), departure);
        }
      } catch {
        // Ignorujemy błędy stacji, żeby pozostałe działały
      }
    }),
  );

  return results;
}
