// Klient zbiorkom.live Open Data API (bez klucza):
// - miasto `pkp`, agencja `KD`: pozycje i opóźnienia pociągów KD,
// - miasto `wroclaw`: awaryjne pozycje autobusów i tramwajów, gdy
//   bezpośredni bus_position MPK nie odpowiada.
//
// Endpointy: GET /api6-open/{city}/positions/{bbox}[?agencies=..].
// Odpowiedź: { positions: [...] }, czasy w ms (epoch), współrzędne [lon, lat].

import { ZBIORKOM } from './gtfsConfig';
import { normalizeName } from './vehiclePosition';
import { gtfsStore, type DayIndex } from './routing/store';
import type { RawVehicleRow } from './liveTracker';

export interface ZbUpcomingStop {
  name: string;
  /** sekunda doby ze scheduledDeparture (awaryjnie scheduledArrival) */
  schedSec: number;
}

export interface ZbKdVehicle {
  id: string;
  /** numer pociągu (brygada) — u nas to route_short_name kursu KD */
  trainNumber: string;
  /** oznaczenie linii z API (D1, D30...), tylko informacyjnie */
  line: string;
  lat: number;
  lon: number;
  /** opóźnienie z API [s] */
  delaySec: number;
  updatedAt: number;
  currentStopName?: string;
  nextStopName?: string;
  stops: ZbUpcomingStop[];
}

interface ZbPositionJson {
  vehicle?: { id?: string; type?: string; agency?: string };
  routeName?: string;
  brigade?: string;
  location?: [number, number];
  timestamp?: number;
  delay?: number;
  headsign?: string;
  upcomingStops?: { name?: string; scheduledArrival?: number; scheduledDeparture?: number }[];
}

async function fetchPositions(city: string, agencies?: string): Promise<ZbPositionJson[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ZBIORKOM.timeoutMs);
  try {
    const url =
      `${ZBIORKOM.baseUrl}/api6-open/${city}/positions/${ZBIORKOM.wroclawBbox}` +
      (agencies ? `?agencies=${encodeURIComponent(agencies)}` : '');
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const parsed: unknown = await res.json();
    if (!parsed || typeof parsed !== 'object') return null;
    const arr = (parsed as { positions?: unknown }).positions;
    return Array.isArray(arr) ? (arr as ZbPositionJson[]) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pozycje MPK (wrocławskie autobusy i tramwaje) jako wiersze dla matchera
 * liveTrackera. Ten sam format co bus_position, więc dopasowanie do kursów,
 * rozwiązywanie konfliktów i RAPTOR działają bez zmian.
 */
export async function fetchZbWroclawRows(): Promise<RawVehicleRow[] | null> {
  const positions = await fetchPositions('wroclaw');
  if (positions === null) return null;
  const rows: RawVehicleRow[] = [];
  for (const p of positions) {
    const line = (p.routeName || '').trim();
    const loc = p.location;
    const id = (p.vehicle?.id || '').trim();
    if (!line || !id || !loc || loc.length < 2) continue;
    const lat = loc[1];
    const lon = loc[0];
    if (!lat || !lon) continue;
    rows.push({ name: line, type: p.vehicle?.type === '0' ? 'tram' : 'bus', x: lat, y: lon, k: id });
  }
  return rows;
}

/** Epoch ms → sekunda doby (ta sama konwencja co reszta trackera). */
function toSecOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

export async function fetchZbKd(): Promise<ZbKdVehicle[] | null> {
  const positions = await fetchPositions('pkp', 'KD');
  if (positions === null) return null;
  const out: ZbKdVehicle[] = [];
  for (const p of positions) {
    const trainNumber = (p.brigade || '').trim();
    const loc = p.location;
    if (!trainNumber || !loc || loc.length < 2) continue;
    const lat = loc[1];
    const lon = loc[0];
    if (!lat || !lon) continue;
    const stops: ZbUpcomingStop[] = [];
    for (const s of p.upcomingStops || []) {
      const name = (s.name || '').trim();
      const ms = s.scheduledDeparture ?? s.scheduledArrival;
      if (!name || ms == null) continue;
      stops.push({ name, schedSec: toSecOfDay(ms) });
    }
    out.push({
      id: (p.vehicle?.id || trainNumber).trim(),
      trainNumber: trainNumber.toUpperCase(),
      line: (p.routeName || '').trim().toUpperCase(),
      lat,
      lon,
      delaySec: Math.round((p.delay ?? 0) / 1000),
      updatedAt: p.timestamp ?? Date.now(),
      currentStopName: stops[0]?.name,
      nextStopName: stops[1]?.name,
      stops,
    });
  }
  return out;
}

export interface ZbKdMatch {
  tripId: string;
}

/**
 * Dopasowanie pociągu KD do lokalnego kursu. Identyfikatory tripów zbiorkom
 * i naszych (PDP) są różne, więc spinamy po numerze pociągu (brygada =
 * nasz route_short_name) + weryfikacja nazwami i czasami najbliższych
 * postojów. Bez weryfikacji czasowej sam numer to za mało: ten sam skład
 * potrafi jechać rano i wieczorem.
 */
export function matchZbKd(veh: ZbKdVehicle, dayIndex: DayIndex): ZbKdMatch | null {
  if (veh.stops.length === 0) return null;
  let routeIds: string[] = [];
  try {
    routeIds = gtfsStore.getRouteIdsByShortName(veh.trainNumber);
  } catch {
    return null;
  }
  if (routeIds.length === 0) return null;

  let bestTripId: string | null = null;
  let bestScore = -Infinity;

  for (const [, pattern] of dayIndex.patterns.entries()) {
    if (!routeIds.includes(pattern.routeId)) continue;
    const trips = pattern.trips as { trip_id: string }[];
    if (!trips || trips.length === 0) continue;
    for (const trip of trips) {
      const times = gtfsStore.stopTimes.get(trip.trip_id) as
        | { stop_id: string; departure_sec: number; arrival_sec: number }[]
        | undefined;
      if (!times || times.length === 0) continue;
      let matched = 0;
      let totalDiff = 0;
      for (const zb of veh.stops) {
        const want = normalizeName(zb.name);
        if (!want) continue;
        for (const t of times) {
          const stop = gtfsStore.stops.get(t.stop_id);
          const local = normalizeName(stop?.stop_name || '');
          if (!local || (!local.includes(want) && !want.includes(local))) continue;
          const localSec = t.departure_sec ?? t.arrival_sec;
          if (localSec == null) continue;
          const diff = Math.abs(localSec - zb.schedSec);
          if (diff > 600) continue;
          matched++;
          totalDiff += diff;
          break;
        }
      }
      if (matched === 0) continue;
      const score = matched * 1000 - totalDiff;
      if (score > bestScore) {
        bestScore = score;
        bestTripId = trip.trip_id;
      }
    }
  }
  return bestTripId ? { tripId: bestTripId } : null;
}
