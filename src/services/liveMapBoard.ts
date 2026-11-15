// Logika mapy live w stylu zbiorkom.live:
// - kolory typow pojazdow i przystankow o wysokim kontrascie WCAG AA,
// - budowa warstwy przystankow z kierunkiem odjazdu (strzalka z geometrii linii),
// - tablice odjazdow dla kliknietego przystanku oraz kolejnych przystankow pojazdu.

import { bearingDegrees, distanceMeters, shiftWarsawDate, warsawNow } from '../gtfs/geo';
import { isFareBoundary } from '../gtfs/fareBoundary';
import { getContrastForeground, inferTransitMode } from './lineIdentity';
import type { TrackedVehicle } from './liveTracker';
import { getRailAgencyColor, inferRailAgencyFromLine } from './railIdentity';
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

const TRAM_MAP_BG = '#C62828';
const BUS_MAP_BG = '#2E7D32';
const TRAIN_MAP_BG = '#1D4ED8';
const CABLE_MAP_BG = '#0369A1';
const SUBWAY_M1_BG = '#1D4ED8';
const SUBWAY_M2_BG = '#C62828';
const SUBWAY_FALLBACK_BG = '#4338CA';

/**
 * Kolory pojazdow i przystankow na mapie na zywo (styl zbiorkom.live):
 * czerwone tramwaje, zielone autobusy/trolejbusy, kolory przewoznikow dla kolei.
 * Kazde tlo ma gwarancje kontrastu >= 4.5:1 z wyznaczonym tekstem `fg`.
 */
export function getLiveMapModeColors(
  mode: Exclude<LegMode, 'walk'>,
  line: string | undefined,
  cityId: string,
): { bg: string; fg: string } {
  const cleanLine = (line ?? '').trim().toUpperCase();
  if (mode === 'train') {
    const agency = inferRailAgencyFromLine(line, cityId);
    const agencyBg = agency ? getRailAgencyColor(agency) : undefined;
    const bg = agencyBg || TRAIN_MAP_BG;
    return { bg, fg: getContrastForeground(bg) };
  }
  if (mode === 'subway') {
    const bg =
      cleanLine === 'M1' ? SUBWAY_M1_BG : cleanLine === 'M2' ? SUBWAY_M2_BG : SUBWAY_FALLBACK_BG;
    return { bg, fg: getContrastForeground(bg) };
  }
  if (mode === 'cable') {
    return { bg: CABLE_MAP_BG, fg: getContrastForeground(CABLE_MAP_BG) };
  }
  if (mode === 'tram') {
    return { bg: TRAM_MAP_BG, fg: getContrastForeground(TRAM_MAP_BG) };
  }
  return { bg: BUS_MAP_BG, fg: getContrastForeground(BUS_MAP_BG) };
}

/**
 * Laduje wycinek rozkladu na biezace okno czasowe mapy live (z obsluga
 * kursow nocnych po polnocy).
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
 * Buduje liste przystankow do rysowania na mapie na zywo wraz z typem
 * dominujacego srodka transportu i kierunkiem odjazdow (jesli slupki sa kierunkowe).
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
 * Zwraca najblizsze odjazdy z wybranego przystanku w horyzoncie 3 godzin,
 * polaczone z danymi live (opoznienia i dopasowane pojazdy).
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
 * dla wybranego pojazdu na podstawie jego dopasowanego kursu GTFS i opoznienia.
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
