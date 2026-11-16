import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGtfsStore, type GtfsStoreBackend } from '../src/services/routing/store';
import type { GtfsDbHandle } from '../src/services/gtfsDatabase';

type StopRow = {
  stop_id: string;
  code: string;
  name: string;
  lat: number;
  lon: number;
  norm: string;
};

const STOP_A: StopRow = {
  stop_id: 'a1',
  code: 'A1',
  name: 'Przystanek A',
  lat: 51.1,
  lon: 17.0,
  norm: 'przystanek a',
};

const STOP_B: StopRow = {
  stop_id: 'b1',
  code: 'B1',
  name: 'Przystanek B',
  lat: 52.2,
  lon: 21.0,
  norm: 'przystanek b',
};

function backendFor(db: GtfsDbHandle): GtfsStoreBackend {
  return {
    getDb: async () => db,
    getActiveServices: async () => new Set<string>(),
    awaitReady: async () => {},
    isImporting: () => false,
    cable: false,
    rustStopIndex: false,
  };
}

function dbWithStops(stops: () => Promise<StopRow[]>): GtfsDbHandle {
  return {
    getAllAsync: async <T>(sql: string): Promise<T[]> => {
      if (sql.includes('FROM stops')) return (await stops()) as T[];
      return [];
    },
    getFirstAsync: async <T>(): Promise<T | null> => null,
    runAsync: async () => ({ lastInsertRowId: 0, changes: 0 }),
    execAsync: async () => {},
    withTransactionAsync: async () => {},
  };
}

test('równoległe load() dzieli jeden przebieg odczytu bazy', async () => {
  let reads = 0;
  const store = new LocalGtfsStore(
    backendFor(
      dbWithStops(async () => {
        reads += 1;
        return [STOP_A];
      }),
    ),
  );

  await Promise.all([store.load(), store.load(), store.load()]);

  assert.equal(reads, 1);
  assert.equal(store.isLoaded, true);
  assert.equal(store.stops.size, 1);
});

test('load rozpoczęty przed zmianą miasta nie podmienia danych nowej bazy', async () => {
  let mode: 'a' | 'b' = 'a';
  let releaseA: () => void = () => {};
  const gateA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });

  const store = new LocalGtfsStore(
    backendFor(
      dbWithStops(async () => {
        if (mode === 'a') {
          await gateA;
          return [STOP_A];
        }
        return [STOP_B];
      }),
    ),
  );

  const staleLoad = store.load();
  // Daj staremu loadowi dojść do pierwszego zapytania (generation już złapany).
  await new Promise<void>((resolve) => setImmediate(resolve));
  store.reset();
  mode = 'b';
  await store.load();

  assert.equal(store.stops.size, 1);
  assert.equal(store.stops.has('b1'), true);

  // Stary load kończy się po nowym i nie może nadpisać map nowego miasta.
  releaseA();
  await staleLoad;

  assert.equal(store.stops.size, 1);
  assert.equal(store.stops.has('b1'), true);
  assert.equal(store.isLoaded, true);
});
