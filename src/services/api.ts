import * as Location from 'expo-location';
import { kvGetStrict, kvSet } from './storage';
import { defaultLocationForCity } from '../config';
import { getCity, cityKey, suggestCityForCoords } from '../cities';
import { getActiveCityIdSync } from './cityStore';
import { Connection, LegStop, RouteQuery, SavedPlace, SavedRoute, SmartDestination, Suggestion } from '../types/models';
import { IFavoritesService, ILocationService, IRoutingService, ISearchService, LocationResult } from './types';
import { addRecentSuggestion, loadLastLocation, loadRecent, loadSuggestions, saveConnections, saveLastLocation, saveSuggestions, findCachedConnection } from './offlineCache';
import { hasSeenOnboarding } from './onboarding';
import { planConnections, buildTripStops } from './routing/engine';
import { getCurrentLocationSnapshot, seedCurrentLocation } from './currentLocation';
import { normalizeConnectionId } from './routing/connectionIdentity';

let cachedLocation: LocationResult | null = null;
let cachedAt = 0;
let cacheWriteSeq = 0;
let refineInFlight: Promise<LocationResult | null> | null = null;
let lastRefineAt = 0;
const locationListeners = new Set<(loc: LocationResult) => void>();

/** Fix starszy niż tyle ms nie wystarcza jako „aktualna" pozycja przy wejściu. */
const FRESH_FIX_MS = 45_000;
/** Minimalny odstęp między odczytami High, chroni GPS i sieć przed młynkiem. */
const REFINE_MIN_INTERVAL_MS = 15_000;
/** Maksymalny czas oczekiwania na pojedynczy odczyt GPS w budynku. */
const HIGH_FIX_TIMEOUT_MS = 8_000;
/** Ruch o tyle metrów (albo zmiana przystanku) znaczy fix istotnie lepszy. */
export const LOCATION_REFINE_DELTA_M = 25;

function getPositionWithTimeout(
  options: Location.LocationOptions,
  timeoutMs: number,
): Promise<Location.LocationObject> {
  return new Promise<Location.LocationObject>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Location request timed out'));
    }, timeoutMs);
    Location.getCurrentPositionAsync(options).then(
      (pos) => {
        clearTimeout(timer);
        resolve(pos);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLa = ((bLat - aLat) * Math.PI) / 180;
  const dLo = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLa / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Identyfikator nowego zapisu. Nie `Math.random().toString(36).substring(7)`-
 * `substring(7)` potrafi zwrócić `''`, gdy zapis jest krótszy niż 7 znaków.
 * Wycinamy z końca, więc długość wyniku jest zawsze stała.
 */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Współrzędne na czytelny tytuł i przystanek w promieniu 500 m. Cache zapisuje
 * tylko wtedy, gdy ten odczyt wciąż jest najnowszy, więc wolniejszy reverse-geocode
 * słabego fixu nie może nadpisać późniejszego, precyzyjnego wyniku.
 */
function activeCityDef() {
  try {
    return getCity(getActiveCityIdSync());
  } catch {
    return getCity('wroclaw');
  }
}

async function resolveLocation(lat: number, lon: number, accuracyM?: number | null): Promise<LocationResult> {
  const seq = ++cacheWriteSeq;
  const fallback = defaultLocationForCity(activeCityDef().id);
  let result: LocationResult = { title: fallback.title, address: fallback.address, lat, lon, accuracyM };
  let city: string | null = null;
  let foundStop = false;
  let hadReverse = false;

  if (Number.isFinite(lat) && Number.isFinite(lon) && (accuracyM == null || accuracyM <= 65)) {
    seedCurrentLocation({
      lat,
      lon,
      accuracy: accuracyM ?? null,
      speed: null,
      heading: null,
      timestamp: Date.now(),
    });
  }

  // Miejscowość z reverse-geocode trzymamy od razu, bo karta
  // „Nieobsługiwane miasto" pokazuje ją bez drugiego zapytania.
  try {
    const { reverseNominatimDirect } = await import('./nominatimDirect');
    const rev = await reverseNominatimDirect(lat, lon);
    city = rev?.city ?? null;
    if (rev) {
      result = { title: rev.title, address: rev.address, lat, lon, city, accuracyM };
      hadReverse = true;
    }
  } catch {}

  // Blisko słupka (< 500 m) tytuł zamieniamy na przystanek.
  try {
    const { findNearestStops } = await import('./gtfsDatabase');
    const nearest = await findNearestStops(lat, lon, 500, 1);
    if (nearest.length > 0) {
      const n = nearest[0];
      result = { title: n.name, address: 'Przystanek', lat, lon, stopId: n.stop_id, city, accuracyM };
      foundStop = true;
    }
  } catch {}

  if (!foundStop && !hadReverse) {
    const last = await loadLastLocation();
    if (last && distanceM(lat, lon, last.lat, last.lon) < 1000) {
      result = { title: last.title, address: last.address, lat, lon, stopId: last.stopId, city: last.city ?? city, accuracyM };
    }
  }

  const existingIsMuchBetter =
    cachedLocation != null &&
    Date.now() - cachedAt < FRESH_FIX_MS &&
    (cachedLocation.accuracyM ?? 999) <= 25 &&
    (accuracyM ?? 999) > 60;

  if (seq === cacheWriteSeq && !existingIsMuchBetter) {
    cachedLocation = result;
    cachedAt = Date.now();
    if (foundStop) void saveLastLocation(result);
  }
  return existingIsMuchBetter && cachedLocation ? cachedLocation : result;
}

/**
 * Dokładniejszy fix (GPS, nie sieć) w tle. Jeden odczyt naraz: równoległe
 * wołania dostają ten sam promise. Słuchaczy powiadamiamy tylko, gdy pozycja
 * realnie się przesunęła albo zmienił się najbliższy przystanek; drobny szum
 * nie może restartować wyszukiwania tras.
 */
async function refineLocation(force?: boolean): Promise<LocationResult | null> {
  if (refineInFlight) return refineInFlight;
  const cachedIsCoarse = (cachedLocation?.accuracyM ?? 999) > 35;
  // Kolejne przebudzenia stanu nie mogą mielić odczytami High co chwilę.
  if (!force && !cachedIsCoarse && cachedLocation && Date.now() - lastRefineAt < REFINE_MIN_INTERVAL_MS) {
    return cachedLocation;
  }
  refineInFlight = (async () => {
    lastRefineAt = Date.now();
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const pos = await getPositionWithTimeout(
        { accuracy: Location.Accuracy.High },
        HIGH_FIX_TIMEOUT_MS,
      );
      const prev = cachedLocation;
      const loc = await resolveLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      const movedM = prev ? distanceM(prev.lat, prev.lon, loc.lat, loc.lon) : Infinity;
      if (movedM >= LOCATION_REFINE_DELTA_M || prev?.stopId !== loc.stopId) {
        for (const listener of locationListeners) {
          try {
            listener(loc);
          } catch {}
        }
      }
      return loc;
    } catch (err) {
      console.warn('[LocationService] Refine failed:', err);
      return null;
    } finally {
      refineInFlight = null;
    }
  })();
  return refineInFlight;
}

function subscribe(listener: (loc: LocationResult) => void): () => void {
  locationListeners.add(listener);
  return () => {
    locationListeners.delete(listener);
  };
}

export const LocationService: ILocationService = {
  async getCurrentLocation(options) {
    try {
      // Przed ukończeniem onboardingu nie wolno pytać o lokalizację:
      // ekran główny montuje się pod spodem, zanim _layout przekieruje
      // na onboarding, i systemowy dialog wyskakiwał przed setup screenem.
      try {
        if (!(await hasSeenOnboarding())) return { ...defaultLocationForCity(activeCityDef().id) };
      } catch {}
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return { ...defaultLocationForCity(activeCityDef().id) };

      const live = getCurrentLocationSnapshot().location;
      if (live && Date.now() - live.timestamp < 15_000 && (live.accuracy ?? 99) <= 30) {
        const loc = await resolveLocation(live.lat, live.lon, live.accuracy);
        if (options?.force) void refineLocation(true);
        return loc;
      }

      if (!options?.force) {
        // Świeży fix oddajemy od razu; precyzja dociąga się w tle i sama
        // powiadomi subskrybentów, więc UI nigdy nie czeka na GPS.
        if (cachedLocation && Date.now() - cachedAt < FRESH_FIX_MS) {
          void refineLocation();
          return cachedLocation;
        }
        const last = await Location.getLastKnownPositionAsync({ maxAge: 90_000, requiredAccuracy: 180 });
        if (last) {
          const loc = await resolveLocation(last.coords.latitude, last.coords.longitude, last.coords.accuracy);
          void refineLocation();
          return loc;
        }
      } else {
        try {
          const highPos = await getPositionWithTimeout(
            { accuracy: Location.Accuracy.High },
            3500,
          );
          return await resolveLocation(
            highPos.coords.latitude,
            highPos.coords.longitude,
            highPos.coords.accuracy,
          );
        } catch {}
      }

      const pos = await getPositionWithTimeout(
        { accuracy: Location.Accuracy.Balanced },
        5000,
      );
      const loc = await resolveLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      void refineLocation(Boolean(options?.force));
      return loc;
    } catch (err) {
      console.warn('[LocationService] Failed to acquire device location:', err);
    }

    return { ...defaultLocationForCity(activeCityDef().id) };
  },
  refineLocation,
  subscribe,
};

/**
 * Abort per kontekst, nie globalny. Wyszukiwarka miejsca docelowego i
 * wyszukiwarka adresu w „Nowym zapisanym miejscu” to dwa niezależne pola
 * tekstowe, które potrafią być otwarte w tej samej chwili (arkusz wyboru
 * miejsca startowego otwiera wyszukiwarkę po zapisaniu). Przy jednym
 * wspólnym `AbortController` nowsze zapytanie z drugiego pola zabijało
 * pierwsze, a przegrany dostawał `SearchAbortedError` zamieniany przez
 * wywołującego w „brak wyników” - czyli wynik znikiał bez powodu.
 */
const searchAborts = new Map<string, AbortController>();
const DEFAULT_SEARCH_SCOPE = 'default';

/**
 * Wyszukiwanie przerwane nowszym zapytaniem. Odróżniamy to od „brak wyników”,
 * bo inaczej anulowany request wpisywałby pustą listę po wynikach nowszego.
 */
class SearchAbortedError extends Error {
  constructor() {
    super('Wyszukiwanie przerwane przez nowe zapytanie');
    this.name = 'SearchAbortedError';
  }
}

// Cache scalonych podpowiedzi (query + zaokrąglona pozycja) - powtórki migają.
const mergedCache = new Map<string, { data: Suggestion[]; expires: number }>();
const MERGED_TTL_MS = 120 * 1000;
const MERGED_MAX = 60;
const NETWORK_DELAY_MS = 280;

function mergedGet(key: string): Suggestion[] | null {
  const e = mergedCache.get(key);
  if (!e) return null;
  if (e.expires < Date.now()) {
    mergedCache.delete(key);
    return null;
  }
  return e.data;
}

function mergedSet(key: string, data: Suggestion[]): void {
  if (mergedCache.size >= MERGED_MAX) {
    const oldest = mergedCache.keys().next().value;
    if (oldest) mergedCache.delete(oldest);
  }
  mergedCache.set(key, { data, expires: Date.now() + MERGED_TTL_MS });
}

export const SearchService: ISearchService = {
  async search(
    query: string,
    coords?: { lat: number; lon: number },
    scope: string = DEFAULT_SEARCH_SCOPE,
    onPartial?: (results: Suggestion[]) => void,
  ): Promise<Suggestion[]> {
    const q = query.trim();
    if (!q) return [];

    searchAborts.get(scope)?.abort();
    const ctrl = new AbortController();
    searchAborts.set(scope, ctrl);
    // Zapytanie uznane za nieaktualne → nie wrzucamy go do cache podpowiedzi.
    const isCurrent = () => searchAborts.get(scope) === ctrl;

    const hasPos = coords !== undefined;
    // Miasto w kluczu: po przełączeniu Wrocław → Kraków ten sam tekst przez
    // 2 minuty wracał z cache starego miasta.
    const searchCityId = getActiveCityIdSync();
    const cacheKey = `v2:${searchCityId}:${q.toLowerCase()}|${coords ? `${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}` : '-'}`;
    const cachedMerged = mergedGet(cacheKey);
    if (cachedMerged) return cachedMerged;

    try {
      const { searchStops } = await import('./gtfsDatabase');
      const { searchPois, ensurePoiIndex } = await import('./poiIndex');
      const { searchPwrBuildings } = await import('./pwrBuildings');
      const { searchPolinkaStops } = await import('./polinkaSearch');
      const { searchNominatimDirect } = await import('./nominatimDirect');
      const { dedupeAndSort } = await import('./searchRank');
      const { distanceMeters } = await import('../gtfs/geo');
      const { normalizePolish } = await import('../gtfs/geo');

      // Lokalny indeks POI odświeża się w tle, nigdy nie blokuje.
      ensurePoiIndex();

      // 1. Lokalne źródła (szybkie, offline): przystanki GTFS + indeks POI
      // + specyfiki miasta (Polinka i budynki PWr tylko we Wrocławiu).
      const [stopHits, poiHits] = await Promise.all([
        searchStops(q, 12).catch(() => []),
        searchPois(q, coords?.lat, coords?.lon, 8).catch(() => []),
      ]);
      if (!isCurrent()) throw new SearchAbortedError();
      const city = activeCityDef();
      const stopSuggestions: Suggestion[] = stopHits.map((h) => ({
        id: `stop-${h.stop_id}`,
        title: h.name.toUpperCase(),
        address: 'Przystanek',
        kind: 'stop' as const,
        lat: h.lat,
        lon: h.lon,
        distanceM:
          coords !== undefined
            ? Math.round(distanceMeters(coords.lat, coords.lon, h.lat, h.lon))
            : undefined,
        weight: h.weight,
      }));
      const localSuggestions = [
        ...stopSuggestions,
        ...(city.features.cable ? searchPolinkaStops(q, coords?.lat, coords?.lon) : []),
        ...poiHits,
        ...(city.features.campusPois ? searchPwrBuildings(q, coords?.lat, coords?.lon, 8) : []),
      ];

      // 2. Sieć (Nominatim) tylko gdy lokalnie za mało albo to adres z numerem.
      // Adresy z numerami są domeną Nominatim - lokalny indeks ich nie ma.
      const normQ = normalizePolish(q);
      const looksLikeAddress = /\d/.test(normQ);
      const needNetwork = q.length >= 2 && (looksLikeAddress || localSuggestions.length < 5);
      let remoteHits: Suggestion[] = [];
      if (needNetwork) {
        // Lokalne trafienia od razu na ekran, sieć dopiero gdy user przestanie pisać
        // (Nominatim ma limit 1 req/s, a każdy znak i tak by anulował żądanie).
        if (onPartial && localSuggestions.length > 0) {
          onPartial(dedupeAndSort(localSuggestions, [], hasPos, normQ).slice(0, 15));
        }
        await new Promise((r) => setTimeout(r, NETWORK_DELAY_MS));
        if (!isCurrent()) throw new SearchAbortedError();
        remoteHits = await searchNominatimDirect(q, coords?.lat, coords?.lon, ctrl.signal).catch(() => []);
        if (!isCurrent()) throw new SearchAbortedError();
      }

      // 3. Merge: przystanki absolutnie pierwsze (w kolejności trafienie+waga),
      // reszta wg nazwy z karą za dystans - bliższe wyżej.
      const merged = dedupeAndSort(localSuggestions, remoteHits, hasPos, normQ).slice(0, 15);
      if (merged.length > 0) {
        mergedSet(cacheKey, merged);
        if (isCurrent()) void saveSuggestions(q, merged, searchCityId);
        return merged;
      }
    } catch {
      // offline / błąd - fallback niżej
    }

    if (!isCurrent()) throw new SearchAbortedError();
    return loadSuggestions(q);
  },

  async recent(): Promise<Suggestion[]> {
    return loadRecent();
  },

  async recordRecent(item: Suggestion): Promise<void> {
    await addRecentSuggestion(item);
  },
};

// In-memory recent connections for getConnectionById
const recentPlannedConnections = new Map<string, Connection>();

export function getPlannedConnection(id: string): Connection | undefined {
  return recentPlannedConnections.get(normalizeConnectionId(id));
}

export function rememberPlannedConnection(connection: Connection): void {
  recentPlannedConnections.set(connection.id, connection);
}

// Serializuje read-modify-write zapisanych tras: dwa równoległe zapisy nie mogą
// zgubić jednego wpisu (każdy czyta-i-zapisuje całą listę).
let routesLock: Promise<unknown> = Promise.resolve();
function withRoutesLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = routesLock.then(fn, fn);
  routesLock = run.catch(() => {});
  return run;
}

export const RoutingService: IRoutingService = {
  async getConnections(query: RouteQuery, onProgress?: (partial: Connection[]) => void): Promise<Connection[]> {
    try {
      const connections = await planConnections({
        fromTitle: query.fromTitle,
        fromLat: query.fromLat,
        fromLon: query.fromLon,
        toTitle: query.toTitle,
        toLat: query.toLat,
        toLon: query.toLon,
        toId: query.toId,
        departureTimeSec: query.departureTimeSec,
        arriveBySec: query.arriveBySec,
        maxTransfers: query.maxTransfers,
        modes: query.modes,
        minTransferSec: query.minTransferSec,
        trainsEnabled: query.trainsEnabled,
        cableEnabled: query.cableEnabled,
        allowedTransferModes: query.allowedTransferModes,
        trainMinTransferSec: query.trainMinTransferSec,
        maxWalkM: query.maxWalkM,
        walkSpeedMps: query.walkSpeedMps,
        routeStyle: query.routeStyle,
        anchorStopId: query.anchorStopId,
        anchorStopLat: query.anchorStopLat,
        anchorStopLon: query.anchorStopLon,
        // Progres dokładamy też do podręcznego cache, żeby ekran detalu
        // działał nawet jeśli użytkownik tapnie wiersz w trakcie liczenia.
        onProgress: onProgress
          ? (partial) => {
              for (const c of partial) {
                recentPlannedConnections.set(c.id, c);
              }
              onProgress(partial);
            }
          : undefined,
      });

      for (const c of connections) {
        recentPlannedConnections.set(c.id, c);
      }

      if (!query.departureTimeSec && !query.arriveBySec) {
        void saveConnections(query, connections);
        // Zawczasu pobierz i przypnij przebieg ulic kilku najlepszych
        // połączeń, żeby ostatnie trasy działały offline.
        void import('./geometryWarmup').then((m) => m.warmConnections(connections));
      }
      return connections;
    } catch (err) {
      console.warn('[RoutingService] Local routing failed:', err);
      throw err instanceof Error ? err : new Error('Routing unavailable');
    }
  },

  async getConnectionById(id: string): Promise<{ connection: Connection; source: 'live' | 'cache' } | undefined> {
    id = normalizeConnectionId(id);
    const found = getPlannedConnection(id);
    if (found) return { connection: found, source: 'live' };

    const allSaved = await getSavedRoutes();
    const hit = allSaved.find(r => r.id === id)?.connection;
    if (hit) return { connection: hit, source: 'live' };

    const cached = await findCachedConnection(id);
    if (cached) {
      // Z dysku: czasy przeliczamy na teraz i gasimy `live`, żeby szczegóły
      // nie udawały, że mają opóźnienie z serwera. Ekran dostanie
      // `source: 'cache'` i powie o tym wprost użytkownikowi.
      return { connection: cached, source: 'cache' };
    }

    return undefined;
  },

  async saveRoute(connection: Connection): Promise<void> {
    return withRoutesLock(async () => {
      try {
        const all = await readSavedRoutes();
        const existingIdx = all.findIndex((r) => r.id === connection.id);
        const entry: SavedRoute = { id: connection.id, savedAt: Date.now(), connection };
        if (existingIdx >= 0) {
          all[existingIdx] = entry;
        } else {
          all.push(entry);
        }
        await kvSet(savedRoutesKey(), JSON.stringify(all));
      } catch (err) {
        console.warn('[RoutingService] Failed to save route:', err);
      }
    });
  },

  async deleteSavedRoute(id: string): Promise<void> {
    return withRoutesLock(async () => {
      try {
        const all = await readSavedRoutes();
        const filtered = all.filter(r => r.id !== id);
        await kvSet(savedRoutesKey(), JSON.stringify(filtered));
      } catch (err) {
        console.warn('[RoutingService] Failed to delete saved route:', err);
      }
    });
  },

  async isRouteSaved(id: string): Promise<boolean> {
    try {
      const all = await getSavedRoutes();
      return all.some(r => r.id === id);
    } catch {
      return false;
    }
  },

  async getTripStops(tripId: string): Promise<LegStop[]> {
    try {
      return buildTripStops(tripId);
    } catch {
      return [];
    }
  },

};

// Zapisane trasy też są per-miasto (połączenie ma sens tylko w bazie miasta,
// w którym je zaplanowano). Ten sam wzorzec kluczy co miejsca.
const SAVED_ROUTES_BASE_KEY = 'kilometr.saved_routes';

export function savedRoutesKey(cityId?: string): string {
  return cityKey(SAVED_ROUTES_BASE_KEY, getCity(cityId ?? getActiveCityIdSync()).id);
}

// Odczyt listy zapisanych tras do modyfikacji: błąd odczytu lub uszkodzony JSON RZUCA,
// żeby save/delete nie nadpisały prawdziwych danych pustą listą.
// Brak klucza (pierwsze uruchomienie) to legalna pusta lista.
export async function readSavedRoutes(key?: string): Promise<SavedRoute[]> {
  const raw = await kvGetStrict(key ?? savedRoutesKey());
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${key ?? SAVED_ROUTES_BASE_KEY} is not an array`);
  return parsed.filter(
    (r): r is SavedRoute =>
      Boolean(r) &&
      typeof r.id === 'string' &&
      typeof r.savedAt === 'number' &&
      Boolean(r.connection) &&
      typeof r.connection.id === 'string' &&
      Array.isArray(r.connection.legs),
  );
}

export async function getSavedRoutes(key?: string): Promise<SavedRoute[]> {
  try {
    return await readSavedRoutes(key);
  } catch (err) {
    console.warn('[RoutingService] Failed to read saved routes:', err);
    return [];
  }
}

// Miejsca są per-miasto: każde miasto ma własny kubełek (`cityKey`),
// Wrocław trzyma legacy klucz bez sufiksu. Kubełek wynika z miasta
// aktywnego w chwili zapisu, więc Kraków nigdy nie zobaczy „Domu”
// z Wrocławia (i na odwrót).
const PLACES_BASE_KEY = 'kilometr.places';

function placesKey(cityId?: string): string {
  return cityKey(PLACES_BASE_KEY, getCity(cityId ?? getActiveCityIdSync()).id);
}

// Brak klucza (pierwsze uruchomienie) to legalna pusta lista.
async function readPlaces(key?: string): Promise<SavedPlace[]> {
  const raw = await kvGetStrict(key ?? placesKey());
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${key ?? PLACES_BASE_KEY} is not an array`);
  return parsed as SavedPlace[];
}

/**
 * Jednorazowa migracja miejsc sprzed multi-city. Legacy kubełek trzymał
 * wszystko razem: wpisy leżące w strefie innego miasta przenosimy do jego
 * kubełka, reszta (w tym punkty spoza wszystkich miast) zostaje we Wrocławiu.
 * Idempotentna: powtórne wywołanie nic nie rusza.
 */
let placesMigration: Promise<void> | null = null;

function ensurePlacesMigrated(): Promise<void> {
  if (!placesMigration) placesMigration = migratePlacesToCityBuckets();
  return placesMigration;
}

async function migratePlacesToCityBuckets(): Promise<void> {
  let legacy: SavedPlace[];
  try {
    legacy = await readPlaces(cityKey(PLACES_BASE_KEY, 'wroclaw'));
  } catch (err) {
    console.warn('[FavoritesService] migration read failed:', err);
    return;
  }
  if (legacy.length === 0) return;
  const movers = new Map<string, SavedPlace[]>();
  const staying = legacy.filter((p) => {
    const hit = suggestCityForCoords(p?.lat, p?.lon);
    if (hit && hit.id !== 'wroclaw') {
      const list = movers.get(hit.id) ?? [];
      list.push(p);
      movers.set(hit.id, list);
      return false;
    }
    return true;
  });
  if (movers.size === 0) return;
  for (const [cityId, moved] of movers) {
    try {
      const key = cityKey(PLACES_BASE_KEY, getCity(cityId).id);
      const existing = await readPlaces(key);
      const have = new Set(existing.map((p) => p.id));
      await kvSet(key, JSON.stringify([...existing, ...moved.filter((p) => !have.has(p.id))]));
    } catch (err) {
      console.warn('[FavoritesService] migration write failed:', err);
      return;
    }
  }
  try {
    await kvSet(cityKey(PLACES_BASE_KEY, 'wroclaw'), JSON.stringify(staying));
  } catch (err) {
    console.warn('[FavoritesService] migration cleanup failed:', err);
  }
}

// Serializuje read-modify-write listy miejsc: dwa równoległe addPlace nie mogą
// zgubić jednego wpisu (każdy czyta-i-zapisuje całą listę).
let placesLock: Promise<unknown> = Promise.resolve();
function withPlacesLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = placesLock.then(fn, fn);
  placesLock = run.catch(() => {});
  return run;
}

export const FavoritesService: IFavoritesService = {
  /** Tylko miejsca aktywnego miasta (po migracji legacy kubełka). */
  async list(): Promise<SavedPlace[]> {
    try {
      await ensurePlacesMigrated();
      return await readPlaces();
    } catch (err) {
      console.warn('[FavoritesService] list failed:', err);
      return [];
    }
  },

  async smartFromOrigin(originId: string, coords?: { lat: number; lon: number }): Promise<SmartDestination[]> {
    try {
      const { getSmartDestinationsForLocation } = await import('./smartRanker');
      const city = activeCityDef();
      // `??` łapie tylko brak, nie `NaN` z deep linka czy zepsutego GPS - a
      // ranking na `NaN` wypadałby z każdego promienia, czyli pokazałby
      // historię z całego miasta jako „w okolicy".
      const lat = Number.isFinite(coords?.lat) ? coords!.lat! : city.center.lat;
      const lon = Number.isFinite(coords?.lon) ? coords!.lon! : city.center.lon;
      return await getSmartDestinationsForLocation(lat, lon);
    } catch (err) {
      console.warn('[FavoritesService] smartFromOrigin failed:', err);
      return [];
    }
  },

  async addPlace(place: {
    name: string;
    icon: SavedPlace['icon'];
    address: string;
    lat: number;
    lon: number;
    anchorStopId?: string | null;
    anchorStopName?: string | null;
    anchorStopLat?: number | null;
    anchorStopLon?: number | null;
  }): Promise<SavedPlace> {
    return withPlacesLock(async () => {
      await ensurePlacesMigrated();
      const places = await readPlaces();
      // `Math.random().toString(36).substring(7)` bywa puste: dla 0 → "0" (długość 1),
      // dla 0.5 → "0.i" (3), dla 0.25 → "0.9" (3). Każde takie trafienie dawało
      // id = "" i dwa pola z tym samym id, a puste klucze psują `key` w liście,
      // `bySlot` i kotwicowanie po lokalizacji. Losujemy więc pełny zapis i
      // obcinamy dopiero na jego końcu - długość jest wtedy stała.
      const id = newId();
      const newPlace: SavedPlace = {
        id,
        placeId: id,
        name: place.name,
        icon: place.icon,
        address: place.address,
        lat: place.lat,
        lon: place.lon,
        anchorStopId: place.anchorStopId || undefined,
        anchorStopName: place.anchorStopName || undefined,
        anchorStopLat: place.anchorStopLat || undefined,
        anchorStopLon: place.anchorStopLon || undefined,
      };
      places.push(newPlace);
      await kvSet(placesKey(), JSON.stringify(places));
      return newPlace;
    });
  },

  async updatePlace(id: string, updates: Partial<SavedPlace>): Promise<SavedPlace | null> {
    return withPlacesLock(async () => {
      await ensurePlacesMigrated();
      const places = await readPlaces();
      const idx = places.findIndex(p => p.id === id);
      if (idx === -1) return null;
      places[idx] = { ...places[idx], ...updates };
      await kvSet(placesKey(), JSON.stringify(places));
      return places[idx];
    });
  },

  async deletePlace(id: string): Promise<boolean> {
    return withPlacesLock(async () => {
      let places: SavedPlace[];
      try {
        await ensurePlacesMigrated();
        places = await readPlaces();
      } catch (err) {
        // Błąd odczytu: NIE nadpisujemy listy pustką, tylko zgłaszamy porażkę.
        console.warn('[FavoritesService] deletePlace read failed:', err);
        return false;
      }
      const filtered = places.filter(p => p.id !== id);
      if (filtered.length === places.length) return false;
      await kvSet(placesKey(), JSON.stringify(filtered));
      return true;
    });
  },
};

export interface NearestStop {
  id: string;
  name: string;
  code?: string;
  lat: number;
  lon: number;
  distanceM: number;
}

export async function fetchNearestStops(lat: number, lon: number, limit = 6, maxDistance = 1200): Promise<NearestStop[]> {
  try {
    const { findNearestStops } = await import('./gtfsDatabase');
    const local = await findNearestStops(lat, lon, maxDistance, limit);
    if (local.length > 0) {
      return local.map((n) => ({
        id: n.stop_id,
        name: n.name,
        code: n.code,
        lat: n.lat,
        lon: n.lon,
        distanceM: n.distanceM,
      }));
    }
  } catch {}
  return [];
}
