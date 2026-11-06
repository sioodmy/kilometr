/**
 * Sprawdzenie live dla pociągów ogólnopolskich na PRAWDZIWYCH danych:
 * pozycje zbiorkomu dopasowane do kursów z realnego buildu polska.
 *
 * Użycie: tsx --require ./scripts/stub-expo.cjs scripts/check-national-live.ts
 * Wymaga: POLSKA_DB (domyślnie /tmp/opencode/bench/national-real.db).
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const POLSKA_DB = process.env.POLSKA_DB ?? '/tmp/opencode/bench/national-real.db';
const POLSKA_DB_NAME = 'kilometr-gtfs-polska.db';

const requireCjs = createRequire(__filename);
const Module = requireCjs('node:module') as typeof import('node:module');
const files: Record<string, string> = { [POLSKA_DB_NAME]: POLSKA_DB };

mkdirSync('/tmp/kilometr-check', { recursive: true });
const shimPath = '/tmp/kilometr-check/node-sqlite-live.cjs';
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
  const { fetchNationalRailLive, fetchZbStopDepartures, fetchZbVehicleAlerts } = await import(
    '../src/services/nationalRailLive'
  );

  // 1. Odjazdy ze stacji: peron, numer, nazwa handlowa.
  const departures = await fetchZbStopDepartures('Wrocław Główny');
  check('tablica odjazdów Wrocław Główny', departures.length > 0, `${departures.length} odjazdów`);
  const withPlatform = departures.filter((d) => d.platform);
  check('odjazdy mają peron', withPlatform.length > 0, `${withPlatform.length}/${departures.length}`);
  const named = departures.filter((d) => d.trainName);
  check('odjazdy mają nazwę handlową', named.length > 0, named[0]?.trainName ?? '');
  if (departures[0]) {
    console.log(
      `  ${departures[0].line} ${departures[0].trainNumber} ${departures[0].trainName ?? ''} peron=${departures[0].platform ?? '-'} delay=${departures[0].delaySec}s`,
    );
  }

  // 2. Pozycje dopasowane do kursów z bazy PLK.
  const live = await fetchNationalRailLive([
    {
      tripId: undefined,
      fromStop: 'Wrocław Główny',
      toStop: 'Warszawa Centralna',
      fromLat: 51.0979,
      fromLon: 17.0374,
      toLat: 52.2286,
      toLon: 21.0031,
      line: 'IC',
      trainNumber: '3830',
      railAgency: 'IC',
    },
  ]);
  check('pozycje dopasowane do kursów PLK', live.delays.size > 0, `${live.delays.size} pociągów`);
  for (const [tripId, delay] of [...live.delays.entries()].slice(0, 3)) {
    const pos = live.positions.get(tripId);
    console.log(`  ${tripId} delay=${delay}s pozycja=${pos ? `${pos.lat.toFixed(3)},${pos.lon.toFixed(3)}` : 'brak'}`);
  }

  // 3. Alerty per pociąg (SSE): vehicle id z dopasowania pozycji.
  const [firstTrip, vehicle] = [...live.zbTripIds.entries()][0] ?? [];
  if (firstTrip && vehicle) {
    const alerts = await fetchZbVehicleAlerts(vehicle);
    check('strumień alertów odpowiada', Array.isArray(alerts), `${alerts.length} alertów dla ${firstTrip}`);
    if (alerts[0]) console.log(`  ${alerts[0].title}`);
  } else {
    check('pozycja ma id kursu zbiorkomu', false, 'brak zbTripIds');
  }

  console.log(failures === 0 ? '\nPASS: live pociągów ogólnopolskich' : `\nFAIL: ${failures} asercji`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
