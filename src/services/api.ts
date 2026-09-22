import * as Location from 'expo-location';
import { API_URL, DEFAULT_LOCATION } from '../config';
import { Connection, LegStop, RouteQuery, SavedPlace, SmartDestination, Suggestion, VehiclePosition } from '../types/models';
import { IFavoritesService, ILocationService, IRoutingService, ISearchService } from './types';
import { loadLastLocation, loadRecent, loadSuggestions, saveConnections, saveLastLocation, saveRecent, saveSuggestions } from './offlineCache';

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

        // Call backend reverse geocode / snap to stop
        try {
          const res = await fetch(`${API_URL}/api/location/reverse?lat=${lat}&lon=${lon}`, {
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            const data = await res.json();
            cachedLocation = {
              title: data.title,
              address: data.address,
              lat: data.lat,
              lon: data.lon,
              stopId: data.stopId,
            };
            void saveLastLocation(cachedLocation);
            return cachedLocation;
          }
        } catch {
          // Backend reverse geocode fallback
        }

        // Offline: ostatnia znana ulica, ale tylko gdy blisko bieżącej pozycji.
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

    // Brak GPS i backendu: neutralny środek Wrocławia (ŻADEN mock danych).
    return { ...DEFAULT_LOCATION };
  },
};

let searchAbort: AbortController | null = null;

export const SearchService: ISearchService = {
  async search(query: string, coords?: { lat: number; lon: number }): Promise<Suggestion[]> {
    const q = query.trim();
    if (!q) return [];

    // Nowe pociągnięcie klawiatury anuluje poprzednie — brak podmiany wyników
    // na przestarzałe i brak kolejek na wolnym łączu.
    searchAbort?.abort();
    const ctrl = new AbortController();
    searchAbort = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 6500);

    try {
      let url = `${API_URL}/api/search?q=${encodeURIComponent(q)}`;
      if (coords) {
        url += `&lat=${coords.lat}&lon=${coords.lon}`;
      } else if (cachedLocation) {
        url += `&lat=${cachedLocation.lat}&lon=${cachedLocation.lon}`;
      }

      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (searchAbort !== ctrl) return []; // w międzyczasie przyszło nowsze zapytanie
      if (res.ok) {
        const items = (await res.json()) as Suggestion[];
        if (searchAbort === ctrl && Array.isArray(items)) {
          void saveSuggestions(q, items);
          return items;
        }
        return [];
      }
    } catch {
      // Backend offline — wyniki z cache (ostatnie prawdziwe dane).
    } finally {
      clearTimeout(timer);
    }

    if (searchAbort !== ctrl) return []; // przestarzałe — nie nadpisuj nowszych wyników
    return loadSuggestions(q);
  },

  async recent(): Promise<Suggestion[]> {
    try {
      const res = await fetch(`${API_URL}/api/history`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const items = await res.json();
        if (Array.isArray(items)) {
          void saveRecent(items);
          return items;
        }
      }
    } catch {
      // offline — recent z cache
    }
    return loadRecent();
  },
};

export const RoutingService: IRoutingService = {
  async getConnections(query: RouteQuery): Promise<Connection[]> {
    try {
      const url = new URL(`${API_URL}/api/routes`);
      url.searchParams.set('fromTitle', query.fromTitle);
      url.searchParams.set('fromLat', String(query.fromLat));
      url.searchParams.set('fromLon', String(query.fromLon));
      url.searchParams.set('toTitle', query.toTitle);
      url.searchParams.set('toLat', String(query.toLat));
      url.searchParams.set('toLon', String(query.toLon));
      if (query.toId) url.searchParams.set('toId', query.toId);
      if (query.departureTimeSec) url.searchParams.set('departureTimeSec', String(query.departureTimeSec));
      if (query.maxTransfers !== undefined) url.searchParams.set('maxTransfers', String(query.maxTransfers));
      if (query.minTransferSec !== undefined) url.searchParams.set('minTransferSec', String(query.minTransferSec));
      if (query.maxWalkM !== undefined) url.searchParams.set('maxWalkM', String(query.maxWalkM));
      if (query.walkSpeedMps !== undefined) url.searchParams.set('walkSpeedMps', String(query.walkSpeedMps));

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const connections = (await res.json()) as Connection[];
        if (Array.isArray(connections)) {
          // Tylko bazowe zapytanie (bez przesunięcia czasu) cachujemy —
          // paginacja dokłada do tej samej listy na ekranie.
          if (!query.departureTimeSec) {
            void saveConnections(query, connections);
          }
          return connections;
        }
        throw new Error('Bad routing response');
      }
      throw new Error(`Routing failed: HTTP ${res.status}`);
    } catch (err) {
      // Brak fałszywych połączeń — ekrany pokazują błąd z przyciskiem ponów.
      console.warn('[RoutingService] API routing unavailable:', err);
      throw err instanceof Error ? err : new Error('Routing unavailable');
    }
  },

  async getConnectionById(id: string): Promise<Connection | undefined> {
    try {
      const res = await fetch(`${API_URL}/api/routes/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        return (await res.json()) as Connection;
      }
    } catch {
      // offline — undefined, ekran pokaże błąd
    }
    return undefined;
  },

  async saveRoute(connection: Connection): Promise<void> {
    try {
      await fetch(`${API_URL}/api/routes/saved`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connection),
      });
    } catch (err) {
      console.warn('[RoutingService] Failed to save route:', err);
    }
  },

  async deleteSavedRoute(id: string): Promise<void> {
    try {
      await fetch(`${API_URL}/api/routes/saved/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.warn('[RoutingService] Failed to delete saved route:', err);
    }
  },

  async isRouteSaved(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_URL}/api/routes/saved/${encodeURIComponent(id)}/status`);
      if (res.ok) {
        const data = await res.json();
        return !!data.isSaved;
      }
    } catch {
      // fallback
    }
    return false;
  },

  async getTripStops(tripId: string): Promise<LegStop[]> {
    try {
      const res = await fetch(`${API_URL}/api/trips/${encodeURIComponent(tripId)}/stops`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data as LegStop[];
        if (Array.isArray(data?.stops)) return data.stops as LegStop[];
      }
    } catch {
      // brak danych — caller użyje fallbacku (intermediateStops lub estymacja)
    }
    return [];
  },

  async getVehicles(line: string): Promise<VehiclePosition[]> {
    try {
      const res = await fetch(`${API_URL}/api/vehicles?line=${encodeURIComponent(line)}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data as VehiclePosition[];
      }
    } catch {
      // offline — estymacja czasowa po stronie UI
    }
    return [];
  },
};

export const FavoritesService: IFavoritesService = {
  async list(): Promise<SavedPlace[]> {
    try {
      const res = await fetch(`${API_URL}/api/places`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const items = await res.json();
        if (Array.isArray(items)) {
          return items;
        }
      }
    } catch {
      // offline — pusta lista (żadnych fałszywych miejsc)
    }
    return [];
  },

  async smartFromOrigin(originId: string, coords?: { lat: number; lon: number }): Promise<SmartDestination[]> {
    try {
      let url = `${API_URL}/api/destinations/smart`;
      if (coords) {
        url += `?lat=${coords.lat}&lon=${coords.lon}`;
      } else if (cachedLocation) {
        url += `?lat=${cachedLocation.lat}&lon=${cachedLocation.lon}`;
      }

      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const items = await res.json();
        if (Array.isArray(items)) {
          return items;
        }
      }
    } catch {
      // offline — pusta lista
    }

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
    const res = await fetch(`${API_URL}/api/places`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(place),
    });
    if (!res.ok) {
      throw new Error(`Add place failed: HTTP ${res.status}`);
    }
    return (await res.json()) as SavedPlace;
  },

  async updatePlace(
    id: string,
    place: Partial<{
      name: string;
      icon: SavedPlace['icon'];
      address: string;
      lat: number;
      lon: number;
      anchorStopId?: string | null;
      anchorStopName?: string | null;
      anchorStopLat?: number | null;
      anchorStopLon?: number | null;
    }>
  ): Promise<SavedPlace | null> {
    const res = await fetch(`${API_URL}/api/places/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(place),
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      const text = await res.text().catch(() => '');
      throw new Error(`Update place failed: HTTP ${res.status} ${text}`);
    }
    return (await res.json()) as SavedPlace;
  },

  async deletePlace(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_URL}/api/places/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) return true;
    } catch {
      // fallback
    }
    return false;
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
    const res = await fetch(
      `${API_URL}/api/stops/nearest?lat=${lat}&lon=${lon}&limit=${limit}&maxDistance=${maxDistance}`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      return (await res.json()) as NearestStop[];
    }
  } catch {
    // ignore
  }
  return [];
}

