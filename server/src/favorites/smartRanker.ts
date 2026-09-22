import { getDb } from '../db';
import { distanceMeters } from '../gtfs/geo';
import { config } from '../config';

export interface SmartDestination {
  id: string;
  title: string;
  address: string;
  frequency: number;
  avgDurationMin: number;
  lat: number;
  lon: number;
  originId: string;
}

interface SavedPlaceRow {
  id: string;
  name: string;
  icon: string;
  place_id: string;
  address: string;
  lat: number;
  lon: number;
}

interface TripRow {
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

/** Record a route query to continuously train the frequency matrix per origin location */
export function recordTripSearch(
  originLat: number,
  originLon: number,
  originTitle: string,
  dest: { id: string; title: string; address?: string; lat: number; lon: number },
  durationMin = 15
) {
  const db = getDb();
  const id = `trip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const address = dest.address || 'Wrocław';

  db.prepare(`
    INSERT INTO trip_history (
      id, origin_title, origin_lat, origin_lon,
      dest_id, dest_title, dest_address,
      dest_lat, dest_lon, duration_min, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    originTitle,
    originLat,
    originLon,
    dest.id,
    dest.title,
    address,
    dest.lat,
    dest.lon,
    durationMin,
    Date.now()
  );
}

/**
 * Intelligent "Frequent from this location" ranker.
 * Ranks destinations based on user's current GPS position, origin clustering radius,
 * context detection (e.g. at Work -> recommend Home/Gym; at Home -> recommend Work/School),
 * and frequency/recency scoring.
 */
export function getSmartDestinationsForLocation(
  userLat: number,
  userLon: number,
  limit = 5
): SmartDestination[] {
  const db = getDb();
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 3600 * 1000;
  const oneMonthAgo = now - 30 * 24 * 3600 * 1000;

  // 1. Fetch all user saved places
  const savedPlaces = db.prepare('SELECT * FROM saved_places').all() as unknown as SavedPlaceRow[];

  // 2. Detect current location context: is the user at/near a known saved place?
  let currentContextPlace: SavedPlaceRow | null = null;
  for (const place of savedPlaces) {
    const dist = distanceMeters(userLat, userLon, place.lat, place.lon);
    if (dist <= config.smartRanking.currentPlaceRadiusMeters) {
      currentContextPlace = place;
      break;
    }
  }

  const originId = currentContextPlace ? currentContextPlace.place_id : 'current-gps';

  // 3. Fetch trips initiated within cluster radius of user's current GPS
  const trips = db
    .prepare('SELECT * FROM trip_history WHERE timestamp >= ?')
    .all(oneMonthAgo) as unknown as TripRow[];

  const nearbyTrips = trips.filter((t) => {
    const dist = distanceMeters(userLat, userLon, t.origin_lat, t.origin_lon);
    return dist <= config.smartRanking.originClusterRadiusMeters;
  });

  // 4. Candidate destination map: dest_id -> aggregated stats
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

  // Aggregate historical trips from this origin area
  for (const t of nearbyTrips) {
    // Proximity check: skip if destination is within exclusion radius of current GPS
    const distToDest = distanceMeters(userLat, userLon, t.dest_lat, t.dest_lon);
    if (distToDest <= config.smartRanking.destinationExclusionRadiusMeters) {
      continue;
    }

    // Skip if destination is the current saved place
    if (currentContextPlace && (t.dest_id === currentContextPlace.place_id || t.dest_id === currentContextPlace.id)) {
      continue;
    }

    let cand = candidateMap.get(t.dest_id);
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
        avgDurationMin: t.duration_min,
        isSavedPlace: false,
      };
      candidateMap.set(t.dest_id, cand);
    }

    cand.totalCount += 1;
    if (t.timestamp >= oneWeekAgo) {
      cand.weeklyCount += 1;
    }
    if (t.timestamp > cand.lastTimestamp) {
      cand.lastTimestamp = t.timestamp;
    }
  }

  // Complementary Saved Places bonus
  // When at work -> Home & Gym are strong candidates
  // When at home -> Work & School are strong candidates
  for (const place of savedPlaces) {
    // Exclude if it is current place
    if (currentContextPlace && place.id === currentContextPlace.id) continue;

    const distToDest = distanceMeters(userLat, userLon, place.lat, place.lon);
    if (distToDest <= config.smartRanking.destinationExclusionRadiusMeters) continue;

    let cand = candidateMap.get(place.place_id) || candidateMap.get(place.id);
    if (!cand) {
      cand = {
        id: place.place_id,
        title: place.name,
        address: place.address,
        lat: place.lat,
        lon: place.lon,
        weeklyCount: 3, // baseline weekly expectation
        totalCount: 5,
        lastTimestamp: now - 24 * 3600 * 1000,
        avgDurationMin: 18,
        isSavedPlace: true,
      };
      candidateMap.set(place.place_id, cand);
    } else {
      cand.isSavedPlace = true;
    }
  }

  // 5. Score and rank candidates
  const scored = Array.from(candidateMap.values()).map((cand) => {
    // Recency boost (up to 5 points if queried in the last 48h)
    const hoursSinceLast = (now - cand.lastTimestamp) / (3600 * 1000);
    const recencyBoost = Math.max(0, 5 - hoursSinceLast / 12);

    // Saved place context boost
    const savedBonus = cand.isSavedPlace ? 10 : 0;

    const score = cand.weeklyCount * 4 + cand.totalCount * 1.5 + savedBonus + recencyBoost;

    // Frequency display (e.g. 14x / week)
    const frequency = Math.max(1, cand.weeklyCount > 0 ? cand.weeklyCount : Math.round(cand.totalCount / 4));

    return {
      cand,
      score,
      frequency,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  // 6. Return top candidates formatted as SmartDestination
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
