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
  /** metres from current location, if known */
  distanceM?: number;
}

export type SavedPlaceIcon =
  | 'home'
  | 'school'
  | 'work'
  | 'gym'
  | 'star'
  | 'heart'
  | 'plus';

export interface SavedPlace {
  id: string;
  /** user-defined label, e.g. "Dom", "Szkoła" */
  name: string;
  icon: SavedPlaceIcon;
  placeId: string;
  address: string;
  lat: number;
  lon: number;
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
}

export interface Connection {
  id: string;
  fromTitle: string;
  toTitle: string;
  /** minutes until departure, from "now" */
  departInMin: number;
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
}
