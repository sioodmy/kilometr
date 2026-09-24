// ─── Backend-ready domain models ─────────────────────────────────────────────
// UI screens ONLY depend on these types + `src/services/types.ts` interfaces.
// Future backend swap guide:
//  - Suggestions  → Nominatim / Photon (`q`, `lat/lon`, `addressdetails=1`)
//                   + local GTFS stops.txt for `kind: 'stop'`
//  - Connections  → OpenTripPlanner 2 / Navitia over Wrocław GTFS + GTFS-RT
//                   (`delayMin`, `live` come from TripUpdates feed)
//  - SavedPlace   → AsyncStorage now, Supabase `saved_places` table later
//  - SmartHistory → frequency table `(fromId, toId, count, lastUsedAt)`

export type LatLon = { lat: number; lon: number };

export type SuggestionKind = 'stop' | 'address' | 'place' | 'history';

export interface Suggestion extends LatLon {
  id: string;
  title: string;
  address: string;
  kind: SuggestionKind;
  category?: string;
  /** metres from current location, if known */
  distanceM?: number;
  /** stop popularity: departures served (drives stop ranking) */
  weight?: number;
}

export type SavedPlaceIcon =
  | 'home'
  | 'school'
  | 'work'
  | 'gym'
  | 'star'
  | 'heart'
  | 'coffee'
  | 'shopping'
  | 'train'
  | 'mapPin'
  | 'plus'
  | 'restaurant'
  | 'pharmacy'
  | 'park'
  | 'cinema'
  | 'culture'
  | 'library'
  | 'friends'
  | 'church'
  | 'car'
  | 'bike'
  | 'plane'
  | 'market'
  | 'university'
  | 'tram'
  | 'bus'
  | 'fuel'
  | 'ship'
  | 'compass'
  | 'pizza'
  | 'sandwich'
  | 'beer'
  | 'wine'
  | 'cart'
  | 'hospital'
  | 'doctor'
  | 'scissors'
  | 'sparkles'
  | 'theater'
  | 'music'
  | 'ticket'
  | 'gamepad'
  | 'mountain'
  | 'tent'
  | 'trophy'
  | 'swimming'
  | 'baby'
  | 'pet'
  | 'hotel'
  | 'bank'
  | 'post'
  | 'laptop';

export interface SavedPlace {
  id: string;
  /** user-defined label, e.g. "Dom", "Szkoła" */
  name: string;
  icon: SavedPlaceIcon;
  placeId: string;
  address: string;
  lat: number;
  lon: number;
  /** Zakotwiczony przystanek odjazdu dla tej lokalizacji */
  anchorStopId?: string;
  anchorStopName?: string;
  anchorStopLat?: number;
  anchorStopLon?: number;
}

export interface SmartDestination extends LatLon {
  id: string;
  title: string;
  address: string;
  /** weekly tap count from this origin — drives ranking */
  frequency: number;
  avgDurationMin: number;
  originId: string;
}

export type LegMode = 'tram' | 'bus' | 'walk';

export interface LegStop {
  stopId: string;
  name: string;
  lat?: number;
  lon?: number;
  /** kolejność w kursie (stop_sequence) */
  seq: number;
  /** sekundy od północy, jeśli znane z GTFS */
  arriveSec?: number;
  departSec?: number;
}

export interface VehiclePosition {
  vehicleId: string;
  line: string;
  lat: number;
  lon: number;
  delaySec: number;
  currentStopName?: string;
  nextStopName?: string;
  updatedAt: number;
  /** GTFS trip_id dopasowany przez backend (matcher) — do matchowania z Leg.tripId */
  matchedTripId?: string;
}

export interface Leg {
  id: string;
  mode: LegMode;
  /** e.g. "4", "K", "D" — undefined for walk */
  line?: string;
  /** headsign, e.g. "BISKUPIN" */
  direction?: string;
  fromStop: string;
  toStop: string;
  departAt: string; // "14:02"
  arriveAt: string; // "14:18"
  stopsCount: number;
  /** metres for walk legs */
  walkM?: number;
  /** GTFS-RT trip present? */
  live: boolean;
  fromStopId?: string;
  toStopId?: string;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
  /** GTFS stop_code / numer słupka (np. 10121) */
  platformCode?: string;
  /** GTFS trip_id kursu — klucz do /trips/:id/stops i matchowania pojazdu */
  tripId?: string;
  routeId?: string;
  /** pełna sekwencja przystanków kursu (cała linia); nasz odcinek to podzbiór */
  intermediateStops?: LegStop[];
}

export interface Connection {
  id: string;
  fromTitle: string;
  toTitle: string;
  /** minutes until departure, from "now" */
  departInMin: number;
  departureSec: number;
  departAt: string;
  arriveAt: string;
  durationMin: number;
  transfers: number;
  /** +late / -early / 0 on time */
  delayMin: number;
  /** any leg has live GPS? */
  live: boolean;
  legs: Leg[];
  /** interchange hint, e.g. "Przesiadka: Rondo" */
  interchange?: string;
}

export interface RouteQuery {
  fromTitle: string;
  fromLat: number;
  fromLon: number;
  toId: string;
  toTitle: string;
  toLat: number;
  toLon: number;
  departureTimeSec?: number;
  /** 0–3, default 2 */
  maxTransfers?: number;
  /** sekundy, default 120 */
  minTransferSec?: number;
  /** metry, default 800 */
  maxWalkM?: number;
  /** m/s, default 1.3. Tempo chodzenia. */
  walkSpeedMps?: number;
  /**
   * Preferowany przystanek startowy (kotwica miejsca).
   * Ułatwienie, NIE sztywne nadpisanie pozycji: routing liczy prawdziwy
   * spacer z fromLat/fromLon do kotwicy i dopuszcza też sąsiednie słupki.
   */
  anchorStopId?: string;
  anchorStopLat?: number;
  anchorStopLon?: number;
}
