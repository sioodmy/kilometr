import {
  ensureFootTileFromPackAsync,
  hasFootTileSync,
  loadFootTileAsync,
  routeFootWaypointsAsync,
  type LocalRouteMode,
} from '../../modules/kilometr-raptor';

export type FootCoord = [number, number];
export type TransitLocalMode = Exclude<LocalRouteMode, 'foot'>;

const MAP_SOURCE_URL =
  process.env.EXPO_PUBLIC_MAP_SOURCE_URL ?? 'https://tiles.openfreemap.org/planet';
const TILE_ZOOM = 14;
const TILE_COUNT = 2 ** TILE_ZOOM;
const DEFAULT_TILE_TEMPLATE =
  'https://tiles.openfreemap.org/planet/20261004_113936_pt/{z}/{x}/{y}.pbf';
const TILE_FETCH_TIMEOUT_MS = 8000;
const MAX_TRANSIT_CHUNK_TILES = 64;
const TILE_LOAD_CONCURRENCY = 6;

let resolvedTileTemplate: string | null = null;
let templatePromise: Promise<string> | null = null;
const inflightTiles = new Map<string, Promise<boolean>>();

function lonToTileX(lon: number, z = TILE_ZOOM): number {
  const n = 2 ** z;
  return Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n)));
}

function latToTileY(lat: number, z = TILE_ZOOM): number {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return Math.max(0, Math.min(n - 1, Math.floor(y)));
}

function approxDistMeters(a: FootCoord, b: FootCoord): number {
  const cosLat = Math.cos(((a[0] + b[0]) * Math.PI) / 360);
  return Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * cosLat);
}

function tilesForWaypoints(waypoints: ReadonlyArray<FootCoord>): Array<[number, number]> {
  if (waypoints.length === 0) return [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lat, lon] of waypoints) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  if (!Number.isFinite(minLat)) return [];

  // Pad by ~250m so routes near a tile border have the adjacent tile loaded.
  const padLat = 0.0023;
  const padLon = 0.0036;
  const x0 = lonToTileX(minLon - padLon);
  const x1 = lonToTileX(maxLon + padLon);
  const y0 = latToTileY(maxLat + padLat);
  const y1 = latToTileY(minLat - padLat);

  const out: Array<[number, number]> = [];
  const maxSpan = 3;
  for (let x = x0; x <= Math.min(x1, x0 + maxSpan); x++) {
    for (let y = y0; y <= Math.min(y1, y0 + maxSpan); y++) {
      out.push([x, y]);
    }
  }
  return out;
}

function addCorridorTilesForHop(
  from: FootCoord,
  to: FootCoord,
  mode: TransitLocalMode,
  tiles: Map<string, [number, number]>,
): boolean {
  const padLat = mode === 'rail' ? 0.009 : 0.0052;
  const padLon = mode === 'rail' ? 0.0145 : 0.0084;
  const distM = approxDistMeters(from, to);
  const steps = Math.max(1, Math.min(48, Math.ceil(distM / 600)));

  for (let s = 0; s <= steps; s++) {
    const f = s / steps;
    const lat = from[0] + (to[0] - from[0]) * f;
    const lon = from[1] + (to[1] - from[1]) * f;
    const x0 = lonToTileX(lon - padLon);
    const x1 = lonToTileX(lon + padLon);
    const y0 = latToTileY(lat + padLat);
    const y1 = latToTileY(lat - padLat);
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= TILE_COUNT) continue;
      for (let y = y0; y <= y1; y++) {
        if (y < 0 || y >= TILE_COUNT) continue;
        tiles.set(`${x}/${y}`, [x, y]);
      }
    }
    if (tiles.size > MAX_TRANSIT_CHUNK_TILES) return false;
  }
  return true;
}

async function resolveTileUrlTemplate(signal?: AbortSignal): Promise<string> {
  if (resolvedTileTemplate) return resolvedTileTemplate;
  if (MAP_SOURCE_URL.includes('{z}') && MAP_SOURCE_URL.includes('{x}')) {
    resolvedTileTemplate = MAP_SOURCE_URL;
    return MAP_SOURCE_URL;
  }
  if (!templatePromise) {
    templatePromise = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      try {
        const res = await fetch(MAP_SOURCE_URL, { signal: ctrl.signal });
        if (res.ok) {
          const body = (await res.json()) as { tiles?: string[] };
          const first = body?.tiles?.[0];
          if (typeof first === 'string' && first.includes('{x}') && first.includes('{y}')) {
            resolvedTileTemplate = first;
            return first;
          }
        }
      } catch {
        // Fallback to pinned planet tile template.
      } finally {
        clearTimeout(timer);
      }
      resolvedTileTemplate = DEFAULT_TILE_TEMPLATE;
      return DEFAULT_TILE_TEMPLATE;
    })().finally(() => {
      templatePromise = null;
    });
  }
  if (signal?.aborted) return DEFAULT_TILE_TEMPLATE;
  return templatePromise;
}

async function fetchTileBytes(
  tx: number,
  ty: number,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const template = await resolveTileUrlTemplate(signal);
  const url = template
    .replace('{z}', String(TILE_ZOOM))
    .replace('{x}', String(tx))
    .replace('{y}', String(ty));

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), TILE_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return buf.byteLength > 0 ? new Uint8Array(buf) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function ensureSingleFootTile(
  tx: number,
  ty: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (hasFootTileSync(tx, ty)) return true;

  const key = `${tx}/${ty}`;
  const existing = inflightTiles.get(key);
  if (existing) return existing;

  const task = (async () => {
    try {
      if (await ensureFootTileFromPackAsync(tx, ty)) {
        return true;
      }
      if (signal?.aborted) return false;
      const bytes = await fetchTileBytes(tx, ty, signal);
      if (!bytes || bytes.byteLength === 0) return false;
      return await loadFootTileAsync(tx, ty, bytes);
    } finally {
      inflightTiles.delete(key);
    }
  })();

  inflightTiles.set(key, task);
  return task;
}

async function ensureTilesLoaded(
  tiles: ReadonlyArray<[number, number]>,
  signal?: AbortSignal,
): Promise<boolean> {
  let anyLoaded = false;
  for (let offset = 0; offset < tiles.length; offset += TILE_LOAD_CONCURRENCY) {
    if (signal?.aborted) return false;
    const batch = tiles.slice(offset, offset + TILE_LOAD_CONCURRENCY);
    const res = await Promise.all(batch.map(([x, y]) => ensureSingleFootTile(x, y, signal)));
    if (res.some(Boolean)) anyLoaded = true;
  }
  return anyLoaded && !signal?.aborted;
}

function canRouteFootSync(waypoints: ReadonlyArray<FootCoord>): boolean {
  const tiles = tilesForWaypoints(waypoints);
  if (tiles.length === 0) return false;
  return tiles.every(([tx, ty]) => hasFootTileSync(tx, ty));
}

export async function routeFootLocal(
  waypoints: ReadonlyArray<FootCoord>,
  signal?: AbortSignal,
): Promise<FootCoord[] | null> {
  if (waypoints.length < 2) return null;

  if (canRouteFootSync(waypoints)) {
    const fast = await routeFootWaypointsAsync(waypoints, 'foot');
    if (fast && fast.length >= 2) return fast;
  }

  const tiles = tilesForWaypoints(waypoints);
  if (tiles.length === 0) return null;

  const results = await Promise.all(
    tiles.map(([tx, ty]) => ensureSingleFootTile(tx, ty, signal)),
  );
  if (signal?.aborted || !results.some(Boolean)) {
    return null;
  }

  return routeFootWaypointsAsync(waypoints, 'foot');
}

/** Wyznacza przebieg linii (tramwaj, metro, kolej, autobus) po kafelkach wektorowych z14. */
export async function routeTransitLocal(
  waypoints: ReadonlyArray<FootCoord>,
  mode: TransitLocalMode,
  signal?: AbortSignal,
): Promise<FootCoord[] | null> {
  if (waypoints.length < 2 || signal?.aborted) return null;
  for (const pt of waypoints) {
    if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return null;
  }

  const path: FootCoord[] = [];
  let startIdx = 0;

  while (startIdx < waypoints.length - 1) {
    if (signal?.aborted) return null;

    const chunkTiles = new Map<string, [number, number]>();
    let endIdx = startIdx;
    const anchorStart = path.at(-1) ?? waypoints[startIdx];

    for (let i = startIdx + 1; i < waypoints.length; i++) {
      const hopFrom = i === startIdx + 1 ? anchorStart : waypoints[i - 1];
      const hopTo = waypoints[i];
      const trial = new Map(chunkTiles);
      const fits = addCorridorTilesForHop(hopFrom, hopTo, mode, trial);
      if (!fits) {
        if (endIdx === startIdx) {
          // Pojedynczy odcinek między dwoma przystankami przekracza budżet kafelków.
          return null;
        }
        break;
      }
      chunkTiles.clear();
      for (const [k, v] of trial) chunkTiles.set(k, v);
      endIdx = i;
    }

    const needed = Array.from(chunkTiles.values());
    if (needed.length === 0) return null;

    const ok = await ensureTilesLoaded(needed, signal);
    if (!ok || signal?.aborted) return null;

    const chunkWaypoints: FootCoord[] = [anchorStart, ...waypoints.slice(startIdx + 1, endIdx + 1)];
    const part = await routeFootWaypointsAsync(chunkWaypoints, mode);
    if (!part || part.length < 2) return null;

    if (path.length > 0) {
      const prevEnd = path[path.length - 1];
      const nextStart = part[0];
      if (approxDistMeters(prevEnd, nextStart) > 250) {
        return null;
      }
      const skipFirst = approxDistMeters(prevEnd, nextStart) < 2;
      path.push(...(skipFirst ? part.slice(1) : part));
    } else {
      path.push(...part);
    }

    startIdx = endIdx;
  }

  return signal?.aborted || path.length < 2 ? null : path;
}
