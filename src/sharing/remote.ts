import { gunzipSync, strFromU8 } from 'fflate';
import type { SharedConnection } from './connection';
import { clipPath, decodePath, encodePath } from './geometry';
import { selectLegStops, tripShard, type TimetableShard } from './timetable';
import type { LegStop } from '../types/models';

export interface SharedDetails {
  journey: SharedConnection;
  stops: LegStop[][];
}

export async function loadSharedDetails(
  journey: SharedConnection,
  root: string,
  signal: AbortSignal,
): Promise<SharedDetails> {
  const base = `${root.replace(/\/$/, '')}/${journey.city}`;
  const response = await fetch(`${base}/manifest.json`, { signal });
  if (!response.ok) throw new Error('Shared timetable unavailable');
  const manifest = await response.json();
  if (manifest.v !== 1 || !/^[a-f0-9]{64}$/.test(manifest.version))
    throw new Error('Invalid shared timetable');
  const shards = new Map<string, TimetableShard>();
  const keys = [...new Set(journey.legs.flatMap((leg) => (leg.trip ? [tripShard(leg.trip)] : [])))];
  await Promise.all(
    keys.map(async (key) => {
      const response = await fetch(`${base}/${manifest.version}/${key}.json.gz`, { signal });
      if (!response.ok) throw new Error('Shared trip unavailable');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const data: TimetableShard = JSON.parse(
        strFromU8(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes),
      );
      if (data.v !== 1 || !data.trips) throw new Error('Invalid shared trip');
      shards.set(key, data);
    }),
  );
  const shapes = new Map<string, string>();
  const shapeKeys = [
    ...new Set(
      journey.legs.flatMap((leg) => {
        const key =
          leg.trip && !leg.path
            ? shards.get(tripShard(leg.trip))?.tripShapes?.[leg.trip]
            : undefined;
        return key && /^[a-f0-9]{16}$/.test(key) ? [key] : [];
      }),
    ),
  ];
  await Promise.all(
    shapeKeys.map(async (key) => {
      const response = await fetch(`${base}/${manifest.version}/shapes/${key}.json.gz`, { signal });
      if (!response.ok) return;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const data = JSON.parse(
        strFromU8(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes),
      );
      if (data.v === 1 && typeof data.path === 'string') shapes.set(key, data.path);
    }),
  );
  const stops: LegStop[][] = [];
  const legs = journey.legs.map((leg, index) => {
    const shard = leg.trip ? shards.get(tripShard(leg.trip)) : undefined;
    const full = leg.trip ? shard?.trips[leg.trip] : undefined;
    const selected = Array.isArray(full) ? selectLegStops(leg, full) : [];
    stops[index] = selected.map((stop, seq) => ({
      stopId: stop.id,
      name: stop.name,
      seq,
      lat: stop.lat,
      lon: stop.lon,
      arriveSec: stop.arrival,
      departSec: stop.departure,
    }));
    const first = selected[0],
      last = selected.at(-1);
    const fromLat = leg.fromLat ?? first?.lat,
      fromLon = leg.fromLon ?? first?.lon;
    const toLat = leg.toLat ?? last?.lat,
      toLon = leg.toLon ?? last?.lon;
    let path = leg.path;
    const shape = leg.trip ? shard?.tripShapes?.[leg.trip] : undefined;
    const encoded = shape ? shapes.get(shape) : undefined;
    const points = encoded ? decodePath(encoded) : null;
    if (!path && points && fromLat != null && fromLon != null && toLat != null && toLon != null) {
      const clipped = clipPath(points, [fromLat, fromLon], [toLat, toLon]);
      if (clipped) path = encodePath(clipped);
    }
    return { ...leg, fromLat, fromLon, toLat, toLon, path };
  });
  return { journey: { ...journey, legs }, stops };
}
