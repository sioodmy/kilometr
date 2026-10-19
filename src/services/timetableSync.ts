// Synchronizacja gotowej bazy z serwera Kilometr (Cloudflare R2 + Worker).
// Telefon pobiera prebuilt SQLite (~80 MB, strumień na dysk) zamiast
// parsować ZIP-a GTFS w pamięci — po stronie RAM-u nie dzieje się nic
// cięższego niż zwykły download (koniec z OOM przy unzip + base64).
//
// Kolejność jest bezpieczna dla działającej aplikacji:
// 1. download do pliku tymczasowego (wznawialny, nie ruszamy bazy),
// 2. weryfikacja: rozmiar + PRAGMA integrity_check + liczniki > 0,
// 3. dopiero wtedy: close() → podmiana pliku → reopen → meta.
// Uszkodzony plik tymczasowy nigdy nie dotyka działającej bazy.

import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { TIMETABLE } from './gtfsConfig';
import { decompressGzipFile } from '../../modules/kilometr-raptor';
import { getCity, type CityId } from '../cities';
import { getActiveCityIdSync } from './cityStore';
import { beginGtfsSwap, closeGtfsDb, endGtfsSwap, getGtfsDb, getMeta, setMeta } from './gtfsDatabase';
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

/** Adres ma zawsze default z gtfsConfig, więc to dziś zawsze true. */
export function timetableEnabled(): boolean {
  return TIMETABLE.baseUrl.length > 0;
}

export function manifestUrl(cityId?: CityId | string): string {
  const city = getCity(typeof cityId === 'string' ? cityId : getActiveCityIdSync());
  return `${TIMETABLE.baseUrl}/${city.id}/manifest.json`;
}

/**
 * URL bazy z manifestu. `db.path` jest pełną ścieżką R2 (`{miasto}/db/kilometr-gtfs.db.gz`).
 */
export function dbDownloadUrl(manifest: TimetableManifest): string {
  const path = manifest.db.path.startsWith('/') ? manifest.db.path : `/${manifest.db.path}`;
  return `${TIMETABLE.baseUrl}${path}`;
}

/** Manifest to ~500 B — tanie pytanie, które chroni limity (brak pobrań bez zmian). */
export async function fetchManifest(cityId?: CityId | string): Promise<TimetableManifest> {
  const city = getCity(typeof cityId === 'string' ? cityId : getActiveCityIdSync());
  try {
    return await fetchManifestAt(manifestUrl(city.id));
  } catch (err) {
    throw describeDownloadError(err);
  }
}

async function fetchManifestAt(url: string): Promise<TimetableManifest> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMETABLE.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    const m = (await res.json()) as TimetableManifest;
    if (!m || typeof m.version !== 'string' || !m.version
      || !m.db || typeof m.db.sizeBytes !== 'number' || m.db.sizeBytes < 500_000
      || !m.stats || m.stats.stops <= 0 || m.stats.trips <= 0) {
      throw new Error('manifest ma niepełny kształt');
    }
    return m;
  } catch (err) {
    throw describeDownloadError(err);
  } finally {
    clearTimeout(timer);
  }
}

export async function getLocalTimetableVersion(): Promise<string | null> {
  try {
    return await getMeta('timetable_version');
  } catch {
    return null;
  }
}

const TEMP_DB_SUFFIX = '.new.db';

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
 * Pobiera, weryfikuje i podmienia bazę. Nie rusza działającej bazy,
 * dopóki plik tymczasowy nie przejdzie integrity_check.
 */
export async function downloadPrebuiltDb(
  manifest: TimetableManifest,
  onProgress?: (bytesWritten: number, totalBytes: number) => void,
  cityId?: CityId | string,
): Promise<void> {
  const T = syncDlTr();
  // Miasto pinujemy raz, na starcie: pobieranie trwa kilka minut, a użytkownik
  // może w międzyczasie zmienić miasto. Bez pinu plik tymczasowy i cel podmiany
  // rozjeżdżałyby się (Wrocławskie dane w pliku Krakowa).
  const city = getCity(cityId ?? getActiveCityIdSync());
  const mainName = city.dbFile;
  const tempName = tempDbName(mainName);
  const destDb = await sqliteUri(tempName);
  const isCompressed = manifest.db.path.endsWith('.gz') || typeof manifest.db.uncompressedSizeBytes === 'number';
  const destDownload = isCompressed ? `${destDb}.gz` : destDb;

  await deleteSidecars(destDb);
  try {
    await FileSystem.deleteAsync(destDb, { idempotent: true });
  } catch {
    // best-effort (stary niekompletny temp)
  }
  if (isCompressed) {
    try {
      await FileSystem.deleteAsync(destDownload, { idempotent: true });
    } catch {
      // best-effort
    }
  }

  // Download strumieniem na dysk (wznawialny) — RAM-u prawie nie rusza.
  const task = FileSystem.createDownloadResumable(
    dbDownloadUrl(manifest),
    destDownload,
    { headers: { 'User-Agent': 'KilometrApp/1.0' } },
    (p) => onProgress?.(p.totalBytesWritten, p.totalBytesExpectedToWrite),
  );
  const result = await task.downloadAsync().catch((err: unknown) => {
    throw describeDownloadError(err);
  });
  if (!result?.uri) throw new GtfsDownloadError(T.noFile, 'download bez uri', T.hintTouch);

  // Rozmiar pobranego pliku musi się zgadzać co do bajta — inaczej nie ma podmiany.
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

  // Podmiana: zamknij działającą bazę, podmień plik atomowo (w ramach katalogu).
  // Bramka blokuje równoległe getGtfsDb() z UI, żeby nie otworzyły usuwanego pliku.
  // Miasto mogło się zmienić w trakcie pobierania: wtedy baza właśnie ściągnięta
  // należy do innego miasta niż aktywne i nie wolno jej podmienić.
  if (getActiveCityIdSync() !== city.id) {
    await FileSystem.deleteAsync(destDb, { idempotent: true }).catch(() => {});
    throw new GtfsDownloadError(T.unavailable, 'city changed during download', T.hintLater, 'unreachable');
  }
  beginGtfsSwap();
  const mainUri = await sqliteUri(mainName);
  try {
    await closeGtfsDb();
    try {
      await FileSystem.deleteAsync(mainUri, { idempotent: true });
    } catch {
      // best-effort
    }
    await deleteSidecars(mainUri);
    await FileSystem.moveAsync({ from: destDb, to: mainUri });
    await deleteSidecars(mainUri);
  } finally {
    endGtfsSwap();
  }

  // Reopen (initDb robi CREATE IF NOT EXISTS — na gotowej bazie to no-op)
  // i zapisz mety wersji, żeby manifest nie ściągał w kółko tego samego.
  await getGtfsDb();
  await setMeta('timetable_version', manifest.version);
  await setMeta('gtfs_imported_at', new Date().toISOString());
  await setMeta('gtfs_source', 'network');
  try {
    await setMeta('feeds', JSON.stringify({
      mpk: manifest.sources.mpk?.effectiveDate ?? null,
      kd: manifest.sources.kd?.schedulesVersion ?? null,
      ztp: manifest.sources.ztp?.fingerprint ?? null,
      kml: manifest.sources.kml?.version ?? null,
    }));
  } catch {
    // meta opisowa — nie blokuje gotowości
  }
}
