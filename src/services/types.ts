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
  /**
   * `scope` rozdziela anulowanie między niezależnymi polami wyszukiwania —
   * bez niego zapytanie w jednym polu zabijałooby zapytanie w drugim.
   */
  search(query: string, coords?: { lat: number; lon: number }, scope?: string): Promise<Suggestion[]>;
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

export interface LocationResult {
  title: string;
  address: string;
  lat: number;
  lon: number;
  stopId?: string;
  city?: string | null;
  /** Promień niepewności fixu w metrach z systemu (null na webe). */
  accuracyM?: number | null;
}

export interface ILocationService {
  /**
   * Pozycja „na teraz": świeży cache, ostatni znany fix albo szybki odczyt
   * Balanced. Nigdy nie czeka na precyzyjny fix, ten dociąga `refineLocation`
   * już po oddaniu wyniku. `force` pomija cache (ręczne „użyj GPS").
   */
  getCurrentLocation(options?: { force?: boolean }): Promise<LocationResult>;
  /** Dokładniejszy odczyt (Accuracy.High) w tle; null, gdy się nie udało. */
  refineLocation(): Promise<LocationResult | null>;
  /** Powiadomienie o istotnie innym fixie; zwraca unsubscribe. */
  subscribe(listener: (loc: LocationResult) => void): () => void;
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
