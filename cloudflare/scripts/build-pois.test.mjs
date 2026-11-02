import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';

process.env.POI_RETRY_WAIT_MS = '1,1';

import {
  POI_SCHEMA_VERSION,
  poisFromElements,
  poiSnapshotIsFresh,
  dedupePois,
  importPois,
  loadPoiSnapshot,
} from './build-pois.mjs';

const bounds = { minLat: 50.95, maxLat: 51.25, minLon: 16.7, maxLon: 17.25 };
const skyTowerElement = {
  type: 'way',
  id: 54510846,
  center: { lat: 51.0945, lon: 17.0195 },
  tags: {
    name: 'Sky Tower',
    landuse: 'commercial',
    'addr:street': 'Powstańców Śląskich',
    'addr:housenumber': '95',
    'addr:suburb': 'Krzyki',
  },
};

const mallElement = {
  type: 'relation',
  id: 2236522,
  center: { lat: 51.0948, lon: 17.0198 },
  tags: {
    name: 'Galeria Handlowa Sky Tower',
    shop: 'mall',
    'addr:street': 'Powstańców Śląskich',
    'addr:housenumber': '95',
  },
};

test('Importuje tylko rzeczywiste POI, klasyfikuje i filtruje granice', () => {
  const rows = poisFromElements(
    [
      skyTowerElement,
      mallElement,
      { ...skyTowerElement, id: 2, center: { lat: NaN, lon: 17.0 } },
      { ...skyTowerElement, id: 3, center: { lat: 52.5, lon: 17.0 } }, // poza granicami
      { ...skyTowerElement, id: 4, tags: { name: 'Obiekt bez kategorii', other: '123' } }, // brak kategorii
      { ...skyTowerElement, id: 5, tags: { shop: 'mall' } }, // brak nazwy
    ],
    bounds,
  );
  assert.equal(rows.length, 2);
  const skyTower = rows.find((r) => r[0] === 'way/54510846');
  assert.ok(skyTower);
  assert.equal(skyTower[1], 'place');
  assert.equal(skyTower[2], 'place'); // category
  assert.equal(skyTower[3], 'Sky Tower');
  assert.equal(skyTower[4], 'sky tower'); // norm_name
  assert.equal(skyTower[6], 51.0945); // lat
  assert.equal(skyTower[7], 17.0195); // lon
  assert.equal(skyTower[8], 'Powstańców Śląskich 95');
  assert.equal(skyTower[9], 'Krzyki');

  assert.equal(dedupePois(rows).length, 2);
  assert.equal(
    poiSnapshotIsFresh({ schemaVersion: POI_SCHEMA_VERSION, count: 1, builtAt: new Date().toISOString() }),
    true,
  );
  assert.equal(
    poiSnapshotIsFresh({ schemaVersion: POI_SCHEMA_VERSION, count: 0, builtAt: new Date().toISOString() }),
    false,
  );
});

test('Snapshot POI jest per miasto, trafia do SQLite i działa z cache bez sieci', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kilometr-pois-'));
  const db = new DatabaseSync(':memory:');
  try {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return new Response(JSON.stringify({ elements: [skyTowerElement] }));
    };
    const snapshot = await loadPoiSnapshot('wroclaw', dir, fetcher);
    assert.equal(snapshot.count, 1);
    assert.ok(calls >= 1);
    const metadata = importPois(db, snapshot);
    assert.equal(metadata.license, 'ODbL-1.0');
    const row = db.prepare('SELECT name, norm_name, street FROM pois WHERE name = ?').get('Sky Tower');
    assert.equal(row.name, 'Sky Tower');
    assert.equal(row.norm_name, 'sky tower');
    assert.equal(row.street, 'Powstańców Śląskich 95');

    const offline = async () => {
      throw new Error('offline');
    };
    assert.deepEqual(await loadPoiSnapshot('wroclaw', dir, offline), snapshot);
    await assert.rejects(loadPoiSnapshot('krakow', dir, offline), /offline/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    db.close();
  }
});

test('Pierwszy build POI odrzuca częściową odpowiedź HTTP 200', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kilometr-pois-'));
  try {
    const partial = async () =>
      new Response(JSON.stringify({ remark: 'runtime error: timeout', elements: [] }));
    await assert.rejects(loadPoiSnapshot('wroclaw', dir, partial), /Niepełna odpowiedź/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Padnięte instancje Overpassa przejmuje lustro', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kilometr-pois-'));
  try {
    let call = 0;
    const recovers = async () => {
      call++;
      if (call < 3) return new Response('gateway timeout', { status: 504 });
      return new Response(JSON.stringify({ elements: [skyTowerElement] }));
    };
    const snapshot = await loadPoiSnapshot('wroclaw', dir, recovers);
    assert.equal(snapshot.count, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Świeży snapshot z R2 zasila build bez Overpassa i ląduje w cache', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kilometr-pois-'));
  try {
    const builtAt = new Date().toISOString();
    const rows = poisFromElements([skyTowerElement], bounds);
    const remoteSnapshot = {
      schemaVersion: POI_SCHEMA_VERSION,
      city: 'wroclaw',
      bounds,
      builtAt,
      count: rows.length,
      fingerprint: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
      attribution: '© OpenStreetMap contributors',
      license: 'ODbL-1.0',
      licenseUrl: 'https://www.openstreetmap.org/copyright',
      rows,
    };
    const fetcher = async (url) => {
      if (String(url).includes('pois.json.gz')) {
        return new Response(gzipSync(JSON.stringify(remoteSnapshot)), {
          headers: { 'Content-Type': 'application/gzip' },
        });
      }
      throw new Error('Overpass nie powinien być wołany!');
    };
    const snapshot = await loadPoiSnapshot('wroclaw', dir, fetcher, 'https://data.kilometr.app');
    assert.equal(snapshot.count, 1);
    assert.equal(snapshot.fingerprint, remoteSnapshot.fingerprint);
    const cached = JSON.parse(gunzipSync(readFileSync(join(dir, 'wroclaw.json.gz'))).toString('utf8'));
    assert.equal(cached.fingerprint, remoteSnapshot.fingerprint);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('importPois z null zwraca null', () => {
  const db = new DatabaseSync(':memory:');
  try {
    assert.equal(importPois(db, null), null);
  } finally {
    db.close();
  }
});
