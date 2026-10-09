import * as Location from 'expo-location';
import { kvGet, kvSet } from './storage';
import { DEFAULT_LOCATION } from '../config';
import { Connection, LegStop, RouteQuery, SavedPlace, SmartDestination, Suggestion, VehiclePosition } from '../types/models';
import { IFavoritesService, ILocationService, IRoutingService, ISearchService, LocationResult } from './types';
import { addRecentSuggestion, loadLastLocation, loadRecent, loadSuggestions, rehydrateConnections, saveConnections, saveLastLocation, saveRecent, saveSuggestions, findCachedConnection } from './offlineCache';
import { planConnections, buildTripStops } from './routing/engine';
import { fetchVehiclesDirect } from './realtimeClient';

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
/** Ruch o tyle metrów (albo zmiana przystanku) znaczy fix istotnie lepszy. */
export const LOCATION_REFINE_DELTA_M = 25;

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
 * Identyfikator nowego zapisu. Nie `Math.random().toString(36).substring(7)` —
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
async function resolveLocation(lat: number, lon: number, accuracyM?: number | null): Promise<LocationResult> {
  const seq = ++cacheWriteSeq;
  let result: LocationResult = { title: 'Twoja lokalizacja', address: 'Wrocław', lat, lon, accuracyM };
  let city: string | null = null;
  let foundStop = false;
  let hadReverse = false;

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
      result = { title: last.title, address: last.address, lat, lon, stopId: last.stopId, accuracyM };
    }
  }

  if (seq === cacheWriteSeq) {
    cachedLocation = result;
    cachedAt = Date.now();
    if (foundStop) void saveLastLocation(result);
  }
  return result;
}

/**
 * Dokładniejszy fix (GPS, nie sieć) w tle. Jeden odczyt naraz: równoległe
 * wołania dostają ten sam promise. Słuchaczy powiadamiamy tylko, gdy pozycja
 * realnie się przesunęła albo zmienił się najbliższy przystanek; drobny szum
 * nie może restartować wyszukiwania tras.
 */
async function refineLocation(): Promise<LocationResult | null> {
  if (refineInFlight) return refineInFlight;
  // Kolejne przebudzenia stanu nie mogą mielić odczytami High co chwilę.
  if (cachedLocation && Date.now() - lastRefineAt < REFINE_MIN_INTERVAL_MS) return cachedLocation;
  refineInFlight = (async () => {
    lastRefineAt = Date.now();
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
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
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return { ...DEFAULT_LOCATION };

      if (!options?.force) {
        // Świeży fix oddajemy od razu; precyzja dociąga się w tle i sama
        // powiadomi subskrybentów, więc UI nigdy nie czeka na GPS.
        if (cachedLocation && Date.now() - cachedAt < FRESH_FIX_MS) {
          void refineLocation();
          return cachedLocation;
        }
        const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000, requiredAccuracy: 300 });
        if (last) {
          const loc = await resolveLocation(last.coords.latitude, last.coords.longitude, last.coords.accuracy);
          void refineLocation();
          return loc;
        }
      }

      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const loc = await resolveLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      void refineLocation();
      return loc;
    } catch (err) {
      console.warn('[LocationService] Failed to acquire device location:', err);
    }

    return { ...DEFAULT_LOCATION };
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
 * wywołującego w „brak wyników” — czyli wynik znikiał bez powodu.
 */
const searchAborts = new Map<string, AbortController>();
const DEFAULT_SEARCH_SCOPE = 'default';

/**
 * Wyszukiwanie przerwane nowszym zapytaniem. Odróżniamy to od „brak wyników”,
 * bo inaczej anulowany request wpisywałby pustą listę po wynikach nowszego.
 */
export class SearchAbortedError extends Error {
  constructor() {
    super('Wyszukiwanie przerwane przez nowe zapytanie');
    this.name = 'SearchAbortedError';
  }
}

// Cache scalonych podpowiedzi (query + zaokrąglona pozycja) — powtórki migają.
const mergedCache = new Map<string, { data: Suggestion[]; expires: number }>();
const MERGED_TTL_MS = 120 * 1000;
const MERGED_MAX = 60;

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
  ): Promise<Suggestion[]> {
    const q = query.trim();
    if (!q) return [];

    searchAborts.get(scope)?.abort();
    const ctrl = new AbortController();
    searchAborts.set(scope, ctrl);
    // Zapytanie uznane za nieaktualne → nie wrzucamy go do cache podpowiedzi.
    const isCurrent = () => searchAborts.get(scope) === ctrl;

    const hasPos = coords !== undefined;
    const cacheKey = `v2:${q.toLowerCase()}|${coords ? `${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}` : '-'}`;
    const cachedMerged = mergedGet(cacheKey);
    if (cachedMerged) return cachedMerged;

    try {
      const { searchStops } = await import('./gtfsDatabase');
      const { searchPois, ensurePoiIndex } = await import('./poiIndex');
      const { searchNominatimDirect } = await import('./nominatimDirect');
      const { dedupeAndSort } = await import('./searchRank');
      const { distanceMeters } = await import('../gtfs/geo');
      const { normalizePolish } = await import('../gtfs/geo');

      // Lokalny indeks POI odświeża się w tle, nigdy nie blokuje.
      ensurePoiIndex();

      // 1. Lokalne źródła (szybkie, offline): przystanki GTFS + indeks POI.
      const [stopHits, poiHits] = await Promise.all([
        searchStops(q, 12).catch(() => []),
        searchPois(q, coords?.lat, coords?.lon, 8).catch(() => []),
      ]);
      if (!isCurrent()) throw new SearchAbortedError();
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
      const localSuggestions = [...stopSuggestions, ...poiHits];

      // 2. Sieć (Nominatim) tylko gdy lokalnie za mało albo to adres z numerem.
      // Adresy z numerami są domeną Nominatim — lokalny indeks ich nie ma.
      const normQ = normalizePolish(q);
      const looksLikeAddress = /\d/.test(normQ);
      const needNetwork = q.length >= 2 && (looksLikeAddress || localSuggestions.length < 5);
      let remoteHits: Suggestion[] = [];
      if (needNetwork) {
        remoteHits = await searchNominatimDirect(q, coords?.lat, coords?.lon, ctrl.signal).catch(() => []);
        if (!isCurrent()) throw new SearchAbortedError();
      }

      // 3. Merge: przystanki absolutnie pierwsze (w kolejności trafienie+waga),
      // reszta wg nazwy z karą za dystans — bliższe wyżej.
      const merged = dedupeAndSort(localSuggestions, remoteHits, hasPos, normQ).slice(0, 15);
      if (merged.length > 0) {
        mergedSet(cacheKey, merged);
        if (isCurrent()) void saveSuggestions(q, merged);
        return merged;
      }
    } catch {
      // offline / błąd — fallback niżej
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
        trainMinTransferSec: query.trainMinTransferSec,
        maxWalkM: query.maxWalkM,
        walkSpeedMps: query.walkSpeedMps,
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
      }
      return connections;
    } catch (err) {
      console.warn('[RoutingService] Local routing failed:', err);
      throw err instanceof Error ? err : new Error('Routing unavailable');
    }
  },

  async getConnectionById(id: string): Promise<{ connection: Connection; source: 'live' | 'cache' } | undefined> {
    const found = recentPlannedConnections.get(id);
    if (found) return { connection: found, source: 'live' };

    const saved = await this.isRouteSaved(id);
    if (saved) {
      const allSaved = await getSavedRoutes();
      const hit = allSaved.find(r => r.id === id)?.connection;
      if (hit) return { connection: hit, source: 'live' };
    }

    const cached = await findCachedConnection(id);
    if (cached) {
      // Z dysku: czasy przeliczamy na teraz i gasiemy `live`, żeby szczegóły
      // nie udawały, że mają opóźnienie z serwera. Ekran dostanie
      // `source: 'cache'` i powie o tym wprost użytkownikowi.
      return { connection: rehydrateConnections([cached])[0], source: 'cache' };
    }

    return undefined;
  },

  async saveRoute(connection: Connection): Promise<void> {
    try {
      const all = await getSavedRoutes();
      all.push({ id: connection.id, savedAt: Date.now(), connection });
      await kvSet('kilometr.saved_routes', JSON.stringify(all));
    } catch (err) {
      console.warn('[RoutingService] Failed to save route:', err);
    }
  },

  async deleteSavedRoute(id: string): Promise<void> {
    try {
      const all = await getSavedRoutes();
      const filtered = all.filter(r => r.id !== id);
      await kvSet('kilometr.saved_routes', JSON.stringify(filtered));
    } catch (err) {
      console.warn('[RoutingService] Failed to delete saved route:', err);
    }
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

  async getVehicles(line: string): Promise<VehiclePosition[]> {
    return fetchVehiclesDirect(line);
  },
};

async function getSavedRoutes(): Promise<{id: string, savedAt: number, connection: Connection}[]> {
  try {
    const raw = await kvGet('kilometr.saved_routes');
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export const FavoritesService: IFavoritesService = {
  async list(): Promise<SavedPlace[]> {
    try {
      const raw = await kvGet('kilometr.places');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  },

  async smartFromOrigin(originId: string, coords?: { lat: number; lon: number }): Promise<SmartDestination[]> {
    try {
      const { getSmartDestinationsForLocation } = await import('./smartRanker');
      // `??` łapie tylko brak, nie `NaN` z deep linka czy zepsutego GPS — a
      // ranking na `NaN` wypadałby z każdego promienia, czyli pokazałby
      // historię z całego miasta jako „w okolicy".
      const lat = Number.isFinite(coords?.lat) ? coords!.lat! : DEFAULT_LOCATION.lat;
      const lon = Number.isFinite(coords?.lon) ? coords!.lon! : DEFAULT_LOCATION.lon;
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
    const places = await this.list();
    // `Math.random().toString(36).substring(7)` bywa puste: dla 0 → "0" (długość 1),
    // dla 0.5 → "0.i" (3), dla 0.25 → "0.9" (3). Każde takie trafienie dawało
    // id = "" i dwa pola z tym samym id, a puste klucze psują `key` w liście,
    // `bySlot` i kotwicowanie po lokalizacji. Losujemy więc pełny zapis i
    // obcinamy dopiero na jego końcu — długość jest wtedy stała.
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
    await kvSet('kilometr.places', JSON.stringify(places));
    return newPlace;
  },

  async updatePlace(id: string, updates: Partial<SavedPlace>): Promise<SavedPlace | null> {
    const places = await this.list();
    const idx = places.findIndex(p => p.id === id);
    if (idx === -1) return null;
    places[idx] = { ...places[idx], ...updates };
    await kvSet('kilometr.places', JSON.stringify(places));
    return places[idx];
  },

  async deletePlace(id: string): Promise<boolean> {
    const places = await this.list();
    const filtered = places.filter(p => p.id !== id);
    await kvSet('kilometr.places', JSON.stringify(filtered));
    return true;
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
