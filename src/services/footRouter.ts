import {
  ensureFootTileFromPackAsync,
  hasFootTileSync,
  loadFootTileAsync,
  routeFootWaypointsAsync,
  routeFootWaypointsSync,
} from '../../modules/kilometr-raptor';

export type FootCoord = [number, number];

const MAP_SOURCE_URL =
  process.env.EXPO_PUBLIC_MAP_SOURCE_URL ?? 'https://tiles.openfreemap.org/planet';
const TILE_ZOOM = 14;
const DEFAULT_TILE_TEMPLATE =
  'https://tiles.openfreemap.org/planet/20261004_113936_pt/{z}/{x}/{y}.pbf';
const TILE_FETCH_TIMEOUT_MS = 8000;

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

function canRouteFootSync(waypoints: ReadonlyArray<FootCoord>): boolean {
  const tiles = tilesForWaypoints(waypoints);
  if (tiles.length === 0) return false;
  return tiles.every(([tx, ty]) => hasFootTileSync(tx, ty));
}

export function routeFootLocalSync(
  waypoints: ReadonlyArray<FootCoord>,
): FootCoord[] | null {
  if (waypoints.length < 2) return null;
  if (!canRouteFootSync(waypoints)) return null;
  return routeFootWaypointsSync(waypoints);
}

export async function routeFootLocal(
  waypoints: ReadonlyArray<FootCoord>,
  signal?: AbortSignal,
): Promise<FootCoord[] | null> {
  if (waypoints.length < 2) return null;

  // Fast path: if all needed tiles are already in the Rust registry, route immediately.
  if (canRouteFootSync(waypoints)) {
    const fast = await routeFootWaypointsAsync(waypoints);
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

  return routeFootWaypointsAsync(waypoints);
}

/** Wyznacza przebieg kolei z kafelków mapy, także z pobranego pakietu offline. */
export async function routeRailLocal(
  waypoints: ReadonlyArray<FootCoord>,
  signal?: AbortSignal,
): Promise<FootCoord[] | null> {
  if (waypoints.length < 2 || signal?.aborted) return null;
  const path: FootCoord[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    if (signal?.aborted) return null;
    const from = path.at(-1) ?? waypoints[i - 1];
    const to = waypoints[i];
    if (![...from, ...to].every(Number.isFinite)) return null;
    const x0 = lonToTileX(from[1]);
    const y0 = latToTileY(from[0]);
    const x1 = lonToTileX(to[1]);
    const y1 = latToTileY(to[0]);
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const tiles = new Map<string, [number, number]>();
    for (let step = 0; step <= steps; step++) {
      const x = Math.round(x0 + ((x1 - x0) * step) / steps);
      const y = Math.round(y0 + ((y1 - y0) * step) / steps);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (x + dx < 0 || y + dy < 0 || x + dx >= 2 ** TILE_ZOOM || y + dy >= 2 ** TILE_ZOOM) continue;
          tiles.set(`${x + dx}/${y + dy}`, [x + dx, y + dy]);
        }
      }
      if (tiles.size > 48) return null;
    }
    const needed = Array.from(tiles.values());
    for (let offset = 0; offset < needed.length; offset += 4) {
      if (signal?.aborted) return null;
      await Promise.all(needed.slice(offset, offset + 4).map(([x, y]) => ensureSingleFootTile(x, y, signal)));
    }
    if (signal?.aborted) return null;
    const part = await routeFootWaypointsAsync([from, to], true);
    if (!part || part.length < 2) return null;
    const start = part[0];
    // Rzut na siatkę kafelka może przesunąć wspólny punkt o ułamek metra.
    if (path.length && (Math.abs(start[0] - from[0]) > 1e-5 || Math.abs(start[1] - from[1]) > 1e-5)) return null;
    path.push(...(path.length ? part.slice(1) : part));
  }
  return signal?.aborted ? null : path;
}
