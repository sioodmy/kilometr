import { kvGet, kvSet } from './storage';
import { defaultLocation } from '../config';
import { tr } from '../i18n';
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


const STORAGE_KEYS = {
  TRIP_HISTORY: 'kilometr.trip_history',
  SAVED_PLACES: 'kilometr.places',
};

const MAX_HISTORY_ITEMS = 80;
// Fallback gdy ustawień nie da się odczytać (np. pierwsze uruchomienie).
const EXCLUSION_RADIUS_FALLBACK_M = 300;

export async function loadTripHistory(): Promise<TripHistoryItem[]> {
  try {
    const raw = await kvGet(STORAGE_KEYS.TRIP_HISTORY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [];
}

export async function saveTripHistory(items: TripHistoryItem[]): Promise<void> {
  try {
    await kvSet(STORAGE_KEYS.TRIP_HISTORY, JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)));
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
  const history = await loadTripHistory();
  const updated = mergeTripSearch(
    history,
    originLat || defaultLocation().lat,
    originLon || defaultLocation().lon,
    originTitle,
    dest,
    measuredMinutes,
    Date.now(),
    // Nazwa aktywnego miasta w bieżącym języku — zamiast literału
    // „Wrocław", który w Krakowie podpisywałby historię złym miastem.
    tr().cityName,
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

  // Zapisane miejsca użytkownika (ten sam klucz co w FavoritesService).
  let savedPlaces: SavedPlace[] = [];
  try {
    const rawPlaces = await kvGet(STORAGE_KEYS.SAVED_PLACES);
    if (rawPlaces) {
      const parsed = JSON.parse(rawPlaces);
      if (Array.isArray(parsed)) savedPlaces = parsed;
    }
  } catch {}

  const history = await loadTripHistory();
  return rankSmartDestinations(history, savedPlaces, userLat, userLon, Date.now(), limit, exclusionRadiusM);
}

// ─── Natychmiastowy start: cache ostatniej listy ────────────────────────────
// GPS potrafi myśleć parę sekund, więc na starcie malujemy gołe ostatnie
// miejsca z cache (bez ikon i odjazdów — te dociągają się jak zwykle),
// a gdy GPS + świeży ranking dotrą, lista zamienia się w miejscu.
const SMART_CACHE_KEY = 'kilometr.smart_cache.v1';
const SMART_CACHE_MAX = 5;

export async function loadCachedSmartDestinations(): Promise<SmartDestination[]> {
  try {
    const raw = await kvGet(SMART_CACHE_KEY);
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
    await kvSet(SMART_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items: items.slice(0, SMART_CACHE_MAX) }));
  } catch {}
}
