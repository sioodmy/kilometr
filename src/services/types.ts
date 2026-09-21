import type {
  Connection,
  RouteQuery,
  SavedPlace,
  SmartDestination,
  Suggestion,
} from '../types/models';

// ─── Service contracts. UI imports ONLY these + `services/index.ts` ─────────
// Mock implementations live in `*.mock.ts`. To wire the backend later:
//  1. create `SearchService.nominatim.ts` implementing ISearchService
//  2. swap the export in `index.ts` — zero UI changes needed.

export interface ISearchService {
  /** Full-text + fuzzy search. Later: Nominatim + Photon + GTFS stops. */
  search(query: string): Promise<Suggestion[]>;
  recent(): Promise<Suggestion[]>;
}

export interface IRoutingService {
  /** Later: POST /otp/plan or Navitia journeys. Must stay sorted by departure. */
  getConnections(query: RouteQuery): Promise<Connection[]>;
  getConnectionById(id: string): Promise<Connection | undefined>;
}

export interface ILocationService {
  /** Later: expo-location getCurrentPositionAsync + reverse-geocode. */
  getCurrentLocation(): Promise<{ title: string; address: string; lat: number; lon: number }>;
}

export interface IFavoritesService {
  list(): Promise<SavedPlace[]>;
  smartFromOrigin(originId: string): Promise<SmartDestination[]>;
}
