// Single import surface for screens — tylko prawdziwe klienty API (MPK/GTFS/Overpass).
// Single import surface for screens — tylko prawdziwe klienty API (MPK/GTFS/Overpass).
export { SearchService, RoutingService, LocationService, FavoritesService, fetchNearestStops, LOCATION_REFINE_DELTA_M, type NearestStop } from './api';
export type { LocationResult } from './types';
export { findAnchorForLocation, distanceMeters, type ActiveAnchor } from './anchorService';
export { recordTripSearch, getSmartDestinationsForLocation } from './smartRanker';
