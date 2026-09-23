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
  prepareForBulkImport,
  finishBulkImport,
  setMeta,
} from './gtfsDatabase';

export type DataStatus =
  | { state: 'empty' }
  | { state: 'downloading'; progress: number }
  | { state: 'importing'; step: string; progress: number }
  | { state: 'ready'; stops: number; trips: number; updatedAt: string | null }
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

/** Szybki start: jeśli SQLite ma przystanki, uznajemy dane za gotowe. */
export async function refreshDataStatus(): Promise<DataStatus> {
  try {
    const stats = await getGtfsStats();
    if (stats.stops > 0) {
      const updatedAt = await getMeta('gtfs_imported_at');
      emit({ state: 'ready', stops: stats.stops, trips: stats.trips, updatedAt });
    } else {
      emit({ state: 'empty' });
    }
  } catch (err) {
    emit({ state: 'error', message: err instanceof Error ? err.message : String(err) });
  }
  return status;
}

let importInProgress = false;

/** Pełny import: katalog → zip → unzip → SQLite. Długie, z progresem. */
export async function importGtfsFromNetwork(): Promise<void> {
  if (importInProgress) return;
  importInProgress = true;
  try {
    emit({ state: 'downloading', progress: 0 });
    const url = await discoverBestArchiveUrl();
    await downloadGtfsZip(url, (p) => {
      const progress = p.totalBytes > 0 ? p.bytesWritten / p.totalBytes : 0;
      emit({ state: 'downloading', progress });
    });

    emit({ state: 'importing', step: 'Rozpakowywanie…', progress: 0 });
    // Jeśli zip już był rozpakowany (retry), nie rozpakowuj drugi raz.
    const already = await hasExtractedGtfs();
    if (!already) {
      const { gtfsZipUri } = await import('./gtfsDownloader');
      await unzipGtfs(gtfsZipUri());
    }

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

    await setMeta('gtfs_imported_at', new Date().toISOString());
    await setMeta('gtfs_dir', gtfsDir());
    await cleanupRawGtfs();
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
