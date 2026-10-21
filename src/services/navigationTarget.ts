import type { Connection, Leg, VehiclePosition } from '../types/models';
import type { CurrentLocation } from './currentLocation';
import type { Coord } from './routeGeometry';
import { bearingDegrees, distanceMeters, projectPointToPolyline } from '../gtfs/geo';
import { parseClock } from './notifications/format';
import { buildFallbackStops, findUserSegment } from './vehiclePosition';

const DAY_SEC = 86400;
const MAX_LIVE_AGE_MS = 120_000;
const MAX_DELAY_MS = 30 * 60_000;

export interface NavigationTarget {
  leg: Leg;
  legIndex: number;
  end: boolean;
  phase: 'approach' | 'waiting' | 'riding' | 'transfer' | 'egress' | 'arrived';
  departMs: number;
  arriveMs: number;
}

interface NavigationInput {
  location?: CurrentLocation | null;
  vehicles?: VehiclePosition[];
  previous?: NavigationTarget | null;
}

export function navigationTimeline(connection: Pick<Connection, 'legs'>, departureAt: number) {
  let previous = 0;
  const timeline = connection.legs.map((leg, legIndex) => {
    let depart = parseClock(leg.departAt) ?? previous;
    while (depart < previous) depart += DAY_SEC;
    let arrive = parseClock(leg.arriveAt) ?? depart;
    while (arrive < depart) arrive += DAY_SEC;
    previous = depart;
    return { leg, legIndex, departMs: depart * 1000, arriveMs: arrive * 1000 };
  });
  const anchor = timeline.find((entry) => entry.leg.mode !== 'walk') ?? timeline[0];
  const shift = departureAt - (anchor?.departMs ?? 0);
  return timeline.map((entry) => ({
    ...entry,
    departMs: entry.departMs + shift,
    arriveMs: entry.arriveMs + shift,
  }));
}

function navigationVehicle(leg: Leg, vehicles: VehiclePosition[], now: number) {
  if (!leg.tripId || leg.mode === 'walk') return null;
  return (
    vehicles.find(
      (vehicle) =>
        vehicle.matchedTripId === leg.tripId &&
        vehicle.line.trim().toUpperCase() === leg.line?.trim().toUpperCase() &&
        Number.isFinite(vehicle.lat) &&
        Number.isFinite(vehicle.lon) &&
        Math.abs(vehicle.lat) <= 90 &&
        Math.abs(vehicle.lon) <= 180 &&
        now >= vehicle.updatedAt &&
        now - vehicle.updatedAt <= MAX_LIVE_AGE_MS,
    ) ?? null
  );
}

function freshLocation(location: CurrentLocation | null | undefined, now: number) {
  return location &&
    now >= location.timestamp &&
    now - location.timestamp <= 15_000 &&
    location.accuracy != null &&
    location.accuracy <= 50
    ? location
    : null;
}

function rideStops(leg: Leg) {
  const stops = buildFallbackStops(leg);
  const segment = findUserSegment(stops, leg);
  return stops.slice(segment.start, segment.end + 1);
}

function rideProjection(leg: Leg, lat: number, lon: number) {
  const points = rideStops(leg)
    .filter((stop) => stop.lat != null && stop.lon != null)
    .map((stop) => ({ lat: stop.lat!, lon: stop.lon! }));
  return points.length >= 2 ? projectPointToPolyline(lat, lon, points) : null;
}

function atAlightingStop(leg: Leg, location: CurrentLocation | null) {
  return (
    location != null &&
    (location.speed ?? 0) < 2.2 &&
    leg.toLat != null &&
    leg.toLon != null &&
    distanceMeters(location.lat, location.lon, leg.toLat, leg.toLon) <= 35
  );
}

export function navigationTarget(
  connection: Pick<Connection, 'legs' | 'delayMin'>,
  departureAt: number,
  now: number,
  input: NavigationInput = {},
): NavigationTarget | null {
  const timeline = navigationTimeline(connection, departureAt);
  const rides = timeline.filter(({ leg }) => leg.mode !== 'walk');
  const location = freshLocation(input.location, now);
  let lastDelay = 0;
  for (const entry of rides) {
    if (input.previous && entry.legIndex < input.previous.legIndex) continue;
    const { leg } = entry;
    const inLiveWindow =
      now >= entry.departMs - MAX_DELAY_MS && now <= entry.arriveMs + MAX_DELAY_MS;
    const vehicle = inLiveWindow ? navigationVehicle(leg, input.vehicles ?? [], now) : null;
    const boarding = rideStops(leg)[0];
    const scheduled = boarding?.departSec ?? boarding?.arriveSec;
    // Bez listy przystanków z GTFS (zapisana trasa, kurs spoza wycinka)
    // boarding.departSec to już leg.departAt z wliczonym opóźnieniem, więc
    // planned zawsze wychodzi 0 i pojazd dokładałby opóźnienie drugi raz.
    const hasScheduledStops = (leg.intermediateStops?.length ?? 0) >= 2;
    const planned =
      hasScheduledStops && scheduled != null
        ? (((parseClock(leg.departAt) ?? 0) - scheduled + 129600) % DAY_SEC) - 43200
        : hasScheduledStops && leg.live && entry === rides[0]
          ? connection.delayMin * 60
          : 0;
    const delay =
      hasScheduledStops && vehicle?.delaySec != null && Math.abs(vehicle.delaySec) <= 1800
        ? (vehicle.delaySec - planned) * 1000
        : 0;
    const departMs = entry.departMs + delay;
    const arriveMs = entry.arriveMs + delay;
    lastDelay = delay;
    const alighted =
      atAlightingStop(leg, location) &&
      ((input.previous?.legIndex === entry.legIndex && input.previous.phase === 'riding') ||
        now >= arriveMs - 60_000);
    if (alighted && now > departMs + 45_000) continue;
    const position = vehicle ? rideProjection(leg, vehicle.lat, vehicle.lon) : null;
    const stillRiding =
      position != null && position.distanceMeters <= 150 && position.fractionAlongShape < 0.98;
    const devicePosition =
      location && (location.speed ?? 0) >= 2.2
        ? rideProjection(leg, location.lat, location.lon)
        : null;
    const ridingDevice =
      input.previous?.legIndex === entry.legIndex &&
      input.previous.phase === 'riding' &&
      devicePosition != null &&
      devicePosition.distanceMeters <= 120 &&
      devicePosition.fractionAlongShape < 0.98;
    if (now >= arriveMs && !((stillRiding || ridingDevice) && now < arriveMs + MAX_DELAY_MS))
      continue;
    const atBoardingStop =
      location &&
      (location.speed ?? 0) < 2.2 &&
      leg.fromLat != null &&
      leg.fromLon != null &&
      distanceMeters(location.lat, location.lon, leg.fromLat, leg.fromLon) <= 35 &&
      !(input.previous?.legIndex === entry.legIndex && input.previous.phase === 'riding');
    const phase =
      now < departMs
        ? entry === rides[0]
          ? 'approach'
          : 'transfer'
        : now < departMs + 45_000 || atBoardingStop
          ? 'waiting'
          : 'riding';
    return { ...entry, departMs, arriveMs, phase, end: phase === 'riding' };
  }
  const last = timeline[timeline.length - 1];
  if (!last) return null;
  const arrived =
    last.leg.mode !== 'walk' ||
    now >= last.arriveMs + lastDelay ||
    (location &&
      last.leg.toLat != null &&
      last.leg.toLon != null &&
      distanceMeters(location.lat, location.lon, last.leg.toLat, last.leg.toLon) <= 25);
  return { ...last, end: true, phase: arrived ? 'arrived' : 'egress' };
}

export interface RideNavigation {
  path: Coord[];
  position: Coord | null;
  heading: number | null;
  nextStop: string | null;
  stopsLeft: number | null;
}

export function rideNavigation(
  target: NavigationTarget,
  now: number,
  vehicles: VehiclePosition[],
): RideNavigation {
  const { leg } = target;
  const stops = rideStops(leg);
  const points = stops.filter((stop) => stop.lat != null && stop.lon != null);
  const path: Coord[] = points.map((stop) => [stop.lat!, stop.lon!]);
  const vehicle = navigationVehicle(leg, vehicles, now);
  const projection = vehicle ? rideProjection(leg, vehicle.lat, vehicle.lon) : null;
  const hasPosition = vehicle != null;
  const gap = projection != null && projection.distanceMeters <= 350 ? projection.segmentIndex : -1;
  const namedNext = vehicle?.nextStopName
    ? stops.findIndex((stop) => stop.name === vehicle.nextStopName)
    : -1;
  const nextIndex = namedNext > 0 ? namedNext : Math.min(points.length - 1, gap + 1);
  const knownStops = points.length === stops.length && (stops.length > 2 || leg.stopsCount <= 1);
  return {
    path,
    position: hasPosition ? [vehicle.lat, vehicle.lon] : null,
    heading: gap >= 0 && path[gap + 1] ? bearingDegrees(...path[gap], ...path[gap + 1]) : null,
    nextStop:
      hasPosition && knownStops && (gap >= 0 || namedNext > 0)
        ? (points[nextIndex]?.name ?? null)
        : null,
    stopsLeft:
      hasPosition && knownStops && (gap >= 0 || namedNext > 0)
        ? Math.max(1, stops.length - nextIndex)
        : null,
  };
}
