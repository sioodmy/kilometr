import { getCity } from '../cities';
import { normalizePolish } from '../gtfs/geo';
import type { Suggestion } from '../types/models';
import { getActiveCityIdSync } from './cityStore';
import { hasOfflineAddressIndex, searchAddresses } from './addressIndex';
import { searchStops } from './gtfsDatabase';
import { searchNominatimDirect } from './nominatimDirect';
import { addRecentSuggestion, loadRecent, loadSuggestions, saveSuggestions } from './offlineCache';
import { ensurePoiIndex, searchPois } from './poiIndex';
import { searchPolinkaStops } from './polinkaSearch';
import { searchPwrBuildings } from './pwrBuildings';
import { matchSuggestions, rankWithFrecency } from './searchFrecency';
import { dedupeAndSort, withDistances } from './searchRank';
import type { ISearchService } from './types';

const requests = new Map<string, AbortController>();
const cache = new Map<string, { data: Suggestion[]; expires: number }>();
const CACHE_TTL_MS = 120_000;
const CACHE_MAX = 60;
const NETWORK_DELAY_MS = 280;
// Literówki dopiero po pauzie w pisaniu; dokładne adresy odpowiadają od razu.
const FUZZY_DELAY_MS = 250;

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
      let pois: Suggestion[] = [];
      let addresses: Suggestion[] = [];
      let fuzzyPromise: Promise<void> | null = null;
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
        local = [...stops, ...pois, ...extras, ...addresses];
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
          if (!ctrl.signal.aborted) publish();
        });
      };
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
          schedulePublish();
        }),
        poisPromise.then((hits) => {
          pois = hits;
          schedulePublish();
        }),
        addressesPromise.then((hits) => {
          addresses = hits;
          schedulePublish();
          if (!hits.length && q.length >= 4 && hasOfflineAddressIndex()) {
            fuzzyPromise = searchFuzzyAddresses();
          }
        }),
      ]);
      if (fuzzyPromise) await fuzzyPromise;
      let remote: Suggestion[] = [];
      const isAddressWithNumber = /\d/.test(q);
      const allowRemote = !hasOfflineAddressIndex() || !isAddressWithNumber;
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
