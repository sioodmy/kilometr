import { kvGet, kvSet } from './storage';
import { DEFAULT_LOCATION } from '../config';
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

export const INITIAL_SAVED_PLACES: SavedPlace[] = [
  {
    id: 'home',
    name: 'Dom',
    icon: 'home',
    placeId: 'swojczycka',
    address: 'Swojczycka 41, Wrocław',
    lat: 51.1085,
    lon: 17.1021,
  },
  {
    id: 'school',
    name: 'Szkoła',
    icon: 'school',
    placeId: 'pwr',
    address: 'Politechnika Wrocławska, Wybrzeże Wyspiańskiego',
    lat: 51.1079,
    lon: 17.0617,
  },
  {
    id: 'work',
    name: 'Praca',
    icon: 'work',
    placeId: 'sky-tower',
    address: 'Sky Tower, Powstańców Śląskich 95',
    lat: 51.0938,
    lon: 17.0196,
  },
  {
    id: 'gym',
    name: 'Siłownia',
    icon: 'gym',
    placeId: 'magnolia',
    address: 'Magnolia Park, Legnicka 58',
    lat: 51.1181,
    lon: 16.9946,
  },
];

export const SEED_TRIPS: TripHistoryItem[] = [
  // Z pracy (Sky Tower: 51.0938, 17.0196) -> Dom (Swojczyce)
  ...Array.from({ length: 12 }).map((_, i) => ({
    id: `seed-work-home-${i}`,
    origin_title: 'Praca (Sky Tower)',
    origin_lat: 51.0938,
    origin_lon: 17.0196,
    dest_id: 'swojczycka',
    dest_title: 'Dom',
    dest_address: 'Swojczycka 41, Wrocław',
    dest_lat: 51.1085,
    dest_lon: 17.1021,
    duration_min: 22,
    timestamp: Date.now() - i * 18 * 3600 * 1000,
  })),
  // Z pracy -> Siłownia (Magnolia)
  ...Array.from({ length: 6 }).map((_, i) => ({
    id: `seed-work-gym-${i}`,
    origin_title: 'Praca (Sky Tower)',
    origin_lat: 51.0938,
    origin_lon: 17.0196,
    dest_id: 'magnolia',
    dest_title: 'Siłownia',
    dest_address: 'Magnolia Park, Legnicka 58',
    dest_lat: 51.1181,
    dest_lon: 16.9946,
    duration_min: 18,
    timestamp: Date.now() - i * 36 * 3600 * 1000,
  })),
  // Z domu (Swojczyce: 51.1085, 17.1021) -> Praca
  ...Array.from({ length: 14 }).map((_, i) => ({
    id: `seed-home-work-${i}`,
    origin_title: 'Dom (Swojczyce)',
    origin_lat: 51.1085,
    origin_lon: 17.1021,
    dest_id: 'sky-tower',
    dest_title: 'Praca',
    dest_address: 'Sky Tower, Powstańców Śląskich 95',
    dest_lat: 51.0938,
    dest_lon: 17.0196,
    duration_min: 25,
    timestamp: Date.now() - i * 16 * 3600 * 1000,
  })),
  // Z domu -> Uczelnia (PWr)
  ...Array.from({ length: 8 }).map((_, i) => ({
    id: `seed-home-pwr-${i}`,
    origin_title: 'Dom (Swojczyce)',
    origin_lat: 51.1085,
    origin_lon: 17.1021,
    dest_id: 'pwr',
    dest_title: 'Szkoła',
    dest_address: 'Politechnika Wrocławska, Wybrzeże Wyspiańskiego',
    dest_lat: 51.1079,
    dest_lon: 17.0617,
    duration_min: 16,
    timestamp: Date.now() - i * 24 * 3600 * 1000,
  })),
  // Z Dworca Głównego (51.0997, 17.0364) -> Rynek
  ...Array.from({ length: 9 }).map((_, i) => ({
    id: `seed-dworzec-rynek-${i}`,
    origin_title: 'Dworzec Główny',
    origin_lat: 51.0997,
    origin_lon: 17.0364,
    dest_id: 'poi-rynek',
    dest_title: 'Rynek',
    dest_address: 'Rynek, Wrocław',
    dest_lat: 51.1079,
    dest_lon: 17.0385,
    duration_min: 10,
    timestamp: Date.now() - i * 20 * 3600 * 1000,
  })),
  // Z Rynku -> Dworzec Główny
  ...Array.from({ length: 7 }).map((_, i) => ({
    id: `seed-rynek-dworzec-${i}`,
    origin_title: 'Rynek',
    origin_lat: 51.1079,
    origin_lon: 17.0385,
    dest_id: 'seed-dworzec',
    dest_title: 'Dworzec Główny',
    dest_address: 'Piłsudskiego 105, Wrocław',
    dest_lat: 51.0997,
    dest_lon: 17.0364,
    duration_min: 12,
    timestamp: Date.now() - i * 28 * 3600 * 1000,
  })),
  // Z Placu Grunwaldzkiego (51.1120, 17.0640) -> Rynek
  ...Array.from({ length: 6 }).map((_, i) => ({
    id: `seed-grunwald-rynek-${i}`,
    origin_title: 'Pl. Grunwaldzki',
    origin_lat: 51.1120,
    origin_lon: 17.0640,
    dest_id: 'poi-rynek',
    dest_title: 'Rynek',
    dest_address: 'Rynek, Wrocław',
    dest_lat: 51.1079,
    dest_lon: 17.0385,
    duration_min: 12,
    timestamp: Date.now() - i * 32 * 3600 * 1000,
  })),
];

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
    originLat || DEFAULT_LOCATION.lat,
    originLon || DEFAULT_LOCATION.lon,
    originTitle,
    dest,
    measuredMinutes,
    Date.now(),
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
