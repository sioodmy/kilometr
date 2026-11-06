/**
 * Sprawdzenie geometrii torów z bazy `polska` (shapes PLK) na prawdziwych
 * danych: wycinek shape'u między stacjami, uproszczenie, długość vs prosta.
 *
 * Użycie: tsx --require ./scripts/stub-expo.cjs scripts/check-rail-shape.ts
 * Wymaga: POLSKA_DB (domyślnie świeży build z cloudflare/dist/polska).
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const POLSKA_DB = process.env.POLSKA_DB ?? 'cloudflare/dist/polska/kilometr-gtfs-polska.db';
const POLSKA_DB_NAME = 'kilometr-gtfs-polska.db';

const requireCjs = createRequire(__filename);
const Module = requireCjs('node:module') as typeof import('node:module');
const files: Record<string, string> = { [POLSKA_DB_NAME]: POLSKA_DB };

mkdirSync('/tmp/kilometr-check', { recursive: true });
const shimPath = '/tmp/kilometr-check/node-sqlite-shape.cjs';
writeFileSync(
  shimPath,
  `
const { DatabaseSync } = require('node:sqlite');
const files = ${JSON.stringify(files)};
function normalize(name) {
  const base = String(name).replace(/^file:\\/\\//, '').split('/').pop() || String(name);
  return files[base] || base;
}
function openDatabaseAsync(name) {
  const db = new DatabaseSync(normalize(name));
  return Promise.resolve({
    execAsync: async (sql) => { db.exec(sql); },
    getAllAsync: async (sql, ...params) => db.prepare(sql).all(...params),
    getFirstAsync: async (sql, ...params) => db.prepare(sql).get(...params) ?? null,
    runAsync: async (sql, ...params) => { const r = db.prepare(sql).run(...params); return { lastInsertRowId: 0, changes: r.changes }; },
    withTransactionAsync: async (task) => { db.exec('BEGIN'); try { await task(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
    closeAsync: async () => db.close(),
  });
}
module.exports = { openDatabaseAsync };
`,
);

const sqliteShim = requireCjs(shimPath) as { openDatabaseAsync: (name: string) => Promise<unknown> };
type PatchedModule = typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const patched = Module as PatchedModule;
const originalLoad = patched._load;
patched._load = function patchedLoad(this: unknown, request: string, ...rest: [unknown, boolean]) {
  if (request === 'expo-sqlite') return sqliteShim;
  return originalLoad.call(this, request, ...rest);
};

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  const { buildMapRoute, resolveGeometry } = await import('../src/services/routeGeometry');
  const { getNationalDb } = await import('../src/services/gtfsDatabase');

  const db = await getNationalDb();
  const svcToday = await db.getAllAsync<{ service_id: string }>(
    "SELECT service_id FROM calendar_dates WHERE date = '20261106' AND exc = 1",
  );
  check('baza ma serwisy na dziś', svcToday.length > 0, `${svcToday.length}`);

  const shapes = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM shapes');
  check('baza ma shapes', (shapes?.n ?? 0) > 2000, `${shapes?.n}`);

  // Kurs Wrocław Główny -> Warszawa (stacje po id z bazy).
  const stops = await db.getAllAsync<{ stop_id: string; name: string; lat: number; lon: number }>(
    'SELECT stop_id, name, lat, lon FROM stops',
  );
  const byName = new Map(stops.map((s) => [s.name, s]));
  const byId = new Map(stops.map((s) => [s.stop_id, s]));
  const wroclaw = byName.get('Wrocław Główny');
  const warszawa = byName.get('Warszawa Centralna');
  if (!wroclaw || !warszawa) throw new Error('brak stacji w bazie');

  const trips = await db.getAllAsync<{ trip_id: string; train_number: string; headsign: string }>(
    `SELECT t.trip_id, t.train_number, t.headsign
     FROM trips t JOIN stop_times st ON st.trip_id = t.trip_id
     WHERE st.stop_id = ? AND t.headsign LIKE 'Warszawa%'
     LIMIT 5`,
    wroclaw.stop_id,
  );
  check('są kursy Wrocław -> Warszawa', trips.length > 0, trips[0]?.train_number ?? '');

  const trip = trips[0];
  const times = await db.getAllAsync<{ stop_id: string; arr_sec: number; dep_sec: number; seq: number }>(
    'SELECT stop_id, arr_sec, dep_sec, seq FROM stop_times WHERE trip_id = ? ORDER BY seq',
    trip.trip_id,
  );
  const nameById = new Map(stops.map((s) => [s.stop_id, s.name]));
  const boardIdx = times.findIndex((t) => t.stop_id === wroclaw.stop_id);
  const alightIdx = times.findIndex(
    (t, i) => i > boardIdx && (t.stop_id === warszawa.stop_id || nameById.get(t.stop_id)?.includes('Warszawa')),
  );
  const board = times[boardIdx];
  const alight = times[alightIdx];
  check('kurs ma obydwie stacje', !!board && !!alight, `${nameById.get(board?.stop_id ?? '')} -> ${nameById.get(alight?.stop_id ?? '')}`);

  // Noga kolejowa jak z planera (MapLeg przez buildMapRoute z Leg).
  const connection = {
    id: 'test-ic',
    fromTitle: 'A',
    toTitle: 'B',
    departInMin: 0,
    departureSec: 0,
    arrivalSec: 0,
    departAt: '00:00',
    arriveAt: '00:00',
    durationMin: 0,
    transfers: 0,
    delayMin: 0,
    live: false,
    legs: [
      {
        id: 'leg-ic',
        mode: 'train' as const,
        line: `IC ${trip.train_number}`,
        direction: trip.headsign,
        fromStop: wroclaw.name,
        toStop: nameById.get(alight.stop_id) ?? '',
        fromStopId: board.stop_id,
        toStopId: alight.stop_id,
        fromLat: wroclaw.lat,
        fromLon: wroclaw.lon,
        toLat: byId.get(alight.stop_id)?.lat,
        toLon: byId.get(alight.stop_id)?.lon,
        departAt: '00:00',
        arriveAt: '00:00',
        stopsCount: alightIdx - boardIdx,
        live: false,
        tripId: trip.trip_id,
        intermediateStops: times.slice(boardIdx, alightIdx + 1).map((t) => ({
          stopId: t.stop_id,
          name: nameById.get(t.stop_id) ?? '',
          lat: byId.get(t.stop_id)?.lat,
          lon: byId.get(t.stop_id)?.lon,
          seq: t.seq,
          arriveSec: t.arr_sec,
          departSec: t.dep_sec,
        })),
      },
    ],
  };
  const route = buildMapRoute(connection);
  const byLeg = new Map<string, Array<[number, number]>>();
  await resolveGeometry(route, (legId, coords) => byLeg.set(legId, coords));
  const shape = byLeg.get('leg-ic');
  check('geometria torów dociągnięta', !!shape && shape.length > 2, shape ? `${shape.length} punktów` : 'brak');

  if (shape) {
    // Długość po torach vs prosta: tory muszą być DŁUŻSZE od prostej
    // (kolej nie jeździ po linii prostej), ale nie absurd (mniej niż 1.6x).
    const dist = (a: [number, number], b: [number, number]) => {
      const R = 6371000;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(b[0] - a[0]);
      const dLon = toRad(b[1] - a[1]);
      const x =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(x));
    };
    let railM = 0;
    for (let i = 1; i < shape.length; i++) railM += dist(shape[i - 1], shape[i]);
    const crowM = dist(shape[0], shape[shape.length - 1]);
    const ratio = railM / Math.max(crowM, 1);
    check('tory dłuższe od prostej', ratio > 1.05, `${(railM / 1000).toFixed(0)} km vs ${(crowM / 1000).toFixed(0)} km (x${ratio.toFixed(2)})`);
    check('tory nie absurd', ratio < 1.6, `x${ratio.toFixed(2)}`);
    // Punkty na trasie między miastami (nie np. sama prosta: 2 punkty)
    check('wycinek ma punkty pośrednie', shape.length > 20, `${shape.length}`);
    // Środek trasy powinien być „gdzieś po drodze” (linia przez Opole/Częstochowa ok. 50.6-52N)
    const mid = shape[Math.floor(shape.length / 2)];
    check('środek wycinka w rozsądnym miejscu', mid[0] > 50.5 && mid[0] < 52.5, `${mid[0].toFixed(2)},${mid[1].toFixed(2)}`);
  }

  console.log(failures === 0 ? '\nPASS: geometria torów' : `\nFAIL: ${failures} asercji`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
