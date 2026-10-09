// Orkiestracja danych offline: status, import GTFS do SQLite, odświeżanie.
// UI (ekran ustawień / baner) pyta getDataStatus() i subskrybuje zmiany,
// żeby pokazać pasek postępu pierwszego importu zamiast "Offline".
//
// Kolejność importu (od najmniejszego):
// stops → routes → calendar → calendar_dates → trips → stop_times.
// stop_times jest ~46 MB — importujemy batched po 5000 rekordów w transakcjach.

import { parseCalendarContent, parseCalendarDatesContent, parseRoutesContent, parseStopsContent, parseTripsContent, parseStopTimesBatched } from '../gtfs/csv';
import { GTFS, TIMETABLE } from './gtfsConfig';
import {
  cleanupRawGtfs,
  downloadArchiveWithFallback,
  GtfsDownloadError,
  gtfsDir,
  hasExtractedGtfs,
  readGtfsText,
  unzipGtfs,
} from './gtfsDownloader';
import { downloadPrebuiltDb, fetchManifest, getLocalTimetableVersion } from './timetableSync';
import { getLocaleSync, type Strings } from '../i18n';
import { pl } from '../i18n/pl';
import { en } from '../i18n/en';
import { de } from '../i18n/de';
import { uk } from '../i18n/uk';

const DATA_DICTS: Record<string, Strings> = { pl, en, de, uk };

function dataTr(): Strings['data'] {
  return (DATA_DICTS[getLocaleSync()] ?? pl).data;
}

import {
  getGtfsStats,
  getMeta,
  importCalendar,
  importCalendarDates,
  importRoutes,
  importStopTimesBatch,
  importStops,
  importTrips,
  clearGtfsTables,
  computeStopWeights,
  prepareForBulkImport,
  finishBulkImport,
  needsStopWeights,
  setMeta,
} from './gtfsDatabase';

export type GtfsSource = 'network';

export type DataStatus =
  | { state: 'empty' }
  | { state: 'downloading'; progress: number }
  | { state: 'importing'; step: string; progress: number }
  | { state: 'ready'; stops: number; trips: number; updatedAt: string | null; source: GtfsSource | null }
  | { state: 'error'; message: string; hint?: string; detail?: string };

let status: DataStatus = { state: 'empty' };
const listeners = new Set<(s: DataStatus) => void>();

export function getDataStatus(): DataStatus {
  return status;
}

export function subscribeDataStatus(fn: (s: DataStatus) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(next: DataStatus): void {
  status = next;
  for (const fn of listeners) {
    try {
      fn(next);
    } catch {
      // listener nie może wywalić importu
    }
  }
}

/** Skąd pochodzą dane w SQLite: pełny rozkład z sieci. */
export async function getGtfsSource(): Promise<GtfsSource | null> {
  try {
    const v = await getMeta('gtfs_source');
    return v === 'network' ? v : null;
  } catch {
    return null;
  }
}

/** Po imporcie pamięć RAPTOR-a jest nieaktualna — czyścimy, warmup dociągnie. */
async function resetRoutingStore(): Promise<void> {
  try {
    const { gtfsStore } = await import('./routing/store');
    gtfsStore.reset();
    const { liveTracker } = await import('./liveTracker');
    liveTracker.reset();
  } catch (err) {
    console.warn('[DataManager] store reset failed:', err);
  }
}

/** Szybki start: pełny rozkład w SQLite uznajemy za gotowy. */
export async function refreshDataStatus(): Promise<DataStatus> {
  // Trwający import sam emituje postęp — nie nadpisuj go fałszywym statusem.
  // Bez tego każde odświeżenie w połowie importu (przystanki już są, kursów
  // jeszcze nie) pokazywałoby "gotowe", a UI wracałoby potem do pobierania.
  if (importInProgress) return status;
  try {
    const stats = await getGtfsStats();
    if (stats.stops > 0 && stats.trips > 0 && stats.stopTimes > 0) {
      const updatedAt = await getMeta('gtfs_imported_at');
      emit({ state: 'ready', stops: stats.stops, trips: stats.trips, updatedAt, source: await getGtfsSource() });
      // Dokończenie przerwanego importu: wagi + warmup w tle.
      void ensureSearchReady();
    } else {
      // Przerwany import zostawia częściowe dane (np. przystanki bez kursów).
      // To nie jest działający rozkład — czyścimy, żeby UI wymusił pobieranie.
      if (stats.stops > 0 || stats.trips > 0 || stats.stopTimes > 0) {
        await clearGtfsTables().catch(() => {});
      }
      emit({ state: 'empty' });
    }
  } catch (err) {
    emit({ state: 'error', message: err instanceof Error ? err.message : String(err) });
  }
  return status;
}

/**
 * Tło po starcie: wagi przystanków (ranking podpowiedzi) i rozgrzany indeks
 * RAPTOR-a na bieżącą porę — żeby pierwsze wyszukiwanie tras nie płaciło
 * pełnego kosztu budowy indeksu.
 */
async function ensureSearchReady(): Promise<void> {
  try {
    if (await needsStopWeights()) {
      await computeStopWeights();
    }
  } catch (err) {
    console.warn('[DataManager] stop weights failed:', err);
  }
  try {
    const { warmupRouting } = await import('./routing/engine');
    await warmupRouting();
  } catch (err) {
    console.warn('[DataManager] routing warmup failed:', err);
  }
}

export let importInProgress = false;

/**
 * Czeka, aż trwający import GTFS się zakończy. Rozwiązuje się natychmiast,
 * gdy nic nie jest importowane.
 *
 * Silnik routingu używa tego zamiast pytać „coś się ładuje?" i oddawać pustą
 * listę: `LocalGtfsStore.load()` w trakcie importu nie ma prawidłowych
 * przystanków, więc planer zwracał zero połączeń i ekran pokazywał „nie
 * znaleziono połączeń" zamiast „rozkład się importuje".
 */
export function awaitImportSettled(timeoutMs = 180000): Promise<void> {
  if (!importInProgress) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      listeners.delete(watch);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const watch = () => {
      if (!importInProgress) finish();
    };
    listeners.add(watch);
  });
}

/** Co faktycznie zrobiło ostatnie odświeżenie, żeby UI mogło to pokazać. */
export type ImportOutcome = 'updated' | 'upToDate' | 'keptLocal';

/** Pełny import: gotowa baza z serwera, w ostateczności klasyczny ZIP. */
export async function importGtfsFromNetwork(): Promise<ImportOutcome> {
  if (importInProgress) return 'upToDate';
  importInProgress = true;
  try {
    // Ścieżka 1 (domyślna po skonfigurowaniu serwera): prebuilt SQLite.
    // Brak parsowania na telefonie — download strumieniem + podmiana pliku.
    if (TIMETABLE.baseUrl) {
      const synced = await tryImportPrebuilt().catch((err) => {
        console.warn('[DataManager] prebuilt sync failed:', err instanceof Error ? err.message : String(err));
        return null;
      });
      if (synced) {
        // Flaga w dół przed końcowym odświeżeniem (ten sam powód co niżej).
        importInProgress = false;
        await refreshDataStatus();
        return synced;
      }
      // Nieudany sync, ale baza działa? Nie psujemy jej i nie męczymy
      // użytkownika importem ZIP na siłę. Pusta baza → fallback do ZIP.
      const stats = await getGtfsStats().catch(() => null);
      if (stats && stats.stops > 0 && stats.trips > 0 && stats.stopTimes > 0) {
        importInProgress = false;
        await refreshDataStatus();
        return 'keptLocal';
      }
    }

    // Ścieżka 2 (fallback): katalog → zip → unzip → SQLite, jak dawniej.
    await importGtfsLegacy();
    // Flaga w dół przed końcowym odświeżeniem — inaczej refresh uzna, że
    // import nadal trwa, i nigdy nie wyemituje gotowości. (finally i tak czyści.)
    importInProgress = false;
    await refreshDataStatus();
    return 'updated';
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Surowy komunikat sieciowy ("Unable to resolve host…") nigdy nie trafia
    // do UI — pokazujemy zdanie w języku użytkownika, a szczegóły w logu.
    const Terr = dataTr();
    const message =
      err instanceof GtfsDownloadError ? err.message : Terr.prepareFail;
    console.warn('[DataManager] import failed:', detail);
    emit({
      state: 'error',
      message,
      hint: err instanceof GtfsDownloadError ? err.hint : Terr.retryHint,
      detail,
    });
    try {
      await finishBulkImport();
    } catch {}
    throw err;
  } finally {
    importInProgress = false;
  }
}

/**
 * Sync z serwera: manifest → przy nowej wersji download + podmiana bazy.
 * 'upToDate' gdy telefon ma już tę wersję, 'updated' gdy baza właśnie wjechała.
 * Rzuca przy problemach, wtedy caller decyduje o fallbacku do ZIP.
 */
async function tryImportPrebuilt(): Promise<'updated' | 'upToDate'> {
  const manifest = await fetchManifest();
  const local = await getLocalTimetableVersion();
  if (local && local === manifest.version) {
    await setMeta('gtfs_last_check', new Date().toISOString());
    return 'upToDate';
  }
  emit({ state: 'downloading', progress: 0 });
  await downloadPrebuiltDb(manifest, (written, total) => {
    emit({ state: 'downloading', progress: total > 0 ? written / total : 0 });
  });
  const T = dataTr();
  emit({ state: 'importing', step: T.stepVerify, progress: 0.97 });
  await setMeta('gtfs_last_check', new Date().toISOString());
  await resetRoutingStore();
  return 'updated';
}

/**
 * Stara ścieżka: katalog Open Data → zip → unzip → SQLite w transakcjach.
 * Fallback, gdy serwer nieskonfigurowany albo sync padł przy pustej bazie.
 * (To ona potrafiła powodować OOM przy unzip na słabszych telefonach.)
 */
async function importGtfsLegacy(): Promise<void> {
  emit({ state: 'downloading', progress: 0 });
  const { uri: zipUri } = await downloadArchiveWithFallback((p) => {
    const progress = p.totalBytes > 0 ? p.bytesWritten / p.totalBytes : 0;
    emit({ state: 'downloading', progress });
  });

  const T = dataTr();
  emit({ state: 'importing', step: T.stepUnpack, progress: 0 });
    await unzipGtfs(zipUri);

    await clearGtfsTables();
    await prepareForBulkImport();

    emit({ state: 'importing', step: T.stepStops, progress: 0.05 });
    const stopsTxt = await readGtfsText('stops.txt');
    if (!stopsTxt) throw new Error(T.errStops);
    await importStops(parseStopsContent(stopsTxt));

    emit({ state: 'importing', step: T.stepLines, progress: 0.15 });
    const routesTxt = await readGtfsText('routes.txt');
    if (routesTxt) await importRoutes(parseRoutesContent(routesTxt));

    emit({ state: 'importing', step: T.stepCalendar, progress: 0.25 });
    const calTxt = await readGtfsText('calendar.txt');
    if (calTxt) await importCalendar(parseCalendarContent(calTxt));
    const calDatesTxt = await readGtfsText('calendar_dates.txt');
    await importCalendarDates(calDatesTxt ? parseCalendarDatesContent(calDatesTxt) : []);

    emit({ state: 'importing', step: T.stepTrips, progress: 0.35 });
    const tripsTxt = await readGtfsText('trips.txt');
    if (!tripsTxt) throw new Error(T.errTrips);
    // Tripsy całego miasta na raz to ~2.2 MB tekstu — wchodzi bez chunkowania.
    await importTrips(parseTripsContent(tripsTxt));

    emit({ state: 'importing', step: T.stepTimes, progress: 0.5 });
    const stopTimesTxt = await readGtfsText('stop_times.txt');
    if (!stopTimesTxt) throw new Error(T.errTimes);
    let done = 0;
    await parseStopTimesBatched(
      stopTimesTxt,
      async (batch) => {
        await importStopTimesBatch(batch);
        done += batch.length;
        // Progres orientacyjny: ~1.5M wierszy w stop_times Wrocławia.
        emit({ state: 'importing', step: T.stepTimesK(Math.round(done / 1000)), progress: Math.min(0.95, 0.5 + done / 1500000 / 2) });
      },
      { batchSize: 5000 },
    );

    emit({ state: 'importing', step: T.stepIndex, progress: 0.97 });
    await finishBulkImport();

    emit({ state: 'importing', step: T.stepWeights, progress: 0.98 });
    await computeStopWeights();

    await setMeta('gtfs_imported_at', new Date().toISOString());
    await setMeta('gtfs_dir', gtfsDir());
    await setMeta('gtfs_source', 'network');
    await cleanupRawGtfs();
    await resetRoutingStore();
}

/**
 * Sprawdza manifest raz dziennie — true, gdy na serwerze czeka nowsza baza.
 * Bez skonfigurowanego serwera (pusty TIMETABLE.baseUrl) zawsze false.
 * Uwaga: NIE pobiera automatycznie (~80 MB) — decyzję zostawia UI.
 */
export async function checkForGtfsUpdate(): Promise<boolean> {
  try {
    const lastCheck = await getMeta('gtfs_last_check');
    if (lastCheck && Date.now() - new Date(lastCheck).getTime() < GTFS.refreshHours * 3600 * 1000) {
      return false;
    }
    await setMeta('gtfs_last_check', new Date().toISOString());
    if (!TIMETABLE.baseUrl) return false;
    const manifest = await fetchManifest().catch(() => null);
    if (!manifest) return false;
    const local = await getLocalTimetableVersion();
    return manifest.version !== local;
  } catch {
    return false;
  }
}
