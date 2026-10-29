import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import {
  hasOfflineAddressIndex,
  warmupAddressIndex,
  searchAddresses,
} from '../src/services/addressIndex';
import { setActiveCityId } from '../src/services/cityStore';
import { getGtfsDb } from '../src/services/gtfsDatabase';
import { SearchService } from '../src/services/searchService';

async function main() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE addresses (
    osm_id TEXT PRIMARY KEY, street TEXT, house TEXT, locality TEXT, lat REAL, lon REAL
  )`);
  const insert = sqlite.prepare('INSERT INTO addresses VALUES (?, ?, ?, ?, ?, ?)');
  sqlite.exec('BEGIN');
  for (let street = 0; street < 2000; street++) {
    const suffix = String.fromCharCode(
      97 + (street % 26),
      97 + (Math.floor(street / 26) % 26),
      97 + Math.floor(street / 676),
    );
    for (let number = 1; number <= 50; number++) {
      insert.run(
        `test/${street}/${number}`,
        `Syntetyczna${suffix}`,
        String(number),
        'Wrocław',
        51.1,
        17.0,
      );
    }
  }
  for (const [id, house] of [
    ['node/1', '12'],
    ['node/2', '12A'],
    ['node/3', '120'],
    ['node/4', '14/2'],
  ]) {
    insert.run(id, 'Grunwaldzka', house, 'Wrocław', house === '12A' ? 51.13 : 51.11, 17.05);
  }
  sqlite.exec('COMMIT');

  let addressReads = 0;
  async function attachDatabase(waitForPois?: Promise<void>) {
    const db = await getGtfsDb();
    Object.assign(db, {
      getAllAsync: async (sql: string, ...params: (string | number)[]) => {
        if (!sql.includes('FROM addresses')) {
          if (sql.includes('FROM pois')) await waitForPois;
          return [];
        }
        addressReads++;
        return sqlite.prepare(sql).all(...params);
      },
    });
  }

  const originalFetch = globalThis.fetch;
  let remoteCalls = 0;
  globalThis.fetch = async (input) => {
    if (!String(input).includes('overpass')) remoteCalls++;
    throw new Error('offline');
  };
  try {
    await attachDatabase();
    const loadStart = performance.now();
    assert.equal(await warmupAddressIndex(), true);
    const loadTime = performance.now() - loadStart;
    const readsAfterLoad = addressReads;
    const exact = await searchAddresses('ul. Grunwaldzka 12');
    assert.deepEqual(
      exact.map((hit) => hit.title),
      ['Grunwaldzka 12', 'Grunwaldzka 12A'],
    );
    assert.equal(hasOfflineAddressIndex(), true);
    assert.deepEqual(await searchAddresses('grunwladzka 12'), []);
    assert.equal((await searchAddresses('grun 12'))[0].title, 'Grunwaldzka 12');
    assert.equal((await searchAddresses('grunwaldzka 14/2'))[0].title, 'Grunwaldzka 14/2');
    assert.deepEqual(await searchAddresses('grunwaldzka 13'), []);
    assert.equal((await searchAddresses('grunwaldzka')).length, 1);
    const nearStreet = (await searchAddresses('grunwaldzka', 51.11, 17.05))[0];
    const farStreet = (await searchAddresses('grunwaldzka', 51.13, 17.05))[0];
    assert.equal(nearStreet.id, farStreet.id);
    assert.notEqual(nearStreet.lat, farStreet.lat);
    assert.equal((await searchAddresses('12 grunwaldzka wroclaw'))[0].title, 'Grunwaldzka 12');
    const results = await SearchService.search('Grunwaldzka 12', undefined, 'addresses');
    assert.equal(results[0].title, 'Grunwaldzka 12');
    assert.deepEqual(await SearchService.search('Grunwladzka 12', undefined, 'addresses'), []);
    assert.deepEqual(await SearchService.search('Grunwaldzka 13', undefined, 'addresses'), []);
    assert.equal(remoteCalls, 0);
    assert.equal(addressReads, readsAfterLoad);

    let releasePois = () => {};
    const blockedPois = new Promise<void>((resolve) => {
      releasePois = resolve;
    });
    await attachDatabase(blockedPois);
    let addressShown = () => {};
    const addressReady = new Promise<void>((resolve) => {
      addressShown = resolve;
    });
    const independent = SearchService.search('grunwaldzka 14', undefined, 'independent', (hits) => {
      if (hits.some((hit) => hit.title === 'Grunwaldzka 14/2')) addressShown();
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        addressReady,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Adresy czekają na POI')), 1000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      releasePois();
      await independent;
      await attachDatabase();
    }
    assert.equal(remoteCalls, 0);

    const timings: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await searchAddresses(i % 2 ? 'grunwladzka 12' : 'grunwaldzka 12', 51.11, 17.04);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    assert.equal(addressReads, readsAfterLoad);

    await setActiveCityId('krakow');
    assert.deepEqual(await searchAddresses('grunwaldzka 12'), []);
    await setActiveCityId('wroclaw');
    await attachDatabase();
    assert.equal((await searchAddresses('grunwaldzka 12'))[0].title, 'Grunwaldzka 12');

    await setActiveCityId('krakow');
    const staleDb = await getGtfsDb();
    let releaseRead = () => {};
    let notifyRead = () => {};
    const blockedRead = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const readStarted = new Promise<void>((resolve) => {
      notifyRead = resolve;
    });
    Object.assign(staleDb, {
      getAllAsync: async (sql: string, ...params: (string | number)[]) => {
        notifyRead();
        await blockedRead;
        return sqlite.prepare(sql).all(...params);
      },
    });
    const staleSearch = searchAddresses('grunwaldzka 12');
    await readStarted;
    try {
      await setActiveCityId('wroclaw');
      await attachDatabase();
      assert.equal((await searchAddresses('grunwaldzka 12'))[0].title, 'Grunwaldzka 12');
    } finally {
      releaseRead();
    }
    assert.deepEqual(await staleSearch, []);
    assert.equal((await searchAddresses('grunwaldzka 12'))[0].title, 'Grunwaldzka 12');
    console.log(
      `PASS: SQLite → Rust/WASM → SearchService, offline, prefiksy, brak trafień, numery i zmiana miasta.`,
    );
    console.log(
      `Node/WASM, 100 004 syntetyczne adresy, 2001 ulic: ładowanie ${loadTime.toFixed(1)} ms; zapytania p50 ${timings[50].toFixed(2)} ms, p95 ${timings[95].toFixed(2)} ms.`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
