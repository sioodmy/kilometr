import { gunzipSync, strFromU8 } from 'fflate';
import type { SharedConnection } from '../../src/sharing/connection';
import {
  selectLegStops,
  tripShard,
  type StaticStop,
  type TimetableShard,
} from '../../src/sharing/timetable';

export async function loadSharedStops(
  journey: SharedConnection,
  signal: AbortSignal,
): Promise<StaticStop[][]> {
  const transit = journey.legs.filter(
    (leg) => leg.mode !== 'walk' && leg.trip && leg.board && leg.alight,
  );
  if (!transit.length) return journey.legs.map(() => []);
  const root = new URL(`./timetables/${journey.city}/`, document.baseURI);
  const manifestResponse = await fetch(new URL('manifest.json', root), { signal });
  if (!manifestResponse.ok) throw new Error('Timetable unavailable');
  const manifest = (await manifestResponse.json()) as { v: number; version: string };
  if (manifest.v !== 1 || !/^[a-f0-9]{64}$/.test(manifest.version))
    throw new Error('Invalid timetable');
  const shards = new Map<string, TimetableShard>();
  await Promise.all(
    [...new Set(transit.map((leg) => tripShard(leg.trip!)))].map(async (key) => {
      const response = await fetch(new URL(`${manifest.version}/${key}.json.gz`, root), { signal });
      if (!response.ok) throw new Error('Timetable shard unavailable');
      const bytes = new Uint8Array(await response.arrayBuffer());
      // Hosting może rozpakować gzip przez Content-Encoding przed przekazaniem do JS.
      const decoded = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
      const data = JSON.parse(strFromU8(decoded)) as TimetableShard;
      if (data.v !== 1 || !data.trips || typeof data.trips !== 'object')
        throw new Error('Invalid timetable shard');
      shards.set(key, data);
    }),
  );
  return journey.legs.map((leg) => {
    if (!leg.trip || leg.mode === 'walk') return [];
    const stops = shards.get(tripShard(leg.trip))?.trips[leg.trip];
    return Array.isArray(stops) ? selectLegStops(leg, stops) : [];
  });
}
