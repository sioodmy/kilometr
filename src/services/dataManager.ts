// Orkiestracja danych offline: status, import GTFS do SQLite, odświeżanie.
// UI (ekran ustawień / baner) pyta getDataStatus() i subskrybuje zmiany,
// żeby pokazać pasek postępu pierwszego importu zamiast "Offline".
//
// Kolejność importu (od najmniejszego):
// stops → routes → calendar → calendar_dates → trips → stop_times.
// stop_times jest ~46 MB - importujemy batched po 5000 rekordów w transakcjach.

import {
  parseCalendarContent,
  parseCalendarDatesContent,
  parseRequiredGtfsFiles,
  parseRoutesContent,
  parseStopTimesBatched,
} from '../gtfs/csv';
import { TIMETABLE } from './gtfsConfig';
import {
  cleanupRawGtfs,
  downloadArchiveWithFallback,
  GtfsDownloadError,
  gtfsDir,
  readGtfsText,
  unzipGtfs,
} from './gtfsDownloader';
import { downloadPrebuiltDb, fetchManifest, getLocalTimetableVersion } from './timetableSync';
import { getTimetableDownloadGate, markTimetableDownloaded } from './downloadLimits';
import { getActiveCityIdSync } from './cityStore';
import { kvGet, kvRemove, kvSet } from './storage';
import { warmupAddressIndex } from './addressIndex';
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
  getGtfsPresence,
  getGtfsStats,
  getMeta,
  getTimetableEndDate,
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
  GTFS_IMPORT_COMPLETE_META,
  needsStopWeights,
  setMeta,
} from './gtfsDatabase';

type GtfsSource = 'network';

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

/**
 * Zmiana miasta zeruje status: liczby z poprzedniego rozkładu nie dotyczą nowego
 * miasta, a Ustawienia pokazywałyby wtedy "gotowe" z cudzymi liczbami.
 *
 * `importInProgress` zostaje nietknięty: to blokada (muteks) importu, nie status.
 * Zdejmowanie jej w trakcie trwającego importu pozwoliłoby drugiemu importowi
 * wejść do tego samego pliku, a routing nowego miasta planowałby na bazie
 * w połowie zaimportowanej. Zamiast tego import ma token miasta i sam się
 * przerywa, gdy użytkownik zmieni miasto w trakcie (patrz `importInProgress`).
 */
export function resetDataStatusForCity(): void {
  emit({ state: 'empty' });
}

/** Skąd pochodzą dane w SQLite: pełny rozkład z sieci. */
async function getGtfsSource(): Promise<GtfsSource | null> {
  try {
    const v = await getMeta('gtfs_source');
    return v === 'network' ? v : null;
  } catch {
    return null;
  }
}

/** Po imporcie pamięć RAPTOR-a jest nieaktualna - czyścimy, warmup dociągnie. */
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

/** Miasto, którego baza jest w trakcie importu (do sprzątania po przerwaniu). */
const IMPORT_CITY_KEY = 'kilometr.gtfsImportCity.v1';

/**
 * Czyści bazę miasta, którego import przerwano. Gdy użytkownik zdążył zmienić
 * miasto, czyścimy TYLKO starą bazę; aktywna zostaje nietknięta nawet gdy
 * nie ma jeszcze znacznika kompletności.
 */
async function cleanupAbortedImport(activeCityId: string): Promise<boolean> {
  const importCityId = await kvGet(IMPORT_CITY_KEY);
  if (!importCityId || getActiveCityIdSync() !== activeCityId) return false;
  const otherCity = importCityId !== activeCityId;
  if (otherCity) {
    const complete = await getMeta(GTFS_IMPORT_COMPLETE_META, importCityId);
    const importedAt = complete === '1' ? null : await getMeta('gtfs_imported_at', importCityId);
    if (getActiveCityIdSync() !== activeCityId) return false;
    if (complete !== '1' && !importedAt) {
      await clearGtfsTables(importCityId).catch(() => {});
    }
  }
  await kvRemove(IMPORT_CITY_KEY);
  return otherCity;
}

/** Szybki start: pełny rozkład w SQLite uznajemy za gotowy. */
export async function refreshDataStatus(): Promise<DataStatus> {
  // Trwający import sam emituje postęp - nie nadpisuj go fałszywym statusem.
  // Bez tego każde odświeżenie w połowie importu (przystanki już są, kursów
  // jeszcze nie) pokazywałoby "gotowe", a UI wracałoby potem do pobierania.
  if (importInProgress) return status;
  const refreshCityId = getActiveCityIdSync();
  const cityChanged = () => getActiveCityIdSync() !== refreshCityId;
  try {
    const stats = await getGtfsPresence();
    if (cityChanged()) return status;
    const marker = await getMeta(GTFS_IMPORT_COMPLETE_META);
    if (cityChanged()) return status;
    const hasData = stats.stops > 0 && stats.trips > 0 && stats.hasStopTimes;
    if (hasData && marker === '1') {
      await cleanupAbortedImport(refreshCityId);
      if (cityChanged()) return status;
      const updatedAt = await getMeta('gtfs_imported_at');
      const source = await getGtfsSource();
      emitForCity(refreshCityId, {
        state: 'ready',
        stops: stats.stops,
        trips: stats.trips,
        updatedAt,
        source,
      });
      // Dokończenie przerwanego importu: wagi + warmup w tle.
      void ensureSearchReady();
    } else {
      // Przerwany import zostawia częściowe dane (np. przystanki bez kursów).
      // To nie jest działający rozkład - czyścimy, żeby UI wymusił pobieranie.
      // Gdy import szedł w innym mieście, aktywnej bazy nie ruszamy.
      const otherCityCleaned = await cleanupAbortedImport(refreshCityId);
      if (cityChanged()) return status;
      if (!otherCityCleaned && (stats.stops > 0 || stats.trips > 0 || stats.hasStopTimes)) {
        await clearGtfsTables().catch(() => {});
      }
      await kvRemove(IMPORT_CITY_KEY);
      emitForCity(refreshCityId, { state: 'empty' });
    }
  } catch (err) {
    emitForCity(refreshCityId, { state: 'error', message: err instanceof Error ? err.message : String(err) });
  }
  return status;
}

/** Emituje status tylko wtedy, gdy aktywne miasto nadal jest tym, dla którego go policzono. */
function emitForCity(cityId: string, next: DataStatus): void {
  if (getActiveCityIdSync() === cityId) emit(next);
}

const EXPIRY_MARGIN_DAYS = 3;
const EXPIRY_RETRY_MS = 60 * 60 * 1000;
let lastExpiryAttempt = 0;

/**
 * Rozkład kończy się za kilka dni: sami sprawdzamy nowszy. Po końcu kalendarza
 * planer nie ma już kursów, a ręczne „Sprawdź aktualizacje" to za mało.
 * Manifest sprawdzamy co najwyżej raz na `refreshHours`, próby bez sieci raz na godzinę.
 */
export async function refreshTimetableIfExpiring(): Promise<void> {
  if (importInProgress || Date.now() - lastExpiryAttempt < EXPIRY_RETRY_MS) return;
  const end = await getTimetableEndDate().catch(() => null);
  if (!end) return;
  const soon = new Date();
  soon.setDate(soon.getDate() + EXPIRY_MARGIN_DAYS);
  const soonKey = `${soon.getFullYear()}${String(soon.getMonth() + 1).padStart(2, '0')}${String(soon.getDate()).padStart(2, '0')}`;
  if (end > soonKey) return;
  const lastCheck = await getMeta('gtfs_last_check').catch(() => null);
  if (lastCheck && Date.now() - new Date(lastCheck).getTime() < TIMETABLE.refreshHours * 3600 * 1000) return;
  lastExpiryAttempt = Date.now();
  await importGtfsFromNetwork();
}

/** Po starcie rozgrzewa równolegle routing, adresy i wagi przystanków. */
async function ensureSearchReady(): Promise<void> {
  const weights = (async () => {
    try {
      if (await needsStopWeights()) {
        await computeStopWeights();
      }
    } catch (err) {
      console.warn('[DataManager] stop weights failed:', err);
    }
  })();
  const warmup = (async () => {
    try {
      const { warmupRouting } = await import('./routing/engine');
      await warmupRouting();
    } catch (err) {
      console.warn('[DataManager] routing warmup failed:', err);
    }
  })();
  const addresses = warmupAddressIndex().catch((err: unknown) => {
    console.warn('[DataManager] address warmup failed:', err);
  });
  await Promise.all([weights, warmup, addresses]);
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
export type ImportOutcome = 'updated' | 'upToDate' | 'keptLocal' | 'cooldown';

/** Pełny import: gotowa baza z serwera, w ostateczności klasyczny ZIP. */
export async function importGtfsFromNetwork(): Promise<ImportOutcome> {
  if (importInProgress) return 'upToDate';
  importInProgress = true;
  // Miasto w chwili startu. Użytkownik może zmienić miasto w trakcie
  // (pobieranie trwa minuty); wtedy import kończy się bez błędu i bez ruszania
  // statusu, bo nowe miasto ma własny cykl pobierania.
  const importCityId = getActiveCityIdSync();
  const cityChanged = () => getActiveCityIdSync() !== importCityId;
  try {
    // Ścieżka 1 (domyślna po skonfigurowaniu serwera): prebuilt SQLite.
    // Brak parsowania na telefonie - download strumieniem + podmiana pliku.
    if (TIMETABLE.baseUrl) {
      const synced = await tryImportPrebuilt(importCityId).catch((err) => {
        console.warn('[DataManager] prebuilt sync failed:', err instanceof Error ? err.message : String(err));
        return null;
      });
      if (cityChanged()) {
        console.log('[DataManager] miasto zmienione w trakcie importu, kończę bez błędu');
        return 'upToDate';
      }
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
    // Tylko Wrocław ma legacy feed Open Data; inne miasta biorą wyłącznie
    // prebuilt z serwera (katalog Wrocławia do bazy Krakowa to katastrofa).
    // Też objęta limitem, żeby nie palić Open Data / R2 przy spamie przycisku.
    const { getActiveCitySync } = await import('./cityStore');
    if (getActiveCitySync().id !== 'wroclaw') {
      const detail = 'prebuilt sync failed';
      const Terr = dataTr();
      console.warn('[DataManager] import failed:', detail);
      emit({ state: 'error', message: Terr.prepareFail, hint: Terr.retryHint, detail });
      throw new Error(detail);
    }
    const gate = await getTimetableDownloadGate();
    const localStats = await getGtfsStats().catch(() => null);
    const hasLocal =
      !!localStats && localStats.stops > 0 && localStats.trips > 0 && localStats.stopTimes > 0;
    if (!gate.allowed && hasLocal) {
      importInProgress = false;
      await refreshDataStatus();
      return 'cooldown';
    }
    const imported = await importGtfsLegacy(importCityId);
    if (!imported) {
      console.log('[DataManager] miasto zmienione w trakcie importu ZIP, przerywam');
      return 'upToDate';
    }
    await markTimetableDownloaded();
    // Flaga w dół przed końcowym odświeżeniem - inaczej refresh uzna, że
    // import nadal trwa, i nigdy nie wyemituje gotowości. (finally i tak czyści.)
    importInProgress = false;
    await refreshDataStatus();
    return 'updated';
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Surowy komunikat sieciowy ("Unable to resolve host…") nigdy nie trafia
    // do UI - pokazujemy zdanie w języku użytkownika, a szczegóły w logu.
    const Terr = dataTr();
    const message =
      err instanceof GtfsDownloadError ? err.message : Terr.prepareFail;
    console.warn('[DataManager] import failed:', detail);
    emitForCity(importCityId, {
      state: 'error',
      message,
      hint: err instanceof GtfsDownloadError ? err.hint : Terr.retryHint,
      detail,
    });
    try {
      await finishBulkImport(importCityId);
    } catch {}
    throw err;
  } finally {
    importInProgress = false;
    // Ścieżka błędu emituje status PRZED wyzerowaniem flagi, więc watch z
    // awaitImportSettled nie zdążył zauważyć końca importu. Powiadamiamy tu,
    // po zgaszeniu flagi, żeby oczekujący nie wisieli do timeoutu.
    for (const l of listeners) l(status);
  }
}

/**
 * Sync z serwera: manifest → przy nowej wersji download + podmiana bazy.
 * 'upToDate' gdy telefon ma już tę wersję, 'updated' gdy baza właśnie wjechała,
 * 'cooldown' gdy jest nowsza wersja, ale pełne pobranie było za niedawno.
 * Rzuca przy problemach, wtedy caller decyduje o fallbacku do ZIP.
 */
async function tryImportPrebuilt(pinnedCityId: string): Promise<'updated' | 'upToDate' | 'cooldown'> {
  // Miasto pinujemy na całą operację: pobieranie trwa minuty, a użytkownik
  // może w międzyczasie zmienić miasto. Manifest, plik tymczasowy i cel
  // podmiany muszą dotyczyć tego samego miasta.
  const cityId = pinnedCityId;
  const manifest = await fetchManifest(cityId);
  if (getActiveCityIdSync() !== cityId) return 'upToDate';
  const local = await getLocalTimetableVersion();
  if (getActiveCityIdSync() !== cityId) return 'upToDate';
  if (local && local === manifest.version) {
    await setMeta('gtfs_last_check', new Date().toISOString(), cityId);
    return 'upToDate';
  }

  // Nowa wersja na serwerze, ale lokalna baza jest: szanujemy limit R2.
  const gate = await getTimetableDownloadGate();
  if (getActiveCityIdSync() !== cityId) return 'upToDate';
  if (!gate.allowed && local) {
    await setMeta('gtfs_last_check', new Date().toISOString(), cityId);
    return 'cooldown';
  }

  emit({ state: 'downloading', progress: 0 });
  await downloadPrebuiltDb(
    manifest,
    (written, total) => {
      emit({ state: 'downloading', progress: total > 0 ? written / total : 0 });
    },
    cityId,
  );
  if (getActiveCityIdSync() !== cityId) return 'upToDate';
  const T = dataTr();
  emit({ state: 'importing', step: T.stepVerify, progress: 0.97 });
  await setMeta('gtfs_last_check', new Date().toISOString(), cityId);
  await markTimetableDownloaded();
  await resetRoutingStore();
  return 'updated';
}

/**
 * Stara ścieżka ZIP. Najpierw waliduje wymagane pliki, dopiero potem czyści
 * bazę. Wszystkie zapisy idą do bazy miasta z początku importu, a każdy krok
 * sprawdza `cityChanged`: zmiana miasta w trakcie nie może wyczyścić ani
 * zabrudzić bazy nowego miasta. Zwraca false, gdy import przerwano.
 */
async function importGtfsLegacy(importCityId: string): Promise<boolean> {
  const cityChanged = () => getActiveCityIdSync() !== importCityId;
  emit({ state: 'downloading', progress: 0 });
  const { uri: zipUri } = await downloadArchiveWithFallback((p) => {
    const progress = p.totalBytes > 0 ? p.bytesWritten / p.totalBytes : 0;
    emit({ state: 'downloading', progress });
  });
  if (cityChanged()) return false;

  const T = dataTr();
  emit({ state: 'importing', step: T.stepUnpack, progress: 0 });
  await unzipGtfs(zipUri);
  if (cityChanged()) return false;

  // Walidacja przed clearGtfsTables: uszkodzony albo niekompletny ZIP nie
  // może skasować działającego rozkładu.
  const stopsTxt = await readGtfsText('stops.txt');
  const tripsTxt = await readGtfsText('trips.txt');
  const stopTimesTxt = await readGtfsText('stop_times.txt');
  if (cityChanged()) return false;
  const validated = await parseRequiredGtfsFiles({ stops: stopsTxt, trips: tripsTxt, stopTimes: stopTimesTxt });
  if (cityChanged()) return false;
  if (validated.stops.length === 0) throw new Error(T.errStops);
  if (validated.trips.length === 0) throw new Error(T.errTrips);
  if (validated.stopTimesRows === 0) throw new Error(T.errTimes);

  // Od tego miejsca stara baza jest nieaktualna, więc zapamiętujemy miasto
  // do sprzątania, gdy import padnie przed znacznikiem kompletności.
  await kvSet(IMPORT_CITY_KEY, importCityId);
  if (cityChanged()) {
    await kvRemove(IMPORT_CITY_KEY);
    return false;
  }
  await clearGtfsTables(importCityId);
  if (cityChanged()) return false;
  await prepareForBulkImport(importCityId);
  if (cityChanged()) return false;

  emit({ state: 'importing', step: T.stepStops, progress: 0.05 });
  await importStops(validated.stops, importCityId);
  if (cityChanged()) return false;

  emit({ state: 'importing', step: T.stepLines, progress: 0.15 });
  const routesTxt = await readGtfsText('routes.txt');
  if (routesTxt) await importRoutes(parseRoutesContent(routesTxt), importCityId);
  if (cityChanged()) return false;

  emit({ state: 'importing', step: T.stepCalendar, progress: 0.25 });
  const calTxt = await readGtfsText('calendar.txt');
  if (calTxt) await importCalendar(parseCalendarContent(calTxt), importCityId);
  const calDatesTxt = await readGtfsText('calendar_dates.txt');
  await importCalendarDates(calDatesTxt ? parseCalendarDatesContent(calDatesTxt) : [], importCityId);
  if (cityChanged()) return false;

  emit({ state: 'importing', step: T.stepTrips, progress: 0.35 });
  // Tripsy całego miasta na raz to ~2.2 MB tekstu - wchodzi bez chunkowania.
  await importTrips(validated.trips, importCityId);
  if (cityChanged()) return false;

  emit({ state: 'importing', step: T.stepTimes, progress: 0.5 });
  let done = 0;
  let stopped = false;
  await parseStopTimesBatched(
    stopTimesTxt ?? '',
    async (batch) => {
      if (cityChanged()) {
        stopped = true;
        return;
      }
      await importStopTimesBatch(batch, importCityId);
      done += batch.length;
      // Progres orientacyjny: ~1.5M wierszy w stop_times dużego miasta.
      emit({ state: 'importing', step: T.stepTimesK(Math.round(done / 1000)), progress: Math.min(0.95, 0.5 + done / 1500000 / 2) });
    },
    { batchSize: 5000 },
  );
  if (stopped || cityChanged()) return false;

  emit({ state: 'importing', step: T.stepIndex, progress: 0.97 });
  await finishBulkImport(importCityId);
  if (cityChanged()) return false;

  emit({ state: 'importing', step: T.stepWeights, progress: 0.98 });
  await computeStopWeights(importCityId);
  if (cityChanged()) return false;

  const importedAt = new Date().toISOString();
  await setMeta('gtfs_imported_at', importedAt, importCityId);
  await setMeta('gtfs_dir', gtfsDir(), importCityId);
  await setMeta('gtfs_source', 'network', importCityId);
  // Znacznik dopiero po finishBulkImport i końcowych metach.
  await setMeta(GTFS_IMPORT_COMPLETE_META, '1', importCityId);
  await kvRemove(IMPORT_CITY_KEY);
  await cleanupRawGtfs();
  await resetRoutingStore();
  return true;
}
