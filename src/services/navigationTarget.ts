import type { Connection, Leg } from '../types/models';
import { timeStringToSeconds } from '../gtfs/geo';

const DAY_MS = 24 * 60 * 60 * 1000;
const BOARDING_GRACE_MS = 5 * 60 * 1000;
const TRANSIT_ARRIVAL_MS = 10 * 60 * 1000;
const ON_TRANSIT_MPS = 4;

export interface NavigationTarget {
  leg: Leg;
  end: boolean;
}

function timeOnOrAfter(time: string, referenceMs: number): number {
  const date = new Date(referenceMs);
  date.setHours(0, 0, 0, 0);
  let value = date.getTime() + timeStringToSeconds(time) * 1000;
  while (value < referenceMs - 2 * 60 * 60 * 1000) value += DAY_MS;
  while (value > referenceMs + 22 * 60 * 60 * 1000) value -= DAY_MS;
  return value;
}

/** Picks the next boarding stop, advancing to the transfer while the user rides. */
export function navigationTarget(
  connection: Pick<Connection, 'legs'>,
  transitLegs: Leg[],
  firstDepartureAt: number,
  now: number,
  speedMps: number | null,
): NavigationTarget | null {
  if (transitLegs.length === 0) {
    const last = connection.legs[connection.legs.length - 1];
    return last ? { leg: last, end: true } : null;
  }

  const schedule: Array<{ depart: number; arrive: number }> = [];
  let previousArrival = firstDepartureAt;
  for (let i = 0; i < transitLegs.length; i++) {
    const leg = transitLegs[i];
    let depart = i === 0 ? firstDepartureAt : timeOnOrAfter(leg.departAt, previousArrival);
    while (depart < previousArrival - 60 * 60 * 1000) depart += DAY_MS;
    let arrive = timeOnOrAfter(leg.arriveAt, depart);
    while (arrive < depart) arrive += DAY_MS;
    schedule.push({ depart, arrive });
    previousArrival = arrive;
  }

  const currentRide =
    speedMps != null && speedMps >= ON_TRANSIT_MPS
      ? schedule.findIndex(
          ({ depart, arrive }) =>
            now >= depart + BOARDING_GRACE_MS && now <= arrive + TRANSIT_ARRIVAL_MS,
        )
      : -1;
  if (currentRide >= 0) {
    if (currentRide < transitLegs.length - 1) {
      return { leg: transitLegs[currentRide + 1], end: false };
    }
    return { leg: transitLegs[currentRide], end: true };
  }

  const upcoming = schedule.findIndex(({ depart }) => now <= depart + BOARDING_GRACE_MS);
  if (upcoming >= 0) return { leg: transitLegs[upcoming], end: false };
  return { leg: transitLegs[transitLegs.length - 1], end: true };
}
