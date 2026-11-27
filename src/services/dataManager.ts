// Orkiestracja danych offline: status, import GTFS do SQLite, odświeżanie.
// UI (ekran ustawień / baner) pyta getDataStatus() i subskrybuje zmiany,
// żeby pokazać pasek postępu pierwszego importu zamiast "Offline".
//
// Kolejność importu (od najmniejszego):
// stops → routes → calendar → calendar_dates → trips → stop_times.
// stop_times jest ~46 MB - importujemy batched po 5000 rekordów w transakcjach.

import { Platform } from 'react-native';
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
import {
  downloadPrebuiltDb,
  fetchManifest,
  TimetableSyncAbortedError,
} from './timetableSync';
import { getTimetableDownloadGate, markTimetableDownloaded } from './downloadLimits';
import { getActiveCityIdSync } from './cityStore';
import { invalidateLocalTimetableCache } from './offlineCache';
import { kvGet, kvRemove, kvSet } from './storage';
import { tr } from '../i18n/locale';

function dataTr() {
  return tr().data;
}

import {
  getGtfsPresence,
  getGtfsStats,
  getMeta,
  getMetaBatch,
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

interface ActiveImport {
  cityId: string;
  generation: number;
  controller: AbortController;
  promise: Promise<ImportOutcome>;
}

let importGeneration = 0;
let activeImport: ActiveImport | null = null;
export let importInProgress = false;

function isCurrentImportRun(runGen: number, cityId: string): boolean {
  return runGen === importGeneration && getActiveCityIdSync() === cityId;
}

function emitForRun(runGen: number, cityId: string, next: DataStatus): void {
  if (isCurrentImportRun(runGen, cityId)) emit(next);
}

/**
 * Przerywa bieżący import (np. po zmianie miasta w trakcie pobierania)
 * i zwalnia blokadę dla nowego miasta. Stary import sprząta własne pliki
 * tymczasowe, ale nie może już dotknąć statusu ani bazy nowego miasta.
 */
export function cancelActiveImport(): void {
  importGeneration++;
  const prev = activeImport;
  activeImport = null;
  importInProgress = false;
  lastCheckAttempt = 0;
  if (prev) prev.controller.abort();
}

/**
 * Zmiana miasta zeruje status i przerywa pobieranie poprzedniego miasta:
 * liczby i postęp starego rozkładu nie mogą zostać na ekranie nowego miasta
 * ani blokować pobrania jego bazy.
 */
export function resetDataStatusForCity(): void {
  cancelActiveImport();
  emit({ state: 'empty' });
}

/** Czy lokalna baza wskazanego miasta ma pełny i kompletny zestaw tabel GTFS. */
async function hasCompleteLocalDb(cityId: string): Promise<boolean> {
  try {
    const stats = await getGtfsPresence(cityId);
    if (!(stats.stops > 0 && stats.trips > 0 && stats.hasStopTimes)) return false;
    const marker = await getMeta(GTFS_IMPORT_COMPLETE_META, cityId);
    if (marker === '1') return true;
    const importedAt = await getMeta('gtfs_imported_at', cityId);
    return Boolean(importedAt);
  } catch {
    return false;
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
let deferredWarmupTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleEnsureSearchReady(cityId: string): void {
  if (deferredWarmupTimer) clearTimeout(deferredWarmupTimer);
  deferredWarmupTimer = setTimeout(() => {
    deferredWarmupTimer = null;
    if (getActiveCityIdSync() !== cityId) return;
    void ensureSearchReady(cityId);
  }, 400);
}

export async function refreshDataStatus(expectedCityId?: string): Promise<DataStatus> {
  const refreshCityId = expectedCityId ?? getActiveCityIdSync();
  if (getActiveCityIdSync() !== refreshCityId) return status;
  // Trwający import tego samego miasta sam emituje postęp: nie nadpisuj go
  // fałszywym statusem. Import innego miasta nie może blokować nowego.
  if (activeImport && activeImport.cityId === refreshCityId) return status;
  const isStale = () =>
    getActiveCityIdSync() !== refreshCityId ||
    (activeImport !== null && activeImport.cityId === refreshCityId);
  try {
    const [stats, meta] = await Promise.all([
      getGtfsPresence(refreshCityId),
      getMetaBatch(
        [GTFS_IMPORT_COMPLETE_META, 'gtfs_imported_at', 'gtfs_source'],
        refreshCityId,
      ),
    ]);
    if (isStale()) return status;
    const marker = meta[GTFS_IMPORT_COMPLETE_META];
    const hasData = stats.stops > 0 && stats.trips > 0 && stats.hasStopTimes;
    // Bazy sprzed znacznika (aktualizacja z wersji bez `gtfs_import_complete`):
    // kompletny import zawsze zostawiał `gtfs_imported_at`, a nowy clear kasuje
    // oba klucze razem. Bez migracji każda aktualizacja usuwałaby offline
    // rozkład i wymuszała ponowne pobieranie.
    let complete = marker === '1';
    if (hasData && !complete) {
      const legacyImportedAt = meta.gtfs_imported_at;
      if (legacyImportedAt) {
        await setMeta(GTFS_IMPORT_COMPLETE_META, '1', refreshCityId);
        if (isStale()) return status;
        complete = true;
      }
    }
    if (hasData && complete) {
      await cleanupAbortedImport(refreshCityId);
      if (isStale()) return status;
      const updatedAt = meta.gtfs_imported_at;
      const source: GtfsSource | null = meta.gtfs_source === 'network' ? 'network' : null;
      emitForCity(refreshCityId, {
        state: 'ready',
        stops: stats.stops,
        trips: stats.trips,
        updatedAt,
        source,
      });
      // Rozgrzewka wag i RAPTOR-a po pierwszej klatce ekranu głównego.
      scheduleEnsureSearchReady(refreshCityId);
    } else {
      // Przerwany import zostawia częściowe dane (np. przystanki bez kursów).
      // To nie jest działający rozkład: czyścimy, żeby UI wymusił pobieranie.
      // Gdy import szedł w innym mieście, aktywnej bazy nie ruszamy.
      const otherCityCleaned = await cleanupAbortedImport(refreshCityId);
      if (isStale()) return status;
      if (!otherCityCleaned && (stats.stops > 0 || stats.trips > 0 || stats.hasStopTimes)) {
        // Pin miasta: zmiana w trakcie nie może wyczyścić bazy nowego miasta.
        await clearGtfsTables(refreshCityId).catch(() => {});
      }
      if (isStale()) return status;
      await kvRemove(IMPORT_CITY_KEY);
      emitForCity(refreshCityId, { state: 'empty' });
    }
  } catch (err) {
    if (!isStale()) {
      emitForCity(refreshCityId, { state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
  return status;
}

/**
 * Sprawdza bazę aktywnego miasta i uruchamia pobieranie, gdy jest pusta.
 * Wspólny punkt wejścia po przełączeniu miasta, starcie i powrocie aplikacji.
 */
export async function ensureActiveCityTimetable(options?: {
  checkUpdates?: boolean;
}): Promise<DataStatus> {
  const cityId = getActiveCityIdSync();
  const st = await refreshDataStatus(cityId).catch(() => ({ state: 'empty' }) as const);
  if (getActiveCityIdSync() !== cityId) return getDataStatus();
  if (st.state === 'empty') {
    void importGtfsFromNetwork(cityId).catch((e) => {
      if (!(e instanceof TimetableSyncAbortedError)) {
        console.warn('[DataManager] Auto import GTFS failed:', e);
      }
    });
  } else if (st.state === 'ready' && options?.checkUpdates) {
    void checkTimetableForUpdates().catch((e) => {
      if (!(e instanceof TimetableSyncAbortedError)) {
        console.warn('[DataManager] Timetable refresh failed:', e);
      }
    });
  }
  return getDataStatus();
}

/** Emituje status tylko wtedy, gdy aktywne miasto nadal jest tym, dla którego go policzono. */
function emitForCity(cityId: string, next: DataStatus): void {
  if (getActiveCityIdSync() === cityId) emit(next);
}

const EXPIRY_MARGIN_DAYS = 3;
const CHECK_RETRY_MS = 60 * 60 * 1000;
let lastCheckAttempt = 0;

/**
 * Manifest rozkładu sprawdzamy co najwyżej raz na `refreshHours`, a nieudane
 * próby ponawiamy po godzinie. Gdy rozkład kończy się w ciągu 3 dni, nowa baza
 * pobiera się od razu, bo po końcu kalendarza planer nie ma kursów. Poza tym
 * nowszą wersję też pobieramy w tle: użytkownik nie klika baneru, a limit
 * pełnych pobrań z R2 (12 h) nadal obowiązuje (patrz `getTimetableDownloadGate`).
 */
export async function checkTimetableForUpdates(): Promise<void> {
  const cityId = getActiveCityIdSync();
  if ((activeImport && activeImport.cityId === cityId) || Date.now() - lastCheckAttempt < CHECK_RETRY_MS) return;
  lastCheckAttempt = Date.now();

  const expiring = await isTimetableExpiring();
  if (getActiveCityIdSync() !== cityId) return;

  const lastCheck = await getMeta('gtfs_last_check', cityId).catch(() => null);
  if (getActiveCityIdSync() !== cityId) return;
  const checkedRecently =
    !!lastCheck &&
    Date.now() - new Date(lastCheck).getTime() < TIMETABLE.refreshHours * 3600 * 1000;

  if (expiring && !checkedRecently) {
    await importGtfsFromNetwork(cityId);
    return;
  }
  if (checkedRecently) return;

  // Manifest to ~500 B, więc pytanie o wersję jest tanie. Pobranie bazy nie.
  const manifest = await fetchManifest(cityId).catch((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn('[DataManager] manifest check failed:', detail);
    return null;
  });
  if (!manifest || getActiveCityIdSync() !== cityId) return;

  const local = await getMeta('timetable_version', cityId).catch(() => null);
  if (getActiveCityIdSync() !== cityId) return;
  if (local !== manifest.version) {
    // Pobranie i tak sprawdza manifest jeszcze raz; dwa tanie requesty
    // są prostsze niż przekazywanie manifestu przez pół pliku.
    await importGtfsFromNetwork(cityId);
    return;
  }
  await setMeta('gtfs_last_check', new Date().toISOString(), cityId);
  await setMeta('gtfs_remote_version', manifest.version, cityId);
}

async function isTimetableExpiring(): Promise<boolean> {
  const end = await getTimetableEndDate().catch(() => null);
  if (!end) return false;
  const soon = new Date();
  soon.setDate(soon.getDate() + EXPIRY_MARGIN_DAYS);
  const soonKey = `${soon.getFullYear()}${String(soon.getMonth() + 1).padStart(2, '0')}${String(soon.getDate()).padStart(2, '0')}`;
  return end <= soonKey;
}

/**
 * Po starcie rozgrzewa wagi przystanków i routing. Indeks adresów NIE jest
 * tu budowany: przy 144k+ adresów zjadał kilkanaście sekund JS threadu zaraz
 * po starcie i każdy dotyk czekał w kolejce. searchAddresses() dociąga go
 * leniwie przy pierwszym wpisaniu litery w wyszukiwarkę.
 */
async function ensureSearchReady(cityId: string): Promise<void> {
  try {
    if (getActiveCityIdSync() !== cityId) return;
    if (await needsStopWeights()) {
      await computeStopWeights();
    }
  } catch (err) {
    console.warn('[DataManager] stop weights failed:', err);
  }
  try {
    if (getActiveCityIdSync() !== cityId) return;
    const { warmupRouting } = await import('./routing/engine');
    await warmupRouting();
  } catch (err) {
    console.warn('[DataManager] routing warmup failed:', err);
  }
}

/**
 * Czeka, aż trwający import GTFS się zakończy. Rozwiązuje się natychmiast,
 * gdy nic nie jest importowane.
 *
 * Silnik routingu używa tego zamiast pytać „coś się ładuje?” i oddawać pustą
 * listę: `LocalGtfsStore.load()` w trakcie importu nie ma prawidłowych
 * przystanków, więc planer zwracał zero połączeń i ekran pokazywał „nie
 * znaleziono połączeń” zamiast „rozkład się importuje”.
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
export function importGtfsFromNetwork(expectedCityId?: string): Promise<ImportOutcome> {
  const importCityId = expectedCityId ?? getActiveCityIdSync();
  if (getActiveCityIdSync() !== importCityId) return Promise.resolve('upToDate');

  // Ten sam import już trwa dla tego miasta: dołączamy się do niego zamiast
  // cicho zwracać 'upToDate' i zostawiać puste UI.
  if (activeImport) {
    if (activeImport.cityId === importCityId) return activeImport.promise;
    // Import innego miasta: przerywamy natychmiast, nowe miasto ma priorytet.
    cancelActiveImport();
  }

  const runGen = ++importGeneration;
  const controller = new AbortController();
  const isStale = () =>
    !isCurrentImportRun(runGen, importCityId) || controller.signal.aborted;

  const clearIfCurrent = () => {
    if (activeImport?.generation === runGen) {
      activeImport = null;
      importInProgress = false;
    }
  };

  importInProgress = true;
  // Dla pustej bazy od razu pokazujemy start pobierania (searchbar reaguje natychmiast).
  if (status.state === 'empty' || status.state === 'error') {
    emitForRun(runGen, importCityId, { state: 'downloading', progress: 0 });
  }

  const promise = (async (): Promise<ImportOutcome> => {
    try {
      // Ścieżka 1 (domyślna po skonfigurowaniu serwera): prebuilt SQLite.
      // Brak parsowania na telefonie: download strumieniem + podmiana pliku.
      if (TIMETABLE.baseUrl) {
        const synced = await tryImportPrebuilt(importCityId, runGen, controller.signal).catch(
          (err) => {
            if (err instanceof TimetableSyncAbortedError || isStale()) return null;
            console.warn(
              '[DataManager] prebuilt sync failed:',
              err instanceof Error ? err.message : String(err),
            );
            return null;
          },
        );
        if (isStale()) {
          return 'upToDate';
        }
        if (synced) {
          invalidateLocalTimetableCache();
          clearIfCurrent();
          await refreshDataStatus(importCityId);
          return synced;
        }
        // Nieudany sync, ale baza działa? Nie psujemy jej i nie męczymy
        // użytkownika importem ZIP na siłę. Pusta baza oznacza fallback do ZIP.
        const stats = await getGtfsStats(importCityId).catch(() => null);
        if (isStale()) return 'upToDate';
        if (stats && stats.stops > 0 && stats.trips > 0 && stats.stopTimes > 0) {
          clearIfCurrent();
          await refreshDataStatus(importCityId);
          return 'keptLocal';
        }
      }

      // Ścieżka 2 (fallback): katalog -> zip -> unzip -> SQLite, jak dawniej.
      // Tylko Wrocław ma legacy feed Open Data; inne miasta biorą wyłącznie
      // prebuilt z serwera (katalog Wrocławia do bazy Krakowa to katastrofa).
      // Też objęta limitem, żeby nie palić Open Data / R2 przy spamie przycisku.
      if (isStale()) return 'upToDate';
      if (importCityId !== 'wroclaw' || Platform.OS === 'web') {
        const detail = 'prebuilt sync failed';
        const Terr = dataTr();
        console.warn('[DataManager] import failed:', detail);
        emitForRun(runGen, importCityId, {
          state: 'error',
          message: Terr.prepareFail,
          hint: Terr.retryHint,
          detail,
        });
        throw new Error(detail);
      }
      const gate = await getTimetableDownloadGate(importCityId);
      const localStats = await getGtfsStats(importCityId).catch(() => null);
      if (isStale()) return 'upToDate';
      const hasLocal =
        !!localStats &&
        localStats.stops > 0 &&
        localStats.trips > 0 &&
        localStats.stopTimes > 0;
      if (!gate.allowed && hasLocal) {
        clearIfCurrent();
        await refreshDataStatus(importCityId);
        return 'cooldown';
      }
      const imported = await importGtfsLegacy(importCityId, runGen, controller.signal);
      if (!imported || isStale()) {
        return 'upToDate';
      }
      await markTimetableDownloaded(importCityId);
      invalidateLocalTimetableCache();
      clearIfCurrent();
      await refreshDataStatus(importCityId);
      return 'updated';
    } catch (err) {
      if (err instanceof TimetableSyncAbortedError || isStale()) {
        return 'upToDate';
      }
      const detail = err instanceof Error ? err.message : String(err);
      // Surowy komunikat sieciowy ("Unable to resolve host…") nigdy nie trafia
      // do UI: pokazujemy zdanie w języku użytkownika, a szczegóły w logu.
      const Terr = dataTr();
      const message =
        err instanceof GtfsDownloadError ? err.message : Terr.prepareFail;
      console.warn('[DataManager] import failed:', detail);
      emitForRun(runGen, importCityId, {
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
      const wasActive = activeImport?.generation === runGen;
      if (wasActive) {
        activeImport = null;
        importInProgress = false;
        // Ścieżka błędu emituje status PRZED wyzerowaniem flagi, więc watch z
        // awaitImportSettled nie zdążył zauważyć końca importu. Powiadamiamy tu,
        // po zgaszeniu flagi, żeby oczekujący nie wisieli do timeoutu.
        for (const l of listeners) l(status);
      }
    }
  })();

  activeImport = { cityId: importCityId, generation: runGen, controller, promise };
  return promise;
}

/**
 * Sync z serwera: manifest -> przy nowej wersji download + podmiana bazy.
 * 'upToDate' gdy telefon ma już tę wersję, 'updated' gdy baza właśnie wjechała,
 * 'cooldown' gdy jest nowsza wersja, ale pełne pobranie było za niedawno.
 * Rzuca przy problemach, wtedy caller decyduje o fallbacku do ZIP.
 */
async function tryImportPrebuilt(
  pinnedCityId: string,
  runGen: number,
  signal: AbortSignal,
): Promise<'updated' | 'upToDate' | 'cooldown'> {
  // Miasto pinujemy na całą operację: pobieranie trwa minuty, a użytkownik
  // może w międzyczasie zmienić miasto. Manifest, plik tymczasowy i cel
  // podmiany muszą dotyczyć tego samego miasta.
  const cityId = pinnedCityId;
  const isStale = () => !isCurrentImportRun(runGen, cityId) || signal.aborted;
  const manifest = await fetchManifest(cityId, signal);
  if (isStale()) return 'upToDate';
  // Wersja, kompletność i limit to stan pliku tego miasta, więc czytamy je z jego bazy.
  const [local, hasComplete, gate] = await Promise.all([
    getMeta('timetable_version', cityId),
    hasCompleteLocalDb(cityId),
    getTimetableDownloadGate(cityId),
  ]);
  if (isStale()) return 'upToDate';
  const checkedAt = new Date().toISOString();

  const setMetaIfActive = async (key: string, value: string) => {
    if (isStale()) return;
    await setMeta(key, value, cityId);
  };

  if (hasComplete && local && local === manifest.version) {
    await setMetaIfActive('gtfs_remote_version', manifest.version);
    await setMetaIfActive('gtfs_last_check', checkedAt);
    return 'upToDate';
  }

  // Nowa wersja na serwerze, ale lokalna kompletna baza jest: szanujemy limit R2.
  // Nie zapisujemy `gtfs_last_check`: kolejny check spróbuje ponownie, gdy limit puści.
  if (hasComplete && !gate.allowed && local) {
    await setMetaIfActive('gtfs_remote_version', manifest.version);
    return 'cooldown';
  }

  emitForRun(runGen, cityId, { state: 'downloading', progress: 0 });
  await downloadPrebuiltDb(
    manifest,
    (written, total) => {
      emitForRun(runGen, cityId, {
        state: 'downloading',
        progress: total > 0 ? written / total : 0,
      });
    },
    cityId,
    signal,
  );
  if (isStale()) return 'upToDate';
  const T = dataTr();
  emitForRun(runGen, cityId, { state: 'importing', step: T.stepVerify, progress: 0.97 });
  await setMetaIfActive('gtfs_last_check', new Date().toISOString());
  await setMetaIfActive('gtfs_remote_version', manifest.version);
  if (!isStale()) await markTimetableDownloaded(cityId);
  await resetRoutingStore();
  return 'updated';
}

/**
 * Stara ścieżka ZIP. Najpierw waliduje wymagane pliki, dopiero potem czyści
 * bazę. Wszystkie zapisy idą do bazy miasta z początku importu, a każdy krok
 * sprawdza `isStale`: zmiana miasta w trakcie nie może wyczyścić ani
 * zabrudzić bazy nowego miasta. Zwraca false, gdy import przerwano.
 */
async function importGtfsLegacy(
  importCityId: string,
  runGen: number,
  signal: AbortSignal,
): Promise<boolean> {
  const isStale = () => !isCurrentImportRun(runGen, importCityId) || signal.aborted;
  emitForRun(runGen, importCityId, { state: 'downloading', progress: 0 });
  const { uri: zipUri } = await downloadArchiveWithFallback((p) => {
    const progress = p.totalBytes > 0 ? p.bytesWritten / p.totalBytes : 0;
    emitForRun(runGen, importCityId, { state: 'downloading', progress });
  });
  if (isStale()) return false;

  const T = dataTr();
  emitForRun(runGen, importCityId, { state: 'importing', step: T.stepUnpack, progress: 0 });
  await unzipGtfs(zipUri);
  if (isStale()) return false;

  // Walidacja przed clearGtfsTables: uszkodzony albo niekompletny ZIP nie
  // może skasować działającego rozkładu.
  const stopsTxt = await readGtfsText('stops.txt');
  const tripsTxt = await readGtfsText('trips.txt');
  const stopTimesTxt = await readGtfsText('stop_times.txt');
  if (isStale()) return false;
  const validated = await parseRequiredGtfsFiles({ stops: stopsTxt, trips: tripsTxt, stopTimes: stopTimesTxt });
  if (isStale()) return false;
  if (validated.stops.length === 0) throw new Error(T.errStops);
  if (validated.trips.length === 0) throw new Error(T.errTrips);
  if (validated.stopTimesRows === 0) throw new Error(T.errTimes);

  // Od tego miejsca stara baza jest nieaktualna, więc zapamiętujemy miasto
  // do sprzątania, gdy import padnie przed znacznikiem kompletności.
  await kvSet(IMPORT_CITY_KEY, importCityId);
  if (isStale()) {
    await kvRemove(IMPORT_CITY_KEY);
    return false;
  }
  await clearGtfsTables(importCityId);
  if (isStale()) return false;
  await prepareForBulkImport(importCityId);
  if (isStale()) return false;

  emitForRun(runGen, importCityId, { state: 'importing', step: T.stepStops, progress: 0.05 });
  await importStops(validated.stops, importCityId);
  if (isStale()) return false;

  emitForRun(runGen, importCityId, { state: 'importing', step: T.stepLines, progress: 0.15 });
  const routesTxt = await readGtfsText('routes.txt');
  if (routesTxt) await importRoutes(parseRoutesContent(routesTxt), importCityId);
  if (isStale()) return false;

  emitForRun(runGen, importCityId, { state: 'importing', step: T.stepCalendar, progress: 0.25 });
  const calTxt = await readGtfsText('calendar.txt');
  if (calTxt) await importCalendar(parseCalendarContent(calTxt), importCityId);
  const calDatesTxt = await readGtfsText('calendar_dates.txt');
  await importCalendarDates(calDatesTxt ? parseCalendarDatesContent(calDatesTxt) : [], importCityId);
  if (isStale()) return false;

  emitForRun(runGen, importCityId, { state: 'importing', step: T.stepTrips, progress: 0.35 });
  // Tripsy całego miasta na raz to ~2.2 MB tekstu: wchodzi bez chunkowania.
  await importTrips(validated.trips, importCityId);
  if (isStale()) return false;

  emitForRun(runGen, importCityId, { state: 'importing', step: T.stepTimes, progress: 0.5 });
  let done = 0;
  let stopped = false;
  await parseStopTimesBatched(
    stopTimesTxt ?? '',
    async (batch) => {
      if (isStale()) {
        stopped = true;
        return;
      }
      await importStopTimesBatch(batch, importCityId);
      done += batch.length;
      // Progres orientacyjny: ~1.5M wierszy w stop_times dużego miasta.
      emitForRun(runGen, importCityId, {
        state: 'importing',
        step: T.stepTimesK(Math.round(done / 1000)),
        progress: Math.min(0.95, 0.5 + done / 1500000 / 2),
      });
    },
    { batchSize: 5000 },
  );
  if (stopped || isStale()) return false;

  emitForRun(runGen, importCityId, { state: 'importing', step: T.stepIndex, progress: 0.97 });
  await finishBulkImport(importCityId);
  if (isStale()) return false;

  emitForRun(runGen, importCityId, { state: 'importing', step: T.stepWeights, progress: 0.98 });
  await computeStopWeights(importCityId);
  if (isStale()) return false;

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
