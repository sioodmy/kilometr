// Definicje miast — wszystko, co różni się między Wrocławiem a Krakowem.
//
// Zasada: miasto jest DANYMI, nie rozproszonym if-em. Każde miejsce w kodzie,
// które dziś zależy od Wrocławia (URL do rozkładu, bbox dla Nominatim,
// granice miasta, tramwaje vs autobusy, RSS, pozycje pojazdów), ma tu swój
// slot. Dodanie kolejnego miasta = dopisanie wpisu, nie grzebanie w serwisach.
//
// Wyjątkiem są świadomie zachowane różnice:
// - rejestr `src/cities/` trzyma wyłącznie fakty (URL, liczby, wzorce),
// - nazwy miast dla użytkownika żyją w słowniku `src/i18n` (`s.cities`),
//   bo każdy tekst widoczny musi być przetłumaczony (patrz AGENTS.md).

import type { VehicleMode } from '../gtfs/transitMode';

/**
 * Identyfikatory miast. Unia jest tu pisana ręcznie celowo — dodanie miasta
 * do `CITIES` bez wpisania go tutaj nie skompiluje się przy `satisfies`, więc
 * nie da się zapomnieć o jednym z dwóch miejsc.
 */
export type CityId = 'wroclaw' | 'krakow';

/** Prostokąt obejmujący obszar obsługiwany przez miasto. */
export interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/**
 * Jedno archiwum GTFS. Miasto może mieć ich kilka — Kraków wystawia osobne
 * pliki na tramwaje, autobusy MPK i autobusy przewoźnika prywatnego
 * (Mobilis). Wrocław ma jeden plik na wszystko.
 */
export interface CityFeed {
  /** Stabilny identyfikator części; wchodzi do nazw plików na telefonie. */
  id: string;
  /** Prosty adres archiwum (.zip). */
  url: string;
  /**
   * Tryb pojazdu dla całego archiwum. Operator, który wystawia osobne pliki,
   * w ten sposób mówi „to są tramwaje" — sygnał mocniejszy niż route_type.
   * Ustawiamy tylko tam, gdzie archiwum faktycznie jest jednego typu.
   */
  mode?: VehicleMode;
  /**
   * Feed opcjonalny: jego brak nie blokuje importu. Prywatni przewoźnicy
   * bywają mniej stabilni niż feed przewoźnika miejskiego.
   */
  optional?: boolean;
}

/** Pozycje pojazdów na żywo. */
export type CityRealtime =
  /**
   * Wrocław: POST formularzowy na `mpk.wroc.pl/bus_position`, bez klucza.
   * Endpoint wymaga wprost listy linii w podziale na tramwaje i autobusy —
   * dlatego listy żyją tutaj, a nie w kodzie wywołującym.
   */
  | {
      kind: 'mpk-form';
      endpoint: string;
      tramLines: readonly string[];
      busLines: readonly string[];
      pollIntervalMs: number;
      timeoutMs: number;
    }
  /**
   * GTFS-RT `VehiclePositions` (.pb, protobuf). Kraków wystawia taki feed
   * osobno dla tramwajów i autobusów. Bez parsera .pb opóźnień nie policzymy —
   * to świadoma decyzja, nie błąd, dlatego `realtime` zostaje nieustawione.
   */
  | { kind: 'gtfs-rt'; vehiclePositions: string[]; pollIntervalMs: number; timeoutMs: number };

export interface CityDefinition {
  id: CityId;
  /**
   * Klucz nazwy w słowniku `s.cities` — nazwy tłumaczy i18n, nie kod.
   * Typ = unia miast, dzięki czemu `s.cities[city.nameKey]` jest typowane:
   * dodanie miasta bez wpisów w czterech słownikach nie skompiluje się.
   */
  nameKey: CityId;
  /** Kod kraju dla Nominatim (`countrycodes`). */
  countryCode: string;
  /** Granice obsługiwanego obszaru — filtr wyników i wykrywanie miasta z GPS. */
  bounds: Bounds;
  /** Środek miasta: placeholder pozycji, zanim GPS zwróci współrzędne. */
  center: { lat: number; lon: number };
  /** Bbox dla Nominatim w kolejności left,top,right,bottom. */
  nominatimBbox: string;
  /** Bbox dla Overpass w kolejności south,west,north,east. */
  overpassBbox: string;
  /** Archiwa GTFS w kolejności importu. */
  feeds: CityFeed[];
  /**
   * Katalog z listą archiwiów (opcjonalny). Gdy jest, downloader szuka
   * najnowszego obowiązującego wydania; bez niego lecimy po `feeds`.
   */
  catalogueUrl?: string;
  /**
   * Prefiks katalogu archiwiów (Open Data Wrocław: `.../hdb/download`, gdzie
   * pełny URL to `${downloadBase}/${id}/`). Wymagany tylko razem z
   * `catalogueUrl`.
   */
  downloadBase?: string;
  /** Adres zapasowy, gdy katalog jest nieosiągalny. */
  fallbackDownloadUrl?: string;
  /** RSS z aktualnościami komunikacji (null = ekran aktualności ukryty). */
  newsFeedUrl: string | null;
  realtime?: CityRealtime;
  /**
   * Linie-tramwaje na wypadek, gdyby `route_type` w feedzie było puste albo
   * stale ustawione na `3`. Ostatnia deska ratunku w `classifyVehicle`,
   * nigdy źródło prawdy. Dla Wrocławia i Krakowa zbędne, bo oba feedy mają
   * poprawne `route_type` (0 i 900) — ale przy kolejnym mieście wystarczy
   * wkleić numery, zamiast pisać heurystykę.
   */
  tramLineFallback: readonly string[];
  /** Ile godzin między sprawdzeniem nowego wydania rozkładu. */
  refreshHours: number;
}
