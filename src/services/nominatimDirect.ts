// Nominatim prosto z telefonu (bez serwera pośredniczącego).
// Te same parametry co serwer: viewbox Wrocławia, limit, User-Agent.
// Cache: AsyncStorageowy recent + memory (jak serwerowy memCache).

import { NOMINATIM } from './gtfsConfig';
import type { Suggestion } from '../types/models';
import { inWroclaw, withDistances } from './searchRank';

const memCache = new Map<string, { data: Suggestion[]; expires: number }>();
const MEM_TTL_MS = 10 * 60 * 1000;
const MEM_MAX = 100;

function memGet(key: string): Suggestion[] | null {
  const e = memCache.get(key);
  if (!e) return null;
  if (e.expires < Date.now()) {
    memCache.delete(key);
    return null;
  }
  return e.data;
}

function memSet(key: string, data: Suggestion[]): void {
  if (memCache.size >= MEM_MAX) {
    const oldest = memCache.keys().next().value;
    if (oldest) memCache.delete(oldest);
  }
  memCache.set(key, { data, expires: Date.now() + MEM_TTL_MS });
}

interface NominatimRow {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  class?: string;
  address?: Record<string, string>;
}

/** Zamienia display_name na krótki tytuł + adres w stylu serwera. Bez pozycji usera. */
function toSuggestion(row: NominatimRow): Suggestion | null {
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Ścisły filtr: obsługujemy tylko Wrocław (viewbox/bounded nie wystarczają).
  if (!inWroclaw(lat, lon)) return null;
  const parts = row.display_name.split(',').map((p) => p.trim()).filter(Boolean);
  const title = parts[0] || row.display_name;
  const address = parts.slice(1, 3).join(', ') || 'Wrocław';
  const kind = row.class === 'place' || row.type === 'bus_stop' ? 'stop' : 'address';
  return {
    id: `nominatim-${row.place_id}`,
    title,
    address,
    kind: kind as Suggestion['kind'],
    lat,
    lon,
  };
}

/** Szuka adresów/POI w Nominatim z bounding boxem Wrocławia. */
export async function searchNominatimDirect(
  query: string,
  userLat?: number,
  userLon?: number,
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  const q = query.trim();
  if (!q || q.length < 2) return [];
  // Cache BEZ pozycji (dystanse dokładamy przy zwrocie — trafienia niezależne od GPS).
  const cacheKey = `nominatim:${q.toLowerCase()}`;
  const cached = memGet(cacheKey);
  if (cached) return withDistances(cached, userLat, userLon);

  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '12',
    countrycodes: 'pl',
    viewbox: NOMINATIM.wroclawBbox,
    bounded: '1',
    addressdetails: '1',
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${NOMINATIM.baseUrl}?${params.toString()}`, {
      headers: { 'User-Agent': NOMINATIM.userAgent, Accept: 'application/json' },
      signal: signal ?? ctrl.signal,
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as NominatimRow[];
    if (!Array.isArray(rows)) return [];
    const out: Suggestion[] = [];
    for (const row of rows) {
      const s = toSuggestion(row);
      if (s) out.push(s);
    }
    memSet(cacheKey, out);
    const withDist = withDistances(out, userLat, userLon);
    // Bliższe punkty wyżej (jak w Jakdojade).
    if (userLat !== undefined && userLon !== undefined) {
      withDist.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
    }
    return withDist;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Reverse-geocode prosto z telefonu (ulica dla GPS). */
export async function reverseNominatimDirect(lat: number, lon: number): Promise<{ title: string; address: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: 'jsonv2',
      zoom: '16',
      addressdetails: '1',
    });
    const res = await fetch(`${NOMINATIM.reverseUrl}?${params.toString()}`, {
      headers: { 'User-Agent': NOMINATIM.userAgent, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const row = (await res.json()) as { display_name?: string; address?: Record<string, string> };
    if (!row?.display_name) return null;
    const parts = row.display_name.split(',').map((p) => p.trim()).filter(Boolean);
    return { title: parts[0] || 'Twoja lokalizacja', address: parts.slice(1, 3).join(', ') || 'Wrocław' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
