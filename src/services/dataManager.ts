// Orkiestracja danych offline: status, import GTFS do SQLite, odświeżanie.
// UI (ekran ustawień / baner) pyta getDataStatus() i subskrybuje zmiany,
// żeby pokazać pasek postępu pierwszego importu zamiast "Offline".
//
// Kolejność importu (od najmniejszego):
// stops → routes → calendar → calendar_dates → trips → stop_times.
// stop_times jest ~46 MB — importujemy batched po 5000 rekordów w transakcjach.

import { parseCalendarContent, parseCalendarDatesContent, parseRoutesContent, parseStopsContent, parseTripsContent, parseStopTimesBatched } from '../gtfs/csv';
import { GTFS } from './gtfsConfig';
import {
  cleanupRawGtfs,
  discoverBestArchiveUrl,
  downloadGtfsZip,
  gtfsDir,
  hasExtractedGtfs,
  readGtfsText,
  unzipGtfs,
} from './gtfsDownloader';
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
  | { state: 'error'; message: string };

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

/** Pełny import: katalog → zip → unzip → SQLite. Długie, z progresem. */
export async function importGtfsFromNetwork(): Promise<void> {
  if (importInProgress) return;
  importInProgress = true;
  try {
    emit({ state: 'downloading', progress: 0 });
    const url = await discoverBestArchiveUrl();
    const zipUri = await downloadGtfsZip(url, (p) => {
      const progress = p.totalBytes > 0 ? p.bytesWritten / p.totalBytes : 0;
      emit({ state: 'downloading', progress });
    });

    emit({ state: 'importing', step: 'Rozpakowywanie…', progress: 0 });
    await unzipGtfs(zipUri);

    await clearGtfsTables();
    await prepareForBulkImport();

    emit({ state: 'importing', step: 'Przystanki…', progress: 0.05 });
    const stopsTxt = await readGtfsText('stops.txt');
    if (!stopsTxt) throw new Error('Brak stops.txt w archiwum GTFS');
    await importStops(parseStopsContent(stopsTxt));

    emit({ state: 'importing', step: 'Linie…', progress: 0.15 });
    const routesTxt = await readGtfsText('routes.txt');
    if (routesTxt) await importRoutes(parseRoutesContent(routesTxt));

    emit({ state: 'importing', step: 'Kalendarz…', progress: 0.25 });
    const calTxt = await readGtfsText('calendar.txt');
    if (calTxt) await importCalendar(parseCalendarContent(calTxt));
    const calDatesTxt = await readGtfsText('calendar_dates.txt');
    await importCalendarDates(calDatesTxt ? parseCalendarDatesContent(calDatesTxt) : []);

    emit({ state: 'importing', step: 'Kursy…', progress: 0.35 });
    const tripsTxt = await readGtfsText('trips.txt');
    if (!tripsTxt) throw new Error('Brak trips.txt w archiwum GTFS');
    // Tripsy całego miasta na raz to ~2.2 MB tekstu — wchodzi bez chunkowania.
    await importTrips(parseTripsContent(tripsTxt));

    emit({ state: 'importing', step: 'Czasy odjazdów…', progress: 0.5 });
    const stopTimesTxt = await readGtfsText('stop_times.txt');
    if (!stopTimesTxt) throw new Error('Brak stop_times.txt w archiwum GTFS');
    let done = 0;
    await parseStopTimesBatched(
      stopTimesTxt,
      async (batch) => {
        await importStopTimesBatch(batch);
        done += batch.length;
        // Progres orientacyjny: ~1.5M wierszy w stop_times Wrocławia.
        emit({ state: 'importing', step: `Czasy odjazdów… (${Math.round(done / 1000)}k)`, progress: Math.min(0.95, 0.5 + done / 1500000 / 2) });
      },
      { batchSize: 5000 },
    );

    emit({ state: 'importing', step: 'Budowanie indeksów…', progress: 0.97 });
    await finishBulkImport();

    emit({ state: 'importing', step: 'Wagi przystanków…', progress: 0.98 });
    await computeStopWeights();

    await setMeta('gtfs_imported_at', new Date().toISOString());
    await setMeta('gtfs_dir', gtfsDir());
    await setMeta('gtfs_source', 'network');
    await cleanupRawGtfs();
    await resetRoutingStore();
    // Flaga w dół przed końcowym odświeżeniem — inaczej refresh uzna, że
    // import nadal trwa, i nigdy nie wyemituje gotowości. (finally i tak czyści.)
    importInProgress = false;
    await refreshDataStatus();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[DataManager] import failed:', message);
    emit({ state: 'error', message });
    try {
      await finishBulkImport();
    } catch {}
    throw err;
  } finally {
    importInProgress = false;
  }
}

/** Sprawdza katalog raz dziennie — jak jest nowy rozkład, importuje w tle. */
export async function checkForGtfsUpdate(): Promise<boolean> {
  try {
    const lastCheck = await getMeta('gtfs_last_check');
    if (lastCheck && Date.now() - new Date(lastCheck).getTime() < GTFS.refreshHours * 3600 * 1000) {
      return false;
    }
    await setMeta('gtfs_last_check', new Date().toISOString());
    // Etap 2: porównanie effectiveDate z katalogu z zapisaną wersją.
    // Na razie zwracamy false — pełny auto-update po podpięciu RAPTOR-a.
    return false;
  } catch {
    return false;
  }
}
