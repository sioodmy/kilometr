import type { CityDef } from '../cities';
import type { GtfsStop, GtfsStopTime, GtfsTrip } from '../gtfs/types';
import { distanceMeters } from '../gtfs/geo';
import type { RawVehicleRow } from './liveTracker';

const KP_TIMEOUT_MS = 8_000;
const MAX_PLACES_PER_CALL = 35;
const MAX_HUB_STOPS = 35;
const MAX_ETA_MIN = 55;
const TRIP_EXEC_CONCURRENCY = 6;
const STOPS_CACHE_TTL_MS = 6 * 3_600_000;

const KP_HEADERS = {
  Accept: 'application/json',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'KilometrApp/1.0 (https://kilometr.pl)',
};

/** [placeId, designator, name, lon_e6, lat_e6, onlyDisembarking, isStation, showPlatforms] */
type KpRawStopTuple = [
  string | number,
  string | number,
  string,
  number,
  number,
  number?,
  number?,
  number?,
];

export interface KpStopEntry {
  placeId: string;
  name: string;
  lat: number;
  lon: number;
  onlyDisembarking: boolean;
  isStation: boolean;
}

interface KpDepartureRow {
  time?: string;
  time_diff?: number;
  canceled?: boolean;
  is_estimated?: boolean;
  line_name?: string;
  trip_execution_id?: string | number | null;
  trip_index?: number | null;
}

interface KpDeparturesResponse {
  departures?: Array<{
    designator?: string | number;
    rows?: KpDepartureRow[];
  }>;
}

interface KpTripExecutionResponse {
  vehicle?: { lat?: number | null; lon?: number | null } | null;
  estimated?: boolean;
  estimates?: Array<{ to_go?: number | null }>;
  trip?: {
    direction?: string | null;
    line?: { name?: string | null; type?: string | null } | null;
    times?: Array<{
      stop_name?: string | null;
      departure_time?: string | null;
    }>;
  } | null;
}

export interface GtfsStopCoverageSource {
  isLoaded: boolean;
  stops: Map<string, GtfsStop & { weight?: number }>;
  trips: Map<string, GtfsTrip>;
  stopTimes: Map<string, GtfsStopTime[]>;
}

const stopsCache = new Map<string, { fetchedAt: number; stops: KpStopEntry[] }>();

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Standard Base64 encoding for `/api/trip_execution/<b64>/<idx>`.
 * Implemented without relying on Node `Buffer` or optional `btoa` polyfills.
 */
export function encodeKpTripExecId(value: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}

function parseEtaMinutes(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^<\s*1\s*min/i.test(s)) return 0;
  const m = /^(\d+)\s*min/i.exec(s);
  if (m) return Number(m[1]);
  return null;
}

function parseHhMmToSec(raw: string | null | undefined, minSec: number): number | null {
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  let sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
  if (sec < minSec - 6 * 3600) sec += 86_400;
  return sec;
}

async function fetchJsonWithTimeout<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), KP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: KP_HEADERS, signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadKpStops(prefix: string): Promise<KpStopEntry[] | null> {
  const cached = stopsCache.get(prefix);
  if (cached && Date.now() - cached.fetchedAt < STOPS_CACHE_TTL_MS) {
    return cached.stops;
  }
  const data = await fetchJsonWithTimeout<{ stops?: KpRawStopTuple[] }>(
    `https://${prefix}.kiedyprzyjedzie.pl/stops`,
  );
  if (!data || !Array.isArray(data.stops)) return cached?.stops ?? null;

  const parsed: KpStopEntry[] = [];
  for (const row of data.stops) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const placeId = String(row[0] ?? '').trim();
    const lon = Number(row[3]) / 1e6;
    const lat = Number(row[4]) / 1e6;
    if (!placeId || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
      continue;
    }
    parsed.push({
      placeId,
      name: String(row[2] ?? '').trim(),
      lat,
      lon,
      onlyDisembarking: row[5] === 1,
      isStation: row[6] === 1,
    });
  }
  stopsCache.set(prefix, { fetchedAt: Date.now(), stops: parsed });
  return parsed;
}

/**
 * Selects up to `MAX_HUB_STOPS` boarding stops covering all loaded routes
 * (using up to 2 stops per route when available) plus spatial grid fallback
 * for cities whose GTFS IDs differ from KP place IDs (e.g. Bielsko-Biała).
 */
export function selectKpHubStops(
  kpStops: KpStopEntry[],
  store?: GtfsStopCoverageSource,
): string[] {
  const boardable = kpStops.filter((s) => !s.onlyDisembarking);
  if (boardable.length === 0) return [];
  if (boardable.length <= MAX_HUB_STOPS) return boardable.map((s) => s.placeId);

  const kpById = new Map<string, KpStopEntry>();
  for (const s of boardable) kpById.set(s.placeId, s);

  const resolveToKpPlaceId = (gtfsStopId: string): string | null => {
    if (kpById.has(gtfsStopId)) return gtfsStopId;
    const gs = store?.stops.get(gtfsStopId);
    if (!gs) return null;
    let bestId: string | null = null;
    let bestDist = 120;
    for (const ks of boardable) {
      const d = distanceMeters(gs.stop_lat, gs.stop_lon, ks.lat, ks.lon);
      if (d < bestDist) {
        bestDist = d;
        bestId = ks.placeId;
      }
    }
    return bestId;
  };

  const selected: string[] = [];
  const selectedSet = new Set<string>();

  if (store?.isLoaded && store.stopTimes.size > 0 && store.trips.size > 0) {
    const kpToRoutes = new Map<string, Set<string>>();
    const gtfsMapCache = new Map<string, string | null>();
    const routeCoverage = new Map<string, number>();

    for (const [tripId, times] of store.stopTimes) {
      const trip = store.trips.get(tripId);
      if (!trip || times.length === 0) continue;
      if (!routeCoverage.has(trip.route_id)) routeCoverage.set(trip.route_id, 0);
      // Sample start and midpoint of each trip to map route coverage cheaply.
      const idxs = times.length > 2 ? [0, Math.floor(times.length / 2)] : [0];
      for (const idx of idxs) {
        const sid = times[idx]?.stop_id;
        if (!sid) continue;
        let kpId = gtfsMapCache.get(sid);
        if (kpId === undefined) {
          kpId = resolveToKpPlaceId(sid);
          gtfsMapCache.set(sid, kpId);
        }
        if (!kpId) continue;
        let routes = kpToRoutes.get(kpId);
        if (!routes) {
          routes = new Set<string>();
          kpToRoutes.set(kpId, routes);
        }
        routes.add(trip.route_id);
      }
    }

    // Greedy set cover requiring up to 2 hub stops per route for direction breadth.
    for (let pass = 0; pass < 2 && selected.length < MAX_HUB_STOPS; pass++) {
      const targetCov = pass + 1;
      while (selected.length < MAX_HUB_STOPS) {
        let bestKp: string | null = null;
        let bestGain = 0;
        for (const [kpId, routes] of kpToRoutes) {
          if (selectedSet.has(kpId)) continue;
          let gain = 0;
          for (const r of routes) {
            if ((routeCoverage.get(r) ?? 0) < targetCov) gain += 1;
          }
          if (gain > bestGain) {
            bestGain = gain;
            bestKp = kpId;
          }
        }
        if (!bestKp || bestGain === 0) break;
        selected.push(bestKp);
        selectedSet.add(bestKp);
        for (const r of kpToRoutes.get(bestKp)!) {
          routeCoverage.set(r, (routeCoverage.get(r) ?? 0) + 1);
        }
      }
    }
  }

  // Top up remaining budget with evenly spread KP stops (stations first).
  if (selected.length < MAX_HUB_STOPS) {
    const stations = boardable.filter((s) => s.isStation && !selectedSet.has(s.placeId));
    for (const s of stations) {
      if (selected.length >= MAX_HUB_STOPS) break;
      selected.push(s.placeId);
      selectedSet.add(s.placeId);
    }
    const step = Math.max(1, Math.floor(boardable.length / (MAX_HUB_STOPS - selected.length || 1)));
    for (let i = 0; i < boardable.length && selected.length < MAX_HUB_STOPS; i += step) {
      const pid = boardable[i]!.placeId;
      if (!selectedSet.has(pid)) {
        selected.push(pid);
        selectedSet.add(pid);
      }
    }
  }

  return selected;
}

async function runPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/**
 * Fetches live GPS positions and delays for a city backed by kiedyprzyjedzie.pl.
 * Deduplicates by brigade prefix because KP exposes future trips on the same
 * physical vehicle with `is_estimated: true` before their scheduled departure.
 */
export async function fetchKpCityRows(
  city: CityDef,
  store?: GtfsStopCoverageSource,
): Promise<RawVehicleRow[] | null> {
  const prefix = city.kpPrefix;
  if (!prefix) return null;

  const kpStops = await loadKpStops(prefix);
  if (!kpStops || kpStops.length === 0) return null;

  let effectiveStore = store;
  if (!effectiveStore) {
    const { gtfsStore } = await import('./routing/store');
    effectiveStore = gtfsStore;
  }

  const placeIds = selectKpHubStops(kpStops, effectiveStore);
  if (placeIds.length === 0) return [];

  interface CandidateTrip {
    execId: string;
    tripIndex: number;
    lineName: string;
    etaMin: number;
    timeDiffMin: number;
  }

  const byBrigade = new Map<string, CandidateTrip>();
  let anyDeparturesOk = false;

  for (let i = 0; i < placeIds.length; i += MAX_PLACES_PER_CALL) {
    const chunk = placeIds.slice(i, i + MAX_PLACES_PER_CALL);
    const url = `https://${prefix}.kiedyprzyjedzie.pl/api/departures?places=${chunk.map(encodeURIComponent).join(',')}`;
    const dep = await fetchJsonWithTimeout<KpDeparturesResponse>(url);
    if (!dep || !Array.isArray(dep.departures)) continue;
    anyDeparturesOk = true;

    for (const stopDep of dep.departures) {
      if (!Array.isArray(stopDep.rows)) continue;
      for (const row of stopDep.rows) {
        if (!row.is_estimated || row.canceled) continue;
        if (row.trip_execution_id == null || row.trip_index == null) continue;
        const etaMin = parseEtaMinutes(row.time);
        if (etaMin === null || etaMin > MAX_ETA_MIN) continue;

        const execId = String(row.trip_execution_id);
        const parts = execId.split(':');
        const brigadeKey = parts.length >= 3 ? parts.slice(0, -1).join(':') : execId;
        const prev = byBrigade.get(brigadeKey);
        if (!prev || etaMin < prev.etaMin) {
          byBrigade.set(brigadeKey, {
            execId,
            tripIndex: row.trip_index,
            lineName: (row.line_name || '').trim(),
            etaMin,
            timeDiffMin: typeof row.time_diff === 'number' && Number.isFinite(row.time_diff)
              ? row.time_diff
              : 0,
          });
        }
      }
    }
  }

  if (!anyDeparturesOk) return null;
  if (byBrigade.size === 0) return [];

  const candidates = [...byBrigade.values()];
  const fetched = await runPool(candidates, TRIP_EXEC_CONCURRENCY, async (c) => {
    const b64 = encodeURIComponent(encodeKpTripExecId(c.execId));
    const url = `https://${prefix}.kiedyprzyjedzie.pl/api/trip_execution/${b64}/${c.tripIndex}`;
    const te = await fetchJsonWithTimeout<KpTripExecutionResponse>(url);
    return { c, te };
  });

  const rows: RawVehicleRow[] = [];
  const seenCoords = new Set<string>();
  const nowMs = Date.now();

  for (const { c, te } of fetched) {
    const lat = te?.vehicle?.lat;
    const lon = te?.vehicle?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;

    const lineName = (te?.trip?.line?.name || c.lineName).trim();
    if (!lineName) continue;

    const coordKey = `${lineName}|${lat.toFixed(5)}|${lon.toFixed(5)}`;
    if (seenCoords.has(coordKey)) continue;
    seenCoords.add(coordKey);

    const type = te?.trip?.line?.type === 'tram' ? 'tram' : 'bus';
    const headsign = te?.trip?.direction?.trim() || undefined;
    const brigade = c.execId.split(':')[0] || undefined;

    const upcomingStops: { name: string; schedSec: number }[] = [];
    const times = te?.trip?.times;
    const estimates = te?.estimates;
    if (Array.isArray(times)) {
      let lastSec = 0;
      for (let idx = 0; idx < times.length && upcomingStops.length < 5; idx++) {
        if (Array.isArray(estimates) && estimates[idx] && estimates[idx]!.to_go == null) {
          continue;
        }
        const t = times[idx];
        const name = t?.stop_name?.trim();
        const schedSec = parseHhMmToSec(t?.departure_time, lastSec);
        if (name && schedSec !== null) {
          lastSec = schedSec;
          upcomingStops.push({ name, schedSec });
        }
      }
    }

    rows.push({
      name: lineName,
      type,
      x: lat,
      y: lon,
      k: c.execId,
      delaySec: Math.round(c.timeDiffMin * 60),
      timestamp: nowMs,
      headsign,
      brigade,
      upcomingStops: upcomingStops.length > 0 ? upcomingStops : undefined,
    });
  }

  return rows;
}

export function clearKpStopsCacheForTests(): void {
  stopsCache.clear();
}
