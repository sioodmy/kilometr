// Konfiguracja sieciowa — adaptujaca definicję aktywnego miasta.
//
// Dawniej ten plik trzymał wartości wrocławskie w stałych (`GTFS`, `MPK`,
// `NOMINATIM`, `OVERPASS`, `BOUNDS`). Teraz są to gettery czytające definicję
// aktywnego miasta, więc podmiana miasta przebiega bez zmian w żadnym z 7
// serwisów, które stąd korzystają. Same wartości dla konkretnego miasta żyją
// w `src/cities/*`.
//
// Zachowujemy tu wyłącznie adresy i timeouty wspólne dla wszystkich miast
// (serwery Nominatim i Overpass są te same — to globalne usługi OSM). Adresy
// zależne od miasta: adresy rozkładów, bbox-y granic, endpoint pozycji
// pojazdów.
//
// UWAGA na `get`: wartości czytamy dopiero przy dostępie. Zwykły `const`
// zamroziłby miasto w chwili wczytania modułu, czyli przed `loadActiveCity()`.

import { getActiveCitySync } from '../cities/active';
import type { Bounds, CityRealtime } from '../cities/types';

// ─── Nominatim (globalny serwer, viewbox zależny od miasta) ────────────────
export const NOMINATIM = {
  baseUrl: 'https://nominatim.openstreetmap.org/search',
  reverseUrl: 'https://nominatim.openstreetmap.org/reverse',
  userAgent: 'KilometrTransitApp/1.0 (contact: dev@kilometr.local)',
  cacheTtlMs: 24 * 60 * 60 * 1000,
  /** Granice aktywnego miasta w formacie Nominatim: left,top,right,bottom. */
  get viewbox(): string {
    return getActiveCitySync().nominatimBbox;
  },
} as const;

// ─── Overpass (globalny serwer, bbox zależny od miasta) ────────────────────
export const OVERPASS = {
  baseUrl: 'https://overpass-api.de/api/interpreter',
  userAgent: 'KilometrTransitApp/1.0 (contact: dev@kilometr.local)',
  timeoutMs: 45000,
  refreshDays: 7,
  /** Granice aktywnego miasta w formacie Overpass: south,west,north,east. */
  get bbox(): string {
    return getActiveCitySync().overpassBbox;
  },
} as const;

/** Granice aktywnego miasta — ścisły filtr wyników wyszukiwania. */
export function activeBounds(): Bounds {
  return getActiveCitySync().bounds;
}

/** Czy punkt mieści się w granicach aktywnego miasta. */
export function inActiveCity(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const { bounds } = getActiveCitySync();
  return (
    lat >= bounds.minLat &&
    lat <= bounds.maxLat &&
    lon >= bounds.minLon &&
    lon <= bounds.maxLon
  );
}

/** Ile godzin między sprawdzeniem nowego wydania rozkładu. */
export function refreshHours(): number {
  return getActiveCitySync().refreshHours;
}

/**
 * Źródło pozycji pojazdów na żywo albo `null`, gdy dane miasto go nie ma.
 * Wrocław ma własne MPK, Kraków ma GTFS-RT, którego jeszcze nie parsujemy —
 * wtedy `null` i usługa mówi wprost, że danych nie ma, zamiast odpytywać
 * cudzy endpoint.
 */
export function activeRealtime(): CityRealtime | null {
  return getActiveCitySync().realtime ?? null;
}
