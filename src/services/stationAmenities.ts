import type { StationAmenity } from '../types/models';
import { getNationalDb } from './gtfsDatabase';

/**
 * Stała kolejność bitów z table `station_amenities` w bazie `polska`.
 * Musi być identyczna z STATION_AMENITY_ORDER w cloudflare/scripts/build-polska.mjs.
 */
export const STATION_AMENITY_ORDER: readonly StationAmenity[] = [
  'toilets',
  'gastronomy',
  'shop',
  'cafe',
  'bakery',
  'pharmacy',
  'atm',
  'luggage',
];

const MAX_CACHE = 500;
const NEAREST_STATION_LAT_DELTA = 0.0017; // ~190 m
const NEAREST_STATION_LON_DELTA = 0.0028; // ~190 m przy 52°N
const LON_SCALE_SQ = 0.38; // cos(52°)^2

const cache = new Map<string, StationAmenity[] | null>();
// Kilka nóg tej samej stacji pyta naraz przy pierwszym otwarciu karty.
const inflight = new Map<string, Promise<StationAmenity[] | null>>();

/** Dekoduje maskę bitową udogodnień dworca na listę kluczy UI. */
export function decodeStationAmenities(bits: number): StationAmenity[] {
  const out: StationAmenity[] = [];
  for (let i = 0; i < STATION_AMENITY_ORDER.length; i++) {
    if ((bits & (1 << i)) !== 0) out.push(STATION_AMENITY_ORDER[i]);
  }
  return out;
}

function cacheSet(key: string, value: StationAmenity[] | null): void {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

/** Czyści cache po podmianie krajowej bazy kolejowej. */
export function resetStationAmenitiesCache(): void {
  cache.clear();
  inflight.clear();
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

export function getCachedStationAmenities(
  stopId?: string,
  lat?: number,
  lon?: number,
): StationAmenity[] | null | undefined {
  const key = stationCacheKey(stopId, lat, lon);
  return key ? cache.get(key) : undefined;
}

/**
 * Pobiera udogodnienia stacji kolejowej (OSM 50 m) z krajowej bazy `polska`.
 * Szuka po `stop_id` (`pl:...`), a dla pociągów miejskich po najbliższej stacji
 * w promieniu ~190 m. Zwraca `null`, gdy brak bazy lub brak dopasowania.
 */
export async function loadStationAmenities(
  stopId?: string,
  lat?: number,
  lon?: number,
): Promise<StationAmenity[] | null> {
  const nationalStopId = normalizeNationalStopId(stopId);
  const cacheKey = stationCacheKey(stopId, lat, lon);
  if (!cacheKey) return null;

  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const promise = loadStationAmenitiesUncached(cacheKey, nationalStopId, lat, lon);
  inflight.set(cacheKey, promise);
  void promise.finally(() => {
    if (inflight.get(cacheKey) === promise) inflight.delete(cacheKey);
  });
  return promise;
}

async function loadStationAmenitiesUncached(
  cacheKey: string,
  nationalStopId: string | undefined,
  lat?: number,
  lon?: number,
): Promise<StationAmenity[] | null> {
  try {
    const db = await getNationalDb();
    let bits: number | null = null;

    if (nationalStopId) {
      const row = await db.getFirstAsync<{ bits: number }>(
        'SELECT bits FROM station_amenities WHERE stop_id = ? LIMIT 1',
        nationalStopId,
      );
      if (row) bits = row.bits;
    }

    if (bits == null && lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
      const nearest = await db.getFirstAsync<{ bits: number | null }>(
        `SELECT sa.bits AS bits
         FROM stops s
         LEFT JOIN station_amenities sa ON sa.stop_id = s.stop_id
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
      if (nearest?.bits != null) bits = nearest.bits;
    }

    const decoded = bits != null ? decodeStationAmenities(bits) : [];
    const result = decoded.length > 0 ? decoded : null;
    cacheSet(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}
