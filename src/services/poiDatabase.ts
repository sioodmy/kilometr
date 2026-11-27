// Lokalny magazyn wieloźródłowych baz POI w expo-sqlite.
// Każde wspierane miasto ma osobny plik `kilometr-pois-<cityId>.db`, niezależny
// od codziennego rozkładu jazdy. Schemat korzysta wyłącznie ze standardowego
// SQLite B-tree (poi_terms WITHOUT ROWID + siatka cell_coarse/cell_fine) bez
// FTS5 i R-Tree, dzięki czemu działa na Androidzie, iOS, F-Droid i Web WASM.

import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { getCity, hasPoiDatabase } from '../cities';
import { expandTokenSynonyms } from '../gtfs/fuzzy';
import { normalizePolish } from '../gtfs/geo';
import { getActiveCityIdSync } from './cityStore';
import { kvGet, kvRemove, kvSet } from './storage';
import { poiGridCellsInBbox, type PoiCategory } from './poiClassify';

const WEB_POI_READY_PREFIX = 'kilometr.web.poi_ready:';
const WEB_POI_BYTES_PREFIX = 'kilometr.web.poi_bytes:';
const WEB_POI_ACTIVE_KEY = 'kilometr.web.poi_active_db';

export interface RichPoiRow {
  id: number;
  ext_id: string;
  name: string;
  norm_name: string;
  category: PoiCategory;
  subtype: string;
  address: string;
  street: string | null;
  district: string | null;
  city: string | null;
  lat: number;
  lon: number;
  rank: number;
  min_zoom: number;
  tags: string;
  sources: string;
  website: string | null;
  phone: string | null;
  hours: string | null;
  rating: number | null;
}

export interface MapPoiItem {
  id: number;
  name: string;
  category: PoiCategory;
  subtype: string;
  address: string;
  lat: number;
  lon: number;
  rank: number;
  minZoom: number;
}

export interface PoiDbHandle {
  getAllAsync<T>(sql: string, ...params: SQLite.SQLiteVariadicBindParams): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: SQLite.SQLiteVariadicBindParams): Promise<T | null>;
  runAsync(sql: string, ...params: SQLite.SQLiteVariadicBindParams): Promise<SQLite.SQLiteRunResult>;
  execAsync(sql: string): Promise<void>;
}

export function poiDbFileName(cityId?: string): string {
  const city = getCity(cityId ?? getActiveCityIdSync());
  return `kilometr-pois-${city.id}.db`;
}

const dbPromises = new Map<string, Promise<SQLite.SQLiteDatabase>>();
const swapGates = new Map<string, { promise: Promise<void>; release: () => void }>();
const closingDbs = new Map<string, Promise<void>>();
const poiDbPresence = new Map<string, boolean>();

interface DbFlights {
  active: number;
  idle: Array<() => void>;
}

const flights = new WeakMap<SQLite.SQLiteDatabase, DbFlights>();
const closedDbs = new WeakSet<SQLite.SQLiteDatabase>();
const handles = new WeakMap<SQLite.SQLiteDatabase, Map<string, PoiDbHandle>>();
const handleStates = new WeakMap<PoiDbHandle, { cityId: string; closed: boolean }>();
const dbHandles = new WeakMap<SQLite.SQLiteDatabase, Set<PoiDbHandle>>();

function trackDb<T>(db: SQLite.SQLiteDatabase, run: () => Promise<T>): Promise<T> {
  let flight = flights.get(db);
  if (!flight) {
    flight = { active: 0, idle: [] };
    flights.set(db, flight);
  }
  const counter = flight;
  counter.active++;
  return run().finally(() => {
    counter.active--;
    if (counter.active > 0 || counter.idle.length === 0) return;
    const idle = counter.idle;
    counter.idle = [];
    for (const wake of idle) wake();
  });
}

function drainDb(db: SQLite.SQLiteDatabase): Promise<void> {
  const flight = flights.get(db);
  if (!flight || flight.active === 0) return Promise.resolve();
  return new Promise((resolve) => flight.idle.push(resolve));
}

function markDbClosed(db: SQLite.SQLiteDatabase): void {
  closedDbs.add(db);
  for (const handle of dbHandles.get(db) ?? []) {
    const st = handleStates.get(handle);
    if (st) st.closed = true;
  }
}

export function beginPoiDbSwap(cityId: string): void {
  if (swapGates.has(cityId)) return;
  let release!: () => void;
  const promise = new Promise<void>((res) => {
    release = res;
  });
  swapGates.set(cityId, { promise, release });
}

export function endPoiDbSwap(cityId: string): void {
  const gate = swapGates.get(cityId);
  if (!gate) return;
  swapGates.delete(cityId);
  gate.release();
}

export async function closePoiDb(cityId: string): Promise<void> {
  const name = poiDbFileName(cityId);
  const p = dbPromises.get(name);
  if (!p) return;
  dbPromises.delete(name);
  const close = (async () => {
    try {
      const db = await p;
      markDbClosed(db);
      await drainDb(db);
      await db.closeAsync();
    } catch {
      // best-effort: plik jest zaraz podmieniany albo usuwany
    }
  })();
  const prev = closingDbs.get(name);
  const gate = prev ? Promise.all([prev, close]).then(() => undefined) : close;
  closingDbs.set(name, gate);
  await close;
  if (closingDbs.get(name) === gate) closingDbs.delete(name);
}

async function openRawPoiDb(name: string): Promise<SQLite.SQLiteDatabase> {
  const existing = dbPromises.get(name);
  if (existing) return existing;
  const p = (async () => {
    const db = await SQLite.openDatabaseAsync(name);
    const nativePragmas =
      Platform.OS === 'web' ? '' : 'PRAGMA journal_mode = WAL; PRAGMA mmap_size = 33554432;';
    await db.execAsync(`
      ${nativePragmas}
      PRAGMA cache_size = -8000;
      PRAGMA temp_store = MEMORY;
      PRAGMA busy_timeout = 10000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    `);
    return db;
  })();
  dbPromises.set(name, p);
  p.catch(() => {
    if (dbPromises.get(name) === p) dbPromises.delete(name);
  });
  return p;
}

function wrapHandle(db: SQLite.SQLiteDatabase, cityId: string): PoiDbHandle {
  let byCity = handles.get(db);
  if (!byCity) {
    byCity = new Map();
    handles.set(db, byCity);
  }
  const cached = byCity.get(cityId);
  if (cached) return cached;

  const state = { cityId, closed: closedDbs.has(db) };
  const run = <T>(direct: () => Promise<T>, again: (next: PoiDbHandle) => Promise<T>): Promise<T> =>
    state.closed ? getPoiDbHandle(state.cityId).then(again) : trackDb(db, direct);

  const handle: PoiDbHandle = {
    getAllAsync: (sql, ...params) =>
      run(() => db.getAllAsync(sql, ...params), (next) => next.getAllAsync(sql, ...params)),
    getFirstAsync: (sql, ...params) =>
      run(() => db.getFirstAsync(sql, ...params), (next) => next.getFirstAsync(sql, ...params)),
    runAsync: (sql, ...params) =>
      run(() => db.runAsync(sql, ...params), (next) => next.runAsync(sql, ...params)),
    execAsync: (sql) => run(() => db.execAsync(sql), (next) => next.execAsync(sql)),
  };
  handleStates.set(handle, state);
  byCity.set(cityId, handle);
  const set = dbHandles.get(db);
  if (set) set.add(handle);
  else dbHandles.set(db, new Set([handle]));
  return handle;
}

export async function getPoiDbHandle(cityId?: string): Promise<PoiDbHandle> {
  const resolved = getCity(cityId ?? getActiveCityIdSync()).id;
  const gate = swapGates.get(resolved);
  if (gate) return gate.promise.then(() => getPoiDbHandle(resolved));
  const name = poiDbFileName(resolved);
  const closing = closingDbs.get(name);
  if (closing) return closing.then(() => getPoiDbHandle(resolved));
  const db = await openRawPoiDb(name);
  return wrapHandle(db, resolved);
}

/** Zapisuje znacznik gotowości bazy POI w OPFS (web), trzymając max 1 bazę POI naraz. */
export async function markWebPoiDbReady(dbName: string, sizeBytes: number): Promise<void> {
  if (Platform.OS !== 'web') return;
  await kvSet(`${WEB_POI_READY_PREFIX}${dbName}`, '1');
  if (Number.isFinite(sizeBytes) && sizeBytes > 0) {
    await kvSet(`${WEB_POI_BYTES_PREFIX}${dbName}`, String(Math.round(sizeBytes)));
  }
  await kvSet(WEB_POI_ACTIVE_KEY, dbName);
}

export async function clearWebPoiDbReady(dbName: string): Promise<void> {
  if (Platform.OS !== 'web') return;
  await kvRemove(`${WEB_POI_READY_PREFIX}${dbName}`);
  await kvRemove(`${WEB_POI_BYTES_PREFIX}${dbName}`);
  const active = await kvGet(WEB_POI_ACTIVE_KEY);
  if (active === dbName) await kvRemove(WEB_POI_ACTIVE_KEY);
}

async function isWebPoiDbReady(dbName: string): Promise<boolean> {
  return (await kvGet(`${WEB_POI_READY_PREFIX}${dbName}`)) === '1';
}

export async function getWebPoiDbBytes(dbName: string): Promise<number | null> {
  const raw = await kvGet(`${WEB_POI_BYTES_PREFIX}${dbName}`);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Na webie trzymamy co najwyżej 1 aktywną bazę POI w OPFS (limit 6 uchwytów VFS). */
export async function evictOtherWebPoiDbs(keepDbName: string): Promise<void> {
  if (Platform.OS !== 'web') return;
  const prev = await kvGet(WEB_POI_ACTIVE_KEY);
  if (!prev || prev === keepDbName) return;
  const existing = dbPromises.get(prev);
  if (existing) {
    dbPromises.delete(prev);
    try {
      const db = await existing;
      markDbClosed(db);
      await drainDb(db);
      await db.closeAsync();
    } catch {}
  }
  await SQLite.deleteDatabaseAsync(prev).catch(() => {});
  await clearWebPoiDbReady(prev);
  const oldCity = prev.replace(/^kilometr-pois-/, '').replace(/\.db$/, '');
  if (oldCity) poiDbPresence.set(oldCity, false);
}

export function setPoiDbPresenceCache(cityId: string, ready: boolean): void {
  poiDbPresence.set(cityId, ready);
}

export function hasPoiDbSync(cityId?: string): boolean {
  const resolved = getCity(cityId ?? getActiveCityIdSync()).id;
  if (!hasPoiDatabase(resolved)) return false;
  return poiDbPresence.get(resolved) === true;
}

export async function hasPoiDb(cityId?: string): Promise<boolean> {
  const resolved = getCity(cityId ?? getActiveCityIdSync()).id;
  if (!hasPoiDatabase(resolved)) {
    poiDbPresence.set(resolved, false);
    return false;
  }
  const name = poiDbFileName(resolved);
  try {
    if (Platform.OS === 'web') {
      if (!(await isWebPoiDbReady(name))) {
        poiDbPresence.set(resolved, false);
        return false;
      }
    } else {
      const FileSystem = await import('expo-file-system/legacy');
      const base = FileSystem.documentDirectory;
      if (base) {
        const main = `${base.replace(/\/+$/, '')}/SQLite/${name}`;
        const info = await FileSystem.getInfoAsync(main);
        if (!info.exists || (typeof info.size === 'number' && info.size < 4096)) {
          poiDbPresence.set(resolved, false);
          return false;
        }
      }
    }
    const db = await getPoiDbHandle(resolved);
    const row = await db.getFirstAsync<{ n: number }>('SELECT EXISTS(SELECT 1 FROM pois) AS n');
    const ok = (row?.n ?? 0) > 0;
    poiDbPresence.set(resolved, ok);
    return ok;
  } catch {
    poiDbPresence.set(resolved, false);
    return false;
  }
}

export async function poiDbCount(cityId?: string): Promise<number> {
  if (!(await hasPoiDb(cityId))) return 0;
  try {
    const db = await getPoiDbHandle(cityId);
    const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM pois');
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function getPoiDbMeta(key: string, cityId?: string): Promise<string | null> {
  try {
    const db = await getPoiDbHandle(cityId);
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function setPoiDbMeta(key: string, value: string, cityId?: string): Promise<void> {
  const db = await getPoiDbHandle(cityId);
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
}

const POI_SELECT_COLS =
  'p.id, p.ext_id, p.name, p.norm_name, p.category, p.subtype, p.address, p.street, p.district, p.city, p.lat, p.lon, p.rank, p.min_zoom, p.tags, p.sources, p.website, p.phone, p.hours, p.rating';

/**
 * Szybkie wyszukiwanie kandydatów przez odwrócony indeks prefiksowy `poi_terms`.
 * Najpierw ścisłe prefiksy tokenów (`term >= tok AND term < tok\uffff`), przy
 * skąpych wynikach i dłuższym słowie fallback po 2-znakowym prefiksie (pod literówki).
 */
export async function queryRichPoiCandidates(
  query: string,
  cityId?: string,
  limit = 80,
): Promise<RichPoiRow[]> {
  if (!(await hasPoiDb(cityId))) return [];
  const normQ = normalizePolish(query.trim());
  if (!normQ || normQ.length < 2) return [];
  const tokens = normQ
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (!tokens.length) return [];

  const db = await getPoiDbHandle(cityId);

  // Dla pojedynczego lub wielu tokenów budujemy zapytanie z podzapytań INTERSECT (bez FTS5).
  const subQueries: string[] = [];
  const params: (string | number)[] = [];
  for (const tok of tokens.slice(0, 4)) {
    const variants = expandTokenSynonyms(tok).filter((v) => v.length >= 2);
    const list = variants.length ? variants.slice(0, 3) : [tok];
    if (list.length === 1) {
      subQueries.push('SELECT poi_id FROM poi_terms WHERE term >= ? AND term < ?');
      params.push(list[0], `${list[0]}\uffff`);
    } else {
      const union = list
        .map(() => 'SELECT poi_id FROM poi_terms WHERE term >= ? AND term < ?')
        .join(' UNION ');
      subQueries.push(`SELECT poi_id FROM (${union})`);
      for (const v of list) params.push(v, `${v}\uffff`);
    }
  }

  const rows = await db.getAllAsync<RichPoiRow>(
    `SELECT ${POI_SELECT_COLS}
     FROM pois p
     JOIN (${subQueries.join(' INTERSECT ')}) m ON m.poi_id = p.id
     ORDER BY p.rank DESC
     LIMIT ?`,
    ...params,
    limit,
  );

  // Złożona nazwa wpisana jednym ciągiem lub bez spacji (np. "galeriadominikanska").
  if (rows.length < 5 && tokens.length > 1) {
    const joined = tokens.join('');
    if (joined.length >= 4) {
      const extra = await db.getAllAsync<RichPoiRow>(
        `SELECT ${POI_SELECT_COLS}
         FROM pois p
         JOIN (SELECT DISTINCT poi_id FROM poi_terms WHERE term >= ? AND term < ?) m ON m.poi_id = p.id
         ORDER BY p.rank DESC
         LIMIT ?`,
        joined,
        `${joined}\uffff`,
        limit,
      );
      const seen = new Set(rows.map((r) => r.id));
      for (const item of extra) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          rows.push(item);
        }
      }
    }
  }

  // Fallback na literówki: zawężenie po pierwszych 2 znakach głównego tokenu.
  if (rows.length < 5) {
    const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length >= 4) {
      const p2 = longest.slice(0, 2);
      const fuzzyPool = await db.getAllAsync<RichPoiRow>(
        `SELECT ${POI_SELECT_COLS}
         FROM pois p
         JOIN (SELECT DISTINCT poi_id FROM poi_terms WHERE term >= ? AND term < ? LIMIT 400) m ON m.poi_id = p.id
         ORDER BY p.rank DESC
         LIMIT ?`,
        p2,
        `${p2}\uffff`,
        Math.max(limit, 120),
      );
      const seen = new Set(rows.map((r) => r.id));
      for (const item of fuzzyPool) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          rows.push(item);
        }
      }
    }
  }

  return rows;
}

/** Pobiera widoczne POI dla aktualnego kadru mapy z wykorzystaniem indeksu siatki B-tree. */
export async function queryPoisInViewport(
  bbox: readonly [number, number, number, number],
  zoom: number,
  cityId?: string,
  limit = 160,
): Promise<MapPoiItem[]> {
  if (zoom < 12) return [];
  if (!(await hasPoiDb(cityId))) return [];
  const level = zoom < 14 ? 'coarse' : 'fine';
  const cells = poiGridCellsInBbox(bbox, level, 220);
  if (!cells.length) return [];

  const [west, south, east, north] = bbox;
  const maxMinZoom = Math.min(16, Math.max(12, Math.floor(zoom)));
  const col = level === 'coarse' ? 'cell_coarse' : 'cell_fine';
  const placeholders = cells.map(() => '?').join(',');
  const db = await getPoiDbHandle(cityId);

  const rows = await db.getAllAsync<{
    id: number;
    name: string;
    category: PoiCategory;
    subtype: string;
    address: string;
    lat: number;
    lon: number;
    rank: number;
    min_zoom: number;
  }>(
    `SELECT id, name, category, subtype, address, lat, lon, rank, min_zoom
     FROM pois
     WHERE ${col} IN (${placeholders})
       AND min_zoom <= ?
       AND lat BETWEEN ? AND ?
       AND lon BETWEEN ? AND ?
     ORDER BY rank DESC
     LIMIT ?`,
    ...cells,
    maxMinZoom,
    south,
    north,
    west,
    east,
    limit,
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    subtype: r.subtype,
    address: r.address,
    lat: r.lat,
    lon: r.lon,
    rank: r.rank,
    minZoom: r.min_zoom,
  }));
}

export async function getPoiById(id: number, cityId?: string): Promise<RichPoiRow | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  if (!(await hasPoiDb(cityId))) return null;
  const db = await getPoiDbHandle(cityId);
  return db.getFirstAsync<RichPoiRow>(
    `SELECT ${POI_SELECT_COLS} FROM pois p WHERE p.id = ? LIMIT 1`,
    id,
  );
}
