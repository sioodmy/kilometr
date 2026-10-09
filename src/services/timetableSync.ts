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
import { GTFS_DB_NAME, beginGtfsSwap, closeGtfsDb, endGtfsSwap, getGtfsDb, getMeta, setMeta } from './gtfsDatabase';
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
  db: { path: string; sizeBytes: number; sha256: string };
  sources: {
    mpk: { effectiveDate?: string };
    kd: { schedulesVersion?: string; skippedReason?: string | null };
  };
  stats: { stops: number; routes: number; trips: number; stopTimes: number };
}

/** Adres ma zawsze default z gtfsConfig, więc to dziś zawsze true. */
export function timetableEnabled(): boolean {
  return TIMETABLE.baseUrl.length > 0;
}

export function manifestUrl(): string {
  return `${TIMETABLE.baseUrl}/manifest.json`;
}

export function dbDownloadUrl(manifest: TimetableManifest): string {
  const path = manifest.db.path.startsWith('/') ? manifest.db.path : `/${manifest.db.path}`;
  return `${TIMETABLE.baseUrl}${path}`;
}

/** Manifest to ~500 B — tanie pytanie, które chroni limity (brak pobrań bez zmian). */
export async function fetchManifest(): Promise<TimetableManifest> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMETABLE.timeoutMs);
  try {
    const res = await fetch(manifestUrl(), {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    const m = (await res.json()) as TimetableManifest;
    if (!m || typeof m.version !== 'string' || !m.version
      || !m.db || typeof m.db.sizeBytes !== 'number' || m.db.sizeBytes < 1_000_000
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

const TEMP_DB_NAME = 'kilometr-gtfs.new.db';

// Ścieżka bez ukośnika na końcu: expo-file-system traktuje ją inaczej przy
// sprawdzaniu uprawnień niż z ogonkiem.
function sqliteDirUri(): string {
  const raw = String((SQLite as unknown as { defaultDatabaseDirectory?: unknown }).defaultDatabaseDirectory ?? '');
  if (raw) return raw.endsWith('/') ? raw.slice(0, -1) : raw;
  const base = FileSystem.documentDirectory;
  if (!base) throw new Error('Brak documentDirectory (expo-file-system)');
  return `${base}SQLite`;
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
): Promise<void> {
  const T = syncDlTr();
  const dest = await sqliteUri(TEMP_DB_NAME);
  await deleteSidecars(dest);
  try {
    await FileSystem.deleteAsync(dest, { idempotent: true });
  } catch {
    // best-effort (stary niekompletny temp)
  }

  // Download strumieniem na dysk (wznawialny) — RAM-u prawie nie rusza.
  const task = FileSystem.createDownloadResumable(
    dbDownloadUrl(manifest),
    dest,
    { headers: { 'User-Agent': 'KilometrApp/1.0' } },
    (p) => onProgress?.(p.totalBytesWritten, p.totalBytesExpectedToWrite),
  );
  const result = await task.downloadAsync().catch((err: unknown) => {
    throw describeDownloadError(err);
  });
  if (!result?.uri) throw new GtfsDownloadError(T.noFile, 'download bez uri', T.hintTouch);

  // Rozmiar musi się zgadzać co do bajta — inaczej nie ma podmiany.
  const info = await FileSystem.getInfoAsync(dest);
  const size = info.exists && 'size' in info ? (info.size as number) : -1;
  if (size !== manifest.db.sizeBytes) {
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
    throw new GtfsDownloadError(T.unavailable, `rozmiar ${size} != ${manifest.db.sizeBytes}`, T.hintLater, 'unreachable');
  }

  // Weryfikacja zawartości na pliku tymczasowym (osobny uchwyt!).
  const probe = await SQLite.openDatabaseAsync(TEMP_DB_NAME);
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
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
    throw err instanceof GtfsDownloadError ? err : describeDownloadError(err);
  }
  try {
    await probe.closeAsync();
  } catch {
    // best-effort
  }

  // Podmiana: zamknij działającą bazę, podmień plik atomowo (w ramach katalogu).
  // Bramka blokuje równoległe getGtfsDb() z UI, żeby nie otworzyły usuwanego pliku.
  beginGtfsSwap();
  const mainUri = await sqliteUri(GTFS_DB_NAME);
  try {
    await closeGtfsDb();
    try {
      await FileSystem.deleteAsync(mainUri, { idempotent: true });
    } catch {
      // best-effort
    }
    await deleteSidecars(mainUri);
    await FileSystem.moveAsync({ from: dest, to: mainUri });
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
    await setMeta('feeds', JSON.stringify({ mpk: manifest.sources.mpk?.effectiveDate ?? null, kd: manifest.sources.kd?.schedulesVersion ?? null }));
  } catch {
    // meta opisowa — nie blokuje gotowości
  }
}
