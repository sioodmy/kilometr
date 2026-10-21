import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { zipSync } from 'fflate';
import { zipEntryNames } from '../src/services/gtfsDownloader';
import { kvGet, kvGetStrict, kvRemove, kvSet } from '../src/services/storage';
import { readSavedRoutes, getSavedRoutes, RoutingService, savedRoutesKey } from '../src/services/api';

const fs = createRequire(import.meta.url)('expo-file-system/legacy');
const files = new Map<string, string>();
const path = (key: string) => `${fs.documentDirectory}.kv/${encodeURIComponent(key)}`;
let pauseRead: (() => Promise<void>) | undefined;
let failWrite = false;

Object.assign(fs, {
  getInfoAsync: async (name: string) => ({ exists: files.has(name) }),
  readAsStringAsync: async (name: string) => {
    const value = files.get(name);
    await pauseRead?.();
    assert.notEqual(value, undefined);
    return value;
  },
  writeAsStringAsync: async (name: string, value: string) => {
    if (failWrite) throw new Error('write failed');
    await Promise.resolve();
    files.set(name, value);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    assert.ok(files.has(from), 'temporary file exists');
    files.set(to, files.get(from)!);
    files.delete(from);
  },
  deleteAsync: async (name: string) => {
    files.delete(name);
  },
});

async function main() {
  await Promise.all([kvSet('writes', 'first'), kvSet('writes', 'last')]);
  assert.equal(files.get(path('writes')), 'last');
  assert.equal(await kvGet('writes'), 'last');

  await Promise.all([kvSet('remove', 'value'), kvRemove('remove')]);
  assert.equal(await kvGet('remove'), null);
  assert.equal(files.has(path('remove')), false);

  files.set(path('read-write'), 'old');
  let started!: () => void;
  let resume!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  pauseRead = async () => {
    started();
    await gate;
  };
  const read = kvGetStrict('read-write');
  await reading;
  const write = kvSet('read-write', 'new');
  resume();
  await Promise.all([read, write]);
  pauseRead = undefined;
  assert.equal(await kvGet('read-write'), 'new');
  assert.equal(files.get(path('read-write')), 'new');

  failWrite = true;
  await kvSet('retry', 'lost');
  failWrite = false;
  await kvSet('retry', 'saved');
  assert.equal(await kvGet('retry'), 'saved');

  const writeThenRead = kvSet('read-after-write', 'saved');
  assert.equal(await kvGet('read-after-write'), 'saved');
  await writeThenRead;

  // Testy parsowania katalogu centralnego ZIP (zipEntryNames)
  const syntheticZip = zipSync({
    'stops.txt': new TextEncoder().encode('stop_id,stop_name\n1,Przystanek\n'),
    'routes.txt': new TextEncoder().encode('route_id,route_short_name\n1,1\n'),
    'folder/subfile_łódź.txt': new TextEncoder().encode('content'),
  });
  const names = zipEntryNames(syntheticZip);
  assert.deepEqual(names, ['stops.txt', 'routes.txt', 'folder/subfile_łódź.txt']);

  // Pusty bufor / uszkodzony nagłówek
  assert.deepEqual(zipEntryNames(new Uint8Array(10)), []);

  // ZIP64 - symulacja wskaźnika 0xFFFFFFFF
  const zip64EOCD = new Uint8Array(22);
  zip64EOCD[0] = 0x50; zip64EOCD[1] = 0x4b; zip64EOCD[2] = 0x05; zip64EOCD[3] = 0x06;
  zip64EOCD[12] = 0xff; zip64EOCD[13] = 0xff; zip64EOCD[14] = 0xff; zip64EOCD[15] = 0xff;
  assert.throws(() => zipEntryNames(zip64EOCD), /ZIP64/);

  // Testy zapisanych tras: readSavedRoutes, getSavedRoutes, saveRoute (deduplikacja i ochrona przed bledem odczytu)
  const routeKey = savedRoutesKey('wroclaw');
  files.delete(path(routeKey));

  // 1. Brak klucza -> pusta tablica
  assert.deepEqual(await readSavedRoutes(routeKey), []);

  // 2. Filtrowanie uszkodzonych wpisow
  const dummyConnection: any = {
    id: 'conn-1',
    fromTitle: 'Start',
    toTitle: 'Koniec',
    departInMin: 5,
    departureSec: 36000,
    departAt: '10:00',
    arriveAt: '10:20',
    durationMin: 20,
    transfers: 0,
    delayMin: 0,
    live: false,
    legs: [],
  };
  files.set(
    path(routeKey),
    JSON.stringify([
      null,
      { id: 'broken' },
      { id: 'conn-1', savedAt: 12345, connection: dummyConnection },
    ]),
  );
  const sanitized = await readSavedRoutes(routeKey);
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].id, 'conn-1');

  // 3. Zapis trasy i aktualizacja istniejacej (deduplikacja)
  await RoutingService.saveRoute(dummyConnection);
  let saved = await readSavedRoutes(routeKey);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 'conn-1');

  // Powtorny save tego samego polaczenia nie tworzy duplikatu
  await RoutingService.saveRoute(dummyConnection);
  saved = await readSavedRoutes(routeKey);
  assert.equal(saved.length, 1);

  // Zapis drugiego polaczenia
  const dummyConnection2 = { ...dummyConnection, id: 'conn-2' };
  await RoutingService.saveRoute(dummyConnection2);
  saved = await readSavedRoutes(routeKey);
  assert.equal(saved.length, 2);

  // Usuniecie polaczenia
  await RoutingService.deleteSavedRoute('conn-1');
  saved = await readSavedRoutes(routeKey);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 'conn-2');

  // 4. Uszkodzony JSON rzuca w readSavedRoutes (nie nadpisuje bazy)
  await kvSet(routeKey, 'corrupted json{');
  await assert.rejects(async () => readSavedRoutes(routeKey));
  assert.deepEqual(await getSavedRoutes(routeKey), []);

  // Proba zapisu przy uszkodzonym JSON nie nadpisuje bazy pusta lista
  await RoutingService.saveRoute(dummyConnection);
  assert.equal(files.get(path(routeKey)), 'corrupted json{');

  console.log('PASS: concurrent writes, removal, stale reads, retry, read after write, zip entry names, saved routes');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
