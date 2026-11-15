// Wykrywanie pojazdu, którym jedzie użytkownik (na podstawie ruchu GPS i pozycji
// live pojazdów) oraz lista pobliskich pojazdów do ręcznego wyboru jako start.

import { bearingDegrees, distanceMeters } from '../gtfs/geo';
import type { GtfsStopTime } from '../gtfs/types';
import type { CurrentLocation } from './currentLocation';
import type { TrackedVehicle } from './liveTracker';
import { projectRoutePoint } from './routeGeometry';
import { classifyTransitMode } from './routing/raptor';
import { LocalGtfsStore, gtfsStore } from './routing/store';
import type { BoardedTripOrigin, LegMode } from '../types/models';

export const ONBOARD_MIN_SPEED_MPS = 4.0;
const MAX_LATERAL_M = 90;
const MAX_HEADING_DIFF_DEG = 50;
const LAG_BEHIND_M = 80;
const LAG_AHEAD_M = 480;
const MAX_ACCURACY_M = 65;

export interface OnboardCandidate {
  vehicle: TrackedVehicle;
  tripId: string;
  routeId?: string;
  line: string;
  mode: Exclude<LegMode, 'walk'>;
  direction: string;
  boardStopId?: string;
  nextStopName?: string;
  distanceM: number;
  lateralM: number;
  alongDeltaM: number;
  headingDiffDeg?: number;
  score: number;
  origin: BoardedTripOrigin;
}

export interface NearbyLiveVehicle {
  vehicle: TrackedVehicle;
  tripId?: string;
  routeId?: string;
  line: string;
  mode: Exclude<LegMode, 'walk'>;
  direction: string;
  boardStopId?: string;
  nextStopName?: string;
  distanceM: number;
  origin?: BoardedTripOrigin;
}

function angularDiffDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

interface TripPolylineCache {
  coords: [number, number][];
  stopIds: string[];
  stopNames: string[];
  cumDist: number[];
}

interface CachedTripEntry {
  timesRef: GtfsStopTime[];
  poly: TripPolylineCache | null;
}

const tripPolylineCache = new WeakMap<LocalGtfsStore, Map<string, CachedTripEntry>>();

function buildTripPolyline(tripId: string, store: LocalGtfsStore): TripPolylineCache | null {
  const times = store.stopTimes.get(tripId);
  if (!times || times.length < 2) return null;

  let storeCache = tripPolylineCache.get(store);
  if (!storeCache) {
    storeCache = new Map();
    tripPolylineCache.set(store, storeCache);
  }
  const existing = storeCache.get(tripId);
  if (existing && existing.timesRef === times) {
    return existing.poly;
  }

  const coords: [number, number][] = [];
  const stopIds: string[] = [];
  const stopNames: string[] = [];
  const cumDist: number[] = [];
  for (const st of times) {
    const stop = store.stops.get(st.stop_id);
    if (!stop || !Number.isFinite(stop.stop_lat) || !Number.isFinite(stop.stop_lon)) continue;
    const prev = coords[coords.length - 1];
    const d = prev ? distanceMeters(prev[0], prev[1], stop.stop_lat, stop.stop_lon) : 0;
    cumDist.push((cumDist[cumDist.length - 1] ?? 0) + d);
    coords.push([stop.stop_lat, stop.stop_lon]);
    stopIds.push(stop.stop_id);
    stopNames.push(stop.stop_name || stop.stop_id);
  }
  const poly = coords.length >= 2 ? { coords, stopIds, stopNames, cumDist } : null;
  storeCache.set(tripId, { timesRef: times, poly });
  return poly;
}

function resolveMode(
  vehicle: TrackedVehicle,
  tripId: string | undefined,
  store: LocalGtfsStore,
): Exclude<LegMode, 'walk'> {
  if (tripId) {
    const trip = store.trips.get(tripId);
    const route = trip ? store.routes.get(trip.route_id) : undefined;
    if (route) return classifyTransitMode(route.route_type, vehicle.line || route.route_short_name);
  }
  return vehicle.type;
}

function resolveStopContext(
  poly: TripPolylineCache | null,
  alongM: number | null,
  fallbackNext?: string,
): { boardStopId?: string; nextStopName?: string } {
  if (!poly || alongM === null) {
    return { nextStopName: fallbackNext };
  }
  let boardIdx = 0;
  for (let i = 0; i < poly.cumDist.length - 1; i++) {
    if (poly.cumDist[i] <= alongM + 35) boardIdx = i;
  }
  const nextIdx = Math.min(poly.stopNames.length - 1, boardIdx + 1);
  return {
    boardStopId: poly.stopIds[boardIdx],
    nextStopName: fallbackNext || poly.stopNames[nextIdx],
  };
}

function localSegmentBearing(poly: TripPolylineCache, alongM: number): number | null {
  for (let i = 0; i < poly.cumDist.length - 1; i++) {
    if (alongM <= poly.cumDist[i + 1] || i === poly.cumDist.length - 2) {
      const a = poly.coords[i];
      const b = poly.coords[i + 1];
      if (distanceMeters(a[0], a[1], b[0], b[1]) < 5) continue;
      return bearingDegrees(a[0], a[1], b[0], b[1]);
    }
  }
  for (let i = poly.cumDist.length - 2; i >= 0; i--) {
    const a = poly.coords[i];
    const b = poly.coords[i + 1];
    if (distanceMeters(a[0], a[1], b[0], b[1]) >= 5) {
      return bearingDegrees(a[0], a[1], b[0], b[1]);
    }
  }
  return null;
}

function normStopHint(name?: string): string {
  return (name ?? '').trim().toLowerCase();
}

/**
 * Zwraca kierunek jazdy pojazdu na podstawie geometrii dopasowanego kursu GTFS (stopnie 0-360),
 * lub `undefined`, gdy kurs nie ma dopasowanej trasy w bazie. Uwzglednia `nextStopName`
 * przy petlach i odcinkach dwukierunkowych.
 */
export function resolveVehicleBearing(
  vehicle: TrackedVehicle,
  store: LocalGtfsStore = gtfsStore,
): number | undefined {
  const tripId = vehicle.matchedTripId;
  if (!tripId) return undefined;
  const poly = buildTripPolyline(tripId, store);
  if (!poly) return undefined;

  const nextHint = normStopHint(vehicle.nextStopName);
  if (nextHint) {
    let bestIdx = -1;
    let bestOffset = Infinity;
    for (let i = 0; i < poly.stopNames.length; i++) {
      const sName = normStopHint(poly.stopNames[i]);
      if (!sName || (sName !== nextHint && !sName.includes(nextHint) && !nextHint.includes(sName))) {
        continue;
      }
      const a = i > 0 ? poly.coords[i - 1] : poly.coords[0];
      const b = i > 0 ? poly.coords[i] : poly.coords[1];
      if (!a || !b || distanceMeters(a[0], a[1], b[0], b[1]) < 5) continue;
      const segProj = projectRoutePoint([a, b], vehicle.lat, vehicle.lon);
      if (!segProj || segProj.offsetM > 550) continue;
      const score = segProj.offsetM + (i === 0 ? 200 : 0);
      if (score < bestOffset) {
        bestOffset = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const a = bestIdx > 0 ? poly.coords[bestIdx - 1] : poly.coords[0];
      const b = bestIdx > 0 ? poly.coords[bestIdx] : poly.coords[1];
      return Math.round(bearingDegrees(a[0], a[1], b[0], b[1])) % 360;
    }
  }

  const proj = projectRoutePoint(poly.coords, vehicle.lat, vehicle.lon);
  if (!proj) return undefined;
  const deg = localSegmentBearing(poly, proj.alongM);
  return deg === null ? undefined : Math.round(deg) % 360;
}

/**
 * Zwraca do 3 najbardziej prawdopodobnych pojazdów, którymi jedzie użytkownik
 * na podstawie prędkości GPS, kierunku jazdy i projekcji na trasę kursu.
 */
export function detectBoardedVehicles(
  location: CurrentLocation | null | undefined,
  vehicles: readonly TrackedVehicle[],
  store: LocalGtfsStore = gtfsStore,
  options?: { maxCandidates?: number; minSpeedMps?: number },
): OnboardCandidate[] {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return [];
  const minSpeed = options?.minSpeedMps ?? ONBOARD_MIN_SPEED_MPS;
  if (location.speed === null || !Number.isFinite(location.speed) || location.speed < minSpeed) {
    return [];
  }
  if (
    location.accuracy !== null &&
    Number.isFinite(location.accuracy) &&
    location.accuracy > MAX_ACCURACY_M
  ) {
    return [];
  }

  const maxCandidates = options?.maxCandidates ?? 3;
  const userHeading =
    location.heading !== null && Number.isFinite(location.heading) && location.heading >= 0
      ? location.heading
      : null;

  const candidates: OnboardCandidate[] = [];

  for (const v of vehicles) {
    const tripId = v.matchedTripId;
    if (!tripId) continue;
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
    const directDist = distanceMeters(location.lat, location.lon, v.lat, v.lon);
    if (directDist > 850) continue;

    const poly = buildTripPolyline(tripId, store);
    if (!poly) continue;

    const userProj = projectRoutePoint(poly.coords, location.lat, location.lon);
    if (!userProj || userProj.offsetM > MAX_LATERAL_M) continue;

    const vehProj = projectRoutePoint(poly.coords, v.lat, v.lon);
    if (!vehProj || vehProj.offsetM > 180) continue;

    const alongDeltaM = userProj.alongM - vehProj.alongM;
    if (alongDeltaM < -LAG_BEHIND_M || alongDeltaM > LAG_AHEAD_M) continue;

    let headingDiffDeg: number | undefined;
    if (userHeading !== null) {
      const segBearing = localSegmentBearing(poly, userProj.alongM);
      if (segBearing !== null) {
        headingDiffDeg = angularDiffDeg(userHeading, segBearing);
        if (headingDiffDeg > MAX_HEADING_DIFF_DEG) continue;
      }
    }

    const trip = store.trips.get(tripId);
    const mode = resolveMode(v, tripId, store);
    const direction = trip?.trip_headsign || v.nextStopName || '';
    const stopCtx = resolveStopContext(poly, userProj.alongM, v.nextStopName);

    // Im mniejsze odchylenie boczne, różnica kierunku i umiarkowany lag do przodu, tym lepszy wynik.
    const lagPenalty = alongDeltaM >= 0 ? alongDeltaM * 0.12 : Math.abs(alongDeltaM) * 0.45;
    const headingPenalty = (headingDiffDeg ?? 15) * 0.8;
    const score = userProj.offsetM * 1.6 + lagPenalty + headingPenalty;

    candidates.push({
      vehicle: v,
      tripId,
      routeId: trip?.route_id,
      line: v.line,
      mode,
      direction,
      boardStopId: stopCtx.boardStopId,
      nextStopName: stopCtx.nextStopName,
      distanceM: Math.round(directDist),
      lateralM: Math.round(userProj.offsetM),
      alongDeltaM: Math.round(alongDeltaM),
      headingDiffDeg: headingDiffDeg !== undefined ? Math.round(headingDiffDeg) : undefined,
      score,
      origin: {
        tripId,
        routeId: trip?.route_id,
        line: v.line,
        mode,
        direction: direction || undefined,
        boardStopId: stopCtx.boardStopId,
        currentLat: location.lat,
        currentLon: location.lon,
        delaySec: v.delaySec ?? undefined,
      },
    });
  }

  candidates.sort((a, b) => a.score - b.score || a.distanceM - b.distanceM);

  // Jedna propozycja na linię+kierunek, żeby nie dublować tej samej linii.
  const out: OnboardCandidate[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = `${c.line}|${c.direction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= maxCandidates) break;
  }
  return out;
}

/**
 * Zwraca najbliższe aktywne pojazdy w okolicy podanej pozycji do ręcznego wyboru
 * jako punkt startowy podróży (np. z wyszukiwarki lub mapy live).
 */
export function findNearbyLiveVehicles(
  lat: number,
  lon: number,
  vehicles: readonly TrackedVehicle[],
  store: LocalGtfsStore = gtfsStore,
  maxDistM = 1200,
  limit = 12,
): NearbyLiveVehicle[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const list: NearbyLiveVehicle[] = [];

  for (const v of vehicles) {
    const tripId = v.matchedTripId;
    if (!tripId) continue;
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
    const d = Math.round(distanceMeters(lat, lon, v.lat, v.lon));
    if (d > maxDistM) continue;
    const poly = buildTripPolyline(tripId, store);
    if (!poly) continue;
    const proj = projectRoutePoint(poly.coords, v.lat, v.lon);
    const trip = store.trips.get(tripId);
    const mode = resolveMode(v, tripId, store);
    const direction = trip?.trip_headsign || v.nextStopName || '';
    const stopCtx = resolveStopContext(poly, proj ? proj.alongM : null, v.nextStopName);

    list.push({
      vehicle: v,
      tripId,
      routeId: trip?.route_id,
      line: v.line,
      mode,
      direction,
      boardStopId: stopCtx.boardStopId,
      nextStopName: stopCtx.nextStopName,
      distanceM: d,
      origin: {
        tripId,
        routeId: trip?.route_id,
        line: v.line,
        mode,
        direction: direction || undefined,
        boardStopId: stopCtx.boardStopId,
        currentLat: v.lat,
        currentLon: v.lon,
        delaySec: v.delaySec ?? undefined,
      },
    });
  }

  list.sort((a, b) => a.distanceM - b.distanceM);
  return list.slice(0, limit);
}

/**
 * Buduje `BoardedTripOrigin` dla pojazdu wskazanego ręcznie (np. z mapy live).
 * Zwraca null, jeśli pojazd nie ma jeszcze dopasowanego kursu GTFS w bazie.
 */
export function buildBoardedOriginFromVehicle(
  vehicle: TrackedVehicle,
  store: LocalGtfsStore = gtfsStore,
): BoardedTripOrigin | null {
  const tripId = vehicle.matchedTripId;
  if (!tripId) return null;
  const poly = buildTripPolyline(tripId, store);
  if (!poly) return null;
  const proj = projectRoutePoint(poly.coords, vehicle.lat, vehicle.lon);
  const trip = store.trips.get(tripId);
  const mode = resolveMode(vehicle, tripId, store);
  const direction = trip?.trip_headsign || vehicle.nextStopName || undefined;
  const stopCtx = resolveStopContext(poly, proj ? proj.alongM : null, vehicle.nextStopName);
  return {
    tripId,
    routeId: trip?.route_id,
    line: vehicle.line,
    mode,
    direction,
    boardStopId: stopCtx.boardStopId,
    currentLat: vehicle.lat,
    currentLon: vehicle.lon,
    delaySec: vehicle.delaySec ?? undefined,
  };
}
