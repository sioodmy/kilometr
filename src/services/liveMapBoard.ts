// Logika mapy live w stylu zbiorkom.live:
// - spójna tożsamość kolorów z LineBadge o wysokim kontraście WCAG AA,
// - budowa warstwy przystanków z kierunkiem odjazdu (strzałka z geometrii linii),
// - tablice odjazdów, kolejne przystanki oraz przebieg trasy wybranego pojazdu.

import { bearingDegrees, distanceMeters, shiftWarsawDate, warsawNow } from '../gtfs/geo';
import { isFareBoundary } from '../gtfs/fareBoundary';
import { inferTransitMode, mapLineColor, resolveLineBadgeIdentity } from './lineIdentity';
import type { TrackedVehicle } from './liveTracker';
import { projectRoutePoint } from './routeGeometry';
import { classifyTransitMode, mergeDayIndexes } from './routing/raptor';
import { gtfsStore, type DayIndex, type LocalGtfsStore } from './routing/store';
import type { LiveMapStopItem } from '../map/liveVehiclesMapDocument';
import type { LegMode } from '../types/models';

export interface StopDepartureItem {
  tripId: string;
  routeId: string;
  line: string;
  mode: Exclude<LegMode, 'walk'>;
  bg: string;
  fg: string;
  headsign: string;
  scheduledSec: number;
  expectedSec: number;
  delayMin: number | null;
  live: boolean;
  vehicleId?: string;
}

export interface VehicleStopEta {
  stopId: string;
  stopName: string;
  stopCode?: string;
  scheduledSec: number;
  expectedSec: number;
  delayMin: number | null;
  isNext: boolean;
}

export interface LiveVehicleRouteStop {
  stopId: string;
  stopName: string;
  lat: number;
  lon: number;
  passed: boolean;
  isNext: boolean;
}

export interface LiveVehicleRoute {
  tripId?: string;
  mode: Exclude<LegMode, 'walk'>;
  line: string;
  color: string;
  coords: [number, number][];
  stops: LiveVehicleRouteStop[];
}

export interface LiveMapScheduleContext {
  dayIndex: DayIndex;
  offsets?: Map<string, number>;
  nowSec: number;
}

const MODE_PRIORITY: Record<Exclude<LegMode, 'walk'>, number> = {
  train: 4,
  subway: 4,
  cable: 3,
  tram: 2,
  trolleybus: 1,
  bus: 1,
};

/**
 * Kolory pojazdów i przystanków na mapie na żywo współdzielone z LineBadge.
 * Każde tło ma gwarancję kontrastu >= 4.5:1 z wyznaczonym tekstem `fg`.
 */
export function getLiveMapModeColors(
  mode: Exclude<LegMode, 'walk'>,
  line: string | undefined,
  cityId: string,
): { bg: string; fg: string } {
  const { bg, fg } = resolveLineBadgeIdentity({ mode, line, cityId });
  return { bg, fg };
}

/**
 * Ładuje wycinek rozkładu na bieżące okno czasowe mapy live (z obsługą
 * kursów nocnych po północy).
 */
export async function loadLiveMapSchedule(
  store: LocalGtfsStore = gtfsStore,
  now: Date = new Date(),
): Promise<LiveMapScheduleContext | null> {
  if (!store.isLoaded) {
    await store.load();
  }
  if (!store.isLoaded) return null;

  const nowWarsaw = warsawNow(now);
  const nowSec = nowWarsaw.sec;
  const dayIndex = await store.getDayIndexSlice(
    nowWarsaw.weekday,
    nowWarsaw.dateStr,
    nowSec - 1800,
    nowSec + 7200,
  );
  if (nowSec >= 7 * 3600) {
    return { dayIndex, nowSec };
  }
  const prevWarsaw = shiftWarsawDate(nowWarsaw, -1);
  const overnight = await store.getDayIndexSlice(
    prevWarsaw.weekday,
    prevWarsaw.dateStr,
    86400 + nowSec - 1800,
    86400 + nowSec + 7200,
  );
  const merged = mergeDayIndexes(dayIndex, overnight, 'y_', -86400);
  return { dayIndex: merged.index, offsets: merged.offsets, nowSec };
}

/**
 * Buduje listę przystanków do rysowania na mapie na żywo wraz z typem
 * dominującego środka transportu i kierunkiem odjazdów (jeśli słupki są kierunkowe).
 */
export function buildLiveMapStops(
  store: LocalGtfsStore,
  dayIndex: DayIndex | null,
  cityId: string,
): LiveMapStopItem[] {
  const modeByStop = new Map<string, Exclude<LegMode, 'walk'>>();
  const vecByStop = new Map<string, { sinSum: number; cosSum: number; count: number }>();

  if (dayIndex) {
    for (const pattern of dayIndex.patterns.values()) {
      const route = store.routes.get(pattern.routeId);
      const rawMode = route
        ? classifyTransitMode(route.route_type, route.route_short_name)
        : 'bus';
      const inferred = inferTransitMode(rawMode, route?.route_short_name, cityId);
      const mode: Exclude<LegMode, 'walk'> = inferred === 'walk' ? 'bus' : inferred;
      const prio = MODE_PRIORITY[mode] ?? 1;

      const seq = pattern.stopSequence;
      for (let i = 0; i < seq.length; i++) {
        const stopId = seq[i];
        const currentMode = modeByStop.get(stopId);
        if (!currentMode || prio > (MODE_PRIORITY[currentMode] ?? 0)) {
          modeByStop.set(stopId, mode);
        }

        if (i < seq.length - 1) {
          const s1 = store.stops.get(stopId);
          const s2 = store.stops.get(seq[i + 1]);
          if (
            s1 &&
            s2 &&
            Number.isFinite(s1.stop_lat) &&
            Number.isFinite(s1.stop_lon) &&
            Number.isFinite(s2.stop_lat) &&
            Number.isFinite(s2.stop_lon) &&
            distanceMeters(s1.stop_lat, s1.stop_lon, s2.stop_lat, s2.stop_lon) >= 12
          ) {
            const deg = bearingDegrees(s1.stop_lat, s1.stop_lon, s2.stop_lat, s2.stop_lon);
            const rad = (deg * Math.PI) / 180;
            const acc = vecByStop.get(stopId) ?? { sinSum: 0, cosSum: 0, count: 0 };
            acc.sinSum += Math.sin(rad);
            acc.cosSum += Math.cos(rad);
            acc.count += 1;
            vecByStop.set(stopId, acc);
          }
        }
      }
    }
  }

  const out: LiveMapStopItem[] = [];
  for (const stop of store.stops.values()) {
    if (!Number.isFinite(stop.stop_lat) || !Number.isFinite(stop.stop_lon)) continue;
    const name = (stop.stop_name || '').trim();
    if (!name || isFareBoundary(name)) continue;

    const mode = modeByStop.get(stop.stop_id) ?? 'bus';
    const vec = vecByStop.get(stop.stop_id);
    let bearing: number | undefined;
    if (vec && vec.count > 0) {
      const len = Math.hypot(vec.sinSum, vec.cosSum) / vec.count;
      if (len >= 0.68) {
        const angle = (Math.atan2(vec.sinSum, vec.cosSum) * 180) / Math.PI;
        bearing = Math.round(((angle % 360) + 360) % 360);
      }
    }

    const { bg, fg } = getLiveMapModeColors(mode, undefined, cityId);
    out.push({
      id: stop.stop_id,
      name,
      code: stop.stop_code?.trim() || undefined,
      lat: stop.stop_lat,
      lon: stop.stop_lon,
      mode,
      bg,
      fg,
      bearing,
    });
  }
  return out;
}

/**
 * Zwraca najbliższe odjazdy z wybranego przystanku w horyzoncie 3 godzin,
 * połączone z danymi live (opóźnienia i dopasowane pojazdy).
 */
export function getStopDepartureBoard(
  stopId: string,
  store: LocalGtfsStore,
  dayIndex: DayIndex | null,
  offsets: Map<string, number> | undefined,
  vehicles: readonly TrackedVehicle[],
  tripDelays: Map<string, number> | undefined,
  nowSec: number,
  cityId: string,
  limit = 20,
): StopDepartureItem[] {
  if (!dayIndex || !stopId) return [];
  const patternIds = dayIndex.stopRoutes.get(stopId);
  if (!patternIds || patternIds.size === 0) return [];

  const vehicleByTrip = new Map<string, TrackedVehicle>();
  for (const v of vehicles) {
    if (v.matchedTripId) {
      vehicleByTrip.set(v.matchedTripId, v);
    }
  }

  const seenTrips = new Set<string>();
  const items: StopDepartureItem[] = [];
  const minSec = nowSec - 60;
  const maxSec = nowSec + 3 * 3600;

  for (const patternId of patternIds) {
    const pattern = dayIndex.patterns.get(patternId);
    if (!pattern) continue;
    const offset = offsets?.get(patternId) ?? 0;
    const route = store.routes.get(pattern.routeId);
    const line = (route?.route_short_name || route?.route_long_name || '?').trim();
    const rawMode = route
      ? classifyTransitMode(route.route_type, route.route_short_name)
      : 'bus';
    const inferred = inferTransitMode(rawMode, line, cityId);
    const mode: Exclude<LegMode, 'walk'> = inferred === 'walk' ? 'bus' : inferred;
    const { bg, fg } = getLiveMapModeColors(mode, line, cityId);

    for (let sIdx = 0; sIdx < pattern.stopSequence.length - 1; sIdx++) {
      if (pattern.stopSequence[sIdx] !== stopId) continue;
      const deps = pattern.departures[sIdx];
      const tIndices = pattern.tripIndices[sIdx];
      if (!deps || !tIndices) continue;

      for (let k = 0; k < deps.length; k++) {
        const trip = pattern.trips[tIndices[k]];
        if (!trip || seenTrips.has(trip.trip_id)) continue;

        const scheduledSec = deps[k] + offset;
        const veh = vehicleByTrip.get(trip.trip_id);
        const delaySec =
          veh?.delaySec ?? (tripDelays?.has(trip.trip_id) ? tripDelays.get(trip.trip_id)! : null);
        const expectedSec = scheduledSec + (delaySec ?? 0);
        if (expectedSec < minSec || expectedSec > maxSec) continue;

        seenTrips.add(trip.trip_id);
        const lastStopId = pattern.stopSequence[pattern.stopSequence.length - 1];
        const headsign =
          trip.trip_headsign?.trim() ||
          store.stops.get(lastStopId)?.stop_name?.trim() ||
          line;

        items.push({
          tripId: trip.trip_id,
          routeId: pattern.routeId,
          line,
          mode,
          bg,
          fg,
          headsign,
          scheduledSec,
          expectedSec,
          delayMin: delaySec != null ? Math.round(delaySec / 60) : null,
          live: Boolean(veh || (tripDelays && tripDelays.has(trip.trip_id))),
          vehicleId: veh?.vehicleId,
        });
      }
    }
  }

  items.sort((a, b) => a.expectedSec - b.expectedSec);
  return items.slice(0, limit);
}

/**
 * Zwraca kolejne przystanki wraz z prognozowanym czasem odjazdu/przyjazdu
 * dla wybranego pojazdu na podstawie jego dopasowanego kursu GTFS i opóźnienia.
 */
export function getVehicleUpcomingBoard(
  vehicle: TrackedVehicle,
  store: LocalGtfsStore,
  nowSec: number,
): VehicleStopEta[] {
  const tripId = vehicle.matchedTripId;
  if (!tripId) return [];
  const times = store.stopTimes.get(tripId);
  if (!times || times.length === 0) return [];

  const offset =
    nowSec < 7 * 3600 && times[times.length - 1].departure_sec >= 24 * 3600 ? -86400 : 0;

  const coords: [number, number][] = [];
  const timeIdxByCoord: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const s = store.stops.get(times[i].stop_id);
    if (!s || !Number.isFinite(s.stop_lat) || !Number.isFinite(s.stop_lon)) continue;
    coords.push([s.stop_lat, s.stop_lon]);
    timeIdxByCoord.push(i);
  }

  let startTimeIdx = 0;
  if (coords.length >= 2) {
    const cumDist: number[] = [0];
    for (let i = 1; i < coords.length; i++) {
      cumDist.push(
        cumDist[i - 1] + distanceMeters(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]),
      );
    }
    const proj = projectRoutePoint(coords, vehicle.lat, vehicle.lon);
    if (proj) {
      let passedCoordIdx = 0;
      for (let i = 0; i < cumDist.length - 1; i++) {
        if (cumDist[i] <= proj.alongM + 35) passedCoordIdx = i;
      }
      const nextCoordIdx =
        passedCoordIdx === 0 && proj.alongM < 30
          ? 0
          : Math.min(coords.length - 1, passedCoordIdx + 1);
      startTimeIdx = timeIdxByCoord[nextCoordIdx] ?? 0;
    }
  }

  const delaySec = vehicle.delaySec ?? 0;
  const delayMin = vehicle.delaySec != null ? Math.round(vehicle.delaySec / 60) : null;
  const out: VehicleStopEta[] = [];

  for (let i = startTimeIdx; i < times.length; i++) {
    const st = times[i];
    const stop = store.stops.get(st.stop_id);
    if (!stop) continue;
    const rawSec = i === times.length - 1 ? st.arrival_sec : st.departure_sec;
    const scheduledSec = rawSec + offset;
    out.push({
      stopId: st.stop_id,
      stopName: stop.stop_name || st.stop_id,
      stopCode: stop.stop_code?.trim() || undefined,
      scheduledSec,
      expectedSec: scheduledSec + delaySec,
      delayMin,
      isNext: out.length === 0,
    });
  }
  return out;
}

function buildRouteStopsWithProgress(
  rawStops: Array<{ stopId: string; stopName: string; lat: number; lon: number }>,
  vehicleLat: number,
  vehicleLon: number,
): LiveVehicleRouteStop[] {
  const coords: [number, number][] = rawStops.map((s) => [s.lat, s.lon]);
  let nextIdx = 0;
  if (coords.length >= 2) {
    const cumDist: number[] = [0];
    for (let i = 1; i < coords.length; i++) {
      cumDist.push(
        cumDist[i - 1] + distanceMeters(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]),
      );
    }
    const proj = projectRoutePoint(coords, vehicleLat, vehicleLon);
    if (proj) {
      let passedCoordIdx = 0;
      for (let i = 0; i < cumDist.length - 1; i++) {
        if (cumDist[i] <= proj.alongM + 35) passedCoordIdx = i;
      }
      nextIdx =
        passedCoordIdx === 0 && proj.alongM < 30
          ? 0
          : Math.min(coords.length - 1, passedCoordIdx + 1);
    }
  }

  return rawStops.map((s, idx) => ({
    stopId: s.stopId,
    stopName: s.stopName,
    lat: s.lat,
    lon: s.lon,
    passed: idx < nextIdx,
    isNext: idx === nextIdx,
  }));
}

function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Buduje trasę i przystanki wybranego pojazdu z lokalnego GTFS (kurs dopasowany
 * lub najbliższy wariant linii z aktywnego rozkładu).
 */
export function buildSelectedVehicleRoute(
  vehicle: TrackedVehicle,
  store: LocalGtfsStore,
  dayIndex: DayIndex | null,
  cityId: string,
  bearing?: number,
): LiveVehicleRoute | null {
  const identity = resolveLineBadgeIdentity({ mode: vehicle.type, line: vehicle.line, cityId });
  const resolvedMode: Exclude<LegMode, 'walk'> =
    identity.resolvedMode === 'walk' ? vehicle.type : identity.resolvedMode;
  const line = identity.normalizedLine || vehicle.line || '?';
  const color = mapLineColor(identity.bg);

  let stopIds: string[] | null = null;
  let tripId = vehicle.matchedTripId;

  if (tripId) {
    const times = store.stopTimes.get(tripId);
    if (times && times.length >= 2) {
      stopIds = times.map((t) => t.stop_id);
    }
  }

  if (!stopIds && dayIndex && vehicle.line) {
    const targetLine = vehicle.line.trim().toUpperCase();
    const targetNorm = line.trim().toUpperCase();
    const nextHint = vehicle.nextStopName?.trim().toLowerCase();
    let bestScore = Infinity;

    for (const pattern of dayIndex.patterns.values()) {
      const route = store.routes.get(pattern.routeId);
      const rLine = (route?.route_short_name || '').trim().toUpperCase();
      if (!rLine || (rLine !== targetLine && rLine !== targetNorm)) continue;
      if (pattern.stopSequence.length < 2) continue;

      const coords: [number, number][] = [];
      for (const sid of pattern.stopSequence) {
        const st = store.stops.get(sid);
        if (st && Number.isFinite(st.stop_lat) && Number.isFinite(st.stop_lon)) {
          coords.push([st.stop_lat, st.stop_lon]);
        }
      }
      if (coords.length < 2) continue;
      const proj = projectRoutePoint(coords, vehicle.lat, vehicle.lon);
      if (!proj || proj.offsetM > 400) continue;

      let score = proj.offsetM;
      if (typeof bearing === 'number' && Number.isFinite(bearing)) {
        const diff = angleDiffDeg(bearing, proj.heading);
        if (diff > 105) continue;
        score += diff * 1.5;
      }
      if (nextHint) {
        const hasNext = pattern.stopSequence.some((sid) =>
          (store.stops.get(sid)?.stop_name || '').toLowerCase().includes(nextHint),
        );
        if (hasNext) score -= 80;
      }
      if (score < bestScore) {
        bestScore = score;
        stopIds = pattern.stopSequence;
        tripId = pattern.trips[0]?.trip_id;
      }
    }
  }

  if (!stopIds || stopIds.length < 2) return null;

  const rawStops: Array<{ stopId: string; stopName: string; lat: number; lon: number }> = [];
  for (const sid of stopIds) {
    const stop = store.stops.get(sid);
    if (!stop || !Number.isFinite(stop.stop_lat) || !Number.isFinite(stop.stop_lon)) continue;
    const stopName = (stop.stop_name || '').trim();
    if (!stopName || isFareBoundary(stopName)) continue;
    rawStops.push({ stopId: stop.stop_id, stopName, lat: stop.stop_lat, lon: stop.stop_lon });
  }
  if (rawStops.length < 2) return null;

  const stops = buildRouteStopsWithProgress(rawStops, vehicle.lat, vehicle.lon);
  return {
    tripId,
    mode: resolvedMode,
    line,
    color,
    coords: stops.map((s) => [s.lat, s.lon]),
    stops,
  };
}

/**
 * Rozwiązuje trasę oraz tablicę kolejnych stacji dla pociągów krajowych (PLK/Polska DB),
 * gdy kurs nie występuje w lokalnym rozkładzie miejskim.
 */
export async function resolveNationalTrainVehicleRoute(
  vehicle: TrackedVehicle,
  cityId: string,
  nowSec: number,
  signal?: AbortSignal,
): Promise<{ route: LiveVehicleRoute; upcoming: VehicleStopEta[] } | null> {
  if (signal?.aborted) return null;
  const identity = resolveLineBadgeIdentity({ mode: vehicle.type, line: vehicle.line, cityId });
  if (identity.resolvedMode !== 'train') return null;

  try {
    const { getNationalDb } = await import('./gtfsDatabase');
    const db = await getNationalDb();
    if (signal?.aborted) return null;

    let tripId: string | null = null;
    let shapeId: string | null = null;

    if (vehicle.matchedTripId) {
      const cleanId = vehicle.matchedTripId.replace(/^pl:/, '');
      const row = await db.getFirstAsync<{ trip_id: string; shape: string }>(
        'SELECT trip_id, shape FROM trips WHERE trip_id = ? OR trip_id = ? OR trip_id = ? LIMIT 1',
        vehicle.matchedTripId,
        cleanId,
        `pl:${cleanId}`,
      );
      if (row) {
        tripId = row.trip_id;
        shapeId = row.shape ? row.shape.replace(/^pl:/, '') : null;
      }
    }

    if (!tripId) {
      const numMatch = `${vehicle.line} ${vehicle.vehicleId}`.match(/\b(\d{3,6}(?:\/\d+)?)\b/);
      if (numMatch) {
        const candidates = await db.getAllAsync<{ trip_id: string; shape: string }>(
          'SELECT trip_id, shape FROM trips WHERE train_number = ? OR train_number LIKE ? LIMIT 12',
          numMatch[1],
          `${numMatch[1]}/%`,
        );
        const nextHint = vehicle.nextStopName?.trim().toLowerCase();
        const curHint = vehicle.currentStopName?.trim().toLowerCase();
        let bestScore = Infinity;
        for (const cand of candidates) {
          if (signal?.aborted) return null;
          const stRows = await db.getAllAsync<{ name: string; lat: number; lon: number }>(
            'SELECT s.name, s.lat, s.lon FROM stop_times st JOIN stops s ON s.stop_id = st.stop_id WHERE st.trip_id = ? ORDER BY st.seq',
            cand.trip_id,
          );
          if (stRows.length < 2) continue;
          const proj = projectRoutePoint(
            stRows.map((r) => [r.lat, r.lon] as [number, number]),
            vehicle.lat,
            vehicle.lon,
          );
          if (!proj || proj.offsetM > 15000) continue;
          let score = proj.offsetM;
          if (nextHint && stRows.some((r) => r.name.toLowerCase().includes(nextHint))) {
            score -= 2000;
          }
          if (curHint && stRows.some((r) => r.name.toLowerCase().includes(curHint))) {
            score -= 1000;
          }
          if (cand.shape) score -= 200;
          if (score < bestScore) {
            bestScore = score;
            tripId = cand.trip_id;
            shapeId = cand.shape ? cand.shape.replace(/^pl:/, '') : null;
          }
        }
      }
    }

    if (!tripId || signal?.aborted) return null;

    const rows = await db.getAllAsync<{
      stop_id: string;
      name: string;
      lat: number;
      lon: number;
      arrival_sec: number;
      departure_sec: number;
    }>(
      `SELECT st.stop_id, s.name, s.lat, s.lon, st.arr_sec AS arrival_sec, st.dep_sec AS departure_sec
       FROM stop_times st
       JOIN stops s ON s.stop_id = st.stop_id
       WHERE st.trip_id = ?
       ORDER BY st.seq`,
      tripId,
    );
    if (rows.length < 2 || signal?.aborted) return null;

    const rawStops = rows
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon) && r.name)
      .map((r) => ({
        stopId: `pl:${r.stop_id}`,
        stopName: r.name,
        lat: r.lat,
        lon: r.lon,
      }));
    if (rawStops.length < 2) return null;

    const stops = buildRouteStopsWithProgress(rawStops, vehicle.lat, vehicle.lon);
    const nextIdx = Math.max(
      0,
      stops.findIndex((s) => s.isNext),
    );
    const delaySec = vehicle.delaySec ?? 0;
    const delayMin = vehicle.delaySec != null ? Math.round(vehicle.delaySec / 60) : null;
    const lastDep = rows[rows.length - 1]?.departure_sec ?? 0;
    const offset = nowSec < 7 * 3600 && lastDep >= 24 * 3600 ? -86400 : 0;

    const upcoming: VehicleStopEta[] = [];
    for (let i = nextIdx; i < rows.length; i++) {
      const r = rows[i];
      const rawSec = i === rows.length - 1 ? r.arrival_sec : r.departure_sec;
      const scheduledSec = rawSec + offset;
      upcoming.push({
        stopId: `pl:${r.stop_id}`,
        stopName: r.name,
        scheduledSec,
        expectedSec: scheduledSec + delaySec,
        delayMin,
        isNext: upcoming.length === 0,
      });
    }

    const line = identity.normalizedLine || vehicle.line || '?';
    const color = mapLineColor(identity.bg);
    let coords: [number, number][] = stops.map((s) => [s.lat, s.lon]);

    const fullTripId = tripId.startsWith('pl:') ? tripId : `pl:${tripId}`;
    const { resolveLiveVehicleRouteGeometry } = await import('./routeGeometry');
    const geom = await resolveLiveVehicleRouteGeometry({
      mode: 'train',
      line,
      tripId: shapeId ? fullTripId : fullTripId,
      color,
      stops: stops.map((s) => ({ id: s.stopId, name: s.stopName, lat: s.lat, lon: s.lon })),
      signal,
    });
    if (geom && geom.length >= 2) {
      coords = geom;
    }

    return {
      route: {
        tripId: fullTripId,
        mode: 'train',
        line,
        color,
        coords,
        stops,
      },
      upcoming,
    };
  } catch {
    return null;
  }
}
