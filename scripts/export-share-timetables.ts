import { createHash } from 'node:crypto';
import { closeSync, openSync, writeSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import { CITIES } from '../src/cities';
import { tripShard, type StaticStop } from '../src/sharing/timetable';

const output = resolve(
  process.env.SHARE_TIMETABLE_OUTPUT || join(__dirname, '../landing/public/timetables'),
);
const source = process.env.TIMETABLE_PUBLIC_URL || 'https://data.kilometr.app';
const selected = process.argv.find((arg) => arg.startsWith('--city='))?.slice(7);
const localDb = process.argv.find((arg) => arg.startsWith('--db='))?.slice(5);
const cities = CITIES.filter((city) => !selected || city.id === selected);
if (!cities.length || (localDb && cities.length !== 1))
  throw new Error('Podaj poprawne --city dla lokalnej bazy.');

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function exportCity(city: string) {
  const temp = await mkdtemp(join(tmpdir(), 'kilometr-share-'));
  let db: DatabaseSync | undefined;
  const shards = new Map<string, number>();
  try {
    let file: string;
    let version: string;
    if (localDb) {
      file = resolve(localDb);
      version = createHash('sha256')
        .update(await readFile(file))
        .digest('hex');
    } else {
      const manifest = JSON.parse(
        (await download(`${source}/${city}/manifest.json`)).toString(),
      ) as {
        db: { path: string; sha256: string; sizeBytes: number };
      };
      if (manifest.db.path !== `${city}/db/kilometr-gtfs.db.gz`)
        throw new Error('Niepoprawna ścieżka rozkładu.');
      const compressed = await download(`${source}/${manifest.db.path}`);
      version = createHash('sha256').update(compressed).digest('hex');
      if (compressed.length !== manifest.db.sizeBytes || version !== manifest.db.sha256)
        throw new Error('Suma kontrolna rozkładu nie zgadza się.');
      file = join(temp, 'timetable.db');
      await writeFile(file, gunzipSync(compressed));
    }
    db = new DatabaseSync(file, { readOnly: true });
    const query = db.prepare(`SELECT st.trip_id, st.stop_id, s.name, st.arr_sec, st.dep_sec
      FROM stop_times st JOIN stops s ON s.stop_id = st.stop_id ORDER BY st.trip_id, st.seq`);
    let count = 0;
    let currentTrip = '';
    let currentStops: StaticStop[] = [];
    const flush = () => {
      if (!currentStops.length) return;
      const key = tripShard(currentTrip);
      let fd = shards.get(key);
      if (fd === undefined) {
        fd = openSync(join(temp, `${key}.json`), 'w');
        shards.set(key, fd);
        writeSync(fd, '{"v":1,"trips":{');
      } else writeSync(fd, ',');
      writeSync(fd, `${JSON.stringify(currentTrip)}:${JSON.stringify(currentStops)}`);
    };
    for (const row of query.iterate()) {
      const trip = String(row.trip_id);
      if (trip !== currentTrip) {
        flush();
        currentTrip = trip;
        currentStops = [];
      }
      currentStops.push({
        id: String(row.stop_id),
        name: String(row.name),
        arrival: Number(row.arr_sec),
        departure: Number(row.dep_sec),
      });
      count++;
    }
    flush();
    if (!count) throw new Error(`Pusty rozkład: ${city}`);
    const directory = join(output, city);
    // Każdy deploy niesie jeden spójny snapshot, bez baz SQLite w artefakcie Pages.
    await rm(directory, { recursive: true, force: true });
    await mkdir(join(directory, version), { recursive: true });
    let bytes = 0;
    for (const [key, fd] of shards) {
      writeSync(fd, '}}');
      closeSync(fd);
      shards.delete(key);
      const compressed = gzipSync(await readFile(join(temp, `${key}.json`)), { level: 9 });
      bytes += compressed.length;
      await writeFile(join(directory, version, `${key}.json.gz`), compressed);
    }
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({ v: 1, version, builtAt: new Date().toISOString() }),
    );
    console.log(`${city}: ${count} przystanków kursów, ${(bytes / 1048576).toFixed(1)} MB.`);
  } finally {
    for (const fd of shards.values()) closeSync(fd);
    db?.close();
    await rm(temp, { recursive: true, force: true });
  }
}

async function main() {
  for (const city of cities) await exportCity(city.id);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
