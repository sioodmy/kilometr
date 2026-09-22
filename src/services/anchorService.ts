import type { SavedPlace } from '../types/models';

const EARTH_RADIUS_METERS = 6371000;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

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
