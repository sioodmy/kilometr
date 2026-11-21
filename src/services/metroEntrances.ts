import { distanceMeters } from '../gtfs/geo';
import type { MetroEntranceRef } from '../types/models';
import type { MetroEntrance, StopHintsDataset } from '../types/stopHints';
import { ensureStopHintsLoaded, getCachedStopHints } from './stopHints';

const indexCache = new WeakMap<MetroEntrance[], Map<string, MetroEntrance[]>>();

function buildStationIndex(entrances: MetroEntrance[]): Map<string, MetroEntrance[]> {
  const cached = indexCache.get(entrances);
  if (cached) return cached;

  const map = new Map<string, MetroEntrance[]>();
  for (const e of entrances) {
    let list = map.get(e.stationId);
    if (!list) {
      list = [];
      map.set(e.stationId, list);
    }
    list.push(e);
  }
  indexCache.set(entrances, map);
  return map;
}

/**
 * Wyciąga kanoniczny identyfikator stacji metra warszawskiego (np. "1003M")
 * z identyfikatora peronu ("1003M:P2"), wejścia ("1003M:E1") lub stacji ("1003M").
 */
export function extractMetroStationId(stopId: string | undefined | null): string | null {
  if (!stopId) return null;
  const m = stopId.trim().match(/^(?:stop-)?(\d+M)(?::[PE][A-Za-z0-9]+)?$/i);
  return m ? m[1].toUpperCase() : null;
}

export function isWarsawMetroStopId(stopId: string | undefined | null): boolean {
  return extractMetroStationId(stopId) !== null;
}

export function toMetroEntranceRef(e: MetroEntrance): MetroEntranceRef {
  return {
    id: e.id,
    num: e.num,
    hint: e.hint,
    ...(e.wheelchair ? { wheelchair: true } : {}),
  };
}

/** Wstępnie ładuje dane wejść metra warszawskiego do pamięci przed uruchomieniem routera. */
export async function warmupMetroEntrances(): Promise<void> {
  await ensureStopHintsLoaded('warszawa');
}

function getStationIndex(dataset?: StopHintsDataset | null): Map<string, MetroEntrance[]> | null {
  const ds = dataset ?? getCachedStopHints('warszawa');
  const list = ds?.metroEntrances;
  if (!list || list.length === 0) return null;
  return buildStationIndex(list);
}

/**
 * Znajduje najbliższe (najbardziej optymalne) wejście do stacji metra względem punktu
 * odniesienia `(refLat, refLon)` (np. punktu startu, celu lub przystanku przesiadkowego).
 * Przy różnicy <= 3 m preferuje wejście z windą.
 */
export function findOptimalMetroEntrance(
  stopIdOrStationId: string | undefined | null,
  refLat: number,
  refLon: number,
  dataset?: StopHintsDataset | null,
): { entrance: MetroEntrance; distanceM: number } | null {
  if (!Number.isFinite(refLat) || !Number.isFinite(refLon)) return null;
  const stationId = extractMetroStationId(stopIdOrStationId);
  if (!stationId) return null;

  const index = getStationIndex(dataset);
  const candidates = index?.get(stationId);
  if (!candidates || candidates.length === 0) return null;

  let best: MetroEntrance | null = null;
  let bestDist = Infinity;

  for (const e of candidates) {
    const d = distanceMeters(refLat, refLon, e.lat, e.lon);
    if (
      d + 3 < bestDist ||
      (Math.abs(d - bestDist) <= 3 && e.wheelchair && !best?.wheelchair) ||
      (Math.abs(d - bestDist) <= 0.5 && (e.wheelchair === best?.wheelchair) && d < bestDist)
    ) {
      best = e;
      bestDist = d;
    }
  }

  return best ? { entrance: best, distanceM: Math.round(bestDist) } : null;
}

/**
 * Zwraca listę stacji metra warszawskiego osiągalnych pieszo przez którekolwiek z ich wejść
 * w zadanym promieniu `maxDistanceM` od `(lat, lon)`.
 */
export function findReachableMetroStationsByEntrance(
  lat: number,
  lon: number,
  maxDistanceM: number,
  dataset?: StopHintsDataset | null,
): Array<{ stationId: string; entrance: MetroEntrance; distanceM: number }> {
  const ds = dataset ?? getCachedStopHints('warszawa');
  const list = ds?.metroEntrances;
  if (!list || list.length === 0) return [];

  const byStation = new Map<string, { stationId: string; entrance: MetroEntrance; distanceM: number }>();
  for (const e of list) {
    const d = Math.round(distanceMeters(lat, lon, e.lat, e.lon));
    if (d > maxDistanceM) continue;
    const prev = byStation.get(e.stationId);
    if (!prev || d + 3 < prev.distanceM || (Math.abs(d - prev.distanceM) <= 3 && e.wheelchair && !prev.entrance.wheelchair)) {
      byStation.set(e.stationId, { stationId: e.stationId, entrance: e, distanceM: d });
    }
  }
  return [...byStation.values()].sort((a, b) => a.distanceM - b.distanceM);
}
