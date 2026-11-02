// Strefa obsługi: aktywne miasto (bounding box lub otulina radiusM od centrum).
//
// Poza nią pokazujemy kartę „Nieobsługiwane miasto" i blokujemy start
// z GPS - użytkownik musi wybrać punkt startowy ręcznie, bo planer
// liczy trasy wyłącznie po rozkładzie aktywnego miasta.

import { getCity, isOutsideCity, suggestCityForCoords as suggest } from '../cities';
import { getActiveCityIdSync } from './cityStore';

/**
 * True, gdy pozycja jest poza strefą aktywnego miasta.
 * Sprawdza czy punkt mieści się w bounding boxie miasta (kluczowe dla aglomeracji
 * o nieregularnym kształcie, takich jak GZM czy Trójmiasto) LUB w promieniu od centrum.
 */
export function isOutsideServiceArea(lat: number, lon: number, cityId?: string): boolean {
  const city = getCity(cityId ?? getActiveCityIdSync());
  return isOutsideCity(city, lat, lon);
}

/**
 * Miasto dla współrzędnych GPS (do sugestii w onboardingu). Zwraca wpis
 * miasta w strefie albo null, gdy GPS jest poza wszystkimi miastami.
 */
export function suggestCityForGps(lat: number, lon: number) {
  return suggest(lat, lon);
}
