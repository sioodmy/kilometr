// Strefa obsługi: aktywne miasto (+ otulina radiusM od centrum).
//
// Poza nią pokazujemy kartę „Nieobsługiwane miasto" i blokujemy start
// z GPS — użytkownik musi wybrać punkt startowy ręcznie, bo planer
// liczy trasy wyłącznie po rozkładzie aktywnego miasta.

import { getCity, suggestCityForCoords as suggest } from '../cities';
import { getActiveCityIdSync } from './cityStore';

/** Haversine: dystans w metrach między dwoma punktami. Środek jawny, bez
 *  domyślnego miasta: jedyny caller (`isOutsideServiceArea`) podaje środek
 *  aktywnego miasta, a ukryty default Wrocławia byłby pułapką. */
export function serviceAreaDistanceM(
  lat: number,
  lon: number,
  centerLat: number,
  centerLon: number,
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

/** True, gdy pozycja jest poza strefą aktywnego miasta. */
export function isOutsideServiceArea(lat: number, lon: number, cityId?: string): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const city = getCity(cityId ?? getActiveCityIdSync());
  return serviceAreaDistanceM(lat, lon, city.center.lat, city.center.lon) > city.radiusM;
}

/**
 * Miasto dla współrzędnych GPS (do sugestii w onboardingu). Zwraca wpis
 * miasta w strefie albo null, gdy GPS jest poza wszystkimi miastami.
 */
export function suggestCityForGps(lat: number, lon: number) {
  return suggest(lat, lon);
}
