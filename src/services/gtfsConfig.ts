// Bezpośrednie źródła danych — telefon gada z publicznymi API, bez pośrednika.
// - Rozkład GTFS: Open Data Wrocław (katalog + zip)
// - Pozycje pojazdów: mpk.wroc.pl/bus_position (POST, bez klucza)
// - Adresy/POI: Nominatim + Overpass (HTTPS, z nagłówkiem User-Agent)
//
// Limity: GTFS-RT nie istnieje dla Wrocławia — opóźnienia liczymy sami,
// dopasowując GPS z bus_position do rozkładu (matcher w realtimeClient).

export const GTFS = {
  catalogueUrl: 'https://api.open-data.cui.wroclaw.pl/od2/6/',
  downloadBase: 'https://open-data.cui.wroclaw.pl/hdb/download',
  fallbackDirectUrl: 'https://open-data.cui.wroclaw.pl/hdb/download/136/',
  cacheFile: 'gtfs.zip',
  extractedDir: 'gtfs',
  refreshHours: 24,
  timeoutMs: 60000,
} as const;

export const MPK = {
  busPositionUrl: 'https://mpk.wroc.pl/bus_position',
  pollIntervalMs: 12000,
  timeoutMs: 8000,
} as const;

export const NOMINATIM = {
  baseUrl: 'https://nominatim.openstreetmap.org/search',
  reverseUrl: 'https://nominatim.openstreetmap.org/reverse',
  userAgent: 'KilometrTransitApp/1.0 (contact: dev@kilometr.local)',
  // Wrocław bbox: minLon, maxLat, maxLon, minLat
  wroclawBbox: '16.7,51.25,17.25,50.95',
  cacheTtlMs: 24 * 60 * 60 * 1000,
} as const;

export const OVERPASS = {
  baseUrl: 'https://overpass-api.de/api/interpreter',
  userAgent: 'KilometrTransitApp/1.0 (contact: dev@kilometr.local)',
  // Wrocław: south,west,north,east
  bbox: '50.95,16.70,51.25,17.25',
  timeoutMs: 45000,
  refreshDays: 7,
} as const;

export const BOUNDS = {
  minLat: 50.95,
  maxLat: 51.25,
  minLon: 16.7,
  maxLon: 17.25,
} as const;
