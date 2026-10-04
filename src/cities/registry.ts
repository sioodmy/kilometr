// Rejestr wspieranych miast.
//
// Jedyne miejsce w kodzie, w którym wymienia się miasta. Serwisy pytają
// `getCity('krakow')` i czytają z definicji adresy, granice i tryb pojazdu —
// nigdy nie zawierają na sztywno nazwy miasta ani wrocławskiego URL-a.

import type { CityDefinition, CityId } from './types';
import { WROCLAW } from './wroclaw';
import { KRAKOW } from './krakow';

/**
 * Kolejność ma znaczenie dla UI: miasto pierwsze na liście jest domyślne dla
 * użytkowników, którzy nie wybrali jeszcze miasta (migracja ze starej wersji
 * aplikacji, która znała wyłącznie Wrocław).
 */
export const CITIES = [WROCLAW, KRAKOW] as const satisfies readonly CityDefinition[];

export const DEFAULT_CITY_ID: CityId = 'wroclaw';

/** Wszystkie identyfikatory — do walidacji danych zapisanych na dysku. */
export const CITY_IDS: readonly CityId[] = CITIES.map((c) => c.id);

const BY_ID = new Map<CityId, CityDefinition>(CITIES.map((c) => [c.id, c]));

/** Definicja miasta; nieznany id → miasto domyślne (dane z dysku bywają stare). */
export function getCity(id: string | null | undefined): CityDefinition {
  if (id && BY_ID.has(id as CityId)) return BY_ID.get(id as CityId)!;
  return BY_ID.get(DEFAULT_CITY_ID)!;
}

/** Czy punkt (w stopniach) mieści się w granicach miasta. */
export function isInCity(city: CityDefinition, lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const { bounds } = city;
  return lat >= bounds.minLat && lat <= bounds.maxLat && lon >= bounds.minLon && lon <= bounds.maxLon;
}

/**
 * Miasto zawierające punkt, albo `null` gdy punkt jest poza wszystkimi.
 *
 * Świadomie czysta funkcja bez `expo-location` — wywołuje ją zarówno
 * wykrywanie GPS, jak i testy (`npm run check:cities`), więc da się
 * sprawdzić ją bez telefonu i bez budowania APK.
 */
export function detectCityFromCoords(lat: number, lon: number): CityId | null {
  for (const city of CITIES) {
    if (isInCity(city, lat, lon)) return city.id;
  }
  return null;
}

/** Czy dany tekst to identyfikator znaczego miasta. */
export function isCityId(value: unknown): value is CityId {
  return typeof value === 'string' && BY_ID.has(value as CityId);
}

export type { CityDefinition, CityId, Bounds, CityFeed, CityRealtime } from './types';
