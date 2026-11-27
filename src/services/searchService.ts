import { getCity } from '../cities';
import { normalizePolish } from '../gtfs/geo';
import type { Suggestion } from '../types/models';
import { getActiveCityIdSync } from './cityStore';
import { hasOfflineAddressIndex, searchAddresses } from './addressIndex';
import { hasNationalDb, searchNationalStations, searchStops } from './gtfsDatabase';
import { searchNominatimDirect } from './nominatimDirect';
import { addRecentSuggestion, loadRecent, loadSuggestions, saveSuggestions } from './offlineCache';
import { hasPoiDbSync } from './poiDatabase';
import { ensurePoiIndex, searchPois } from './poiIndex';
import { subscribePoiDbChanged } from './poiSync';
import { searchPolinkaStops } from './polinkaSearch';
import { searchPwrBuildings } from './pwrBuildings';
import { matchSuggestions, rankWithFrecency } from './searchFrecency';
import { dedupeAndSort, withDistances } from './searchRank';
import { tr } from '../i18n/locale';
import type { ISearchService } from './types';

const requests = new Map<string, AbortController>();
const cache = new Map<string, { data: Suggestion[]; expires: number }>();
subscribePoiDbChanged(() => {
  cache.clear();
});
const CACHE_TTL_MS = 120_000;
const CACHE_MAX = 60;
const NETWORK_DELAY_MS = 280;
// Literówki dopiero po pauzie w pisaniu; dokładne adresy odpowiadają od razu.
const FUZZY_DELAY_MS = 250;
// Zimny indeks adresowy (np. GZM 618k wierszy) nie może blokować przystanków ani Nominatim.
const ADDRESS_COLD_BUDGET_MS = 180;

class SearchAbortedError extends Error {
  constructor() {
    super('Search aborted');
    this.name = 'SearchAbortedError';
  }
}

function cancel(scope = 'default'): void {
  requests.get(scope)?.abort();
  requests.delete(scope);
}

function waitForIdle(signal: AbortSignal, delay: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new SearchAbortedError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delay);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

function raceWithBudget(task: Promise<void>, signal: AbortSignal, budgetMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (err !== undefined) reject(err);
      else resolve();
    };
    const onAbort = () => finish(new SearchAbortedError());
    const timer = setTimeout(() => finish(), budgetMs);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    task.then(
      () => finish(),
      (err) => finish(err),
    );
  });
}

export const SearchService: ISearchService = {
  cancel,
  async search(query, coords, scope = 'default', onPartial) {
    cancel(scope);
    const persistedQuery = query.trim();
    const q = normalizePolish(persistedQuery);
    if (!q) return [];
    const ctrl = new AbortController();
    requests.set(scope, ctrl);
    const cityId = getActiveCityIdSync();
    const assertCurrent = () => {
      if (ctrl.signal.aborted || cityId !== getActiveCityIdSync()) throw new SearchAbortedError();
    };
    const key = `${cityId}:${q}:${coords ? `${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}` : ''}`;
    const rank = (items: Suggestion[], history: Suggestion[]) =>
      rankWithFrecency(withDistances(items, coords?.lat, coords?.lon), history, q).slice(0, 15);
    let completed = false;

    try {
      const cached = cache.get(key);
      if (cached && cached.expires > Date.now()) {
        const history = await loadRecent(cityId);
        assertCurrent();
        cache.delete(key);
        cache.set(key, cached);
        const matches = matchSuggestions(q, history);
        const personal = history.filter((_, index) => matches[index] >= 80);
        return rank(dedupeAndSort(cached.data, personal, !!coords, q), history);
      }
      cache.delete(key);
      ensurePoiIndex();
      const stopsPromise = searchStops(q, 24).catch(() => []);
      const poisPromise = searchPois(q, coords?.lat, coords?.lon, 16).catch(() => []);
      const addressesPromise = searchAddresses(q, coords?.lat, coords?.lon, 16).catch(() => []);
      // Stacje kolejowe ogólnopolskie (dataset polska): tylko przy pobranej
      // bazie; pomijamy stacje, które ma też baza miasta (np. Wrocław Główny
      // we Wrocławiu), żeby dojazd liczył miejski silnik z KD.
      const stationsPromise = hasNationalDb()
        .then((present) => (present ? searchNationalStations(persistedQuery, 8) : []))
        .catch(() => [] as Awaited<ReturnType<typeof searchNationalStations>>);
      const [history, offline] = await Promise.all([
        loadRecent(cityId),
        loadSuggestions(persistedQuery, cityId),
      ]);
      assertCurrent();
      const historyMatches = matchSuggestions(q, history);
      const personal = history.filter((_, index) => historyMatches[index] >= 80);
      if (personal.length || offline.length) {
        onPartial?.(rank(dedupeAndSort(personal, offline, !!coords, q), history));
      }
      const city = getCity(cityId);
      const extras = [
        ...(city.features.cable ? searchPolinkaStops(q, coords?.lat, coords?.lon) : []),
        ...(city.features.campusPois ? searchPwrBuildings(q, coords?.lat, coords?.lon, 8) : []),
        ...personal,
      ];
      let stops: Suggestion[] = [];
      let stations: Suggestion[] = [];
      let pois: Suggestion[] = [];
      let addresses: Suggestion[] = [];
      let fuzzyPromise: Promise<void> | null = null;
      const buildLocal = () => {
        // Stacja o nazwie przystanku miasta (np. Wrocław Główny w bazie
        // Wrocławia) wypada: dojazd liczy miejski silnik z KD.
        const cityStopNames = new Set(stops.map((s) => normalizePolish(s.title)));
        const visibleStations = stations.filter((s) => !cityStopNames.has(normalizePolish(s.title)));
        return [...stops, ...visibleStations, ...pois, ...extras, ...addresses];
      };
      let local = extras;
      const merge = (remote: Suggestion[]) =>
        dedupeAndSort(
          withDistances(local.length ? local : offline, coords?.lat, coords?.lon),
          remote,
          !!coords,
          q,
        );
      const publish = () => {
        assertCurrent();
        local = buildLocal();
        onPartial?.(rank(merge([]), history));
      };
      const searchFuzzyAddresses = async () => {
        await waitForIdle(ctrl.signal, FUZZY_DELAY_MS);
        addresses = await searchAddresses(persistedQuery, coords?.lat, coords?.lon, 16, true).catch(
          () => [],
        );
        publish();
      };
      let publishScheduled = false;
      const schedulePublish = () => {
        if (publishScheduled) return;
        publishScheduled = true;
        queueMicrotask(() => {
          publishScheduled = false;
          if (!completed && !ctrl.signal.aborted) publish();
        });
      };
      const addressIndexWarm = hasOfflineAddressIndex();
      let localBatchDone = false;
      let earlyAddressPublish = false;
      const addressesTask = addressesPromise.then((hits) => {
        if (completed || ctrl.signal.aborted || cityId !== getActiveCityIdSync()) return;
        addresses = hits;
        if (localBatchDone) {
          schedulePublish();
        } else if (hits.length) {
          // Adresy są niezależne od POI: pokazujemy je od razu, zamiast
          // czekać na wolniejsze źródła.
          earlyAddressPublish = true;
          schedulePublish();
        }
        if (!hits.length && q.length >= 4 && hasOfflineAddressIndex()) {
          fuzzyPromise = searchFuzzyAddresses();
        }
      });
      await Promise.all([
        stopsPromise.then((hits) => {
          stops = hits.map((hit) => ({
            id: `stop-${hit.stop_id}`,
            title: hit.name.toUpperCase(),
            address: '',
            kind: 'stop',
            lat: hit.lat,
            lon: hit.lon,
            weight: hit.weight,
          }));
        }),
        stationsPromise.then((hits) => {
          stations = hits.map((hit) => ({
            id: `stop-${hit.stop_id}`,
            title: hit.name,
            address: tr().intercity.stationAddress,
            kind: 'stop' as const,
            category: 'train',
            lat: hit.lat,
            lon: hit.lon,
            weight: hit.weight,
          }));
        }),
        poisPromise.then((hits) => {
          pois = hits;
        }),
        addressIndexWarm
          ? addressesTask
          : raceWithBudget(addressesTask, ctrl.signal, ADDRESS_COLD_BUDGET_MS),
      ]);
      localBatchDone = true;
      assertCurrent();
      local = buildLocal();
      const isAddressWithNumber = /\d/.test(q);
      const richPoiReady = hasPoiDbSync(cityId);
      const allowRemote =
        (!hasOfflineAddressIndex() || !isAddressWithNumber) &&
        !(richPoiReady && !isAddressWithNumber && pois.length >= 3);
      const willFetchRemote =
        q.length >= 2 &&
        !addresses.length &&
        allowRemote &&
        (isAddressWithNumber || local.length < 5);
      // Publikujemy lokalny pakiet raz, gdy czekamy jeszcze na fuzzy albo Nominatim.
      // Jeśli adresy wyszły wcześniej, doliczamy do nich resztę źródeł.
      if (earlyAddressPublish || ((fuzzyPromise || willFetchRemote) && local.length)) {
        onPartial?.(rank(merge([]), history));
      }
      if (fuzzyPromise) await fuzzyPromise;
      local = buildLocal();
      let remote: Suggestion[] = [];
      if (
        q.length >= 2 &&
        !addresses.length &&
        allowRemote &&
        (isAddressWithNumber || local.length < 5)
      ) {
        await waitForIdle(ctrl.signal, NETWORK_DELAY_MS);
        assertCurrent();
        remote = await searchNominatimDirect(persistedQuery, coords?.lat, coords?.lon, ctrl.signal);
        assertCurrent();
      }
      local = buildLocal();
      let candidates = merge(remote);
      if (!candidates.length) {
        candidates = await loadSuggestions(persistedQuery, cityId);
        assertCurrent();
      }
      if (candidates.length) {
        cache.set(key, {
          data: candidates.map((item) => ({
            ...item,
            distanceM: undefined,
            searchUsage: undefined,
          })),
          expires: Date.now() + CACHE_TTL_MS,
        });
        if (cache.size > CACHE_MAX) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        if (remote.length) {
          void saveSuggestions(
            persistedQuery,
            remote.map((item) => ({ ...item, distanceM: undefined, searchUsage: undefined })),
            cityId,
          );
        }
      }
      return rank(candidates, history);
    } finally {
      completed = true;
      if (requests.get(scope) === ctrl) requests.delete(scope);
    }
  },
  async recent() {
    return (await loadRecent()).slice(0, 10);
  },
  async recordRecent(item) {
    await addRecentSuggestion(item);
  },
};
