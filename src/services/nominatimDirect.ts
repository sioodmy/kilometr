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
  name?: string;
  address?: Record<string, string>;
}

/** Numer domu stoi w display_name na pierwszym miejscu ("1, Różana, ..."). */
function isHouseNumber(part: string): boolean {
  return /^\d+[A-Za-z]?(?:\/\d+[A-Za-z]?)?$/.test(part.trim());
}

/** Zamienia display_name na krótki tytuł + adres w stylu serwera. Bez pozycji usera. */
function toSuggestion(row: NominatimRow): Suggestion | null {
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Ścisły filtr: obsługujemy tylko Wrocław (viewbox/bounded nie wystarczają).
  if (!inWroclaw(lat, lon)) return null;
  const addr = row.address ?? {};
  const road = addr.road || addr.pedestrian || addr.residential || addr.footway || addr.cycleway;
  const houseNo = addr.house_number;
  const parts = row.display_name.split(',').map((p) => p.trim()).filter(Boolean);
  let title: string;
  let address: string;
  if (road && houseNo) {
    title = `${road} ${houseNo}`;
    address = parts.filter((p) => p !== road && p !== houseNo).slice(0, 2).join(', ') || 'Wrocław';
  } else if (row.name) {
    title = row.name;
    address = parts.slice(1, 3).join(', ') || 'Wrocław';
  } else if (parts.length >= 2 && isHouseNumber(parts[0])) {
    title = `${parts[1]} ${parts[0]}`;
    address = parts.slice(2, 4).join(', ') || 'Wrocław';
  } else {
    title = parts[0] || row.display_name;
    address = parts.slice(1, 3).join(', ') || 'Wrocław';
  }
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

/**
 * Sygnał, który przerwie żądanie po `timeoutMs` ALBO po przerwaniu `outer`.
 *
 * Wcześniejsza wersja robiła `signal: signal ?? ctrl.signal` i odpalała
 * `setTimeout(() => ctrl.abort(), 5000)` na kontrolerze, którego nikt nie
 * podpiął do żądania. Każdy wywołujący przekazuje własny sygnał, więc limit
 * czasu nigdy nie zadziałał, a wiszące połączenie z Nominatim zostawiało
 * wyszukiwarkę bez wyników na zawsze.
 */
function scopedSignal(timeoutMs: number, outer?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const ctrl = new AbortController();
  const onOuter = () => ctrl.abort();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // Sygnał przychodzący już przerwany musi zadziałać natychmiast.
  if (outer?.aborted) ctrl.abort();
  else outer?.addEventListener('abort', onOuter);
  return {
    signal: ctrl.signal,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuter);
    },
  };
}

/** Szuka adresów/POI w Nominatim z bounding boxem Wrocławia. */
export async function searchNominatimDirect(
  query: string,
  userLat?: number,
  userLon?: number,
  outer?: AbortSignal,
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
  const scope = scopedSignal(5000, outer);
  try {
    const res = await fetch(`${NOMINATIM.baseUrl}?${params.toString()}`, {
      headers: { 'User-Agent': NOMINATIM.userAgent, Accept: 'application/json' },
      signal: scope.signal,
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
    scope.dispose();
  }
}

/** Reverse-geocode prosto z telefonu (ulica dla GPS + miejscowość do karty strefy). */
export async function reverseNominatimDirect(
  lat: number,
  lon: number,
): Promise<{ title: string; address: string; city: string | null } | null> {
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
    const row = (await res.json()) as {
      display_name?: string;
      address?: Record<string, string>;
    };
    if (!row?.display_name) return null;
    const parts = row.display_name.split(',').map((p) => p.trim()).filter(Boolean);
    const addr = row.address ?? {};
    const road = addr.road || addr.pedestrian || addr.residential || addr.footway || addr.cycleway;
    const houseNo = addr.house_number;
    // Miejscowość do komunikatu „Twoja lokalizacja GPS wskazuje na …":
    // pierwsze trafienie z hierarchii OSM, z pominięciem dzielnic/przedmieść.
    const city =
      addr.city ||
      addr.town ||
      addr.village ||
      addr.municipality ||
      addr.city_district ||
      addr.suburb ||
      addr.county ||
      addr.state ||
      null;
    if (road && houseNo) {
      return {
        title: `${road} ${houseNo}`,
        address: parts.filter((p) => p !== road && p !== houseNo).slice(0, 2).join(', ') || 'Wrocław',
        city,
      };
    }
    if (parts.length >= 2 && /^\d+[A-Za-z]?(?:\/\d+[A-Za-z]?)?$/.test(parts[0])) {
      return {
        title: `${parts[1]} ${parts[0]}`,
        address: parts.slice(2, 4).join(', ') || 'Wrocław',
        city,
      };
    }
    return {
      title: parts[0] || 'Twoja lokalizacja',
      address: parts.slice(1, 3).join(', ') || 'Wrocław',
      city,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
