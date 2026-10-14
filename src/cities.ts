// Rejestr obsługiwanych miast. Jedno miejsce na wszystko co specyficzne
// dla miasta: środek strefy, bboxy, feedy GTFS/live/news, kafle offline.
// Nowe miasto = jeden wpis tutaj + build workera. Zero ifów po id miasta
// w reszcie kodu: serwisy czytają aktywny wpis przez cityStore.

export type CityId = 'wroclaw' | 'krakow' | 'gzm' | 'warszawa';

export interface CityCenter {
  lat: number;
  lon: number;
}

export interface CityBbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface CityDef {
  id: CityId;
  /** Nazwa w mianowniku (do chipów i nagłówków). */
  name: string;
  center: CityCenter;
  /** Promień strefy obsługi w metrach. */
  radiusM: number;
  bounds: CityBbox;
  /** Nominatim viewbox: minLon,maxLat,maxLon,minLat. */
  nominatimViewbox: string;
  /** Overpass: south,west,north,east. */
  overpassBbox: string;
  /** Zbiorkom: slug miasta + bbox minLon,minLat,maxLon,maxLat. */
  zbiorkomSlug: string;
  zbiorkomBbox: string;
  /** Plik bazy w katalogu SQLite. Wrocław trzyma legacy nazwę. */
  dbFile: string;
  /** Pakiet kafli offline w R2 i na telefonie. */
  tilePack: string;
  tileBbox: CityBbox;
  tileMaxZoom: number;
  /** Orientacyjny rozmiar pakietu kafli (MB) do tekstów UI; "ok." w i18n. */
  tilePackMB: number;
  features: {
    /** Kolej linowa (Polinka) istnieje tylko we Wrocławiu. */
    cable: boolean;
    /** Budynki uczelni w wyszukiwarce (PWr). */
    campusPois: boolean;
    /** Pociągi regionalne w prebuilt (KD we Wrocławiu). */
    regionalRail: boolean;
    /** Bezpośredni POST bus_position (tylko MPK Wrocław). */
    directBusPosition: boolean;
  };
}

const WROCLAW: CityDef = {
  id: 'wroclaw',
  name: 'Wrocław',
  center: { lat: 51.1079, lon: 17.0385 },
  radiusM: 15_000,
  bounds: { minLat: 50.95, maxLat: 51.25, minLon: 16.7, maxLon: 17.25 },
  nominatimViewbox: '16.7,51.25,17.25,50.95',
  overpassBbox: '50.95,16.70,51.25,17.25',
  zbiorkomSlug: 'wroclaw',
  zbiorkomBbox: '16.7,50.95,17.25,51.25',
  dbFile: 'kilometr-gtfs.db',
  tilePack: 'wroclaw-tiles.ktp',
  tileBbox: { minLat: 51.0, maxLat: 51.22, minLon: 16.8, maxLon: 17.28 },
  tileMaxZoom: 14,
  tilePackMB: 31,
  features: { cable: true, campusPois: true, regionalRail: true, directBusPosition: true },
};

const KRAKOW: CityDef = {
  id: 'krakow',
  name: 'Kraków',
  center: { lat: 50.0614, lon: 19.9366 },
  radiusM: 15_000,
  bounds: { minLat: 49.95, maxLat: 50.17, minLon: 19.7, maxLon: 20.3 },
  nominatimViewbox: '19.7,50.17,20.3,49.95',
  overpassBbox: '49.95,19.70,50.17,20.30',
  zbiorkomSlug: 'krakow',
  zbiorkomBbox: '19.7,49.95,20.3,50.17',
  dbFile: 'kilometr-gtfs-krakow.db',
  tilePack: 'krakow-tiles.ktp',
  tileBbox: { minLat: 49.96, maxLat: 50.16, minLon: 19.7, maxLon: 20.3 },
  tileMaxZoom: 14,
  tilePackMB: 34,
  features: { cable: false, campusPois: false, regionalRail: true, directBusPosition: false },
};

const GZM: CityDef = {
  id: 'gzm',
  name: 'GZM',
  // Strefa obsługi metropolii: promień musi sięgać najdalszych gmin GZM
  // (najdalszy punkt to Rudziniec Gliwicki ~46 km od Katowic), a nie obejmować
  // Bielska (~49,5 km). Rybnik i Wodzisław Śląskie NIE są w GZM, więc nie
  // wyznaczają promienia.
  center: { lat: 50.2649, lon: 19.0238 },
  radiusM: 48_000,
  bounds: { minLat: 49.95, maxLat: 50.6, minLon: 18.3, maxLon: 19.8 },
  nominatimViewbox: '18.3,50.6,19.8,49.95',
  overpassBbox: '49.95,18.30,50.60,19.80',
  zbiorkomSlug: 'gzm',
  zbiorkomBbox: '18.3,49.95,19.8,50.6',
  dbFile: 'kilometr-gtfs-gzm.db',
  tilePack: 'gzm-tiles.ktp',
  tileBbox: { minLat: 49.9, maxLat: 50.65, minLon: 18.25, maxLon: 19.85 },
  // z13, nie z14: cała metropolia w z14 to ~311 MB (limit 300 MB na obiekt
  // w R2), a z13 daje ~80 MB i wystarczającą szczegółowość offline.
  tileMaxZoom: 13,
  tilePackMB: 80,
  features: { cable: false, campusPois: false, regionalRail: true, directBusPosition: false },
};

const WARSZAWA: CityDef = {
  id: 'warszawa',
  name: 'Warszawa',
  center: { lat: 52.2297, lon: 21.0122 },
  radiusM: 16_000,
  bounds: { minLat: 52.0, maxLat: 52.4, minLon: 20.8, maxLon: 21.3 },
  nominatimViewbox: '20.8,52.4,21.3,52.0',
  overpassBbox: '52.00,20.80,52.40,21.30',
  // zbiorkom.live nazywa miasto `warsaw` (agencja `default`); bbox jak bounds.
  zbiorkomSlug: 'warsaw',
  zbiorkomBbox: '20.8,52.0,21.3,52.4',
  dbFile: 'kilometr-gtfs-warszawa.db',
  tilePack: 'warszawa-tiles.ktp',
  tileBbox: { minLat: 52.05, maxLat: 52.35, minLon: 20.85, maxLon: 21.28 },
  // Warszawa w z14: powierzchnia porównywalna z Krakowem (~34 MB).
  tileMaxZoom: 14,
  tilePackMB: 38,
  // SKM siedzi w GTFS WTP, KM i WKD dociąga build z PDP (jak KD we Wrocławiu).
  features: { cable: false, campusPois: false, regionalRail: true, directBusPosition: false },
};

export const CITIES: readonly CityDef[] = [WROCLAW, KRAKOW, GZM, WARSZAWA];

export const DEFAULT_CITY_ID: CityId = 'wroclaw';

export function getCity(id: string | null | undefined): CityDef {
  return CITIES.find((c) => c.id === id) ?? WROCLAW;
}

export function isCityId(id: string | null | undefined): id is CityId {
  return CITIES.some((c) => c.id === id);
}

/**
 * Klucz KV per-miasto. Wrocław trzyma legacy klucz bez sufiksu (kompat
 * ze starymi instalacjami), reszta miast dokleja `.id`. Jawny parametr,
 * bez odczytu aktywnego miasta: funkcja jest czysta i testowalna.
 */
export function cityKey(base: string, cityId: CityId): string {
  return cityId === 'wroclaw' ? base : `${base}.${cityId}`;
}

/** Haversine w metrach. */
export function cityDistanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLa = ((bLat - aLat) * Math.PI) / 180;
  const dLo = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLa / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Miasto dla współrzędnych: najbliższy środek w swoim promieniu, inaczej null. */
export function suggestCityForCoords(lat: number, lon: number): CityDef | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: CityDef | null = null;
  let bestDist = Infinity;
  for (const c of CITIES) {
    const d = cityDistanceM(lat, lon, c.center.lat, c.center.lon);
    if (d <= c.radiusM && d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/** Ścisły filtr: punkt w bboxie miasta. */
export function inCityBounds(city: CityDef, lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= city.bounds.minLat &&
    lat <= city.bounds.maxLat &&
    lon >= city.bounds.minLon &&
    lon <= city.bounds.maxLon
  );
}
