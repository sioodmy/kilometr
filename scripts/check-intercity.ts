/**
 * Sprawdzenie planera między miastami na PRAWDZIWYCH danych:
 * baza miasta (Wrocław) + baza ogólnopolska z buildu build-polska.mjs.
 * Podmienia expo-sqlite na node:sqlite (Node 22) i liczy planConnections
 * oraz planIntercity tak, jak zrobiłaby to aplikacja.
 *
 * Użycie: tsx --require ./scripts/stub-expo.cjs scripts/check-intercity.ts
 * Wymaga: WROCLAW_DB i POLSKA_DB (ścieżki do plików .db).
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const WROCLAW_DB = process.env.WROCLAW_DB ?? '/tmp/opencode/bench/wroclaw.db';
const POLSKA_URL = process.env.POLSKA_URL;
const POLSKA_DB = process.env.POLSKA_DB ?? '/tmp/opencode/bench/national-real.db';
const POLSKA_DB_NAME = 'kilometr-gtfs-polska.db';

// Shim expo-sqlite → node:sqlite. stub-expo podmienia moduł przez Module._load,
// więc rejestrujemy go TUTAJ (przed importem gtfsDatabase) i nadpisujemy atrapę.
const requireCjs = createRequire(__filename);
const Module = requireCjs('node:module') as typeof import('node:module');
const files: Record<string, string> = {
  'kilometr-gtfs-wroclaw.db': WROCLAW_DB,
  [POLSKA_DB_NAME]: POLSKA_DB,
};

/**
 * Prawdziwy tor pobierania z R2 (gdy POLSKA_URL podane): manifest → .gz →
 * gunzip → plik w katalogu SQLite. Sprawdza rozmiar i integrity_check,
 * tak jak timetableSync na telefonie.
 */
async function fetchNationalFromUrl(baseUrl: string): Promise<string> {
  const { gunzipSync } = requireCjs('node:zlib') as typeof import('node:zlib');
  const base = baseUrl.replace(/\/$/, '');
  const manifest = (await (await fetch(`${base}/polska/manifest.json`)).json()) as {
    version: string;
    db: { sizeBytes: number; uncompressedSizeBytes?: number };
  };
  const gz = Buffer.from(
    await (await fetch(`${base}/polska/db/kilometr-gtfs-polska.db.gz`)).arrayBuffer(),
  );
  if (gz.length !== manifest.db.sizeBytes) {
    throw new Error(`rozmiar gz ${gz.length} != manifest ${manifest.db.sizeBytes}`);
  }
  const raw = gunzipSync(gz);
  if (manifest.db.uncompressedSizeBytes && raw.length !== manifest.db.uncompressedSizeBytes) {
    throw new Error(`rozmiar po gunzip ${raw.length} != manifest ${manifest.db.uncompressedSizeBytes}`);
  }
  const out = '/tmp/kilometr-check/kilometr-gtfs-polska.db';
  writeFileSync(out, raw);
  const { DatabaseSync } = requireCjs('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(out);
  const check = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  const counts = db.prepare(
    'SELECT (SELECT COUNT(*) FROM stops) s, (SELECT COUNT(*) FROM trips) t, (SELECT COUNT(*) FROM stop_times) st',
  ).get() as { s: number; t: number; st: number };
  db.close();
  if (check.integrity_check !== 'ok' || counts.s <= 0 || counts.t <= 0 || counts.st <= 0) {
    throw new Error(`weryfikacja bazy: ${JSON.stringify({ check, counts })}`);
  }
  console.log(`PASS pobranie z R2: ${manifest.version}, ${(gz.length / 1048576).toFixed(1)} MB gz, ${counts.s} stacji, ${counts.t} kursów`);
  return out;
}

mkdirSync('/tmp/kilometr-check', { recursive: true });
const shimPath = '/tmp/kilometr-check/node-sqlite-shim.cjs';
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
// Module._load nie jest w typach Node, a to jedyny punkt podmiany atrapy
// z stub-expo.cjs (ten sam wzorzec co scripts/check-*.ts).
type PatchedModule = typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const patched = Module as PatchedModule;
const originalLoad = patched._load;
patched._load = function patchedLoad(
  this: unknown,
  request: string,
  ...rest: [unknown, boolean]
) {
  if (request === 'expo-sqlite') return sqliteShim;
  return originalLoad.call(this, request, ...rest);
};

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  if (POLSKA_URL) {
    files[POLSKA_DB_NAME] = await fetchNationalFromUrl(POLSKA_URL);
  }
  const { planConnections } = await import('../src/services/routing/engine');
  const { planIntercity } = await import('../src/services/routing/intercity');
  const { polskaStore } = await import('../src/services/routing/store');

  const origin = { lat: 51.1095, lon: 17.0568 }; // Plac Grunwaldzki
  const base = {
    fromTitle: 'Plac Grunwaldzki',
    fromLat: origin.lat,
    fromLon: origin.lon,
    maxTransfers: 2,
    modes: 'all' as const,
    minTransferSec: 120,
    trainMinTransferSec: 300,
    maxWalkM: 800,
    walkSpeedMps: 1.34,
    trainsEnabled: true,
    cableEnabled: true,
  };

  // 1. Noga miejska do dworca (jak dziś, bez kolei ogólnopolskiej).
  const city = await planConnections({
    ...base,
    toTitle: 'Wrocław Główny',
    toLat: 51.0979,
    toLon: 17.0374,
  });
  check('miasto -> dworzec zwraca połączenia', city.length > 0, `${city.length} opcji`);
  if (city[0]) {
    console.log(`  ${city[0].departAt} -> ${city[0].arriveAt} (${city[0].durationMin} min, ${city[0].transfers} przesiadek)`);
    console.log(`  ${city[0].legs.map((l) => `${l.mode}:${l.line ?? ''}`).join(' + ')}`);
  }

  // 2. Planer intercity: Plac Grunwaldzki -> Warszawa Centralna.
  await polskaStore.load();
  check('magazyn polska ma stacje', polskaStore.stops.size > 3000, `${polskaStore.stops.size} stacji`);

  const intercity = await planIntercity({
    ...base,
    toTitle: 'Warszawa Centralna',
    toLat: 52.2286,
    toLon: 21.0031,
    toId: 'stop-pl:33605',
  });
  check('Plac Grunwaldzki -> Warszawa Centralna ma warianty', intercity.connections.length > 0, `${intercity.connections.length} opcji`);
  for (const c of intercity.connections.slice(0, 3)) {
    const trains = c.legs.filter((l) => l.mode === 'train');
    console.log(`  ${c.departAt} -> ${c.arriveAt} (${c.durationMin} min, ${c.transfers} przesiadek) ${trains.map((t) => `${t.line} ${t.trainName ?? ''} peron=${t.platformCode ?? '-'}`).join(', ')}`);
    console.log(`    ${c.legs.map((l) => `${l.mode}:${l.line ?? ''}`).join(' + ')}`);
  }
  // Wariant z nogą miejską (nie tylko przesiadka IC->EIC na stacji).
  const withCity = intercity.connections.find((c) => c.legs.some((l) => l.mode === 'tram' || l.mode === 'bus'));
  const first = withCity ?? intercity.connections[0];
  if (first) {
    check('są dwie nogi tranzytowe (miasto + pociąg)', first.legs.filter((l) => l.mode !== 'walk').length >= 2);
    const train = first.legs.find((l) => l.mode === 'train');
    check('pociąg ma numer/nazwę z bazy', !!train?.trainNumber || !!train?.trainName, `${train?.line} ${train?.trainName ?? ''}`);
    check('pociąg ma peron', !!train?.platformCode, train?.platformCode ?? 'brak');
    check('pociąg to pl: trip', !!train?.tripId?.startsWith('pl:'), train?.tripId ?? '');
    check('noga miejska kończy się na stacji', first.legs.some((l) => l.mode !== 'walk' && l.mode !== 'train'));
  }

  // 3. Krótki dystans: Plac Grunwaldzki -> Oborniki Śląskie (KD/PR).
  const oborniki = await planIntercity({
    ...base,
    toTitle: 'Oborniki Śląskie',
    toLat: 51.3006,
    toLon: 16.9139,
    toId: 'stop-pl:58784',
  });
  check('Plac Grunwaldzki -> Oborniki Śląskie ma warianty', oborniki.connections.length > 0, `${oborniki.connections.length} opcji`);
  for (const c of oborniki.connections.slice(0, 2)) {
    const trains = c.legs.filter((l) => l.mode === 'train');
    console.log(`  ${c.departAt} -> ${c.arriveAt} ${trains.map((t) => `${t.line} ${t.trainName ?? ''}`).join(', ')}`);
  }

  // 4. Data w przyszłości (+7 dni).
  const futureSec = 7 * 86400 + 9 * 3600;
  const future = await planIntercity({
    ...base,
    toTitle: 'Warszawa Centralna',
    toLat: 52.2286,
    toLon: 21.0031,
    toId: 'stop-pl:33605',
    departureTimeSec: futureSec,
  });
  check('za 7 dni też planuje', future.connections.length > 0, `${future.connections.length} opcji`);
  if (future.connections[0]) {
    const c = future.connections[0];
    check('data w przyszłości zachowana', c.departureSec >= 7 * 86400, `departureSec=${c.departureSec}`);
    console.log(`  ${c.departAt} -> ${c.arriveAt} (offset ${Math.floor(c.departureSec / 86400)} dni)`);
  }

  // 5. Tryb przyjazd na: bądź na 18:00.
  const arriveBy = 18 * 3600;
  const byArrival = await planIntercity({
    ...base,
    toTitle: 'Warszawa Centralna',
    toLat: 52.2286,
    toLon: 21.0031,
    toId: 'stop-pl:33605',
    arriveBySec: arriveBy,
  });
  check('tryb przyjazdu zwraca warianty', byArrival.connections.length > 0, `${byArrival.connections.length} opcji`);
  if (byArrival.connections[0]) {
    check('przyjazd przed terminem', (byArrival.connections[0].arrivalSec ?? 0) <= arriveBy, `${byArrival.connections[0].arriveAt}`);
  }

  // 6. Stacja -> stacja: Katowice -> Warszawa Centralna bez pustego spaceru na początku.
  const katowice = Array.from(polskaStore.stops.values()).find((s) => s.stop_name === 'Katowice');
  const warszawa = Array.from(polskaStore.stops.values()).find((s) => s.stop_name === 'Warszawa Centralna');
  if (katowice && warszawa) {
    const stationToStation = await planIntercity({
      ...base,
      fromTitle: katowice.stop_name ?? 'Katowice',
      fromLat: katowice.stop_lat,
      fromLon: katowice.stop_lon,
      fromId: 'stop-pl:' + katowice.stop_id,
      toTitle: warszawa.stop_name ?? 'Warszawa Centralna',
      toLat: warszawa.stop_lat,
      toLon: warszawa.stop_lon,
      toId: 'stop-pl:' + warszawa.stop_id,
      departureTimeSec: undefined,
      arriveBySec: undefined,
    });
    check('stacja -> stacja (Katowice -> Warszawa) ma warianty', stationToStation.connections.length > 0, `${stationToStation.connections.length} opcji`);
    for (const c of stationToStation.connections) {
      const firstLeg = c.legs[0];
      const hasEmptyWalk = firstLeg?.mode === 'walk' && (firstLeg.walkM ?? 0) <= 0;
      check('pierwsza noga to nie pusty spacer 0m', !hasEmptyWalk, `${firstLeg?.mode} ${firstLeg?.fromStop} -> ${firstLeg?.toStop}`);
    }
  }

  console.log(failures === 0 ? '\nPASS: planer intercity na prawdziwych danych' : `\nFAIL: ${failures} asercji`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
