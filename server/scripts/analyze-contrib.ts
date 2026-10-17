/**
 * Analiza sesji Contributor: przechodzi po plikach JSONL w
 * data/contributor/<deviceId>/<sessionId>.jsonl i wypisuje per sesja:
 * czas, dystans, liczbę ruchów i odległość ostatniego fixa od
 * najbliższego przystanku GTFS (kontrola jakości GPS). Uruchomienie:
 *   npx tsx scripts/analyze-contrib.ts [deviceId]
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config';
import { gtfsStore } from '../src/gtfs/store';

interface SessionHeader {
  kind?: string;
  id?: string;
  deviceId?: string;
  startedAt?: number;
  endedAt?: number | null;
  city?: string;
  line?: string;
  tripId?: string;
  headsign?: string;
  source?: string;
}

interface SampleRow {
  t: number;
  lat?: number;
  lng?: number;
  spd?: number;
  hacc?: number;
  a?: [number, number, number, number];
  moved?: boolean;
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function loadSessions(deviceFilter?: string): { deviceId: string; id: string; header: SessionHeader; samples: SampleRow[] }[] {
  const sessions: { deviceId: string; id: string; header: SessionHeader; samples: SampleRow[] }[] = [];
  if (!fs.existsSync(DATA_ROOT)) return sessions;
  for (const deviceId of fs.readdirSync(DATA_ROOT)) {
    if (deviceFilter && deviceId !== deviceFilter) continue;
    const deviceDir = path.join(DATA_ROOT, deviceId);
    if (!fs.statSync(deviceDir).isDirectory()) continue;
    for (const file of fs.readdirSync(deviceDir)) {
      if (!file.endsWith('.jsonl')) continue;
      try {
        const raw = fs.readFileSync(path.join(deviceDir, file), 'utf8');
        const lines = raw.split('\n').filter((l) => l.trim());
        const header = JSON.parse(lines[0] ?? '{}') as SessionHeader;
        const samples = lines
          .slice(1)
          .map((line) => {
            try {
              return JSON.parse(line) as SampleRow;
            } catch {
              return null;
            }
          })
          .filter((r): r is SampleRow => r !== null && typeof r.t === 'number');
        if (header.id) sessions.push({ deviceId, id: header.id, header, samples });
      } catch (err) {
        console.warn(`[Contributor] skip broken file ${deviceId}/${file}:`, err);
      }
    }
  }
  return sessions.sort((a, b) => (a.header.startedAt ?? 0) - (b.header.startedAt ?? 0));
}

function analyze(samples: SampleRow[]) {
  if (samples.length === 0) return { durationMin: 0, moves: 0, distKm: 0, avgMag: 0, lastStopDist: -1 };
  const first = samples[0];
  const last = samples[samples.length - 1];
  const durationMin = Math.round(((last.t - first.t) / 60000) * 10) / 10;

  let dist = 0;
  let prev: SampleRow | null = null;
  let magSum = 0;
  let magCount = 0;
  let moves = 0;
  for (const s of samples) {
    if (prev?.lat && prev?.lng && s.lat && s.lng) {
      dist += distanceMeters(prev.lat, prev.lng, s.lat, s.lng);
    }
    if (s.a && s.a.length === 4) {
      magSum += s.a[2];
      magCount += 1;
    }
    if (s.moved) moves += 1;
    prev = s;
  }

  let lastStopDist = -1;
  if (last.lat && last.lng) {
    const nearest = gtfsStore.findNearestStops(last.lat, last.lng, 500, 1);
    lastStopDist = nearest.length > 0 ? nearest[0].distanceM : -1;
  }

  return {
    durationMin,
    moves,
    distKm: Math.round(dist / 100) / 10,
    avgMag: magCount > 0 ? Math.round((magSum / magCount) * 100) / 100 : 0,
    lastStopDist,
  };
}

const DATA_ROOT = path.join(config.dataDir, 'contributor');

async function main(): Promise<void> {
  const deviceFilter = process.argv[2];
  await gtfsStore.load();
  const sessions = loadSessions(deviceFilter);
  console.log(`sesje contributor: ${sessions.length}${deviceFilter ? ` (urządzenie: ${deviceFilter})` : ''}`);
  console.log(
    'id | urządzenie | linia | origin | czas(min) | próbki | ruch | km | średnia mg | końcowy fix→przystanek',
  );
  for (const s of sessions) {
    const stats = analyze(s.samples);
    console.log(
      [
        s.id,
        s.deviceId,
        s.header.line || '-',
        s.header.fromTitle ?? s.header.city ?? '-',
        stats.durationMin,
        s.samples.length,
        stats.moves,
        stats.distKm,
        stats.avgMag,
        stats.lastStopDist < 0 ? '>500 m' : `${stats.lastStopDist} m`,
      ].join(' | '),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
