import path from 'node:path';

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:19006',
  'http://127.0.0.1:19006',
];

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const requestedHost = process.env.HOST?.trim() || '127.0.0.1';
const apiToken = process.env.API_TOKEN?.trim() ?? '';

export const config = {
  port: Number(process.env.PORT || 3000),
  // Bez tokenu serwer nie wychodzi do LAN: HOST=0.0.0.0 spada do loopbacku.
  host: apiToken === '' && !LOOPBACK_HOSTS.has(requestedHost) ? '127.0.0.1' : requestedHost,
  apiToken,
  corsOrigins: (process.env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  dataDir: path.resolve(__dirname, '../data'),
  gtfs: {
    catalogueUrl: 'https://api.open-data.cui.wroclaw.pl/od2/6/',
    downloadBase: 'https://open-data.cui.wroclaw.pl/hdb/download',
    fallbackDirectUrl: 'https://open-data.cui.wroclaw.pl/hdb/download/136/',
    cacheFile: 'gtfs.zip',
    extractedDir: 'extracted_gtfs',
    refreshHours: 24,
    timeoutMs: 60000,
  },
  mpk: {
    busPositionUrl: 'https://mpk.wroc.pl/bus_position',
    pollIntervalMs: 12000,
    timeoutMs: 8000,
  },
  nominatim: {
    baseUrl: 'https://nominatim.openstreetmap.org/search',
    reverseUrl: 'https://nominatim.openstreetmap.org/reverse',
    userAgent: 'KilometrTransitApp/1.0 (contact: dev@kilometr.local)',
    wroclawBbox: '16.7,51.25,17.25,50.95', // [left, top, right, bottom] -> minLon, maxLat, maxLon, minLat
    cacheTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  },
  overpass: {
    baseUrl: 'https://overpass-api.de/api/interpreter',
    userAgent: 'KilometrTransitApp/1.0 (contact: dev@kilometr.local)',
    // Wrocław: south,west,north,east
    bbox: '50.95,16.70,51.25,17.25',
    timeoutMs: 45000,
    refreshDays: 7,
  },
  bounds: {
    minLat: 50.95,
    maxLat: 51.25,
    minLon: 16.70,
    maxLon: 17.25,
  },
  smartRanking: {
    currentPlaceRadiusMeters: 300,
    originClusterRadiusMeters: 450,
    destinationExclusionRadiusMeters: 250,
  },
};
