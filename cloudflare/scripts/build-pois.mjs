import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getCity } from '../../src/cities.ts';
import { classifyPoi, buildPoiAddress } from '../../src/services/poiClassify.ts';

export const POI_SCHEMA_VERSION = 1;
const MAX_AGE_MS = 7 * 86400000;

const OVERPASS_MIRRORS = [
  process.env.POI_OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const TILE_DEG = 0.35;
const MIN_TILE_DEG = 0.08;
const OVERPASS_BUDGET_MS = 10 * 60_000;
const MIRROR_ROUNDS = 2;

const retryWaitMs = (round) => {
  const waits = (process.env.POI_RETRY_WAIT_MS || '3000')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v >= 0);
  return waits[round] ?? waits.at(-1) ?? 3000;
};

export const POI_OVERPASS_FILTERS = [
  'nwr["shop"~"^(supermarket|mall|department_store)$"]',
  'nwr["amenity"~"^(pharmacy|hospital|clinic|university|college|school|cinema|theatre|library|fuel)$"]',
  'nwr["tourism"~"^(hotel|museum|attraction|zoo|viewpoint)$"]',
  'nwr["leisure"~"^(park|garden|stadium|swimming_pool|sports_centre|fitness_centre)$"]',
  'nwr["railway"~"^(station|halt)$"]',
  'nwr["landuse"="commercial"]["name"]',
];

export function normalizePolish(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .trim();
}

export function poiSnapshotIsFresh(snapshot, now = Date.now()) {
  const age = now - Date.parse(snapshot?.builtAt);
  return (
    snapshot?.schemaVersion === POI_SCHEMA_VERSION &&
    snapshot.count > 0 &&
    age >= 0 &&
    age < MAX_AGE_MS
  );
}

/** Filtruje, klasyfikuje i mapuje elementy OSM do wierszy tabeli pois. */
export function poisFromElements(elements, bounds) {
  const rows = [];
  for (const element of elements) {
    const tags = element?.tags;
    if (!tags) continue;
    const name = tags.name;
    if (typeof name !== 'string' || !name.trim()) continue;

    const cls = classifyPoi(tags);
    if (!cls) continue;

    const lat = element?.lat ?? element?.center?.lat;
    const lon = element?.lon ?? element?.center?.lon;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < bounds.minLat ||
      lat > bounds.maxLat ||
      lon < bounds.minLon ||
      lon > bounds.maxLon ||
      !['node', 'way', 'relation'].includes(element.type) ||
      !Number.isSafeInteger(element.id)
    ) {
      continue;
    }

    const addr = buildPoiAddress(cls.label, tags);
    const cleanName = name.trim();
    rows.push([
      `${element.type}/${element.id}`,
      'place',
      cls.category,
      cleanName,
      normalizePolish(cleanName),
      addr.address,
      lat,
      lon,
      addr.street ?? null,
      addr.district ?? null,
    ]);
  }
  return rows;
}

export function dedupePois(rows) {
  const seenIds = new Set();
  const seenKeys = new Set();
  return rows
    .sort((a, b) => a[0].localeCompare(b[0]))
    .filter((row) => {
      const [id, _kind, _cat, name, _norm, _addr, lat, lon] = row;
      const key = `${name.toLowerCase()}\0${lat.toFixed(4)}\0${lon.toFixed(4)}`;
      if (seenIds.has(id) || seenKeys.has(key)) return false;
      seenIds.add(id);
      seenKeys.add(key);
      return true;
    });
}

function readSnapshot(file, city) {
  try {
    return validateSnapshot(JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')), city);
  } catch {
    return null;
  }
}

function validateSnapshot(snapshot, city) {
  if (
    snapshot?.city !== city.id ||
    snapshot.schemaVersion !== POI_SCHEMA_VERSION ||
    JSON.stringify(snapshot.bounds) !== JSON.stringify(city.bounds) ||
    !Array.isArray(snapshot.rows) ||
    snapshot.rows.length !== snapshot.count ||
    !snapshot.count
  ) {
    return null;
  }
  for (const row of snapshot.rows) {
    if (
      !Array.isArray(row) ||
      row.length !== 10 ||
      typeof row[0] !== 'string' ||
      typeof row[1] !== 'string' ||
      typeof row[2] !== 'string' ||
      typeof row[3] !== 'string' ||
      typeof row[4] !== 'string' ||
      typeof row[5] !== 'string' ||
      !Number.isFinite(row[6]) ||
      !Number.isFinite(row[7])
    ) {
      return null;
    }
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(snapshot.rows)).digest('hex');
  return snapshot.fingerprint === fingerprint ? snapshot : null;
}

async function fetchRemoteSnapshot(city, snapshotUrl, fetcher) {
  if (!snapshotUrl) return null;
  try {
    const response = await fetcher(`${snapshotUrl}/${city.id}/pois.json.gz`, {
      headers: { Accept: 'application/gzip' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return validateSnapshot(JSON.parse(gunzipSync(buffer).toString('utf8')), city);
  } catch {
    return null;
  }
}

/**
 * Łańcuch ładowania: cache lokalny → R2 snapshot → Overpass API (lustra).
 */
export async function loadPoiSnapshot(cityId, cacheDir, fetcher = fetch, snapshotUrl = '') {
  const city = getCity(cityId);
  const file = join(cacheDir, `${city.id}.json.gz`);
  const save = (snapshot) => {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(`${file}.tmp`, gzipSync(JSON.stringify(snapshot)));
    renameSync(`${file}.tmp`, file);
  };
  const cached = readSnapshot(file, city);
  if (poiSnapshotIsFresh(cached)) return cached;
  const remote = await fetchRemoteSnapshot(city, snapshotUrl, fetcher);
  if (poiSnapshotIsFresh(remote)) {
    save(remote);
    return remote;
  }
  try {
    const bounds = city.bounds;
    const deadline = Date.now() + OVERPASS_BUDGET_MS;
    const rows = [];

    const fetchTile = async (south, west, north, east) => {
      const bbox = [south, west, north, east].join(',');
      const filters = POI_OVERPASS_FILTERS.map((f) => `${f}(${bbox});`).join('\n  ');
      const query = `[out:json][timeout:60];(\n  ${filters}\n);\nout center tags;`;
      const request = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'KilometrPoiBuild/1.0 (https://github.com/sioodmy/kilometr)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(90_000),
      };
      let lastError = null;
      for (let round = 0; round < MIRROR_ROUNDS; round++) {
        for (const url of OVERPASS_MIRRORS) {
          if (Date.now() > deadline) throw new Error('Overpass: przekroczony budżet czasu');
          try {
            const response = await fetcher(url, request);
            if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
            const json = await response.json();
            if (json.remark || !Array.isArray(json.elements)) {
              throw new Error(`Niepełna odpowiedź Overpass: ${json.remark || 'brak elements'}`);
            }
            return poisFromElements(json.elements, bounds);
          } catch (error) {
            lastError = error;
          }
        }
        if (round < MIRROR_ROUNDS - 1) await new Promise((r) => setTimeout(r, retryWaitMs(round)));
      }

      const latSpan = north - south;
      const lonSpan = east - west;
      if (Math.max(latSpan, lonSpan) > MIN_TILE_DEG * 1.01) {
        const midLat = (south + north) / 2;
        const midLon = (west + east) / 2;
        const parts = [
          [south, west, midLat, midLon],
          [south, midLon, midLat, east],
          [midLat, west, north, midLon],
          [midLat, midLon, north, east],
        ];
        const out = [];
        for (const [s, w, n, e] of parts) out.push(...(await fetchTile(s, w, n, e)));
        return out;
      }
      throw lastError ?? new Error('Overpass: brak odpowiedzi');
    };

    const latSteps = Math.max(1, Math.ceil((bounds.maxLat - bounds.minLat) / TILE_DEG));
    const lonSteps = Math.max(1, Math.ceil((bounds.maxLon - bounds.minLon) / TILE_DEG));
    for (let y = 0; y < latSteps; y++) {
      for (let x = 0; x < lonSteps; x++) {
        const south = bounds.minLat + (y * (bounds.maxLat - bounds.minLat)) / latSteps;
        const north = bounds.minLat + ((y + 1) * (bounds.maxLat - bounds.minLat)) / latSteps;
        const west = bounds.minLon + (x * (bounds.maxLon - bounds.minLon)) / lonSteps;
        const east = bounds.minLon + ((x + 1) * (bounds.maxLon - bounds.minLon)) / lonSteps;
        rows.push(...(await fetchTile(south, west, north, east)));
      }
    }
    const unique = dedupePois(rows);
    if (!unique.length) throw new Error('Pusty indeks POI');
    const snapshot = {
      schemaVersion: POI_SCHEMA_VERSION,
      city: city.id,
      bounds,
      builtAt: new Date().toISOString(),
      count: unique.length,
      fingerprint: createHash('sha256').update(JSON.stringify(unique)).digest('hex'),
      attribution: '© OpenStreetMap contributors',
      license: 'ODbL-1.0',
      licenseUrl: 'https://www.openstreetmap.org/copyright',
      rows: unique,
    };
    save(snapshot);
    return snapshot;
  } catch (error) {
    if (remote) {
      save(remote);
      console.warn(
        `[pois] ${city.id}: ${error.message}; odgrzewam snapshot z R2 sprzed ${Math.round((Date.now() - Date.parse(remote.builtAt)) / 86400000)} dni`,
      );
      return remote;
    }
    if (!cached) throw error;
    console.warn(`[pois] ${city.id}: ${error.message}; zachowuję snapshot z ${cached.builtAt}`);
    return cached;
  }
}

/** Wstawia snapshot POI do tabeli pois w SQLite. */
export function importPois(db, snapshot) {
  db.exec(`CREATE TABLE IF NOT EXISTS pois (
    osm_id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL DEFAULT 'place',
    category TEXT NOT NULL DEFAULT 'place',
    name TEXT NOT NULL,
    norm_name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    street TEXT,
    district TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pois_norm ON pois (norm_name);`);
  if (!snapshot || !snapshot.rows?.length) return null;
  const insert = db.prepare(
    'INSERT OR REPLACE INTO pois (osm_id, kind, category, name, norm_name, address, lat, lon, street, district) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  db.exec('BEGIN');
  try {
    for (const row of snapshot.rows) insert.run(...row);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const { rows: _rows, bounds: _bounds, ...metadata } = snapshot;
  return metadata;
}
