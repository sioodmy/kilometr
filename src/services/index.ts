export { SearchService, RoutingService, LocationService, FavoritesService, fetchNearestStops, subscribeSavedRoutes, LOCATION_REFINE_DELTA_M, type NearestStop } from './api';
export type { LocationResult } from './types';
export { findAnchorForLocation, type ActiveAnchor } from './anchorService';
export { distanceMeters } from '../gtfs/geo';
export { recordTripSearch } from './smartRanker';
