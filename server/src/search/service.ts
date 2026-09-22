import { getDb } from '../db';
import { gtfsStore } from '../gtfs/store';
import { distanceMeters, normalizePolish } from '../gtfs/geo';
import { searchNominatim } from './nominatim';
import { ensurePoiIndex, searchPois } from './poiIndex';
import { fuzzyMatch } from './fuzzy';
import { Suggestion } from './types';
import { config } from '../config';

// Pamięciowy cache najczęstszych zapytań (przed SQLite — podpowiedzi "śmigają").
const memCache = new Map<string, { data: Suggestion[]; expires: number }>();
const MEM_CACHE_TTL_MS = 10 * 60 * 1000;
const MEM_CACHE_MAX = 300;

// Generacja zapytań: gdy użytkownik pisze, starsze zapytania still waiting
// na rate-limit Nominatim są przestarzałe — zwracają od razu same przystanki
// GTFS zamiast blokować kolejkę i opóźniać aktualne zapytanie.
let searchGen = 0;

function memGet(key: string): Suggestion[] | null {
  const e = memCache.get(key);
  if (!e) return null;
  if (e.expires < Date.now()) {
    memCache.delete(key);
    return null;
  }
  return e.data;
}

function memSet(key: string, data: Suggestion[]) {
  if (memCache.size >= MEM_CACHE_MAX) {
    const oldest = memCache.keys().next().value;
    if (oldest) memCache.delete(oldest);
  }
  memCache.set(key, { data, expires: Date.now() + MEM_CACHE_TTL_MS });
}

export async function searchSuggestions(
  query: string,
  userLat?: number,
  userLon?: number
): Promise<Suggestion[]> {
  const q = query.trim();
  if (!q) return [];
  const myGen = ++searchGen;

  const normQ = normalizePolish(q);
  // v2: tytuły z numerami domów + dedupe ze współrzędnymi (stare wpisy ignorowane)
  const cacheKey = `search:v2:${normQ}`;
  const now = Date.now();
  const hasUserPos = userLat !== undefined && userLon !== undefined;
  const isFresh = () => myGen === searchGen;

  const db = getDb();

  // 1. Lokalne źródła (synchroniczne, in-memory — zawsze natychmiast):
  // przystanki GTFS + indeks miejsc (POI) Wrocławia. Liczone ZAWSZE świeżo,
  // także przy trafieniu w cache Nominatim.
  ensurePoiIndex(); // leniwy trigger odświeżania Overpass w tle, nie blokuje
  await gtfsStore.load();
  const stopMatches = gtfsStore.searchStops(q, 6);
  const stopSuggestions: Suggestion[] = stopMatches.map(({ stop, weight }) => ({
    id: `stop-${stop.stop_id}`,
    title: stop.stop_name,
    address: `Przystanek • ${stop.stop_code ? `słup. ${stop.stop_code}` : 'Wrocław'}`,
    kind: 'stop' as const,
    weight,
    lat: stop.stop_lat,
    lon: stop.stop_lon,
    distanceM:
      hasUserPos && userLat !== undefined && userLon !== undefined
        ? Math.round(distanceMeters(userLat, userLon, stop.stop_lat, stop.stop_lon))
        : undefined,
  }));

  const poiSuggestions: Suggestion[] = searchPois(q, userLat, userLon, 8);
  const localSuggestions = [...stopSuggestions, ...poiSuggestions];

  // 2. Nominatim: najpierw cache (pamięć, potem SQLite), potem sieć.
  // Przestarzałe zapytanie nie dostaje slotu rate-limitu i zwraca [] —
  // frontend i tak je anulował, a pusta odpowiedź nie nadpisze nic gorszego.
  // Sieć omijamy też gdy lokalny indeks już daje dobre wyniki, a query nie
  // wygląda na adres (adresy z numerami są domeną Nominatim).
  const looksLikeAddress = /\d/.test(normQ);
  let nominatimSuggestions: Suggestion[] | null = memGet(cacheKey);
  let hasCache = nominatimSuggestions != null;

  if (!hasCache) {
    const cacheRow = db
      .prepare('SELECT response_json, expires_at FROM search_cache WHERE cache_key = ?')
      .get(cacheKey) as { response_json: string; expires_at: number } | undefined;
    if (cacheRow && cacheRow.expires_at > now) {
      try {
        nominatimSuggestions = JSON.parse(cacheRow.response_json);
        hasCache = true;
        memSet(cacheKey, nominatimSuggestions ?? []);
      } catch {
        nominatimSuggestions = [];
      }
    }
  }

  if (!hasCache) {
    const needNetwork = looksLikeAddress || localSuggestions.length < 5;
    if (needNetwork && isFresh()) {
      nominatimSuggestions = await searchNominatim(q, isFresh);
      if (!isFresh()) return []; // w międzyczasie przyszło nowsze — nic nie zwracaj
      if ((nominatimSuggestions?.length ?? 0) > 0) {
        const expiresAt = now + config.nominatim.cacheTtlMs;
        try {
          db.prepare(
            'INSERT OR REPLACE INTO search_cache (cache_key, response_json, expires_at) VALUES (?, ?, ?)'
          ).run(cacheKey, JSON.stringify(nominatimSuggestions), expiresAt);
        } catch {
          // cache opcjonalny
        }
        memSet(cacheKey, nominatimSuggestions ?? []);
      }
    } else if (!isFresh()) {
      return [];
    } else {
      nominatimSuggestions = [];
    }
  }

  // 3. Merge: świeże lokalne + (ew.) Nominatim, dystanse przed sortowaniem.
  const nominatimWithDist = withDistances(nominatimSuggestions ?? [], userLat, userLon);
  const combined = dedupeAndSort(localSuggestions, nominatimWithDist, hasUserPos, normQ);
  return combined.slice(0, 15);
}

/** Odległości liczone na końcu (cache trzyma surowe wyniki bez pozycji usera). */
function withDistances(
  items: Suggestion[],
  userLat?: number,
  userLon?: number
): Suggestion[] {
  if (userLat === undefined || userLon === undefined) return items;
  return items.map((item) => ({
    ...item,
    distanceM: Math.round(distanceMeters(userLat, userLon, item.lat, item.lon)),
  }));
}

function dedupeAndSort(
  local: Suggestion[],
  nominatim: Suggestion[],
  hasUserPos: boolean,
  normQ?: string
): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const item of [...local, ...nominatim]) {
    // Deduplikacja ze współrzędnymi (~100 m): te same sieciówki w różnych
    // częściach miasta (Lidl, Biedronka) MUSZĄ przetrwać jako osobne wyniki,
    // a ten sam obiekt z dwóch źródeł (POI + Nominatim) scala się w jeden.
    const key = `${normalizePolish(item.title)}-${item.category || item.kind}-${item.lat.toFixed(3)}-${item.lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  // Zapytanie z numerem ("grabiszyńska 309") = szukanie adresu:
  // dokładne adresy najpierw, potem reszta wg odległości.
  const wantsAddress = normQ ? /\d/.test(normQ) : false;
  // Rank: jakość dopasowania nazwy PRZED odległością (fuzzy wyniki Nominatim
  // nie mogą wyprzedzać dokładnych trafień), potem kara za dystans.
  const nameScore = (s: Suggestion): number => {
    if (!normQ) return 0;
    const match = fuzzyMatch(normQ, s.title);
    if (match.matches) return match.score;
    if (s.address) {
      const addrMatch = fuzzyMatch(normQ, s.address);
      if (addrMatch.matches) return Math.max(30, addrMatch.score - 15);
    }
    return 10;
  };
  const distPenalty = (s: Suggestion): number =>
    hasUserPos ? Math.min(40, (s.distanceM ?? Infinity) / 250) : 0;

  out.sort((a, b) => {
    // 1. Absolutny priorytet dla przystanków
    const aIsStop = a.kind === 'stop' ? 1 : 0;
    const bIsStop = b.kind === 'stop' ? 1 : 0;
    if (aIsStop !== bIsStop) return bIsStop - aIsStop; // przystanki na górze

    // 2. Dokładne adresy na górze, jeśli zapytanie wygląda jak adres (z numerem)
    if (wantsAddress) {
      const aAddr = a.kind === 'address' ? 0 : 1;
      const bAddr = b.kind === 'address' ? 0 : 1;
      if (aAddr !== bAddr) return aAddr - bAddr;
    }

    // 3. Score wg nazwy (priorytet) - kara za dystans + nagroda za popularność przystanku
    const weightBonus = (s: Suggestion): number => (s.weight ?? 0) / 100;
    
    const scoreA = nameScore(a) - distPenalty(a) + weightBonus(a);
    const scoreB = nameScore(b) - distPenalty(b) + weightBonus(b);
    
    return scoreB - scoreA;
  });
  return out;
}
