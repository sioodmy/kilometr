// Synchronizacja gotowej bazy z serwera Kilometr (Cloudflare R2 + Worker).
// Telefon pobiera prebuilt SQLite (~80 MB, strumień na dysk) zamiast
// parsować ZIP-a GTFS w pamięci - po stronie RAM-u nie dzieje się nic
// cięższego niż zwykły download (koniec z OOM przy unzip + base64).
//
// Kolejność jest bezpieczna dla działającej aplikacji:
// 1. download do pliku tymczasowego (wznawialny, nie ruszamy bazy),
// 2. weryfikacja: rozmiar + PRAGMA integrity_check + liczniki > 0,
// 3. dopiero wtedy: close() → stara baza do .bak → nowa na jej miejsce → reopen → meta.
// Uszkodzony plik tymczasowy nigdy nie dotyka działającej bazy.

import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { gunzipSync } from 'fflate';
import { Platform } from 'react-native';
import { TIMETABLE } from './gtfsConfig';
import { decompressGzipFile } from '../../modules/kilometr-raptor';
import { getCity, type CityId } from '../cities';
import { getActiveCityIdSync } from './cityStore';
import {
  beginGtfsSwap,
  closeGtfsDb,
  endGtfsSwap,
  evictExcessWebCityDbs,
  getGtfsDb,
  GTFS_IMPORT_COMPLETE_META,
  markWebDbReady,
  openGtfsDbHandle,
  setMeta,
} from './gtfsDatabase';

/** Przerwanie syncu rozkładu (np. użytkownik przełączył miasto w trakcie pobierania). */
export class TimetableSyncAbortedError extends Error {
  constructor(message = 'timetable sync aborted') {
    super(message);
    this.name = 'TimetableSyncAbortedError';
  }
}
import { GtfsDownloadError, describeDownloadError } from './gtfsDownloader';
import { tr } from '../i18n/locale';

function syncDlTr() {
  return tr().downloader;
}

export interface TimetableManifest {
  version: string;
  builtAt: string;
  city?: string;
  db: {
    path: string;
    sizeBytes: number;
    sha256: string;
    uncompressedSizeBytes?: number;
  };
  sources: {
    mpk?: { effectiveDate?: string };
    kd?: { schedulesVersion?: string; skippedReason?: string | null };
    ztp?: { fingerprint?: string };
    kml?: { version?: string | null; skippedReason?: string | null };
    ztm?: { fingerprint?: string };
    ks?: { version?: string | null; skippedReason?: string | null };
    wtp?: { fingerprint?: string };
    km?: { version?: string | null; skippedReason?: string | null };
    wkd?: { version?: string | null; skippedReason?: string | null };
    ic?: { schedulesVersion?: string; skippedReason?: string | null };
    pr?: { schedulesVersion?: string; skippedReason?: string | null };
  };
  stats: { stops: number; routes: number; trips: number; stopTimes: number };
}

function manifestUrl(cityId?: CityId | string): string {
  const city = getCity(typeof cityId === 'string' ? cityId : getActiveCityIdSync());
  return `${TIMETABLE.baseUrl}/${city.id}/manifest.json`;
}

/**
 * URL bazy z manifestu. `db.path` jest pełną ścieżką R2 (`{miasto}/db/kilometr-gtfs.db.gz`).
 */
function dbDownloadUrl(manifest: TimetableManifest): string {
  const path = manifest.db.path.startsWith('/') ? manifest.db.path : `/${manifest.db.path}`;
  return `${TIMETABLE.baseUrl}${path}`;
}

/** Manifest to ~500 B: tanie pytanie, które chroni limity (brak pobrań bez zmian). */
export async function fetchManifest(
  cityId?: CityId | string,
  signal?: AbortSignal,
): Promise<TimetableManifest> {
  const city = getCity(typeof cityId === 'string' ? cityId : getActiveCityIdSync());
  try {
    return await fetchManifestAt(manifestUrl(city.id), signal);
  } catch (err) {
    if (err instanceof TimetableSyncAbortedError) throw err;
    throw describeDownloadError(err);
  }
}

async function fetchManifestAt(url: string, signal?: AbortSignal): Promise<TimetableManifest> {
  if (signal?.aborted) throw new TimetableSyncAbortedError('manifest aborted before start');
  const ctrl = new AbortController();
  const onParentAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), TIMETABLE.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (signal?.aborted) throw new TimetableSyncAbortedError('manifest aborted');
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    const m = (await res.json()) as TimetableManifest;
    if (signal?.aborted) throw new TimetableSyncAbortedError('manifest aborted');
    if (!m || typeof m.version !== 'string' || !m.version
      || !m.db || typeof m.db.sizeBytes !== 'number' || m.db.sizeBytes < 10_000
      || !m.stats || m.stats.stops <= 0 || m.stats.trips <= 0) {
      throw new Error('manifest ma niepełny kształt');
    }
    return m;
  } catch (err) {
    if (err instanceof TimetableSyncAbortedError || signal?.aborted) {
      throw new TimetableSyncAbortedError('manifest aborted');
    }
    throw describeDownloadError(err);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onParentAbort);
  }
}

export async function fetchNationalManifest(): Promise<TimetableManifest> {
  try {
    return await fetchManifestAt(`${TIMETABLE.baseUrl}/polska/manifest.json`);
  } catch (err) {
    throw describeDownloadError(err);
  }
}

/** Wersja pobranego rozkładu kolejowego (meta w samej bazie polska). */
export async function getNationalTimetableVersion(): Promise<string | null> {
  try {
    const { getNationalMeta } = await import('./gtfsDatabase');
    return await getNationalMeta('timetable_version');
  } catch {
    return null;
  }
}

const TEMP_DB_SUFFIX = '.new.db';
const BAK_DB_SUFFIX = '.bak';

function tempDbName(mainName: string): string {
  return `${mainName}${TEMP_DB_SUFFIX}`;
}

// Katalog bazy z documentDirectory (file:///data/user/0/…/files/SQLite).
// expo-file-system przyznaje zapis po kanonicznej ścieżce względem filesDir,
// czyli /data/user/0/…. SQLite.defaultDatabaseDirectory zwraca /data/data/…:
// to ten sam katalog (bind mount, nie symlink), ale inna ścieżka, więc
// sprawdzenie nie przechodzi. Stąd „isn't writable" przy mkdir i downloadzie,
// a sync po cichu zostawał przy starej bazie bez pociągów. expo-sqlite i tak
// trzyma plik w tym samym miejscu, więc podmiana trafia w bazę, której używa.
function sqliteDirUri(): string {
  const base = FileSystem.documentDirectory;
  if (base) return `${base.replace(/\/+$/, '')}/SQLite`;
  const raw = String((SQLite as unknown as { defaultDatabaseDirectory?: unknown }).defaultDatabaseDirectory ?? '').replace(/\/+$/, '');
  if (!raw) throw new Error('Brak katalogu bazy (expo-file-system/expo-sqlite)');
  return raw.startsWith('file://') ? raw : `file://${raw}`;
}

async function sqliteUri(name: string): Promise<string> {
  const dir = sqliteDirUri();
  // Katalog tworzy samo expo-sqlite przy pierwszym openDatabaseAsync. Na
  // części urządzeń getInfoAsync mimo to zgłasza go jako nieistniejący, a
  // makeDirectoryAsync odrzuca z "isn't writable", bo uprawnienia liczone
  // są w stosunku do innej ścieżki niż ta z logu. Wyjątek tutaj nie może
  // wywracać całego syncu: jeśli katalogu naprawdę zabrakło, download zgłosi
  // to dalej własnym komunikatem, a użytkownik zobaczy błąd zamiast ciszy.
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch (err) {
    console.warn('[Timetable] katalog bazy niedostępny:', dir, err);
  }
  return `${dir}/${name}`;
}

async function deleteSidecars(uri: string): Promise<void> {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try {
      await FileSystem.deleteAsync(`${uri}${suffix}`, { idempotent: true });
    } catch {
      // best-effort
    }
  }
}

/**
 * Pobiera bazę z manifestu do pliku tymczasowego i weryfikuje ją: rozmiar
 * co do bajta, dekompresja gzip, integrity_check i niezerowe liczniki.
 * Zwraca nazwę pliku tymczasowego gotowego do podmiany (caller robi swap).
 */
async function downloadToTemp(
  mainName: string,
  manifest: TimetableManifest,
  onProgress?: (bytesWritten: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new TimetableSyncAbortedError('download aborted before start');
  const T = syncDlTr();
  const tempName = tempDbName(mainName);
  const destDb = await sqliteUri(tempName);
  const isCompressed = manifest.db.path.endsWith('.gz') || typeof manifest.db.uncompressedSizeBytes === 'number';
  const destDownload = isCompressed ? `${destDb}.gz` : destDb;

  const cleanupTemp = async () => {
    await deleteSidecars(destDb);
    await FileSystem.deleteAsync(destDb, { idempotent: true }).catch(() => {});
    if (isCompressed) {
      await FileSystem.deleteAsync(destDownload, { idempotent: true }).catch(() => {});
    }
  };

  await cleanupTemp();
  if (signal?.aborted) throw new TimetableSyncAbortedError('download aborted before transfer');

  // Download strumieniem na dysk (wznawialny): RAM-u prawie nie rusza.
  const task = FileSystem.createDownloadResumable(
    dbDownloadUrl(manifest),
    destDownload,
    { headers: { 'User-Agent': 'KilometrApp/1.0' } },
    (p) => {
      if (signal?.aborted) return;
      onProgress?.(p.totalBytesWritten, p.totalBytesExpectedToWrite);
    },
  );
  const onAbort = () => {
    void task.cancelAsync().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  let result: FileSystem.FileSystemDownloadResult | undefined;
  try {
    result = await task.downloadAsync().catch((err: unknown) => {
      if (signal?.aborted) throw new TimetableSyncAbortedError('download cancelled');
      throw describeDownloadError(err);
    });
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted) {
    await cleanupTemp();
    throw new TimetableSyncAbortedError('download cancelled');
  }
  if (!result?.uri) throw new GtfsDownloadError(T.noFile, 'download bez uri', T.hintTouch);

  // Rozmiar pobranego pliku musi się zgadzać co do bajta, inaczej nie ma podmiany.
  const info = await FileSystem.getInfoAsync(destDownload);
  const size = info.exists && 'size' in info ? (info.size as number) : -1;
  if (size !== manifest.db.sizeBytes) {
    await FileSystem.deleteAsync(destDownload, { idempotent: true }).catch(() => {});
    throw new GtfsDownloadError(T.unavailable, `rozmiar ${size} != ${manifest.db.sizeBytes}`, T.hintLater, 'unreachable');
  }

  // Dekompresja jeśli plik z R2 był skompresowany (.gz)
  if (isCompressed) {
    const ok = await decompressGzipFile(destDownload, destDb);
    // Usuwamy pobrany .gz natychmiast po rozpakowaniu, żeby nie trzymać duplikatu na dysku
    await FileSystem.deleteAsync(destDownload, { idempotent: true }).catch(() => {});
    if (signal?.aborted) {
      await cleanupTemp();
      throw new TimetableSyncAbortedError('download cancelled after decompress');
    }
    if (!ok) {
      await FileSystem.deleteAsync(destDb, { idempotent: true }).catch(() => {});
      throw new GtfsDownloadError(T.unavailable, 'błąd dekompresji bazy rozkładu (gzip)', T.hintLater, 'unreachable');
    }

    if (typeof manifest.db.uncompressedSizeBytes === 'number') {
      const dbInfo = await FileSystem.getInfoAsync(destDb);
      const dbSize = dbInfo.exists && 'size' in dbInfo ? (dbInfo.size as number) : -1;
      if (dbSize !== manifest.db.uncompressedSizeBytes) {
        await FileSystem.deleteAsync(destDb, { idempotent: true }).catch(() => {});
        throw new GtfsDownloadError(
          T.unavailable,
          `rozmiar po dekompresji ${dbSize} != ${manifest.db.uncompressedSizeBytes}`,
          T.hintLater,
          'unreachable',
        );
      }
    }
  }

  if (signal?.aborted) {
    await cleanupTemp();
    throw new TimetableSyncAbortedError('download cancelled before verify');
  }

  // Weryfikacja zawartości na pliku tymczasowym (osobny uchwyt!).
  const probe = await SQLite.openDatabaseAsync(tempName);
  try {
    const chk = await probe.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
    const s = await probe.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stops');
    const t = await probe.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM trips');
    const st = await probe.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stop_times');
    if (chk?.integrity_check !== 'ok' || !s?.n || !t?.n || !st?.n) {
      throw new Error(`weryfikacja bazy: integrity=${chk?.integrity_check} stops=${s?.n} trips=${t?.n} times=${st?.n}`);
    }
    // Znacznik kompletności już w pliku tymczasowym: po podmianie baza jest
    // gotowa nawet gdy aplikacja padnie przed zapisem met wersji.
    await probe.runAsync(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      GTFS_IMPORT_COMPLETE_META,
      '1',
    );
  } catch (err) {
    try {
      await probe.closeAsync();
    } catch {
      // best-effort
    }
    await FileSystem.deleteAsync(destDb, { idempotent: true }).catch(() => {});
    throw err instanceof GtfsDownloadError ? err : describeDownloadError(err);
  }
  try {
    await probe.closeAsync();
  } catch {
    // best-effort
  }
  if (signal?.aborted) {
    await cleanupTemp();
    throw new TimetableSyncAbortedError('download cancelled after verify');
  }
  return tempName;
}

/** Podmienia plik bazy: stara do .bak, nowa (temp) na miejsce, rollback przy błędzie. */
async function swapDbFile(mainName: string, tempName: string): Promise<void> {
  const mainUri = await sqliteUri(mainName);
  const bakUri = `${mainUri}${BAK_DB_SUFFIX}`;
  const destDb = await sqliteUri(tempName);
  await FileSystem.deleteAsync(bakUri, { idempotent: true }).catch(() => {});
  const old = await FileSystem.getInfoAsync(mainUri);
  if (old.exists) await FileSystem.moveAsync({ from: mainUri, to: bakUri });
  await deleteSidecars(mainUri);
  try {
    await FileSystem.moveAsync({ from: destDb, to: mainUri });
  } catch (err) {
    // Nowa baza nie weszła: przywróć poprzednią, żeby planer działał offline.
    await FileSystem.deleteAsync(mainUri, { idempotent: true }).catch(() => {});
    if (old.exists) {
      await FileSystem.moveAsync({ from: bakUri, to: mainUri }).catch((restoreErr) => {
        console.warn('[Timetable] przywrócenie bazy z .bak nie udało się:', restoreErr);
      });
    }
    throw err;
  }
  await deleteSidecars(mainUri);
  await FileSystem.deleteAsync(bakUri, { idempotent: true }).catch(() => {});
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

/**
 * Webowy odpowiednik downloadToTemp: pobiera strumieniem z postępem,
 * dekompresuje w przeglądarce i weryfikuje w pamięci przed zapisem do OPFS.
 */
async function downloadAndVerifyWebDb(
  manifest: TimetableManifest,
  onProgress?: (bytesWritten: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<{ memDb: SQLite.SQLiteDatabase; byteLength: number }> {
  if (signal?.aborted) throw new TimetableSyncAbortedError('download aborted before start');
  const T = syncDlTr();
  const isCompressed =
    manifest.db.path.endsWith('.gz') || typeof manifest.db.uncompressedSizeBytes === 'number';

  let res: Response;
  try {
    res = await fetch(dbDownloadUrl(manifest), { signal });
  } catch (err) {
    if (signal?.aborted) throw new TimetableSyncAbortedError('download cancelled');
    throw describeDownloadError(err);
  }
  if (!res.ok) {
    throw new GtfsDownloadError(
      T.unavailable,
      `HTTP response status code ${res.status}`,
      T.hintLater,
      'unreachable',
    );
  }

  const expectedBytes = Number(res.headers.get('content-length')) || manifest.db.sizeBytes;
  const chunks: Uint8Array[] = [];
  let bytesWritten = 0;

  if (res.body?.getReader) {
    const reader = res.body.getReader();
    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel().catch(() => {});
          throw new TimetableSyncAbortedError('download cancelled');
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          bytesWritten += value.byteLength;
          onProgress?.(bytesWritten, expectedBytes);
        }
      }
    } catch (err) {
      if (err instanceof TimetableSyncAbortedError || signal?.aborted) {
        throw new TimetableSyncAbortedError('download cancelled');
      }
      throw describeDownloadError(err);
    }
  } else {
    const buf = new Uint8Array(await res.arrayBuffer());
    chunks.push(buf);
    bytesWritten = buf.byteLength;
    onProgress?.(bytesWritten, expectedBytes);
  }

  if (signal?.aborted) throw new TimetableSyncAbortedError('download cancelled');
  if (bytesWritten !== manifest.db.sizeBytes) {
    throw new GtfsDownloadError(
      T.unavailable,
      `rozmiar ${bytesWritten} != ${manifest.db.sizeBytes}`,
      T.hintLater,
      'unreachable',
    );
  }

  const rawBytes = new Uint8Array(bytesWritten);
  let offset = 0;
  for (const chunk of chunks) {
    rawBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let dbBytes: Uint8Array = rawBytes;
  if (isCompressed) {
    try {
      dbBytes = await gunzipBytesWeb(rawBytes);
    } catch {
      throw new GtfsDownloadError(
        T.unavailable,
        'błąd dekompresji bazy rozkładu (gzip)',
        T.hintLater,
        'unreachable',
      );
    }
    if (signal?.aborted) throw new TimetableSyncAbortedError('download cancelled after decompress');
    if (
      typeof manifest.db.uncompressedSizeBytes === 'number' &&
      dbBytes.byteLength !== manifest.db.uncompressedSizeBytes
    ) {
      throw new GtfsDownloadError(
        T.unavailable,
        `rozmiar po dekompresji ${dbBytes.byteLength} != ${manifest.db.uncompressedSizeBytes}`,
        T.hintLater,
        'unreachable',
      );
    }
  }

  const memDb = await SQLite.deserializeDatabaseAsync(dbBytes);
  try {
    const chk = await memDb.getFirstAsync<{ quick_check: string }>('PRAGMA quick_check(1)');
    const s = await memDb.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stops');
    const t = await memDb.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM trips');
    const st = await memDb.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stop_times');
    if (chk?.quick_check !== 'ok' || !s?.n || !t?.n || !st?.n) {
      throw new Error(
        `weryfikacja bazy: quick_check=${chk?.quick_check} stops=${s?.n} trips=${t?.n} times=${st?.n}`,
      );
    }
    await memDb.runAsync(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      GTFS_IMPORT_COMPLETE_META,
      '1',
    );
  } catch (err) {
    await memDb.closeAsync().catch(() => {});
    throw err instanceof GtfsDownloadError ? err : describeDownloadError(err);
  }

  if (signal?.aborted) {
    await memDb.closeAsync().catch(() => {});
    throw new TimetableSyncAbortedError('download cancelled after verify');
  }
  return { memDb, byteLength: dbBytes.byteLength };
}

async function commitWebDb(
  targetDbName: string,
  memDb: SQLite.SQLiteDatabase,
  byteLength: number,
  isCity: boolean,
): Promise<void> {
  if (isCity) {
    await evictExcessWebCityDbs(targetDbName);
  }
  await SQLite.deleteDatabaseAsync(targetDbName).catch(() => {});
  const destDb = await SQLite.openDatabaseAsync(targetDbName);
  try {
    await SQLite.backupDatabaseAsync({ sourceDatabase: memDb, destDatabase: destDb });
  } finally {
    await destDb.closeAsync().catch(() => {});
    await memDb.closeAsync().catch(() => {});
  }
  await markWebDbReady(targetDbName, byteLength, isCity);
}

/**
 * Pobiera, weryfikuje i podmienia bazę. Nie rusza działającej bazy,
 * dopóki plik tymczasowy nie przejdzie integrity_check.
 */
export async function downloadPrebuiltDb(
  manifest: TimetableManifest,
  onProgress?: (bytesWritten: number, totalBytes: number) => void,
  cityId?: CityId | string,
  signal?: AbortSignal,
): Promise<void> {
  // Miasto pinujemy raz, na starcie: pobieranie trwa kilka minut, a użytkownik
  // może w międzyczasie zmienić miasto. Bez pinu plik tymczasowy i cel podmiany
  // rozjeżdżałyby się (Wrocławskie dane w pliku Krakowa).
  const city = getCity(cityId ?? getActiveCityIdSync());

  if (Platform.OS === 'web') {
    const { memDb, byteLength } = await downloadAndVerifyWebDb(manifest, onProgress, signal);
    if (signal?.aborted || getActiveCityIdSync() !== city.id) {
      await memDb.closeAsync().catch(() => {});
      throw new TimetableSyncAbortedError('city changed during download');
    }
    beginGtfsSwap();
    let swapFailed = false;
    try {
      await closeGtfsDb();
      await commitWebDb(city.dbFile, memDb, byteLength, true);
    } catch (err) {
      swapFailed = true;
      await memDb.closeAsync().catch(() => {});
      throw err;
    } finally {
      endGtfsSwap();
      if (swapFailed && getActiveCityIdSync() === city.id) await getGtfsDb().catch(() => {});
    }
  } else {
    const tempName = await downloadToTemp(city.dbFile, manifest, onProgress, signal);

    // Podmiana: zamknij działającą bazę, odsuń starą do .bak i wstaw nową.
    // Bramka blokuje równoległe getGtfsDb() z UI, żeby nie otworzyły usuwanego pliku.
    // Miasto mogło się zmienić w trakcie pobierania: wtedy baza właśnie ściągnięta
    // należy do innego miasta niż aktywne i nie wolno jej podmienić.
    if (signal?.aborted || getActiveCityIdSync() !== city.id) {
      const destDb = await sqliteUri(tempName);
      await deleteSidecars(destDb);
      await FileSystem.deleteAsync(destDb, { idempotent: true }).catch(() => {});
      throw new TimetableSyncAbortedError('city changed during download');
    }
    beginGtfsSwap();
    let swapFailed = false;
    try {
      await closeGtfsDb();
      await swapDbFile(city.dbFile, tempName);
    } catch (err) {
      swapFailed = true;
      throw err;
    } finally {
      endGtfsSwap();
      // Po nieudanej podmianie otwórz z powrotem poprzednią bazę (tylko jeśli miasto nadal aktywne).
      if (swapFailed && getActiveCityIdSync() === city.id) await getGtfsDb().catch(() => {});
    }
  }

  // Reopen i zapis met wersji w pliku docelowego miasta (nigdy innego miasta).
  await openGtfsDbHandle(city.id);
  await setMeta('timetable_version', manifest.version, city.id);
  await setMeta('gtfs_imported_at', new Date().toISOString(), city.id);
  await setMeta('gtfs_source', 'network', city.id);
  try {
    await setMeta('feeds', JSON.stringify({
      mpk: manifest.sources.mpk?.effectiveDate ?? null,
      kd: manifest.sources.kd?.schedulesVersion ?? null,
      ztp: manifest.sources.ztp?.fingerprint ?? null,
      kml: manifest.sources.kml?.version ?? null,
    }), city.id);
  } catch {
    // meta opisowa nie blokuje gotowości
  }
}

/**
 * Pobiera i podmienia ogólnopolską bazę kolejową (kilometr-gtfs-polska.db).
 * Osobna bramka podmiany (beginNationalDbSwap): bazy miast zostają nietknięte,
 * a polskaStore resetuje magazyn kolejowy po podmianie pliku.
 */
export async function downloadNationalDb(
  manifest: TimetableManifest,
  onProgress?: (bytesWritten: number, totalBytes: number) => void,
): Promise<void> {
  const gtfs = await import('./gtfsDatabase');

  if (Platform.OS === 'web') {
    const { memDb, byteLength } = await downloadAndVerifyWebDb(manifest, onProgress);
    gtfs.beginNationalDbSwap();
    let swapFailed = false;
    try {
      await gtfs.closeNationalDb();
      await commitWebDb(gtfs.NATIONAL_DB_FILE, memDb, byteLength, false);
    } catch (err) {
      swapFailed = true;
      await memDb.closeAsync().catch(() => {});
      throw err;
    } finally {
      gtfs.endNationalDbSwap();
      if (swapFailed) await gtfs.getNationalDb().catch(() => {});
    }
  } else {
    const tempName = await downloadToTemp(gtfs.NATIONAL_DB_FILE, manifest, onProgress);

    gtfs.beginNationalDbSwap();
    let swapFailed = false;
    try {
      await gtfs.closeNationalDb();
      await swapDbFile(gtfs.NATIONAL_DB_FILE, tempName);
    } catch (err) {
      swapFailed = true;
      throw err;
    } finally {
      gtfs.endNationalDbSwap();
      if (swapFailed) await gtfs.getNationalDb().catch(() => {});
    }
  }

  // Mety w samej bazie krajowej (plik niezależny od miast).
  await gtfs.setNationalMeta('timetable_version', manifest.version);
  await gtfs.setNationalMeta('gtfs_imported_at', new Date().toISOString());
  await gtfs.setNationalMeta('gtfs_source', 'network');

  // Świeży plik = świeży magazyn: wycinki i sieci RAPTOR trzymają się
  // starej wersji. clearRaptorNetCache jest globalny (rzadka operacja).
  const { polskaStore } = await import('./routing/store');
  polskaStore.reset();
  // Udogodnienia też siedzą w tej bazie: cache per pociąg trzymałby stare bity.
  const { resetRailAmenitiesCache } = await import('./railAmenities');
  resetRailAmenitiesCache();
  const { resetStationAmenitiesCache } = await import('./stationAmenities');
  resetStationAmenitiesCache();
  const { resetPlatformSidesCache } = await import('./trainDoorSide');
  resetPlatformSidesCache();
}
