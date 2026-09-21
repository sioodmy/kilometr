import { CURRENT_LOCATION, SMART_DESTINATIONS, SUGGESTIONS, SAVED_PLACES, CONNECTIONS } from '../data/mocks';
import type { IFavoritesService, ILocationService, IRoutingService, ISearchService } from './types';
import type { Connection, RouteQuery } from '../types/models';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Strip Polish diacritics so "wroclav", "biskupin" etc. still match. Later: server-side fuzzy. */
export function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
}

export const SearchService: ISearchService = {
  async search(query) {
    await wait(180); // simulate network; remove when real API lands
    const q = normalize(query.trim());
    if (!q) return [];
    return SUGGESTIONS.filter(
      (s) => normalize(s.title).includes(q) || normalize(s.address).includes(q),
    ).slice(0, 8);
  },
  async recent() {
    await wait(60);
    return SUGGESTIONS.filter((s) => s.kind === 'history');
  },
};

export const RoutingService: IRoutingService = {
  async getConnections(query: RouteQuery) {
    await wait(450); // simulate OTP planning latency
    // Mock fixtures are static; overlay the queried titles so headers/details
    // stay coherent. Real backend returns these per-journey — same shape.
    return [...CONNECTIONS]
      .sort((a, b) => a.departInMin - b.departInMin)
      .map((c) => ({ ...c, fromTitle: query.fromTitle, toTitle: query.toTitle }));
  },
  async getConnectionById(id: string): Promise<Connection | undefined> {
    await wait(120);
    return CONNECTIONS.find((c) => c.id === id);
  },
};

export const LocationService: ILocationService = {
  async getCurrentLocation() {
    await wait(80);
    return { ...CURRENT_LOCATION };
  },
};

export const FavoritesService: IFavoritesService = {
  async list() {
    await wait(60);
    return SAVED_PLACES;
  },
  async smartFromOrigin(originId: string) {
    await wait(80);
    return SMART_DESTINATIONS.filter((d) => d.originId === originId).sort(
      (a, b) => b.frequency - a.frequency,
    );
  },
};
