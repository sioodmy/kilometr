import { bearingDegrees, distanceMeters } from '../gtfs/geo';
import type { LegStop } from '../types/models';
import type { TrainTrack } from './trainTrack';

export type DoorSide = 'left' | 'right';

/** Wartość w tabeli `platform_sides.bearing` oznaczająca perony po obu stronach toru (blokuje fallback). */
export const BOTH_SIDES_BEARING = -1;

const MAX_CACHE = 400;
const NEAREST_STATION_LAT_DELTA = 0.0017; // ~190 m
const NEAREST_STATION_LON_DELTA = 0.0028; // ~190 m przy 52°N
const LON_SCALE_SQ = 0.38; // cos(52°)^2
const APPROACH_WINDOW_M = 120;
const MIN_APPROACH_SPAN_M = 25;
const FALLBACK_MIN_M = 150;
const FALLBACK_MAX_M = 2500;

const ROMAN_TO_ARABIC: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12',
};

const cache = new Map<string, Record<string, number> | null>();
const inflight = new Map<string, Promise<Record<string, number> | null>>();

function cacheSet(key: string, value: Record<string, number> | null): void {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

/** Czyści cache stron peronów po podmianie krajowej bazy kolejowej. */
export function resetPlatformSidesCache(): void {
  cache.clear();
  inflight.clear();
}

/** Normalizuje oznaczenie peronu (np. "Peron III", "IIa", "02") do spójnego klucza ("3", "2a", "2"). */
export function normalizePlatformKey(raw?: string | null): string {
  if (!raw) return '';
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/^(?:peron|platform|per\.?)\s+/i, '')
    .replace(/\s+/g, '');
  if (!s) return '';
  const romanMatch = s.match(/^(xii|xi|ix|x|viii|vii|vi|iv|v|iii|ii|i)([a-z]?)$/);
  if (romanMatch) {
    const num = ROMAN_TO_ARABIC[romanMatch[1]];
    if (num) s = `${num}${romanMatch[2]}`;
  }
  return s.replace(/^0+(\d)/, '$1');
}

/** Normalizuje oznaczenie toru (np. "tor 04", "4ŚR", "11p") do spójnego klucza ("4", "4śr", "11p"). */
export function normalizeTrackKey(raw?: string | null): string {
  if (!raw) return '';
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/^(?:tor|track)\s+/i, '')
    .replace(/\s+/g, '');
  if (!s) return '';
  return s.replace(/^0+(\d)/, '$1');
}

/** Zwraca azymut peronu (0..359 albo -1 dla obu stron) dla pary (peron, tor) ze słownika stacji. */
export function pickPlatformBearing(
  entries: Record<string, number> | null | undefined,
  platform?: string | null,
  track?: string | null,
): number | null {
  if (!entries) return null;
  const normTrack = normalizeTrackKey(track);
  if (normTrack) {
    const byTrack = entries[`t:${normTrack}`];
    if (typeof byTrack === 'number') return byTrack;
  }
  const normPlatform = normalizePlatformKey(platform);
  if (normPlatform) {
    const byPlatform = entries[`p:${normPlatform}`];
    if (typeof byPlatform === 'number') return byPlatform;
  }
  const stationDefault = entries['*'];
  return typeof stationDefault === 'number' ? stationDefault : null;
}

function pointAtDistance(
  shape: { lat: number; lon: number }[],
  cum: number[],
  targetM: number,
): { lat: number; lon: number } {
  if (targetM <= 0) return shape[0];
  const last = shape.length - 1;
  if (targetM >= cum[last]) return shape[last];
  let lo = 0;
  let hi = last;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= targetM) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo];
  const ratio = span > 0 ? (targetM - cum[lo]) / span : 0;
  return {
    lat: shape[lo].lat + (shape[hi].lat - shape[lo].lat) * ratio,
    lon: shape[lo].lon + (shape[hi].lon - shape[lo].lon) * ratio,
  };
}

export interface ApproachBearing {
  bearing: number;
  exact: boolean;
}

/**
 * Wyznacza kierunek wjazdu pociągu na stację docelową.
 * Preferuje zakotwiczoną geometrię toru PLK (`TrainTrack`), a jako ostrożny
 * fallback używa odcinka między przedostatnim a ostatnim przystankiem.
 */
export function computeApproachBearing(
  track: TrainTrack | null | undefined,
  stops: LegStop[],
  segment: { start: number; end: number },
): ApproachBearing | null {
  if (
    track &&
    track.shape.length >= 2 &&
    segment.end > segment.start &&
    segment.end < track.anchorsM.length
  ) {
    const endM = track.anchorsM[segment.end];
    const startM = Math.max(0, track.anchorsM[segment.start]);
    if (endM >= 0 && endM - startM >= MIN_APPROACH_SPAN_M) {
      let cum = track.cumM;
      if (!cum || cum.length !== track.shape.length) {
        cum = [0];
        for (let i = 0; i < track.shape.length - 1; i++) {
          cum.push(
            cum[i] +
              distanceMeters(
                track.shape[i].lat,
                track.shape[i].lon,
                track.shape[i + 1].lat,
                track.shape[i + 1].lon,
              ),
          );
        }
      }
      const fromM = Math.max(startM, endM - APPROACH_WINDOW_M);
      if (endM - fromM >= MIN_APPROACH_SPAN_M) {
        const pFrom = pointAtDistance(track.shape, cum, fromM);
        const pTo = pointAtDistance(track.shape, cum, endM);
        if (distanceMeters(pFrom.lat, pFrom.lon, pTo.lat, pTo.lon) >= MIN_APPROACH_SPAN_M) {
          return {
            bearing: bearingDegrees(pFrom.lat, pFrom.lon, pTo.lat, pTo.lon),
            exact: true,
          };
        }
      }
    }
  }

  const endStop = stops[segment.end];
  if (!endStop || endStop.lat == null || endStop.lon == null) return null;
  for (let i = segment.end - 1; i >= segment.start; i--) {
    const prev = stops[i];
    if (!prev || prev.lat == null || prev.lon == null) continue;
    const dist = distanceMeters(prev.lat, prev.lon, endStop.lat, endStop.lon);
    if (dist < FALLBACK_MIN_M) continue;
    if (dist > FALLBACK_MAX_M) return null;
    return {
      bearing: bearingDegrees(prev.lat, prev.lon, endStop.lat, endStop.lon),
      exact: false,
    };
  }
  return null;
}

/**
 * Z azymutu wjazdu pociągu i azymutu peronu (od toru ku peronowi) wyznacza
 * stronę otwierania drzwi. Zwraca `null`, gdy geometria nie jest jednoznaczna.
 */
export function resolveDoorSide(
  approach: ApproachBearing | null | undefined,
  platformBearing: number | null | undefined,
): DoorSide | null {
  if (platformBearing == null) return null;
  if (platformBearing === BOTH_SIDES_BEARING) return null;
  if (!approach || !Number.isFinite(approach.bearing) || !Number.isFinite(platformBearing)) {
    return null;
  }
  const diff = ((platformBearing - approach.bearing + 540) % 360) - 180;
  const abs = Math.abs(diff);
  const minAngle = approach.exact ? 35 : 65;
  const maxAngle = approach.exact ? 145 : 115;
  if (abs < minAngle || abs > maxAngle) return null;
  return diff > 0 ? 'right' : 'left';
}

function normalizeNationalStopId(stopId?: string): string | undefined {
  if (!stopId) return undefined;
  const clean = stopId.startsWith('stop-') ? stopId.slice('stop-'.length) : stopId;
  return clean.startsWith('pl:') ? clean : undefined;
}

function stationCacheKey(stopId?: string, lat?: number, lon?: number): string {
  const nationalStopId = normalizeNationalStopId(stopId);
  const coordKey =
    lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)
      ? `${lat.toFixed(4)},${lon.toFixed(4)}`
      : '';
  return !nationalStopId && !coordKey ? '' : `${nationalStopId ?? ''}|${coordKey}`;
}

async function loadStationPlatformSides(
  stopId?: string,
  lat?: number,
  lon?: number,
): Promise<Record<string, number> | null> {
  const nationalStopId = normalizeNationalStopId(stopId);
  const key = stationCacheKey(stopId, lat, lon);
  if (!key) return null;

  if (cache.has(key)) return cache.get(key) ?? null;
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = loadStationPlatformSidesUncached(key, nationalStopId, lat, lon);
  inflight.set(key, promise);
  void promise.finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  return promise;
}

async function loadStationPlatformSidesUncached(
  cacheKey: string,
  nationalStopId: string | undefined,
  lat?: number,
  lon?: number,
): Promise<Record<string, number> | null> {
  try {
    const { getNationalDb } = await import('./gtfsDatabase');
    const db = await getNationalDb();
    let targetStopId = nationalStopId;

    if (
      !targetStopId &&
      lat != null &&
      lon != null &&
      Number.isFinite(lat) &&
      Number.isFinite(lon)
    ) {
      const nearest = await db.getFirstAsync<{ stop_id: string }>(
        `SELECT s.stop_id AS stop_id
         FROM stops s
         WHERE s.lat BETWEEN ? AND ?
           AND s.lon BETWEEN ? AND ?
         ORDER BY ((s.lat - ?) * (s.lat - ?) + (s.lon - ?) * (s.lon - ?) * ?) ASC
         LIMIT 1`,
        lat - NEAREST_STATION_LAT_DELTA,
        lat + NEAREST_STATION_LAT_DELTA,
        lon - NEAREST_STATION_LON_DELTA,
        lon + NEAREST_STATION_LON_DELTA,
        lat,
        lat,
        lon,
        lon,
        LON_SCALE_SQ,
      );
      if (nearest?.stop_id) targetStopId = nearest.stop_id;
    }

    if (!targetStopId) {
      cacheSet(cacheKey, null);
      return null;
    }

    const rows = await db.getAllAsync<{ key: string; bearing: number }>(
      'SELECT key, bearing FROM platform_sides WHERE stop_id = ?',
      targetStopId,
    );
    if (!rows || rows.length === 0) {
      cacheSet(cacheKey, null);
      return null;
    }
    const entries: Record<string, number> = {};
    for (const row of rows) {
      entries[row.key] = row.bearing;
    }
    cacheSet(cacheKey, entries);
    return entries;
  } catch {
    // Starsza wersja bazy polska przed dodaniem tabeli platform_sides nie rzuca błędu w UI.
    return null;
  }
}

/**
 * Wyznacza stronę otwierania drzwi pociągu przy wysiadaniu na podstawie
 * tabeli `platform_sides` w bazie `polska` i geometrii wjazdu w stację.
 */
export async function loadTrainDoorSide(params: {
  stopId?: string;
  lat?: number;
  lon?: number;
  platform?: string | null;
  track?: string | null;
  trainTrack: TrainTrack | null;
  stops: LegStop[];
  segment: { start: number; end: number };
}): Promise<DoorSide | null> {
  const entries = await loadStationPlatformSides(params.stopId, params.lat, params.lon);
  const platformBearing = pickPlatformBearing(entries, params.platform, params.track);
  if (platformBearing == null || platformBearing === BOTH_SIDES_BEARING) return null;
  const approach = computeApproachBearing(params.trainTrack, params.stops, params.segment);
  return resolveDoorSide(approach, platformBearing);
}
