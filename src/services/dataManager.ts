// Orkiestracja danych offline: status, import GTFS do SQLite, odświeżanie.
// UI (ekran ustawień / baner) pyta getDataStatus() i subskrybuje zmiany,
// żeby pokazać pasek postępu pierwszego importu zamiast "Offline".
//
// Kolejność importu (od najmniejszego):
// stops → routes → calendar → calendar_dates → trips → stop_times.
// stop_times jest najcięższy (~1.5 mln wierszy dla Wrocławia, ~2 mln dla
// Krakowa z trzech feedów) — importujemy batched po 5000 rekordów
// w transakcjach.
//
// Import dotyczy AKTYWNEGO MIASTA, które może wystawiać kilka archiwów
// (patrz `src/cities`).

import { parseCalendarContent, parseCalendarDatesContent, parseRoutesContent, parseStopsContent, parseTripsContent, parseStopTimesBatched } from '../gtfs/csv';
import type { GtfsCalendar } from '../gtfs/types';
import { getActiveCitySync } from '../cities/active';
import { refreshHours } from './gtfsConfig';
import {
  cleanupRawGtfs,
  downloadFeedWithFallback,
  GtfsDownloadError,
  hasExtractedGtfs,
  readGtfsFiles,
  unzipGtfs,
} from './gtfsDownloader';
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

/**
 * Pełny import rozkładu AKTYWNEGO MIASTA: archiwa → unzip → SQLite.
 *
 * Miasto może wystawiać wiele archiwów (Kraków: tramwaje + autobusy MPK +
 * Mobilis), więc etapy powtarzają się per feed. Ważne:
 *
 * - tabele czyścimy RAZ, przed pętlą, nie per feed;
 * - każdy feed ma własny nagłówek CSV, bo szerokość kolumn różni się między
 *   plikami (tramwaje ZTP: 9 kolumn w routes.txt, autobusy: 12), więc
 *   parsujemy osobno i dopisujemy (`INSERT OR REPLACE`);
 * - feed opcjonalny, którego nie udało się pobrać, pomijamy — wolno mieć
 *   rozkład bez przewoźnika prywatnego, niedopuszczalne jest stawianie tego
 *   jako błędu;
 * - `stop_times` to najcięższy etap (~140 MB tekstu dla Krakowa), więc
 *   postęp liczymy na wszystkich feedach łącznie.
 */
export async function importGtfsFromNetwork(): Promise<void> {
  if (importInProgress) return;
  importInProgress = true;
  try {
    const city = getActiveCitySync();
    const feeds = city.feeds;
    const T = dataTr();

    emit({ state: 'downloading', progress: 0 });
    // Feedy po kolei: równoległe pobieranie trzech archiwów po kilkadziesiąt
    // MB tylko wzmocniłoby problem z limitem zapisu na wolnym dysku.
    const downloaded: string[] = [];
    for (let i = 0; i < feeds.length; i++) {
      const feed = feeds[i];
      try {
        const { uri } = await downloadFeedWithFallback(feed, (p) => {
          const within = p.totalBytes > 0 ? p.bytesWritten / p.totalBytes : 0;
          // Feedy mają różne rozmiary, więc dzielimy postęp równo między
          // nie; to przybliżenie, ale nie skacze jak liczenie na bajtach.
          emit({ state: 'downloading', progress: (i + within) / feeds.length });
        });
        downloaded.push(uri);
      } catch (err) {
        if (!feed.optional) throw err;
        console.warn(`[DataManager] opcjonalny feed ${feed.id} pominięty:`, err);
      }
    }
    if (downloaded.length === 0) {
      throw new Error(T.prepareFail);
    }

    emit({ state: 'importing', step: T.stepUnpack, progress: 0 });
    let unpacked = 0;
    for (const feed of feeds) {
      const uri = downloaded[unpacked];
      if (uri) await unzipGtfs(uri, feed.id);
      unpacked++;
    }

    await clearGtfsTables();
    await prepareForBulkImport();

    // Pliki czytamy raz, przed pętlą po feedach — czytanie z dysku w trakcie
    // importu wielokrotnie spowalnia ciężki etap stop_times.
    const [stopsFiles, routesFiles, calendarFiles, calDatesFiles, tripsFiles, stopTimesFiles] =
      await Promise.all([
        readGtfsFiles('stops.txt'),
        readGtfsFiles('routes.txt'),
        readGtfsFiles('calendar.txt'),
        readGtfsFiles('calendar_dates.txt'),
        readGtfsFiles('trips.txt'),
        readGtfsFiles('stop_times.txt'),
      ]);

    emit({ state: 'importing', step: T.stepStops, progress: 0.05 });
    let sawStops = false;
    for (const f of stopsFiles) {
      if (!f.content) continue;
      sawStops = true;
      await importStops(parseStopsContent(f.content));
    }
    if (!sawStops) throw new Error(T.errStops);

    emit({ state: 'importing', step: T.stepLines, progress: 0.15 });
    for (const f of routesFiles) {
      if (!f.content) continue;
      // `route_type` zapisujemy tak, jak go dał operator (Wrocław 0/3,
      // Kraków 900/3). Interpretację robi `gtfs/transitMode` — nie
      // normalizujemy tu typów, bo zgubilibyśmy informację o feedzie.
      await importRoutes(parseRoutesContent(f.content));
    }

    emit({ state: 'importing', step: T.stepCalendar, progress: 0.25 });
    const allCals: GtfsCalendar[] = [];
    const allCalDates: { service_id: string; date: string; exception_type: number }[] = [];
    for (const f of calendarFiles) if (f.content) allCals.push(...parseCalendarContent(f.content));
    for (const f of calDatesFiles) if (f.content) allCalDates.push(...parseCalendarDatesContent(f.content));
    await importCalendar(allCals);
    await importCalendarDates(allCalDates);

    emit({ state: 'importing', step: T.stepTrips, progress: 0.35 });
    let sawTrips = false;
    for (const f of tripsFiles) {
      if (!f.content) continue;
      sawTrips = true;
      // Tripsy jednego feedu to kilka MB tekstu — wchodzi bez chunkowania.
      await importTrips(parseTripsContent(f.content));
    }
    if (!sawTrips) throw new Error(T.errTrips);

    emit({ state: 'importing', step: T.stepTimes, progress: 0.5 });
    let done = 0;
    let sawTimes = false;
    // Orientacyjna liczba wierszy stop_times w całym mieście: Wrocław
    // ~1.5 mln, Kraków (3 feedy) ~2 mln. Służy tylko do płynnego paska postępu.
    const totalTimes = city.id === 'krakow' ? 2000000 : 1500000;
    for (const f of stopTimesFiles) {
      if (!f.content) continue;
      sawTimes = true;
      await parseStopTimesBatched(
        f.content,
        async (batch) => {
          await importStopTimesBatch(batch);
          done += batch.length;
          emit({
            state: 'importing',
            step: T.stepTimesK(Math.round(done / 1000)),
            progress: Math.min(0.95, 0.5 + done / totalTimes / 2),
          });
        },
        { batchSize: 5000 },
      );
    }
    if (!sawTimes) throw new Error(T.errTimes);

    emit({ state: 'importing', step: T.stepIndex, progress: 0.97 });
    await finishBulkImport();

    emit({ state: 'importing', step: T.stepWeights, progress: 0.98 });
    await computeStopWeights();

    await setMeta('gtfs_imported_at', new Date().toISOString());
    await setMeta('gtfs_source', 'network');
    // Zapamiętujemy, którymi feedami zbudowano bazę — przy diagnostyce
    // importu warto wiedzieć, czy Mobilis w ogóle się pobrał.
    await setMeta('gtfs_feeds', downloaded.length + '/' + feeds.length);
    await cleanupRawGtfs();
    await resetRoutingStore();
    // Flaga w dół przed końcowym odświeżeniem — inaczej refresh uzna, że
    // import nadal trwa, i nigdy nie wyemituje gotowości. (finally i tak czyści.)
    importInProgress = false;
    await refreshDataStatus();
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

/** Sprawdza katalog raz dziennie — jak jest nowy rozkład, importuje w tle. */
export async function checkForGtfsUpdate(): Promise<boolean> {
  try {
    const lastCheck = await getMeta('gtfs_last_check');
    if (lastCheck && Date.now() - new Date(lastCheck).getTime() < refreshHours() * 3600 * 1000) {
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
