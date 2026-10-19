import { kvGet, kvSet } from './storage';
import { defaultLocationForCity } from '../config';
import { getActiveCityIdSync, getActiveCitySync } from './cityStore';
import { cityKey, getCity, suggestCityForCoords, type CityId } from '../cities';
import {
  mergeTripSearch,
  rankSmartDestinations,
  type TripDestinationInput,
  type TripHistoryItem,
} from './smartRanking';
import type { SavedPlace, SmartDestination } from '../types/models';

// Typ przejazdu i cała logika rankingu mieszkają w czystym module bez natywnych
// zależności (`npm run check:smart-rank` policzy je bez telefonu).
export type { TripHistoryItem } from './smartRanking';

// Klucze per-miasto ze wspólnego helpera (cities.cityKey): historia z Wrocławia
// nie może wyskakiwać na ekranie Krakowa (pozycje z innego miasta nigdy nie
// mają trasy w bazie). Wrocław trzyma klucze bez sufiksu.
const STORAGE_KEYS = {
  tripHistory: (): string => cityKey('kilometr.trip_history', getActiveCityIdSync()),
  savedPlaces: (): string => cityKey('kilometr.places', getActiveCityIdSync()),
};

const MAX_HISTORY_ITEMS = 80;
// Fallback gdy ustawień nie da się odczytać (np. pierwsze uruchomienie).
const EXCLUSION_RADIUS_FALLBACK_M = 300;

export async function loadTripHistory(): Promise<TripHistoryItem[]> {
  await ensureTripHistoryMigrated();
  return readRawHistory(STORAGE_KEYS.tripHistory());
}

/** Surowy odczyt kubełka, bez migracji (żeby migracja nie wpadła w rekurencję). */
async function readRawHistory(key: string): Promise<TripHistoryItem[]> {
  try {
    const raw = await kvGet(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [];
}

/**
 * Jednorazowa migracja historii sprzed podziału na miasta. Historia była
 * w jednym globalnym kubełku (dziś legacy klucz Wrocławia), więc leżą w nim
 * także trasy krakowskie. Przenosimy wpisy, których POCZĄTEK leży w strefie
 * innego miasta, do jego kubełka (idempotentna). Bez tego pull na ekranie
 * głównym oferowałby w Wrocławiu trasę z Krakowa, a jej wyszukanie nie ma
 * przystanków w aktywnej bazie.
 */
let historyMigration: Promise<void> | null = null;

export function ensureTripHistoryMigrated(): Promise<void> {
  if (!historyMigration) historyMigration = migrateTripHistoryToCityBuckets();
  return historyMigration;
}

async function migrateTripHistoryToCityBuckets(): Promise<void> {
  let legacy: TripHistoryItem[];
  try {
    legacy = await readRawHistory(cityKey('kilometr.trip_history', 'wroclaw'));
  } catch (err) {
    console.warn('[SmartRanker] history migration read failed:', err);
    return;
  }
  if (legacy.length === 0) return;
  const movers = new Map<CityId, TripHistoryItem[]>();
  const staying = legacy.filter((t) => {
    const hit = suggestCityForCoords(t?.origin_lat, t?.origin_lon);
    if (hit && hit.id !== 'wroclaw') {
      const list = movers.get(hit.id) ?? [];
      list.push(t);
      movers.set(hit.id, list);
      return false;
    }
    return true;
  });
  if (movers.size === 0) return;
  for (const [cityId, moved] of movers) {
    try {
      const key = cityKey('kilometr.trip_history', getCity(cityId).id);
      const existing = await readRawHistory(key);
      const have = new Set(existing.map((t) => t.id));
      const merged = [...existing, ...moved.filter((t) => !have.has(t.id))]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, MAX_HISTORY_ITEMS);
      await kvSet(key, JSON.stringify(merged));
    } catch (err) {
      console.warn('[SmartRanker] history migration write failed:', err);
      return;
    }
  }
  try {
    await kvSet(cityKey('kilometr.trip_history', 'wroclaw'), JSON.stringify(staying));
  } catch (err) {
    console.warn('[SmartRanker] history migration cleanup failed:', err);
  }
}

export async function saveTripHistory(items: TripHistoryItem[]): Promise<void> {
  try {
    await kvSet(STORAGE_KEYS.tripHistory(), JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)));
  } catch {}
}

/**
 * Zapisuje jedno sprawdzenie trasy `stąd → tam`.
 *
 * Liczy się nawyk, a nie historia wyszukiwania: powtórna kontrola tej samej
 * pary zwiększa `uses`, a wybór celu z innego miejsca tworzy osobny wpis
 * (szczegóły w `mergeTripSearch`). `measuredMinutes` to prawdziwy czas dojazdu
 * z planera — bez niego zostajemy przy `FALLBACK_TRIP_MIN`.
 */
export async function recordTripSearch(
  originLat: number,
  originLon: number,
  originTitle: string,
  dest: TripDestinationInput,
  measuredMinutes?: number,
): Promise<void> {
  if (!dest.title || typeof dest.lat !== 'number' || typeof dest.lon !== 'number') return;
  // `NaN` i `0` są fałszywe, więc `||` łapie też śmieci z deep linka.
  const cityFallback = defaultLocationForCity(getActiveCitySync().id);
  const history = await loadTripHistory();
  const updated = mergeTripSearch(
    history,
    originLat || cityFallback.lat,
    originLon || cityFallback.lon,
    originTitle,
    dest,
    measuredMinutes,
    Date.now(),
    cityFallback.address,
  );
  await saveTripHistory(updated);
}

export async function getSmartDestinationsForLocation(
  userLat: number,
  userLon: number,
  limit = 5,
): Promise<SmartDestination[]> {
  // Dystans kotwiczenia z ustawień: miejsce bliżej niż to nie jest celem —
  // skipujemy je i pokazujemy następne w rankingu.
  let exclusionRadiusM = EXCLUSION_RADIUS_FALLBACK_M;
  try {
    const { getSettingsSync } = await import('./settings');
    exclusionRadiusM = getSettingsSync().anchorRadiusM ?? EXCLUSION_RADIUS_FALLBACK_M;
  } catch {}

  // Zapisane miejsca czytamy z kubełka aktywnego miasta (ten sam klucz co
  // FavoritesService). Odsiew po bbox zostaje jako zabezpieczenie przed
  // wpisami z cudzych kubełków (np. stara kopia sprzed migracji).
  let savedPlaces: SavedPlace[] = [];
  try {
    const rawPlaces = await kvGet(STORAGE_KEYS.savedPlaces());
    if (rawPlaces) {
      const parsed = JSON.parse(rawPlaces);
      if (Array.isArray(parsed)) savedPlaces = parsed;
    }
  } catch {}

  // Historia bywa jeszcze z poprzedniego miasta (klucze per-miasto powstają dopiero
  // po zmianie). Pozycje poza granicami aktywnego miasta odrzucamy: routing nigdy
  // nie znajdzie do nich przystanku, więc podpowiedź byłaby martwa.
  const { activeBounds } = await import('./gtfsConfig');
  const bounds = activeBounds();
  const inCity = (lat: number, lon: number): boolean =>
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= bounds.minLat && lat <= bounds.maxLat &&
    lon >= bounds.minLon && lon <= bounds.maxLon;
  const history = (await loadTripHistory()).filter(
    (t) => inCity(t.dest_lat, t.dest_lon) && inCity(t.origin_lat, t.origin_lon),
  );
  savedPlaces = savedPlaces.filter((p) => inCity(p.lat, p.lon));
  return rankSmartDestinations(history, savedPlaces, userLat, userLon, Date.now(), limit, exclusionRadiusM);
}

// ─── Natychmiastowy start: cache ostatniej listy ────────────────────────────
// GPS potrafi myśleć parę sekund, więc na starcie malujemy gołe ostatnie
// miejsca z cache (bez ikon i odjazdów — te dociągają się jak zwykle),
// a gdy GPS + świeży ranking dotrą, lista zamienia się w miejscu.
const smartCacheKey = (): string => cityKey('kilometr.smart_cache.v1', getActiveCityIdSync());
const SMART_CACHE_MAX = 5;

export async function loadCachedSmartDestinations(): Promise<SmartDestination[]> {
  try {
    const raw = await kvGet(smartCacheKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { items?: SmartDestination[] };
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items
      .filter((d) => d && typeof d.id === 'string' && typeof d.lat === 'number' && typeof d.lon === 'number')
      .slice(0, SMART_CACHE_MAX);
  } catch {
    return [];
  }
}

export async function saveCachedSmartDestinations(items: SmartDestination[]): Promise<void> {
  try {
    if (!Array.isArray(items) || items.length === 0) return;
    await kvSet(smartCacheKey(), JSON.stringify({ savedAt: Date.now(), items: items.slice(0, SMART_CACHE_MAX) }));
  } catch {}
}
