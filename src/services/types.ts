import type {
  Connection,
  LegStop,
  RouteQuery,
  SavedPlace,
  SmartDestination,
  Suggestion,
  VehiclePosition,
} from '../types/models';

export interface ISearchService {
  search(query: string, coords?: { lat: number; lon: number }): Promise<Suggestion[]>;
  recent(): Promise<Suggestion[]>;
  recordRecent(item: Suggestion): Promise<void>;
}

export interface IRoutingService {
  getConnections(query: RouteQuery, onProgress?: (partial: Connection[]) => void): Promise<Connection[]>;
  /**
   * Pojedyncze połączenie wraz z informacją, SKĄD je wzięliśmy.
   * `source: 'cache'` oznacza, że nie ma go w pamięci procesu i pochodzi
   * z zapisu na dysku — wtedy czasy są sprzed zapisu, a `live` jest zerowane.
   * Bez tej informacji ekran szczegółów pokazywał dane z cache tak, jakby były
   * świeżo policzone, a użytkownik nie miał szansy tego odróżnić.
   */
  getConnectionById(id: string): Promise<{ connection: Connection; source: 'live' | 'cache' } | undefined>;
  saveRoute(connection: Connection): Promise<void>;
  deleteSavedRoute(id: string): Promise<void>;
  isRouteSaved(id: string): Promise<boolean>;
  /** Pełna sekwencja przystanków kursu (cała linia). Zwraca [] gdy brak danych. */
  getTripStops(tripId: string): Promise<LegStop[]>;
  /** Live pojazdy danej linii (GTFS-RT match). Zwraca [] gdy brak. */
  getVehicles(line: string): Promise<VehiclePosition[]>;
}

export interface ILocationService {
  getCurrentLocation(): Promise<{ title: string; address: string; lat: number; lon: number; stopId?: string }>;
}

export interface IFavoritesService {
  list(): Promise<SavedPlace[]>;
  smartFromOrigin(originId: string, coords?: { lat: number; lon: number }): Promise<SmartDestination[]>;
  addPlace(place: {
    name: string;
    icon: SavedPlace['icon'];
    address: string;
    lat: number;
    lon: number;
    anchorStopId?: string | null;
    anchorStopName?: string | null;
    anchorStopLat?: number | null;
    anchorStopLon?: number | null;
  }): Promise<SavedPlace>;
  updatePlace(
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
  ): Promise<SavedPlace | null>;
  deletePlace(id: string): Promise<boolean>;
}
