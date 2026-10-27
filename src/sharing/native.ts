import type { Connection, Leg, LegStop, VehiclePosition } from '../types/models';
import { formatShareTime, transferCount, type SharedConnection } from './connection';
import { sharedJourneySeconds } from './progress';
import { decodePath } from './geometry';

function sharedConnectionId(encoded: string): string {
  let hash = 2166136261;
  for (let i = 0; i < encoded.length; i++) hash = Math.imul(hash ^ encoded.charCodeAt(i), 16777619);
  return `shared-${(hash >>> 0).toString(16)}`;
}

/** Odtwarza plan bez ponownego wyszukiwania innego połączenia. */
export function sharedToConnection(
  journey: SharedConnection,
  encoded: string,
  stops: LegStop[][] = [],
): Connection {
  const id = sharedConnectionId(encoded);
  const legs = journey.legs.map((leg, index): Leg => {
    const full = stops[index] ?? [];
    const board = full.findIndex(
      (stop) =>
        stop.stopId === leg.board &&
        (stop.departSec == null ||
          Math.floor(stop.departSec / 60) % 1440 ===
            (leg.scheduledDeparture ?? leg.departure) % 1440),
    );
    const alight = full.findIndex(
      (stop, i) =>
        i > board &&
        stop.stopId === leg.alight &&
        (stop.arriveSec == null ||
          Math.floor(stop.arriveSec / 60) % 1440 === (leg.scheduledArrival ?? leg.arrival) % 1440),
    );
    const selected = board >= 0 && alight > board ? full.slice(board, alight + 1) : [];
    return {
      id: `${id}-${index}`,
      mode: leg.mode,
      line: leg.line,
      direction: leg.direction,
      fromStop: leg.from,
      toStop: leg.to,
      fromStopId: leg.board,
      toStopId: leg.alight,
      departAt: formatShareTime(leg.departure),
      arriveAt: formatShareTime(leg.arrival),
      stopsCount: leg.stops,
      walkM: leg.walk,
      tripId: leg.trip,
      live: false,
      fromLat: leg.fromLat ?? selected[0]?.lat,
      fromLon: leg.fromLon ?? selected[0]?.lon,
      toLat: leg.toLat ?? selected.at(-1)?.lat,
      toLon: leg.toLon ?? selected.at(-1)?.lon,
      intermediateStops: selected,
      geometry: leg.path ? (decodePath(leg.path) ?? undefined) : undefined,
    };
  });
  return {
    id,
    serviceDate: journey.date,
    fromTitle: journey.from,
    toTitle: journey.to,
    departureSec: journey.departure * 60,
    arrivalSec: journey.arrival * 60,
    departAt: formatShareTime(journey.departure),
    arriveAt: formatShareTime(journey.arrival),
    departInMin: 0,
    durationMin: journey.arrival - journey.departure,
    transfers: transferCount(journey),
    delayMin: 0,
    live: false,
    legs,
  };
}

/** Nakłada tylko świeże opóźnienia właściwej daty i konkretnego kursu. */
export function sharedLiveConnection(
  connection: Connection,
  journey: SharedConnection,
  delays: ReadonlyMap<string, number>,
  now = new Date(),
): Connection {
  const elapsed = sharedJourneySeconds(journey.date, now);
  let carriedDelay = 0;
  let delayMin = 0;
  let cursor = -Infinity;
  let departure = journey.departure;
  let arrival = journey.arrival;
  const legs = connection.legs.map((leg, index) => {
    const shared = journey.legs[index];
    const near = elapsed >= shared.departure * 60 - 1800 && elapsed <= shared.arrival * 60 + 1800;
    const seconds = near && shared.trip ? delays.get(shared.trip) : undefined;
    const live = seconds !== undefined && Number.isFinite(seconds);
    if (leg.mode !== 'walk') carriedDelay = live ? Math.round(seconds / 60) : 0;
    if (live && Math.abs(carriedDelay) > Math.abs(delayMin)) delayMin = carriedDelay;
    const from =
      shared.scheduledDeparture === undefined
        ? shared.departure
        : shared.scheduledDeparture +
          Math.round((shared.departure - shared.scheduledDeparture) / 1440) * 1440;
    const to =
      shared.scheduledArrival === undefined
        ? shared.arrival
        : shared.scheduledArrival +
          Math.round((shared.arrival - shared.scheduledArrival) / 1440) * 1440;
    const dep = Math.max(
      cursor,
      live || leg.mode === 'walk' ? from + carriedDelay : shared.departure,
    );
    const arr = Math.max(dep, live || leg.mode === 'walk' ? to + carriedDelay : shared.arrival);
    cursor = arr;
    if (index === 0) departure = dep;
    arrival = arr;
    return { ...leg, live, departAt: formatShareTime(dep), arriveAt: formatShareTime(arr) };
  });
  return {
    ...connection,
    legs,
    departureSec: departure * 60,
    arrivalSec: arrival * 60,
    departAt: formatShareTime(departure),
    arriveAt: formatShareTime(arrival),
    departInMin: Math.ceil(departure - elapsed / 60),
    durationMin: arrival - departure,
    live: legs.some((leg) => leg.live),
    delayMin,
  };
}

export function sharedVehicle(
  connection: Connection,
  vehicles: VehiclePosition[],
  now = new Date(),
): { leg: Leg; vehicle: VehiclePosition } | null {
  if (!connection.serviceDate) return null;
  const elapsed = sharedJourneySeconds(connection.serviceDate, now);
  let cursor = connection.departureSec;
  for (const leg of connection.legs) {
    const minute = (clock: string) => {
      const [h, m] = clock.split(':').map(Number);
      let seconds = h * 3600 + m * 60 + Math.floor(cursor / 86400) * 86400;
      while (seconds < cursor) seconds += 86400;
      return seconds;
    };
    const departure = minute(leg.departAt);
    cursor = departure;
    const arrival = minute(leg.arriveAt);
    cursor = arrival;
    if (leg.mode === 'walk' || !leg.tripId || elapsed < departure - 300 || elapsed > arrival + 600)
      continue;
    const vehicle = vehicles.find(
      (v) =>
        v.matchedTripId === leg.tripId &&
        v.updatedAt <= now.getTime() &&
        now.getTime() - v.updatedAt < 90_000,
    );
    if (vehicle) return { leg, vehicle };
  }
  return null;
}
