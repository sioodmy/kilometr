import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getCity } from '../../src/cities.ts';

export const ADDRESS_SCHEMA_VERSION = 1;
const MAX_AGE_MS = 7 * 86400000;
/**
 * Kolejno próbowane instancje Overpassa; pierwszy wpis można nadpisać
 * przez ADDRESS_OVERPASS_URL. Kilka kolejnych dni 502/504 z głównego
 * serwera kończyło się firmowaniem bazy bez indeksu adresów, więc
 * pojedyncza padnięta instancja nie ubija już snapshotu. mail.ru to
 * ostatni przystanek (własny mirror planety, wolniejszy albo z dziurami
 * w importach, więc zaufany tylko gdy wyczerpie się wszystko powyżej).
 */
const OVERPASS_MIRRORS = [
  process.env.ADDRESS_OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
/**
 * Rozdzielczość kafli Overpassa: start 0.25°, przy padniętym kaflu schodzimy
 * połówkami do MIN_TILE_DEG (GZM to 41 gmin, więc nie schodzimy w nieskończoność).
 */
const TILE_DEG = 0.25;
const MIN_TILE_DEG = 0.06;
/** Sufit czasu na Overpass w jednym buildzie: po nim wolimy R2/cache niż wisieć. */
const OVERPASS_BUDGET_MS = 20 * 60_000;
/** Dwie rundy po lusterkach z pauzą między nimi; potem podział kafelka. */
const MIRROR_ROUNDS = 2;
const retryWaitMs = (round) => {
  const waits = (process.env.ADDRESS_RETRY_WAIT_MS || '5000')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v >= 0);
  return waits[round] ?? waits.at(-1) ?? 5000;
};

export function addressSnapshotIsFresh(snapshot, now = Date.now()) {
  const age = now - Date.parse(snapshot?.builtAt);
  return (
    snapshot?.schemaVersion === ADDRESS_SCHEMA_VERSION &&
    snapshot.count > 0 &&
    age >= 0 &&
    age < MAX_AGE_MS
  );
}

/** Zapisuje wyłącznie oznaczone adresy OSM, bez interpolacji numerów. */
export function addressesFromElements(elements, bounds) {
  const rows = [];
  for (const element of elements) {
    const tags = element?.tags;
    const street = tags?.['addr:street'] || tags?.['addr:place'];
    const house = tags?.['addr:housenumber'];
    const locality = tags?.['addr:city'] || tags?.['addr:town'] || tags?.['addr:village'] || '';
    const lat = element?.lat ?? element?.center?.lat;
    const lon = element?.lon ?? element?.center?.lon;
    if (
      typeof street !== 'string' ||
      !street.trim() ||
      typeof house !== 'string' ||
      !house.trim() ||
      typeof locality !== 'string' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < bounds.minLat ||
      lat > bounds.maxLat ||
      lon < bounds.minLon ||
      lon > bounds.maxLon ||
      !['node', 'way', 'relation'].includes(element.type) ||
      !Number.isSafeInteger(element.id)
    )
      continue;
    rows.push([
      `${element.type}/${element.id}`,
      street.trim(),
      house.trim(),
      locality.trim(),
      lat,
      lon,
    ]);
  }
  return rows;
}

export function dedupeAddresses(rows) {
  const seenIds = new Set();
  const seenAddresses = new Set();
  return rows
    .sort((a, b) => a[0].localeCompare(b[0]))
    .filter((row) => {
      const [id, street, house, locality, lat, lon] = row;
      const key = `${street.toLocaleLowerCase('pl')}\0${house.toLocaleLowerCase('pl')}\0${locality.toLocaleLowerCase('pl')}\0${lat.toFixed(4)}\0${lon.toFixed(4)}`;
      if (seenIds.has(id) || seenAddresses.has(key)) return false;
      seenIds.add(id);
      seenAddresses.add(key);
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

/**
 * Waliduje snapshot niezależnie od źródła (plik, R2): miasto, schemat, granice,
 * spójność count i fingerprint. Rozjechany snapshot to null, nigdy zaufane dane.
 */
function validateSnapshot(snapshot, city) {
  if (
    snapshot?.city !== city.id ||
    snapshot.schemaVersion !== ADDRESS_SCHEMA_VERSION ||
    JSON.stringify(snapshot.bounds) !== JSON.stringify(city.bounds) ||
    !Array.isArray(snapshot.rows) ||
    snapshot.rows.length !== snapshot.count ||
    !snapshot.count
  )
    return null;
  for (const row of snapshot.rows) {
    if (
      !Array.isArray(row) ||
      row.length !== 6 ||
      !row.slice(0, 4).every((v) => typeof v === 'string') ||
      !Number.isFinite(row[4]) ||
      !Number.isFinite(row[5])
    )
      return null;
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(snapshot.rows)).digest('hex');
  return snapshot.fingerprint === fingerprint ? snapshot : null;
}

/** Snapshot adresów z Workera/R2 (`{miasto}/addresses.json.gz`). Null = brak albo nieprawidłowy. */
async function fetchRemoteSnapshot(city, snapshotUrl, fetcher) {
  if (!snapshotUrl) return null;
  try {
    const response = await fetcher(`${snapshotUrl}/${city.id}/addresses.json.gz`, {
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
 * Łańcuch: lokalny cache → snapshot z R2 → lustra Overpassa. Gdy padnie
 * wszystko i zostaje tylko bardzo stary snapshot z R2, używamy go zamiast
 * firmować bazę bez adresów. Cache nigdy nie jest nadpisywany śmieciem.
 */
export async function loadAddressSnapshot(cityId, cacheDir, fetcher = fetch, snapshotUrl = '') {
  const city = getCity(cityId);
  const file = join(cacheDir, `${city.id}.json.gz`);
  const save = (snapshot) => {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(`${file}.tmp`, gzipSync(JSON.stringify(snapshot)));
    renameSync(`${file}.tmp`, file);
  };
  const cached = readSnapshot(file, city);
  if (addressSnapshotIsFresh(cached)) return cached;
  const remote = await fetchRemoteSnapshot(city, snapshotUrl, fetcher);
  if (addressSnapshotIsFresh(remote)) {
    save(remote);
    return remote;
  }
  try {
    const bounds = city.bounds;
    const deadline = Date.now() + OVERPASS_BUDGET_MS;
    const rows = [];
    /** Kafelek z ratunkiem: lustra → pauza → lustra → podział na ćwiartki. */
    const fetchTile = async (south, west, north, east) => {
      const bbox = [south, west, north, east].join(',');
      const query = `[out:json][timeout:90];(nwr["addr:housenumber"]["addr:street"](${bbox});nwr["addr:housenumber"]["addr:place"](${bbox}););out center qt;`;
      const request = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'KilometrAddressBuild/1.0 (https://github.com/sioodmy/kilometr)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(120_000),
      };
      let lastError = null;
      for (let round = 0; round < MIRROR_ROUNDS; round++) {
        for (const url of OVERPASS_MIRRORS) {
          if (Date.now() > deadline) throw new Error('Overpass: przekroczony budżet czasu');
          try {
            const response = await fetcher(url, request);
            if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
            const json = await response.json();
            if (json.remark || !Array.isArray(json.elements))
              throw new Error(`Niepełna odpowiedź Overpass: ${json.remark || 'brak elements'}`);
            return addressesFromElements(json.elements, bounds);
          } catch (error) {
            lastError = error;
          }
        }
        if (round < MIRROR_ROUNDS - 1) await new Promise((r) => setTimeout(r, retryWaitMs(round)));
      }
      // Za duże zapytanie zwykle umiera na limitach serwera: tniemy na ćwiartki,
      // aż dojdzie do MIN_TILE_DEG (GZM ma 225 kafli 0.1°, więc bez przesady).
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
    const latSteps = Math.ceil((bounds.maxLat - bounds.minLat) / TILE_DEG);
    const lonSteps = Math.ceil((bounds.maxLon - bounds.minLon) / TILE_DEG);
    for (let y = 0; y < latSteps; y++) {
      for (let x = 0; x < lonSteps; x++) {
        const south = bounds.minLat + (y * (bounds.maxLat - bounds.minLat)) / latSteps;
        const north = bounds.minLat + ((y + 1) * (bounds.maxLat - bounds.minLat)) / latSteps;
        const west = bounds.minLon + (x * (bounds.maxLon - bounds.minLon)) / lonSteps;
        const east = bounds.minLon + ((x + 1) * (bounds.maxLon - bounds.minLon)) / lonSteps;
        rows.push(...(await fetchTile(south, west, north, east)));
      }
    }
    const unique = dedupeAddresses(rows);
    if (!unique.length) throw new Error('Pusty indeks adresów');
    const snapshot = {
      schemaVersion: ADDRESS_SCHEMA_VERSION,
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
    // Awaryjnie: stary snapshot z R2 wygrywa z bazą w ogóle bez adresów.
    if (remote) {
      save(remote);
      console.warn(
        `[addresses] ${city.id}: ${error.message}; odgrzewam snapshot z R2 sprzed ${Math.round((Date.now() - Date.parse(remote.builtAt)) / 86400000)} dni`,
      );
      return remote;
    }
    if (!cached) throw error;
    console.warn(
      `[addresses] ${city.id}: ${error.message}; zachowuję snapshot z ${cached.builtAt}`,
    );
    return cached;
  }
}

export function importAddresses(db, snapshot) {
  db.exec(`CREATE TABLE addresses (
    osm_id TEXT PRIMARY KEY NOT NULL,
    street TEXT NOT NULL,
    house TEXT NOT NULL,
    locality TEXT NOT NULL DEFAULT '',
    lat REAL NOT NULL,
    lon REAL NOT NULL
  )`);
  if (!snapshot) return null;
  const insert = db.prepare(
    'INSERT INTO addresses (osm_id, street, house, locality, lat, lon) VALUES (?, ?, ?, ?, ?, ?)',
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
