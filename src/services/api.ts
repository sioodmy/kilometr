import * as Location from 'expo-location';
import { kvGet, kvSet } from './storage';
import { DEFAULT_LOCATION } from '../config';
import { Connection, LegStop, RouteQuery, SavedPlace, SmartDestination, Suggestion, VehiclePosition } from '../types/models';
import { IFavoritesService, ILocationService, IRoutingService, ISearchService } from './types';
import { loadLastLocation, loadRecent, loadSuggestions, saveConnections, saveLastLocation, saveRecent, saveSuggestions, findCachedConnection } from './offlineCache';
import { planConnections, buildTripStops } from './routing/engine';
import { fetchVehiclesDirect } from './realtimeClient';

let cachedLocation: { title: string; address: string; lat: number; lon: number; stopId?: string } | null = null;

function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLa = ((bLat - aLat) * Math.PI) / 180;
  const dLo = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLa / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const LocationService: ILocationService = {
  async getCurrentLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        try {
          const { findNearestStops } = await import('./gtfsDatabase');
          const nearest = await findNearestStops(lat, lon, 500, 1);
          if (nearest.length > 0) {
            const n = nearest[0];
            cachedLocation = {
              title: n.name,
              address: n.code ? `Przystanek • słup ${n.code}` : 'Wrocław',
              lat,
              lon,
              stopId: n.stop_id,
            };
            void saveLastLocation(cachedLocation);
            return cachedLocation;
          }
          const { reverseNominatimDirect } = await import('./nominatimDirect');
          const rev = await reverseNominatimDirect(lat, lon);
          if (rev) {
            cachedLocation = { title: rev.title, address: rev.address, lat, lon };
            return cachedLocation;
          }
        } catch {}

        const last = await loadLastLocation();
        if (last && distanceM(lat, lon, last.lat, last.lon) < 1000) {
          cachedLocation = {
            title: last.title,
            address: last.address,
            lat,
            lon,
            stopId: last.stopId,
          };
          return cachedLocation;
        }

        cachedLocation = {
          title: 'Twoja lokalizacja',
          address: 'Wrocław',
          lat,
          lon,
        };
        return cachedLocation;
      }
    } catch (err) {
      console.warn('[LocationService] Failed to acquire device location:', err);
    }

    return { ...DEFAULT_LOCATION };
  },
};

let searchAbort: AbortController | null = null;

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
  async search(query: string, coords?: { lat: number; lon: number }): Promise<Suggestion[]> {
    const q = query.trim();
    if (!q) return [];

    searchAbort?.abort();
    const ctrl = new AbortController();
    searchAbort = ctrl;

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
      if (searchAbort !== ctrl) return [];
      const stopSuggestions: Suggestion[] = stopHits.map((h) => ({
        id: `stop-${h.stop_id}`,
        title: h.name,
        address: h.code ? `Przystanek • słup. ${h.code}` : 'Wrocław',
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
        if (searchAbort !== ctrl) return [];
      }

      // 3. Merge: przystanki absolutnie pierwsze (w kolejności trafienie+waga),
      // reszta wg nazwy z karą za dystans — bliższe wyżej.
      const merged = dedupeAndSort(localSuggestions, remoteHits, hasPos, normQ).slice(0, 15);
      if (merged.length > 0) {
        mergedSet(cacheKey, merged);
        if (searchAbort === ctrl) void saveSuggestions(q, merged);
        return merged;
      }
    } catch {
      // offline / błąd — fallback niżej
    }

    if (searchAbort !== ctrl) return [];
    return loadSuggestions(q);
  },

  async recent(): Promise<Suggestion[]> {
    return loadRecent();
  },
};

// In-memory recent connections for getConnectionById
const recentPlannedConnections = new Map<string, Connection>();

export const RoutingService: IRoutingService = {
  async getConnections(query: RouteQuery): Promise<Connection[]> {
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
        maxTransfers: query.maxTransfers,
        modes: query.modes,
        minTransferSec: query.minTransferSec,
        maxWalkM: query.maxWalkM,
        walkSpeedMps: query.walkSpeedMps,
        anchorStopId: query.anchorStopId,
        anchorStopLat: query.anchorStopLat,
        anchorStopLon: query.anchorStopLon,
      });
      
      for (const c of connections) {
        recentPlannedConnections.set(c.id, c);
      }

      if (!query.departureTimeSec) {
        void saveConnections(query, connections);
      }
      return connections;
    } catch (err) {
      console.warn('[RoutingService] Local routing failed:', err);
      throw err instanceof Error ? err : new Error('Routing unavailable');
    }
  },

  async getConnectionById(id: string): Promise<Connection | undefined> {
    const found = recentPlannedConnections.get(id);
    if (found) return found;

    const saved = await this.isRouteSaved(id);
    if (saved) {
      const allSaved = await getSavedRoutes();
      return allSaved.find(r => r.id === id)?.connection;
    }
    
    const cached = await findCachedConnection(id);
    if (cached) return cached;
    
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
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  },

  async smartFromOrigin(originId: string, coords?: { lat: number; lon: number }): Promise<SmartDestination[]> {
    return [];
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
    const newPlace: SavedPlace = {
      id: Math.random().toString(36).substring(7),
      placeId: Math.random().toString(36).substring(7),
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
