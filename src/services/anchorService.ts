import type { SavedPlace } from '../types/models';
import { distanceMeters } from '../gtfs/geo';

export interface ActiveAnchor {
  placeId: string;
  placeName: string;
  stopId?: string;
  stopName: string;
  lat: number;
  lon: number;
  distanceM: number;
  rawGps: {
    title: string;
    lat: number;
    lon: number;
  };
}

/**
 * Sprawdza czy podane współrzędne (np. GPS użytkownika) znajdują się w promieniu kotwiczenia
 * od któregoś z zapisanych miejsc. Jeśli tak, zwraca dane zakotwiczonego przystanku.
 */
export function findAnchorForLocation(
  lat: number,
  lon: number,
  title: string,
  places: SavedPlace[],
  radiusM: number,
  dismissedPlaceIds?: Set<string>
): ActiveAnchor | null {
  if (!lat || !lon || !places || places.length === 0) return null;

  let bestPlace: SavedPlace | null = null;
  let bestDist = Infinity;

  for (const place of places) {
    if (dismissedPlaceIds) {
      if (dismissedPlaceIds.has(place.id) || (place.placeId && dismissedPlaceIds.has(place.placeId))) {
        continue;
      }
    }
    const d = distanceMeters(lat, lon, place.lat, place.lon);
    if (d <= radiusM && d < bestDist) {
      bestDist = d;
      bestPlace = place;
    }
  }

  if (!bestPlace) return null;

  const stopName = bestPlace.anchorStopName || bestPlace.name;
  const stopId = bestPlace.anchorStopId || bestPlace.placeId;
  const stopLat = bestPlace.anchorStopLat ?? bestPlace.lat;
  const stopLon = bestPlace.anchorStopLon ?? bestPlace.lon;

  return {
    placeId: bestPlace.id,
    placeName: bestPlace.name,
    stopId,
    stopName,
    lat: stopLat,
    lon: stopLon,
    distanceM: Math.round(bestDist),
    rawGps: {
      title,
      lat,
      lon,
    },
  };
}
