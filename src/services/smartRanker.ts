import { kvGet, kvSet } from './storage';
import { distanceMeters } from '../gtfs/geo';
import { DEFAULT_LOCATION } from '../config';
import type { SavedPlace, SmartDestination } from '../types/models';

export interface TripHistoryItem {
  id: string;
  origin_title: string;
  origin_lat: number;
  origin_lon: number;
  dest_id: string;
  dest_title: string;
  dest_address: string;
  dest_lat: number;
  dest_lon: number;
  duration_min: number;
  timestamp: number;
}

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
const CLUSTER_RADIUS_M = 1600;
const EXCLUSION_RADIUS_M = 250;

export async function loadTripHistory(): Promise<TripHistoryItem[]> {
  try {
    const raw = await kvGet(STORAGE_KEYS.TRIP_HISTORY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  // Seed trips przy pierwszym uruchomieniu
  await saveTripHistory(SEED_TRIPS);
  return SEED_TRIPS;
}

export async function saveTripHistory(items: TripHistoryItem[]): Promise<void> {
  try {
    await kvSet(STORAGE_KEYS.TRIP_HISTORY, JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)));
  } catch {}
}

export async function recordTripSearch(
  originLat: number,
  originLon: number,
  originTitle: string,
  dest: { id: string; title: string; address?: string; lat: number; lon: number },
  durationMin = 18,
): Promise<void> {
  if (!dest.title || typeof dest.lat !== 'number' || typeof dest.lon !== 'number') return;
  const history = await loadTripHistory();
  const id = `trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const item: TripHistoryItem = {
    id,
    origin_title: originTitle || 'Wrocław',
    origin_lat: originLat || DEFAULT_LOCATION.lat,
    origin_lon: originLon || DEFAULT_LOCATION.lon,
    dest_id: dest.id || dest.title,
    dest_title: dest.title,
    dest_address: dest.address || 'Wrocław',
    dest_lat: dest.lat,
    dest_lon: dest.lon,
    duration_min: durationMin,
    timestamp: Date.now(),
  };

  const updated = [item, ...history.filter((h) => h.dest_id !== dest.id && h.dest_title !== dest.title)];
  await saveTripHistory(updated);
}

export async function getSmartDestinationsForLocation(
  userLat: number,
  userLon: number,
  limit = 4,
): Promise<SmartDestination[]> {
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 3600 * 1000;
  const oneMonthAgo = now - 30 * 24 * 3600 * 1000;

  // 1. Zapisane miejsca użytkownika
  let savedPlaces: SavedPlace[] = [];
  try {
    const rawPlaces = await kvGet(STORAGE_KEYS.SAVED_PLACES);
    if (rawPlaces) {
      savedPlaces = JSON.parse(rawPlaces);
    }
  } catch {}
  if (!savedPlaces || savedPlaces.length === 0) {
    savedPlaces = INITIAL_SAVED_PLACES;
    await kvSet(STORAGE_KEYS.SAVED_PLACES, JSON.stringify(savedPlaces));
  }

  // 2. Wykryj, czy użytkownik jest blisko któregoś z zapisanych miejsc
  let currentContextPlace: SavedPlace | null = null;
  for (const place of savedPlaces) {
    if (typeof place.lat === 'number' && typeof place.lon === 'number') {
      const dist = distanceMeters(userLat, userLon, place.lat, place.lon);
      if (dist <= 350) {
        currentContextPlace = place;
        break;
      }
    }
  }

  const originId = currentContextPlace ? currentContextPlace.placeId || currentContextPlace.id : 'current-gps';

  // 3. Historia przejazdów
  const history = await loadTripHistory();
  const recentMonthTrips = history.filter((t) => t.timestamp >= oneMonthAgo);

  // Filtrujemy przejazdy z okolic bieżącej pozycji
  let nearbyTrips = recentMonthTrips.filter((t) => {
    const dist = distanceMeters(userLat, userLon, t.origin_lat, t.origin_lon);
    return dist <= CLUSTER_RADIUS_M;
  });

  // Jeśli brak przejazdów z tego punktu, użyj globalnej historii jako bazy,
  // żeby użytkownik NIGDY nie widział pustej sekcji "Ostatnie miejsca"
  if (nearbyTrips.length === 0) {
    nearbyTrips = recentMonthTrips.length > 0 ? recentMonthTrips : history;
  }

  // 4. Agregacja kandydatów destynacji
  interface CandidateStats {
    id: string;
    title: string;
    address: string;
    lat: number;
    lon: number;
    weeklyCount: number;
    totalCount: number;
    lastTimestamp: number;
    avgDurationMin: number;
    isSavedPlace: boolean;
  }

  const candidateMap = new Map<string, CandidateStats>();

  for (const t of nearbyTrips) {
    // Nie sugeruj miejsca, w którym użytkownik już się znajduje (<250 m)
    const distToDest = distanceMeters(userLat, userLon, t.dest_lat, t.dest_lon);
    if (distToDest <= EXCLUSION_RADIUS_M) continue;

    // Nie sugeruj miejsca kontekstowego
    if (currentContextPlace && (t.dest_id === currentContextPlace.id || t.dest_id === currentContextPlace.placeId)) {
      continue;
    }

    const key = t.dest_id || t.dest_title;
    let cand = candidateMap.get(key);
    if (!cand) {
      cand = {
        id: t.dest_id,
        title: t.dest_title,
        address: t.dest_address,
        lat: t.dest_lat,
        lon: t.dest_lon,
        weeklyCount: 0,
        totalCount: 0,
        lastTimestamp: t.timestamp,
        avgDurationMin: t.duration_min || 18,
        isSavedPlace: false,
      };
      candidateMap.set(key, cand);
    }

    cand.totalCount += 1;
    if (t.timestamp >= oneWeekAgo) {
      cand.weeklyCount += 1;
    }
    if (t.timestamp > cand.lastTimestamp) {
      cand.lastTimestamp = t.timestamp;
    }
  }

  // 5. Bonus dla zapisanych miejsc (np. Dom, Praca, Szkoła)
  for (const place of savedPlaces) {
    if (currentContextPlace && place.id === currentContextPlace.id) continue;
    const distToDest = distanceMeters(userLat, userLon, place.lat, place.lon);
    if (distToDest <= EXCLUSION_RADIUS_M) continue;

    const key = place.placeId || place.id;
    let cand = candidateMap.get(key);
    if (!cand) {
      cand = {
        id: place.placeId || place.id,
        title: place.name,
        address: place.address,
        lat: place.lat,
        lon: place.lon,
        weeklyCount: 3,
        totalCount: 5,
        lastTimestamp: now - 12 * 3600 * 1000,
        avgDurationMin: 20,
        isSavedPlace: true,
      };
      candidateMap.set(key, cand);
    } else {
      cand.isSavedPlace = true;
    }
  }

  // 6. Ranking
  const scored = Array.from(candidateMap.values()).map((cand) => {
    const hoursSinceLast = (now - cand.lastTimestamp) / (3600 * 1000);
    const recencyBoost = Math.max(0, 8 - hoursSinceLast / 12);
    const savedBonus = cand.isSavedPlace ? 12 : 0;
    const score = cand.weeklyCount * 4 + cand.totalCount * 1.5 + savedBonus + recencyBoost;
    const frequency = Math.max(1, cand.weeklyCount > 0 ? cand.weeklyCount : Math.round(cand.totalCount / 3));

    return {
      cand,
      score,
      frequency,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ cand, frequency }) => ({
    id: cand.id,
    title: cand.title,
    address: cand.address,
    frequency,
    avgDurationMin: cand.avgDurationMin,
    lat: cand.lat,
    lon: cand.lon,
    originId,
  }));
}
