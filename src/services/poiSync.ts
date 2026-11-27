// Synchronizacja osobnych, skompresowanych baz POI per miasto z R2.
// Wzorzec zgodny z nationalTimetable.ts i timetableSync.ts:
// - pobieranie strumieniowe z weryfikacją rozmiaru i PRAGMA integrity_check,
// - atomowa podmiana z .bak na Android/iOS oraz deserializacja do OPFS na Webie,
// - rzadkie automatyczne odświeżanie (raz na 7 dni) oraz ręczne w Ustawieniach.

import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { gunzipSync } from 'fflate';
import { Platform } from 'react-native';
import { decompressGzipFile } from '../../modules/kilometr-raptor';
import { getCity, hasPoiDatabase } from '../cities';
import { getActiveCityIdSync } from './cityStore';
import { TIMETABLE } from './gtfsConfig';
import {
  beginPoiDbSwap,
  clearWebPoiDbReady,
  closePoiDb,
  endPoiDbSwap,
  evictOtherWebPoiDbs,
  getPoiDbHandle,
  getPoiDbMeta,
  getWebPoiDbBytes,
  hasPoiDb,
  markWebPoiDbReady,
  poiDbCount,
  poiDbFileName,
  setPoiDbMeta,
  setPoiDbPresenceCache,
} from './poiDatabase';

const CHECK_INTERVAL_MS = 7 * 24 * 3600 * 1000;
const AUTO_RETRY_MS = 10 * 60 * 1000;

export interface PoiDbManifest {
  version: string;
  schemaVersion?: number;
  builtAt: string;
  city: string;
  db: {
    path: string;
    sizeBytes: number;
    uncompressedSizeBytes?: number;
    sha256: string;
  };
  stats: {
    total: number;
  };
}

export type PoiDbState =
  | { phase: 'unavailable' }
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'downloading'; progress: number }
  | { phase: 'ready'; version: string | null; count: number; builtAt: string | null; sizeBytes: number | null }
  | { phase: 'error' };

const states = new Map<string, PoiDbState>();
const inFlight = new Map<string, Promise<PoiDbState>>();
const lastAutoAttempt = new Map<string, number>();
const listeners = new Set<(cityId: string, state: PoiDbState) => void>();
const dataListeners = new Set<(cityId: string) => void>();

function setState(cityId: string, next: PoiDbState): void {
  states.set(cityId, next);
  for (const fn of listeners) {
    try {
      fn(cityId, next);
    } catch {
      // słuchacz nie może wywrócić synchronizacji
    }
  }
}

function notifyDataChanged(cityId: string): void {
  for (const fn of dataListeners) {
    try {
      fn(cityId);
    } catch {}
  }
}

export function getPoiDbState(cityId?: string): PoiDbState {
  const resolved = getCity(cityId ?? getActiveCityIdSync()).id;
  if (!hasPoiDatabase(resolved)) return { phase: 'unavailable' };
  return states.get(resolved) ?? { phase: 'idle' };
}

export function subscribePoiDbState(
  listener: (cityId: string, state: PoiDbState) => void,
): () => void {
  listeners.add(listener);
  const currentId = getActiveCityIdSync();
  listener(currentId, getPoiDbState(currentId));
  return () => {
    listeners.delete(listener);
  };
}

/** Powiadamia wyszukiwarkę i mapy o pojawieniu się lub usunięciu bazy POI miasta. */
export function subscribePoiDbChanged(listener: (cityId: string) => void): () => void {
  dataListeners.add(listener);
  return () => {
    dataListeners.delete(listener);
  };
}

function sqliteDirUri(): string {
  const base = FileSystem.documentDirectory;
  if (base) return `${base.replace(/\/+$/, '')}/SQLite`;
  const raw = String(
    (SQLite as unknown as { defaultDatabaseDirectory?: unknown }).defaultDatabaseDirectory ?? '',
  ).replace(/\/+$/, '');
  if (!raw) throw new Error('Brak katalogu SQLite');
  return raw.startsWith('file://') ? raw : `file://${raw}`;
}

async function sqliteUri(name: string): Promise<string> {
  const dir = sqliteDirUri();
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {}
  return `${dir}/${name}`;
}

async function deleteSidecars(uri: string): Promise<void> {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    await FileSystem.deleteAsync(`${uri}${suffix}`, { idempotent: true }).catch(() => {});
  }
}

async function fetchPoiManifest(cityId: string): Promise<PoiDbManifest> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMETABLE.timeoutMs);
  try {
    const res = await fetch(`${TIMETABLE.baseUrl}/${cityId}/pois-manifest.json`, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`POI manifest HTTP ${res.status}`);
    const m = (await res.json()) as PoiDbManifest;
    if (
      !m ||
      typeof m.version !== 'string' ||
      !m.version ||
      !m.db ||
      typeof m.db.path !== 'string' ||
      typeof m.db.sizeBytes !== 'number' ||
      m.db.sizeBytes < 1000 ||
      !m.stats ||
      m.stats.total <= 0
    ) {
      throw new Error('Niepełny manifest POI');
    }
    return m;
  } finally {
    clearTimeout(timer);
  }
}

function poiDbDownloadUrl(manifest: PoiDbManifest): string {
  const path = manifest.db.path.startsWith('/') ? manifest.db.path : `/${manifest.db.path}`;
  return `${TIMETABLE.baseUrl}${path}`;
}

async function gunzipBytesWeb(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([compressed as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return gunzipSync(compressed);
}

async function downloadAndVerifyWebPoiDb(
  manifest: PoiDbManifest,
  onProgress?: (written: number, total: number) => void,
): Promise<{ memDb: SQLite.SQLiteDatabase; byteLength: number }> {
  const res = await fetch(poiDbDownloadUrl(manifest));
  if (!res.ok) throw new Error(`POI download HTTP ${res.status}`);
  const expected = Number(res.headers.get('content-length')) || manifest.db.sizeBytes;
  const chunks: Uint8Array[] = [];
  let bytesWritten = 0;

  if (res.body?.getReader) {
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        bytesWritten += value.byteLength;
        onProgress?.(bytesWritten, expected);
      }
    }
  } else {
    const buf = new Uint8Array(await res.arrayBuffer());
    chunks.push(buf);
    bytesWritten = buf.byteLength;
    onProgress?.(bytesWritten, expected);
  }

  if (bytesWritten !== manifest.db.sizeBytes) {
    throw new Error(`Rozmiar POI ${bytesWritten} != ${manifest.db.sizeBytes}`);
  }

  const rawBytes = new Uint8Array(bytesWritten);
  let offset = 0;
  for (const chunk of chunks) {
    rawBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const isGz = manifest.db.path.endsWith('.gz') || typeof manifest.db.uncompressedSizeBytes === 'number';
  const dbBytes = isGz ? await gunzipBytesWeb(rawBytes) : rawBytes;
  if (
    typeof manifest.db.uncompressedSizeBytes === 'number' &&
    dbBytes.byteLength !== manifest.db.uncompressedSizeBytes
  ) {
    throw new Error(`Rozmiar po dekompresji ${dbBytes.byteLength} != ${manifest.db.uncompressedSizeBytes}`);
  }

  const memDb = await SQLite.deserializeDatabaseAsync(dbBytes);
  try {
    const chk = await memDb.getFirstAsync<{ quick_check: string }>('PRAGMA quick_check(1)');
    const cnt = await memDb.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM pois');
    const term = await memDb.getFirstAsync<{ poi_id: number }>('SELECT poi_id FROM poi_terms LIMIT 1');
    if (chk?.quick_check !== 'ok' || !cnt?.n || !term?.poi_id) {
      throw new Error('Weryfikacja bazy POI nie powiodła się');
    }
  } catch (err) {
    await memDb.closeAsync().catch(() => {});
    throw err;
  }
  return { memDb, byteLength: dbBytes.byteLength };
}

async function downloadToTempNative(
  mainName: string,
  manifest: PoiDbManifest,
  onProgress?: (written: number, total: number) => void,
): Promise<{ tempName: string; byteLength: number }> {
  const tempName = `${mainName}.new.db`;
  const destDb = await sqliteUri(tempName);
  const isGz = manifest.db.path.endsWith('.gz') || typeof manifest.db.uncompressedSizeBytes === 'number';
  const destDownload = isGz ? `${destDb}.gz` : destDb;

  await deleteSidecars(destDb);
  await FileSystem.deleteAsync(destDb, { idempotent: true }).catch(() => {});
  await FileSystem.deleteAsync(destDownload, { idempotent: true }).catch(() => {});

  const task = FileSystem.createDownloadResumable(
    poiDbDownloadUrl(manifest),
    destDownload,
    { headers: { 'User-Agent': 'KilometrApp/1.0' } },
    (p) => onProgress?.(p.totalBytesWritten, p.totalBytesExpectedToWrite),
  );
  const result = await task.downloadAsync();
  if (!result?.uri) throw new Error('Pobieranie bazy POI bez pliku wynikowego');

  const dlInfo = await FileSystem.getInfoAsync(destDownload);
  const dlSize = dlInfo.exists && 'size' in dlInfo ? (dlInfo.size as number) : -1;
  if (dlSize !== manifest.db.sizeBytes) {
    await FileSystem.deleteAsync(destDownload, { idempotent: true }).catch(() => {});
    throw new Error(`Rozmiar POI ${dlSize} != ${manifest.db.sizeBytes}`);
  }

  let byteLength = dlSize;
  if (isGz) {
    const ok = await decompressGzipFile(destDownload, destDb);
    await FileSystem.deleteAsync(destDownload, { idempotent: true }).catch(() => {});
    if (!ok) {
      await FileSystem.deleteAsync(destDb, { idempotent: true }).catch(() => {});
      throw new Error('Błąd dekompresji gzip bazy POI');
    }
    const dbInfo = await FileSystem.getInfoAsync(destDb);
    byteLength = dbInfo.exists && 'size' in dbInfo ? (dbInfo.size as number) : -1;
    if (
      typeof manifest.db.uncompressedSizeBytes === 'number' &&
      byteLength !== manifest.db.uncompressedSizeBytes
    ) {
      await FileSystem.deleteAsync(destDb, { idempotent: true }).catch(() => {});
      throw new Error(`Rozmiar po dekompresji ${byteLength} != ${manifest.db.uncompressedSizeBytes}`);
    }
  }

  const probe = await SQLite.openDatabaseAsync(tempName);
  try {
    const chk = await probe.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
    const cnt = await probe.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM pois');
    const term = await probe.getFirstAsync<{ poi_id: number }>('SELECT poi_id FROM poi_terms LIMIT 1');
    if (chk?.integrity_check !== 'ok' || !cnt?.n || !term?.poi_id) {
      throw new Error('Baza POI uszkodzona lub pusta');
    }
  } catch (err) {
    await probe.closeAsync().catch(() => {});
    await FileSystem.deleteAsync(destDb, { idempotent: true }).catch(() => {});
    throw err;
  }
  await probe.closeAsync().catch(() => {});
  return { tempName, byteLength };
}

async function swapNativeFile(mainName: string, tempName: string): Promise<void> {
  const mainUri = await sqliteUri(mainName);
  const bakUri = `${mainUri}.bak`;
  const tempUri = await sqliteUri(tempName);
  await FileSystem.deleteAsync(bakUri, { idempotent: true }).catch(() => {});
  const old = await FileSystem.getInfoAsync(mainUri);
  if (old.exists) await FileSystem.moveAsync({ from: mainUri, to: bakUri });
  await deleteSidecars(mainUri);
  try {
    await FileSystem.moveAsync({ from: tempUri, to: mainUri });
  } catch (err) {
    await FileSystem.deleteAsync(mainUri, { idempotent: true }).catch(() => {});
    if (old.exists) {
      await FileSystem.moveAsync({ from: bakUri, to: mainUri }).catch(() => {});
    }
    throw err;
  }
  await deleteSidecars(mainUri);
  await FileSystem.deleteAsync(bakUri, { idempotent: true }).catch(() => {});
}

async function localPoiDbSize(cityId: string): Promise<number | null> {
  const name = poiDbFileName(cityId);
  if (Platform.OS === 'web') return getWebPoiDbBytes(name);
  try {
    const uri = await sqliteUri(name);
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && 'size' in info ? (info.size as number) : null;
  } catch {
    return null;
  }
}

async function readLocalReadyState(cityId: string): Promise<PoiDbState> {
  const [version, builtAt, count, sizeBytes] = await Promise.all([
    getPoiDbMeta('poi_version', cityId),
    getPoiDbMeta('built_at', cityId),
    poiDbCount(cityId),
    localPoiDbSize(cityId),
  ]);
  return { phase: 'ready', version, count, builtAt, sizeBytes };
}

/**
 * Utrzymuje lokalną bazę POI dla wybranego miasta. Gdy jej brak w wspieranym mieście,
 * pobiera w tle z R2; gdy już jest, sprawdza aktualizację manifestu raz na 7 dni.
 */
export function ensureCityPoiDb(cityId?: string, force = false): Promise<PoiDbState> {
  const resolved = getCity(cityId ?? getActiveCityIdSync()).id;
  if (!hasPoiDatabase(resolved)) {
    const unavailable: PoiDbState = { phase: 'unavailable' };
    setState(resolved, unavailable);
    return Promise.resolve(unavailable);
  }
  const existing = inFlight.get(resolved);
  if (existing) return existing;

  const task = (async () => {
    try {
      const present = await hasPoiDb(resolved);
      if (present && !force) {
        const rawLast = await getPoiDbMeta('poi_last_check', resolved);
        const last = rawLast ? Number(rawLast) : 0;
        if (Number.isFinite(last) && Date.now() - last < CHECK_INTERVAL_MS) {
          const ready = await readLocalReadyState(resolved);
          setState(resolved, ready);
          return ready;
        }
      } else if (!present && !force) {
        const prevAttempt = lastAutoAttempt.get(resolved) ?? 0;
        if (Date.now() - prevAttempt < AUTO_RETRY_MS) {
          return getPoiDbState(resolved);
        }
      }

      if (!present) lastAutoAttempt.set(resolved, Date.now());
      setState(resolved, { phase: 'checking' });

      const manifest = await fetchPoiManifest(resolved);
      const localVersion = present ? await getPoiDbMeta('poi_version', resolved) : null;
      if (present && localVersion && localVersion === manifest.version) {
        await setPoiDbMeta('poi_last_check', String(Date.now()), resolved).catch(() => {});
        const ready = await readLocalReadyState(resolved);
        setState(resolved, ready);
        return ready;
      }

      setState(resolved, { phase: 'downloading', progress: 0 });
      const dbName = poiDbFileName(resolved);

      if (Platform.OS === 'web') {
        const { memDb, byteLength } = await downloadAndVerifyWebPoiDb(manifest, (written, total) => {
          setState(resolved, { phase: 'downloading', progress: total > 0 ? written / total : 0 });
        });
        beginPoiDbSwap(resolved);
        let swapFailed = false;
        try {
          await closePoiDb(resolved);
          await evictOtherWebPoiDbs(dbName);
          await SQLite.deleteDatabaseAsync(dbName).catch(() => {});
          const destDb = await SQLite.openDatabaseAsync(dbName);
          try {
            await SQLite.backupDatabaseAsync({ sourceDatabase: memDb, destDatabase: destDb });
          } finally {
            await destDb.closeAsync().catch(() => {});
            await memDb.closeAsync().catch(() => {});
          }
          await markWebPoiDbReady(dbName, byteLength);
        } catch (err) {
          swapFailed = true;
          await memDb.closeAsync().catch(() => {});
          throw err;
        } finally {
          endPoiDbSwap(resolved);
          if (swapFailed) await getPoiDbHandle(resolved).catch(() => {});
        }
      } else {
        const { tempName } = await downloadToTempNative(dbName, manifest, (written, total) => {
          setState(resolved, { phase: 'downloading', progress: total > 0 ? written / total : 0 });
        });
        beginPoiDbSwap(resolved);
        let swapFailed = false;
        try {
          await closePoiDb(resolved);
          await swapNativeFile(dbName, tempName);
        } catch (err) {
          swapFailed = true;
          throw err;
        } finally {
          endPoiDbSwap(resolved);
          if (swapFailed) await getPoiDbHandle(resolved).catch(() => {});
        }
      }

      setPoiDbPresenceCache(resolved, true);
      await setPoiDbMeta('poi_version', manifest.version, resolved);
      await setPoiDbMeta('poi_last_check', String(Date.now()), resolved);
      const ready = await readLocalReadyState(resolved);
      setState(resolved, ready);
      notifyDataChanged(resolved);
      return ready;
    } catch (err) {
      console.warn(`[PoiSync:${resolved}]`, err instanceof Error ? err.message : String(err));
      const present = await hasPoiDb(resolved).catch(() => false);
      if (present) {
        const ready = await readLocalReadyState(resolved);
        setState(resolved, ready);
        return ready;
      }
      const errorState: PoiDbState = { phase: 'error' };
      setState(resolved, errorState);
      return errorState;
    } finally {
      inFlight.delete(resolved);
    }
  })();

  inFlight.set(resolved, task);
  return task;
}

export function downloadCityPoiDb(cityId?: string): Promise<PoiDbState> {
  return ensureCityPoiDb(cityId, true);
}

export async function deleteCityPoiDb(cityId?: string): Promise<void> {
  const resolved = getCity(cityId ?? getActiveCityIdSync()).id;
  const dbName = poiDbFileName(resolved);
  beginPoiDbSwap(resolved);
  try {
    await closePoiDb(resolved);
    if (Platform.OS === 'web') {
      await SQLite.deleteDatabaseAsync(dbName).catch(() => {});
      await clearWebPoiDbReady(dbName);
    } else {
      const mainUri = await sqliteUri(dbName);
      await deleteSidecars(mainUri);
      await FileSystem.deleteAsync(mainUri, { idempotent: true }).catch(() => {});
      await FileSystem.deleteAsync(`${mainUri}.bak`, { idempotent: true }).catch(() => {});
    }
    setPoiDbPresenceCache(resolved, false);
    const next: PoiDbState = hasPoiDatabase(resolved) ? { phase: 'idle' } : { phase: 'unavailable' };
    setState(resolved, next);
    notifyDataChanged(resolved);
  } finally {
    endPoiDbSwap(resolved);
  }
}
