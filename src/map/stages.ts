// Podział trasy na etapy mapowe oraz dociąganie przystanków pośrednich.
// Dla dalekobieżnej kolei dzieli długi kurs przez Polskę na czytelne odcinki
// regionalne i wycina odpowiadający im fragment geometrii torów.

import { useEffect, useState } from 'react';
import { distanceMeters, secondsToTimeString } from '../gtfs/geo';
import { RoutingService } from '../services/api';
import type { Coord } from '../services/routeGeometry';
import { findUserSegment } from '../services/vehiclePosition';
import type { Connection, Leg } from '../types/models';
import type { MapLeg, MapRoute } from './types';

export interface MapStage {
  /** Unikalny identyfikator etapu: `leg.id` albo `${leg.id}@seg${i}`. */
  id: string;
  /** Identyfikator nogi w `MapRoute.legs`. */
  legId: string;
  /** Numer etapu (1..totalStages). */
  stageNumber: number;
  totalStages: number;
  /** Numer części w obrębie podzielonej nogi kolejowej (1..segmentCount). */
  segmentIndex?: number;
  segmentCount?: number;
  /** Gdy pojedynczy kurs bez przystanków pośrednich dzielimy na start i cel. */
  endpointRole?: 'start' | 'end';
  leg: MapLeg;
  fromStop: string;
  toStop: string;
  departAt: string;
  arriveAt: string;
  stopsCount: number;
  walkM?: number;
  /** Wycięty fragment geometrii [lat, lon][] do wykadrowania i podświetlenia. */
  focusCoords?: Coord[];
  /** Zakres indeksów przystanków [startIdx, endIdx] w `leg.stops`. */
  stopRange?: [number, number];
  /** Ograniczenie maksymalnego przybliżenia przy kadrowaniu etapu. */
  focusMaxZoom?: number;
}

const enrichedCache = new Map<string, Connection>();

/**
 * Dociąga brakujące `intermediateStops` z bazy GTFS dla wszystkich nóg
 * komunikacji i przycina je do odcinka pasażera (`findUserSegment`).
 */
async function enrichConnectionStops(conn: Connection): Promise<Connection> {
  const cached = enrichedCache.get(conn.id);
  if (cached) return cached;

  const needsFetch = conn.legs.some(
    (l) => l.mode !== 'walk' && l.tripId && (!l.intermediateStops || l.intermediateStops.length < 2),
  );
  if (!needsFetch) {
    enrichedCache.set(conn.id, conn);
    return conn;
  }

  const legs: Leg[] = await Promise.all(
    conn.legs.map(async (l) => {
      if (l.mode === 'walk' || !l.tripId || (l.intermediateStops && l.intermediateStops.length >= 2)) {
        return l;
      }
      try {
        const full = await RoutingService.getTripStops(l.tripId);
        if (!full || full.length < 2) return l;
        const { start, end } = findUserSegment(full, l);
        const slice = end > start ? full.slice(start, end + 1) : full;
        if (slice.length < 2) return l;
        return { ...l, intermediateStops: slice };
      } catch {
        return l;
      }
    }),
  );

  const next: Connection = { ...conn, legs };
  enrichedCache.set(conn.id, next);
  if (enrichedCache.size > 60) {
    const oldest = enrichedCache.keys().next().value;
    if (oldest !== undefined) enrichedCache.delete(oldest);
  }
  return next;
}

/**
 * Hook zwracający połączenie wzbogacone o przystanki pośrednie (zarówno dla
 * minimapy w szczegółach trasy, jak i pełnoekranowej mapy).
 */
export function useEnrichedConnection(connection: Connection | null): Connection | null {
  const [enriched, setEnriched] = useState<Connection | null>(() =>
    connection ? (enrichedCache.get(connection.id) ?? connection) : null,
  );

  useEffect(() => {
    if (!connection) {
      setEnriched(null);
      return;
    }
    const hit = enrichedCache.get(connection.id);
    if (hit) {
      setEnriched(hit);
      return;
    }
    setEnriched(connection);
    let cancelled = false;
    void enrichConnectionStops(connection).then((next) => {
      if (!cancelled) setEnriched(next);
    });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  return enriched;
}

function legSpanKm(leg: MapLeg): number {
  const stops = leg.stops;
  if (!stops || stops.length < 2) return 0;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const s of stops) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lon < minLon) minLon = s.lon;
    if (s.lon > maxLon) maxLon = s.lon;
  }
  if (!Number.isFinite(minLat)) return 0;
  return distanceMeters(minLat, minLon, maxLat, maxLon) / 1000;
}

function closestCoordIndex(coords: Coord[], lat: number, lon: number, minIdx = 0): number {
  let bestIdx = minIdx;
  let bestDist = Infinity;
  for (let i = minIdx; i < coords.length; i++) {
    const dLat = coords[i][0] - lat;
    const dLon = coords[i][1] - lon;
    const d2 = dLat * dLat + dLon * dLon;
    if (d2 < bestDist) {
      bestDist = d2;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Wycina fragment linii (z `geometryMap` lub przystanków) pomiędzy przystankami
 * `startIdx` oraz `endIdx`.
 */
function sliceLegCoords(
  leg: MapLeg,
  fullCoords: Coord[] | undefined,
  startIdx: number,
  endIdx: number,
): Coord[] {
  const stops = leg.stops;
  const subStops = stops.slice(startIdx, endIdx + 1);
  const geom = fullCoords && fullCoords.length >= 2 ? fullCoords : leg.geometry;
  if (geom && geom.length >= 2 && subStops.length >= 2) {
    const first = subStops[0];
    const last = subStops[subStops.length - 1];
    const i0 = closestCoordIndex(geom, first.lat, first.lon, 0);
    const i1 = closestCoordIndex(geom, last.lat, last.lon, i0);
    if (i1 > i0) {
      const sliced = geom.slice(i0, i1 + 1);
      return [[first.lat, first.lon], ...sliced, [last.lat, last.lon]];
    }
  }
  return subStops.map((s) => [s.lat, s.lon] as Coord);
}

function stationBoxCoords(lat: number, lon: number, deltaDeg = 0.012): Coord[] {
  return [
    [lat - deltaDeg, lon - deltaDeg],
    [lat, lon],
    [lat + deltaDeg, lon + deltaDeg],
  ];
}

function formatStopSec(sec: number | undefined, fallback: string): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return fallback;
  return secondsToTimeString(sec);
}

/**
 * Buduje listę etapów podróży do przełączania na minimapie i pełnym ekranie.
 * Wielonogowe trasy zachowują nogi, a długie przeloty kolejowe (> 80 km, lub
 * > 20 km przy pojedynczej nodze) są dzielone na 2 lub 3 odcinki regionalne.
 */
export function buildMapStages(
  route: MapRoute | null,
  geometryMap?: ReadonlyMap<string, Coord[]>,
): MapStage[] {
  if (!route || route.legs.length === 0) return [];

  const raw: Omit<MapStage, 'stageNumber' | 'totalStages'>[] = [];
  const isSingleLegRoute = route.legs.length === 1;

  for (const leg of route.legs) {
    const spanKm = legSpanKm(leg);
    const stops = leg.stops ?? [];
    const fullCoords = geometryMap?.get(leg.id);

    const shouldSplitByStops =
      leg.mode !== 'walk' &&
      ((spanKm >= 85 && stops.length >= 6) || (isSingleLegRoute && spanKm >= 20 && stops.length >= 4));

    if (shouldSplitByStops) {
      const segmentCount = spanKm >= 240 && stops.length >= 9 ? 3 : 2;
      for (let s = 0; s < segmentCount; s++) {
        const startIdx = Math.round((s * (stops.length - 1)) / segmentCount);
        const endIdx = Math.round(((s + 1) * (stops.length - 1)) / segmentCount);
        const startStop = stops[startIdx];
        const endStop = stops[endIdx];
        const departAt =
          s === 0
            ? leg.departAt
            : formatStopSec(startStop.departSec ?? startStop.arriveSec, leg.departAt);
        const arriveAt =
          s === segmentCount - 1
            ? leg.arriveAt
            : formatStopSec(endStop.arriveSec ?? endStop.departSec, leg.arriveAt);

        raw.push({
          id: `${leg.id}@seg${s + 1}`,
          legId: leg.id,
          segmentIndex: s + 1,
          segmentCount,
          leg,
          fromStop: startStop.name,
          toStop: endStop.name,
          departAt,
          arriveAt,
          stopsCount: Math.max(1, endIdx - startIdx),
          focusCoords: sliceLegCoords(leg, fullCoords, startIdx, endIdx),
          stopRange: [startIdx, endIdx],
          focusMaxZoom: 13.5,
        });
      }
      continue;
    }

    if (isSingleLegRoute && leg.mode !== 'walk' && spanKm >= 15 && stops.length >= 2) {
      const first = stops[0];
      const last = stops[stops.length - 1];
      raw.push({
        id: `${leg.id}@start`,
        legId: leg.id,
        endpointRole: 'start',
        leg,
        fromStop: leg.fromStop,
        toStop: leg.fromStop,
        departAt: leg.departAt,
        arriveAt: leg.departAt,
        stopsCount: 0,
        focusCoords: stationBoxCoords(first.lat, first.lon, 0.011),
        stopRange: [0, Math.min(1, stops.length - 1)],
        focusMaxZoom: 14.5,
      });
      raw.push({
        id: `${leg.id}@end`,
        legId: leg.id,
        endpointRole: 'end',
        leg,
        fromStop: leg.toStop,
        toStop: leg.toStop,
        departAt: leg.arriveAt,
        arriveAt: leg.arriveAt,
        stopsCount: 0,
        focusCoords: stationBoxCoords(last.lat, last.lon, 0.011),
        stopRange: [Math.max(0, stops.length - 2), stops.length - 1],
        focusMaxZoom: 14.5,
      });
      continue;
    }

    raw.push({
      id: leg.id,
      legId: leg.id,
      leg,
      fromStop: leg.fromStop,
      toStop: leg.toStop,
      departAt: leg.departAt,
      arriveAt: leg.arriveAt,
      stopsCount: leg.stopsCount,
      walkM: leg.walkM,
    });
  }

  const totalStages = raw.length;
  return raw.map((item, idx) => ({
    ...item,
    stageNumber: idx + 1,
    totalStages,
  }));
}

/**
 * Znajduje etap po `stage.id` albo po `leg.id`. Gdy kliknięta na mapie noga
 * ma kilka odcinków, kolejne kliknięcia tej samej nogi przełączają jej odcinki.
 */
export function resolveStageSelection(
  stages: MapStage[],
  idOrLegId: string | null,
  currentStageId?: string | null,
): MapStage | null {
  if (!idOrLegId || stages.length === 0) return null;
  const exact = stages.find((s) => s.id === idOrLegId);
  if (exact) return exact;

  const matchingLegStages = stages.filter((s) => s.legId === idOrLegId);
  if (matchingLegStages.length === 0) return null;
  if (matchingLegStages.length === 1) return matchingLegStages[0];

  const currentIdx = matchingLegStages.findIndex((s) => s.id === currentStageId);
  if (currentIdx >= 0 && currentIdx + 1 < matchingLegStages.length) {
    return matchingLegStages[currentIdx + 1];
  }
  return matchingLegStages[0];
}
