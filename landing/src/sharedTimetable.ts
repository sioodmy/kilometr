import { gunzipSync, strFromU8 } from 'fflate';
import type { SharedConnection } from '../../src/sharing/connection';
import { clipPath, decodePath, type RoutePoint } from '../../src/sharing/geometry';
import {
  selectLegStops,
  tripShard,
  type StaticStop,
  type TimetableShard,
} from '../../src/sharing/timetable';

export interface SharedWebTimetableData {
  stops: StaticStop[][];
  paths: (RoutePoint[] | null)[];
}

export async function loadSharedTimetable(
  journey: SharedConnection,
  signal: AbortSignal,
): Promise<SharedWebTimetableData> {
  const transit = journey.legs.filter(
    (leg) => leg.mode !== 'walk' && leg.trip && leg.board && leg.alight,
  );
  if (!transit.length) {
    return {
      stops: journey.legs.map(() => []),
      paths: journey.legs.map((leg) => (leg.path ? decodePath(leg.path) : null)),
    };
  }

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

  // Dociągamy geometrię tras równolegle, jeśli shard wskazuje klucz shape.
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
  const shapes = new Map<string, string>();
  await Promise.all(
    shapeKeys.map(async (key) => {
      try {
        const response = await fetch(
          new URL(`${manifest.version}/shapes/${key}.json.gz`, root),
          { signal },
        );
        if (!response.ok) return;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const decoded = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
        const data = JSON.parse(strFromU8(decoded)) as { v?: number; path?: string };
        if (data.v === 1 && typeof data.path === 'string') shapes.set(key, data.path);
      } catch {
        /* Brak kształtu nie blokuje przystanków ani mapy po współrzędnych. */
      }
    }),
  );

  const stops: StaticStop[][] = [];
  const paths: (RoutePoint[] | null)[] = [];

  for (const leg of journey.legs) {
    if (!leg.trip || leg.mode === 'walk') {
      stops.push([]);
      paths.push(leg.path ? decodePath(leg.path) : null);
      continue;
    }
    const shard = shards.get(tripShard(leg.trip));
    const full = shard?.trips[leg.trip];
    const selected = Array.isArray(full) ? selectLegStops(leg, full) : [];
    stops.push(selected);

    let pts = leg.path ? decodePath(leg.path) : null;
    if (!pts) {
      const shapeKey = shard?.tripShapes?.[leg.trip];
      const encoded = shapeKey ? shapes.get(shapeKey) : undefined;
      const decodedShape = encoded ? decodePath(encoded) : null;
      const fromLat = leg.fromLat ?? selected[0]?.lat;
      const fromLon = leg.fromLon ?? selected[0]?.lon;
      const toLat = leg.toLat ?? selected.at(-1)?.lat;
      const toLon = leg.toLon ?? selected.at(-1)?.lon;
      if (
        decodedShape &&
        fromLat != null &&
        fromLon != null &&
        toLat != null &&
        toLon != null
      ) {
        pts = clipPath(decodedShape, [fromLat, fromLon], [toLat, toLon]);
      }
    }
    paths.push(pts);
  }

  return { stops, paths };
}
