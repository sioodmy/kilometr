// Single import surface for screens. Swap mocks → real clients here later.
// Example:
//   export { NominatimSearchService as SearchService } from './SearchService.nominatim';
export { SearchService, RoutingService, LocationService, FavoritesService } from './mock';
export { normalize } from './mock';
