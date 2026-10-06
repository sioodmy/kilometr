// Strefa obsługi: tylko Wrocław (+ otulina 15 km od Rynku).
//
// Poza nią pokazujemy kartę „Nieobsługiwane miasto" i blokujemy start
// z GPS — użytkownik musi wybrać punkt startowy ręcznie, bo planer
// liczy trasy wyłącznie po rozkładzie MPK Wrocław.

import { DEFAULT_LOCATION } from '../config';

export const SERVICE_AREA_CENTER = {
  lat: DEFAULT_LOCATION.lat,
  lon: DEFAULT_LOCATION.lon,
} as const;

/** Promień obsługi w metrach (15 km od centrum Wrocławia). */
export const SERVICE_AREA_RADIUS_M = 15_000;

/** Haversine — dystans w metrach między dwoma punktami. */
export function serviceAreaDistanceM(
  lat: number,
  lon: number,
  centerLat: number = SERVICE_AREA_CENTER.lat,
  centerLon: number = SERVICE_AREA_CENTER.lon,
): number {
  const R = 6_371_000;
  const dLa = ((lat - centerLat) * Math.PI) / 180;
  const dLo = ((lon - centerLon) * Math.PI) / 180;
  const s =
    Math.sin(dLa / 2) ** 2 +
    Math.cos((centerLat * Math.PI) / 180) *
      Math.cos((lat * Math.PI) / 180) *
      Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** True, gdy pozycja jest DALEJ niż 15 km od centrum Wrocławia. */
export function isOutsideServiceArea(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return serviceAreaDistanceM(lat, lon) > SERVICE_AREA_RADIUS_M;
}
