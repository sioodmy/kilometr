import { GtfsStore } from '../gtfs/store';
import { bearingDegrees, projectPointToPolyline } from '../gtfs/geo';

export interface VehicleMatch {
  vehicleId: string;
  line: string;
  lat: number;
  lon: number;
  type: 'bus' | 'tram';
  heading?: number;
  matchedTripId?: string;
  delaySec: number;
  currentStopName?: string;
  nextStopName?: string;
  updatedAt: number;
}

export function matchVehicleToSchedule(
  store: GtfsStore,
  raw: { name: string; type: string; x: number; y: number; k: number },
  prevLat?: number,
  prevLon?: number
): VehicleMatch {
  const line = raw.name.trim().toUpperCase();
  const lat = raw.x;
  const lon = raw.y;
  const vehicleId = `${line}-${raw.k}`;
  const now = new Date();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  let heading: number | undefined;
  if (prevLat !== undefined && prevLon !== undefined) {
    heading = bearingDegrees(prevLat, prevLon, lat, lon);
  }

  // Find candidate route for this line.
  // routeTrips jest kluczowane po GTFS route_id — szukamy po route_short_name,
  // bo MPK zwraca oznaczenie linii ("4", "K"), nie route_id.
  const candidateRouteIds = store.getRouteIdsByShortName(line);
  // Fallback: gdyby jakieś route_id było równe oznaczeniu linii
  if (store.routeTrips.has(line) && !candidateRouteIds.includes(line)) {
    candidateRouteIds.push(line);
  }

  let matchedTripId: string | undefined;
  let delaySec = 0;
  let currentStopName: string | undefined;
  let nextStopName: string | undefined;

  // Najlepszy kurs globalnie (spośród wszystkich wariantów route_id tej linii)
  let bestDist = Infinity;
  let bestTrip: { trip_id: string } | null = null;
  let bestExpectedSec = 0;

  // Tylko kursy z dzisiejszego rozkładu (routeTrips trzyma wszystkie dni).
  const todayServices = store.getActiveServices(now.getDay());

  for (const routeId of candidateRouteIds) {
    const trips = store.routeTrips.get(routeId);
    if (!trips || trips.length === 0) continue;
    // Find candidate trips running around nowSec (+/- 30 min)

    for (const trip of trips) {
      if (todayServices.size > 0 && !todayServices.has(trip.service_id)) continue;
      const times = store.stopTimes.get(trip.trip_id);
      if (!times || times.length === 0) continue;

      const firstDep = times[0].departure_sec;
      const lastArr = times[times.length - 1].arrival_sec;

      // Window check
      if (nowSec >= firstDep - 1800 && nowSec <= lastArr + 1800) {
        const shape = store.shapes.get(trip.shape_id);
        if (shape && shape.length > 1) {
          const proj = projectPointToPolyline(lat, lon, shape);
          if (proj.distanceMeters < bestDist && proj.distanceMeters < 300) {
            bestDist = proj.distanceMeters;
            bestTrip = trip;

            // Interpolate expected time along shape
            const tripDuration = lastArr - firstDep;
            bestExpectedSec = firstDep + proj.fractionAlongShape * tripDuration;
          }
        }
      }
    }
  }

  if (bestTrip) {
    matchedTripId = bestTrip.trip_id;
    delaySec = Math.round(nowSec - bestExpectedSec);

    // Find current/next stop
    const times = store.stopTimes.get(bestTrip.trip_id) || [];
    for (let i = 0; i < times.length - 1; i++) {
      if (bestExpectedSec >= times[i].departure_sec && bestExpectedSec <= times[i + 1].arrival_sec) {
        currentStopName = store.stops.get(times[i].stop_id)?.stop_name;
        nextStopName = store.stops.get(times[i + 1].stop_id)?.stop_name;
        break;
      }
    }
  }

  // Cap unrealistically high delays
  if (Math.abs(delaySec) > 1800) {
    delaySec = 0;
  }

  return {
    vehicleId,
    line,
    lat,
    lon,
    type: raw.type === 'tram' ? 'tram' : 'bus',
    heading,
    matchedTripId,
    delaySec,
    currentStopName,
    nextStopName,
    updatedAt: Date.now(),
  };
}
