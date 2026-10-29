import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { parseCsvLine, parseTripsContent } from '../src/gtfs/csv';
import { encodePath, type RoutePoint } from '../src/sharing/geometry';

export async function loadShareShapes(tripIds: string[], sources: unknown, localZip?: string) {
  const tripShapes = new Map<string, string>();
  const shapes = new Map<string, string>();
  const ids = new Set(tripIds);
  const aliases = new Map<string, string[]>();
  for (const id of tripIds) {
    const raw = id.split(':').at(-1)!;
    aliases.set(raw, [...(aliases.get(raw) ?? []), id]);
  }
  const urls = new Set<string>();
  if (sources && typeof sources === 'object') {
    for (const value of Object.values(sources)) {
      if (!value || typeof value !== 'object') continue;
      const source: Record<string, unknown> = value;
      if (source.kind !== 'gtfs-zip') continue;
      for (const url of [
        source.downloadUrl,
        source.url,
        ...(Array.isArray(source.feeds) ? source.feeds : []),
      ])
        if (typeof url === 'string' && url.startsWith('https://')) urls.add(url);
    }
  }
  for (const [index, url] of (localZip ? [localZip] : [...urls]).entries()) {
    try {
      const bytes = localZip
        ? await readFile(url)
        : new Uint8Array(
            await (async () => {
              const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return response.arrayBuffer();
            })(),
          );
      const entries = unzipSync(bytes, {
        filter: (file) => /(^|\/)(trips|shapes)\.txt$/i.test(file.name),
      });
      const tripsFile = Object.entries(entries).find(([name]) =>
        /(^|\/)trips\.txt$/i.test(name),
      )?.[1];
      const shapesFile = Object.entries(entries).find(([name]) =>
        /(^|\/)shapes\.txt$/i.test(name),
      )?.[1];
      if (!tripsFile || !shapesFile) continue;
      const needed = new Set<string>();
      for (const trip of parseTripsContent(strFromU8(tripsFile))) {
        const matches = ids.has(trip.trip_id) ? [trip.trip_id] : (aliases.get(trip.trip_id) ?? []);
        if (matches.length !== 1 || !trip.shape_id) continue;
        tripShapes.set(matches[0], `${index}:${trip.shape_id}`);
        needed.add(trip.shape_id);
      }
      const lines = strFromU8(shapesFile)
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/);
      const header = parseCsvLine(lines.shift() ?? '');
      const id = header.indexOf('shape_id'),
        lat = header.indexOf('shape_pt_lat');
      const lon = header.indexOf('shape_pt_lon'),
        seq = header.indexOf('shape_pt_sequence');
      if (Math.min(id, lat, lon, seq) < 0) continue;
      const points = new Map<string, { seq: number; point: RoutePoint }[]>();
      for (const line of lines) {
        const fields = parseCsvLine(line),
          shape = fields[id];
        if (!needed.has(shape)) continue;
        const point: RoutePoint = [Number(fields[lat]), Number(fields[lon])];
        if (!point.every(Number.isFinite)) continue;
        const list = points.get(shape) ?? [];
        list.push({ seq: Number(fields[seq]), point });
        points.set(shape, list);
      }
      for (const [id, pointsBySeq] of points) {
        if (pointsBySeq.length >= 2)
          shapes.set(
            `${index}:${id}`,
            encodePath(pointsBySeq.sort((a, b) => a.seq - b.seq).map((row) => row.point)),
          );
      }
    } catch (error) {
      console.warn(`Geometria GTFS niedostępna: ${url}`, error);
    }
  }
  return { tripShapes, shapes };
}
