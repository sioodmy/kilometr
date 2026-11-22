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
import { TIMETABLE } from './gtfsConfig';
import { decompressGzipFile } from '../../modules/kilometr-raptor';
import { getCity, type CityId } from '../cities';
import { getActiveCityIdSync } from './cityStore';
import {
  beginGtfsSwap,
  closeGtfsDb,
  endGtfsSwap,
  getGtfsDb,
  GTFS_IMPORT_COMPLETE_META,
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
import { getLocaleSync, type Strings } from '../i18n';
import { pl } from '../i18n/pl';
import { en } from '../i18n/en';
import { de } from '../i18n/de';
import { uk } from '../i18n/uk';

const SYNC_DICTS: Record<string, Strings> = { pl, en, de, uk };

function syncDlTr(): Strings['downloader'] {
  return (SYNC_DICTS[getLocaleSync()] ?? pl).downloader;
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
