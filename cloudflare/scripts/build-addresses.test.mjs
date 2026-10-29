import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  addressesFromElements,
  addressSnapshotIsFresh,
  dedupeAddresses,
  importAddresses,
  loadAddressSnapshot,
} from './build-addresses.mjs';

const bounds = { minLat: 50.95, maxLat: 51.25, minLon: 16.7, maxLon: 17.25 };
const element = {
  type: 'node',
  id: 1,
  lat: 51.1,
  lon: 17.0,
  tags: { 'addr:street': 'Grunwaldzka', 'addr:housenumber': '12A', 'addr:city': 'Wrocław' },
};

test('Importuje tylko rzeczywiste adresy i zachowuje miejscowości', () => {
  const rows = addressesFromElements(
    [
      element,
      { ...element, id: 2, lat: NaN },
      { ...element, id: 3, lat: 52 },
      { ...element, id: 4, tags: { 'addr:interpolation': 'even' } },
      {
        ...element,
        type: 'way',
        id: 5,
        lat: undefined,
        lon: undefined,
        center: { lat: 51.1, lon: 17 },
      },
      { ...element, id: 6, tags: { 'addr:place': 'Rynek', 'addr:housenumber': '7' } },
    ],
    bounds,
  );
  assert.equal(rows.length, 3);
  assert.equal(dedupeAddresses(rows).length, 2);
  assert.equal(rows.find((row) => row[0] === 'node/6')[3], '');
  assert.equal(
    addressSnapshotIsFresh({ schemaVersion: 1, count: 1, builtAt: new Date().toISOString() }),
    true,
  );
  assert.equal(
    addressSnapshotIsFresh({ schemaVersion: 1, count: 0, builtAt: new Date().toISOString() }),
    false,
  );
});

test('Snapshot jest per miasto, trafia do SQLite i działa z cache bez sieci', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kilometr-addresses-'));
  const db = new DatabaseSync(':memory:');
  try {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return new Response(JSON.stringify({ elements: [element] }));
    };
    const snapshot = await loadAddressSnapshot('wroclaw', dir, fetcher);
    assert.equal(snapshot.count, 1);
    assert.ok(calls > 1);
    const metadata = importAddresses(db, snapshot);
    assert.equal(metadata.license, 'ODbL-1.0');
    assert.equal(db.prepare('SELECT street, house, locality FROM addresses').get().house, '12A');
    const offline = async () => {
      throw new Error('offline');
    };
    assert.deepEqual(await loadAddressSnapshot('wroclaw', dir, offline), snapshot);
    await assert.rejects(loadAddressSnapshot('krakow', dir, offline), /offline/);

    snapshot.builtAt = '2020-01-01T00:00:00.000Z';
    const file = join(dir, 'wroclaw.json.gz');
    writeFileSync(file, gzipSync(JSON.stringify(snapshot)));
    const partial = async () =>
      new Response(JSON.stringify({ elements: [element], remark: 'runtime error: timeout' }));
    const previous = await loadAddressSnapshot('wroclaw', dir, partial);
    assert.equal(previous.builtAt, snapshot.builtAt);
    assert.equal(JSON.parse(gunzipSync(readFileSync(file))).builtAt, snapshot.builtAt);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

test('Pierwszy build odrzuca częściową odpowiedź HTTP 200', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kilometr-addresses-partial-'));
  try {
    const fetcher = async () =>
      new Response(JSON.stringify({ elements: [element], remark: 'runtime error: timeout' }));
    await assert.rejects(loadAddressSnapshot('wroclaw', dir, fetcher), /Niepełna odpowiedź/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('Padnięte instancje Overpassa przejmuje lustro, a wszystkie naraz kończą błędem', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kilometr-addresses-mirrors-'));
  try {
    const calls = [];
    const failing = async (url) => {
      calls.push(url);
      return new Response('', { status: 502 });
    };
    await assert.rejects(loadAddressSnapshot('wroclaw', dir, failing), /HTTP 502/);
    // Bez cache padnie na pierwszym kafelku: po jednej próbie na każde lustro.
    assert.equal(calls.length, 3);

    calls.length = 0;
    let attempt = 0;
    const recovers = async (url) => {
      calls.push(url);
      // Główna instancja i pierwsze lustro padają, trzecie zawsze działa.
      return attempt++ % 3 === 2
        ? new Response(JSON.stringify({ elements: [element] }))
        : new Response('', { status: 504 });
    };
    const snapshot = await loadAddressSnapshot('wroclaw', dir, recovers);
    assert.equal(snapshot.count, 1);
    // 6 kafelków × 3 instancje: dwie padają, za każdym razem ratuje lustro.
    assert.equal(calls.length, 18);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('Brak pierwszego snapshotu pozwala zachować sam rozkład', () => {
  const db = new DatabaseSync(':memory:');
  try {
    assert.equal(importAddresses(db, null), null);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM addresses').get().n, 0);
  } finally {
    db.close();
  }
});
