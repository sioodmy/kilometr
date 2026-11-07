// Podział trasy na etapy mapowe oraz dociąganie przystanków pośrednich.
// Każda noga trasy to jeden etap. Dla długich tras kolejowych nie dzielimy
// nogi na części — etap obejmuje całą trasę i jest w całości kadrowany na mapie.

import { useEffect, useState } from 'react';
import { RoutingService } from '../services/api';
import type { Coord } from '../services/routeGeometry';
import { findUserSegment } from '../services/vehiclePosition';
import type { Connection, Leg } from '../types/models';
import type { MapLeg, MapRoute } from './types';

export interface MapStage {
  /** Unikalny identyfikator etapu: `leg.id`. */
  id: string;
  /** Identyfikator nogi w `MapRoute.legs`. */
  legId: string;
  /** Numer etapu (1..totalStages). */
  stageNumber: number;
  totalStages: number;
  /** Numer części w obrębie podzielonej nogi (zachowane dla zgodności typów). */
  segmentIndex?: number;
  segmentCount?: number;
  /** Rola stacji końcowej (zachowane dla zgodności typów). */
  endpointRole?: 'start' | 'end';
  leg: MapLeg;
  fromStop: string;
  toStop: string;
  departAt: string;
  arriveAt: string;
  stopsCount: number;
  walkM?: number;
  /** Fragment geometrii [lat, lon][] do wykadrowania i podświetlenia. */
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

/**
 * Buduje listę etapów podróży do przełączania na minimapie i pełnym ekranie.
 * Każda noga trasy odpowiada jednemu etapowi bez sztucznego dzielenia na pododcinki.
 * Nawet dla długiej trasy kolejowej przez całą Polskę etap obejmuje całą nogę,
 * a mapa kadruje pełną trasę.
 */
export function buildMapStages(
  route: MapRoute | null,
  _geometryMap?: ReadonlyMap<string, Coord[]>,
): MapStage[] {
  if (!route || route.legs.length === 0) return [];

  const raw: Omit<MapStage, 'stageNumber' | 'totalStages'>[] = [];

  for (const leg of route.legs) {
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
