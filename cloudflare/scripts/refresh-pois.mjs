/**
 * Odświeża snapshot POI jednego miasta i zostawia go w
 * `cloudflare/dist/poi-cache/<miasto>.json.gz` do uploadu w workflow.
 *
 * Kod wyjścia: 0 = świeży snapshot, 2 = nic do roboty (cache/R2 świeże
 * albo Overpass nie odświeżył), 1 = błąd. Workflow wysyła do R2 tylko 0.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPoiSnapshot, poiSnapshotIsFresh } from './build-pois.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_URL = (process.env.TIMETABLE_PUBLIC_URL || '').replace(/\/$/, '');
/**
 * Cron chodzi co tydzień, więc odświeżamy snapshot starszy niż 3 dni.
 * Świeżość w buildzie to 7 dni; ten próg tylko pomija miasta, które
 * build rozkładu odświeżył całkiem niedawno.
 */
const MAX_AGE_MS = 3 * 86400000;

const city = process.argv
  .slice(2)
  .map((arg) => /^--city=(.+)$/.exec(arg)?.[1])
  .find(Boolean);
if (!city) {
  console.error('Użycie: node refresh-pois.mjs --city=<id>');
  process.exit(1);
}

const started = Date.now();
const snapshot = await loadPoiSnapshot(
  city,
  join(ROOT, 'dist', 'poi-cache'),
  fetch,
  PUBLIC_URL,
  { maxAgeMs: MAX_AGE_MS },
).catch((error) => {
  console.error(`[pois] ${city}: ${error.message}`);
  process.exit(1);
});

const ageMs = Date.now() - Date.parse(snapshot.builtAt);
if (!poiSnapshotIsFresh(snapshot, Date.now(), MAX_AGE_MS)) {
  console.warn(
    `[pois] ${city}: Overpass nie odświeżył snapshotu (${Math.round(ageMs / 86400000)} dni), zostawiam R2.`,
  );
  process.exit(2);
}

console.log(
  `[pois] ${city}: ${snapshot.count} POI, snapshot ${snapshot.builtAt} (${((Date.now() - started) / 1000).toFixed(0)}s)`,
);
