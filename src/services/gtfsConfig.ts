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

/**
 * Gotowa baza z serwera Kilometr (Cloudflare R2 + Worker): telefon pobiera
 * prebuilt SQLite zamiast parsować ZIP-a w pamięci (OOM na słabszych
 * urządzeniach). Domyślny adres to publiczna subdomena, więc build APK
 * działa bez zmiennej środowiskowej. EXPO_PUBLIC_TIMETABLE_URL nadpisuje
 * adres (np. do testów lokalnego Workera); to nie jest sekret, manifest
 * i baza są publiczne, klucz PDP API siedzi tylko w Workerze. Gdy serwer
 * nieosiągalny, aplikacja wraca do starego importu z ZIP-a.
 */
export const TIMETABLE = {
  baseUrl: (process.env.EXPO_PUBLIC_TIMETABLE_URL || 'https://data.kilometr.wroclaw.pl').replace(/\/$/, ''),
  dbFile: 'kilometr-gtfs.db',
  refreshHours: 24,
  timeoutMs: 15000,
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

export const WROCLAW_TRAM_LINES = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '70', '72', '74',
] as const;

export const WROCLAW_BUS_LINES = [
  'A', 'C', 'D', 'K', 'N',
  '100', '101', '102', '103', '104', '105', '106', '107', '108', '109', '110',
  '111', '112', '113', '114', '115', '116', '117', '118', '119', '120', '121', '122',
  '123', '124', '125', '126', '127', '128', '129', '130', '131', '132', '133', '134',
  '136', '137', '138', '140', '142', '143', '144', '145', '146', '147', '148', '149',
  '150', '151', '152', '153',
  '206', '240', '241', '242', '243', '244', '245', '246', '247', '248', '249',
  '250', '251', '253', '255', '257', '259',
  '306', '310', '315', '319', '343', '345',
  '602', '607', '612',
  '704', '715', '747',
  '903', '904', '905', '906', '907', '908', '909', '911', '914', '920', '921',
  '924', '927', '930', '931', '934', '936', '947', '948', '955', '958', '967',
] as const;
