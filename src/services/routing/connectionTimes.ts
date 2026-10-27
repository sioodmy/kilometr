import { secondsToTimeString, timeStringToSeconds } from '../../gtfs/geo';
import { sharedJourneySeconds, sharedTimeMs } from '../../sharing/progress';
import type { Connection, Leg } from '../../types/models';
import { toAbsoluteMs } from '../notifications/format';
import { predictDelaySec } from './delays';

const DAY = 86400;

function alignClock(seconds: number, anchor: number): number {
  return seconds + Math.round((anchor - seconds) / DAY) * DAY;
}

/** Pierwszy pojazd, bez czasu dojścia. Kotwica zachowuje datę po północy. */
export function boardingDepartureSec(connection: Connection): number {
  let cursor = connection.departureSec;
  for (const leg of connection.legs) {
    const departure = alignClock(timeStringToSeconds(leg.departAt), cursor);
    if (leg.mode !== 'walk')
      return leg.scheduledDepartureSec != null && leg.delaySec != null
        ? leg.scheduledDepartureSec + leg.delaySec
        : departure;
    let arrival = alignClock(timeStringToSeconds(leg.arriveAt), departure);
    if (arrival < departure) arrival += DAY;
    cursor = arrival;
  }
  return connection.departureSec;
}

export function boardingDepartureMs(connection: Connection, now = new Date()): number {
  const seconds = boardingDepartureSec(connection);
  const firstVehicle = connection.legs.find((leg) => leg.mode !== 'walk');
  const anchor =
    firstVehicle?.scheduledDepartureSec != null
      ? connection.departureSec - (firstVehicle.delaySec ?? 0)
      : connection.departureSec;
  return connection.serviceDate
    ? sharedTimeMs(connection.serviceDate, seconds)
    : toAbsoluteMs(anchor, now) + (seconds - anchor) * 1000;
}

/** Starsze plany odzyskują rozkład wyłącznie z zapisanych przystanków GTFS. */
export function scheduledLegTimes(leg: Leg, anchor: number) {
  const departure =
    leg.scheduledDepartureSec ??
    leg.intermediateStops?.find((stop) => stop.stopId === leg.fromStopId)?.departSec;
  const arrival =
    leg.scheduledArrivalSec ??
    leg.intermediateStops?.findLast((stop) => stop.stopId === leg.toStopId)?.arriveSec;
  return {
    departure: departure == null ? undefined : alignClock(departure, anchor),
    arrival: arrival == null ? undefined : alignClock(arrival, anchor),
  };
}

/** Przelicza godziny od rozkładu, więc kolejne odświeżenia nie sumują opóźnień. */
export function refreshConnectionTimes(
  connection: Connection,
  tripDelays: ReadonlyMap<string, number>,
  now = new Date(),
): Connection {
  const firstVehicle = connection.legs.find((leg) => leg.mode !== 'walk');
  if (!firstVehicle) return connection;
  if (connection.departureSec - (firstVehicle.delaySec ?? 0) >= DAY && !connection.serviceDate)
    return connection;
  const elapsed = connection.serviceDate
    ? sharedJourneySeconds(connection.serviceDate, now)
    : undefined;
  const nowSec =
    elapsed ??
    alignClock(
      now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds(),
      connection.departureSec,
    );
  const sameDay = elapsed == null || Math.abs(elapsed - boardingDepartureSec(connection)) < DAY / 2;
  let cursor = connection.departureSec;
  let carriedShift = 0;
  let firstShift: number | undefined;
  let lastShift = 0;
  let maxDelayMin = 0;
  const shifts: number[] = [];
  const legs = connection.legs.map((leg) => {
    const oldDeparture = alignClock(timeStringToSeconds(leg.departAt), cursor);
    let oldArrival = alignClock(timeStringToSeconds(leg.arriveAt), oldDeparture);
    if (oldArrival < oldDeparture) oldArrival += DAY;
    cursor = oldArrival;
    if (leg.mode === 'walk') {
      shifts.push(carriedShift);
      return leg;
    }
    const times = scheduledLegTimes(leg, oldDeparture);
    const measured = sameDay && leg.tripId ? tripDelays.get(leg.tripId) : undefined;
    const live = measured != null && Number.isFinite(measured);
    const delaySec =
      live && times.departure != null
        ? predictDelaySec(measured, times.departure - (nowSec - measured), 'board')
        : live
          ? measured
          : 0;
    const arrivalDelaySec =
      live && times.arrival != null
        ? predictDelaySec(measured, times.arrival - (nowSec - measured), 'arrive')
        : live
          ? measured
          : 0;
    const delayMin = Math.round(delaySec / 60);
    if (Math.abs(delayMin) > Math.abs(maxDelayMin)) maxDelayMin = delayMin;
    const oldDelay = leg.delaySec ?? (times.departure == null ? 0 : oldDeparture - times.departure);
    const oldArrivalDelay =
      leg.arrivalDelaySec ?? (times.arrival == null ? 0 : oldArrival - times.arrival);
    const shift = times.departure == null ? 0 : delaySec - oldDelay;
    const arrivalShift = times.arrival == null ? 0 : arrivalDelaySec - oldArrivalDelay;
    carriedShift = arrivalShift;
    firstShift ??= shift;
    lastShift = arrivalShift;
    shifts.push(shift);
    const departAt =
      times.departure == null ? leg.departAt : secondsToTimeString(times.departure + delaySec);
    const arriveAt =
      times.arrival == null ? leg.arriveAt : secondsToTimeString(times.arrival + arrivalDelaySec);
    if (
      leg.live === live &&
      leg.delaySec === delaySec &&
      leg.arrivalDelaySec === arrivalDelaySec &&
      leg.departAt === departAt &&
      leg.arriveAt === arriveAt &&
      leg.scheduledDepartureSec === times.departure &&
      leg.scheduledArrivalSec === times.arrival
    )
      return leg;
    return {
      ...leg,
      live,
      delaySec,
      arrivalDelaySec,
      scheduledDepartureSec: times.departure,
      scheduledArrivalSec: times.arrival,
      departAt,
      arriveAt,
    };
  });
  const firstTransitIndex = legs.findIndex((leg) => leg.mode !== 'walk');
  const shiftedLegs = legs.map((leg, index) => {
    if (leg.mode !== 'walk') return leg;
    const shift = index < firstTransitIndex ? (firstShift ?? 0) : shifts[index];
    if (shift === 0) return leg;
    const departure =
      leg.scheduledDepartureSec ??
      (index === 0
        ? connection.departureSec
        : alignClock(timeStringToSeconds(leg.departAt), connection.departureSec));
    const arrival =
      leg.scheduledArrivalSec ??
      (index === legs.length - 1 && connection.arrivalSec != null
        ? connection.arrivalSec
        : alignClock(timeStringToSeconds(leg.arriveAt), departure));
    const delaySec = (leg.delaySec ?? 0) + shift;
    const arrivalDelaySec = (leg.arrivalDelaySec ?? 0) + shift;
    return {
      ...leg,
      scheduledDepartureSec: departure,
      scheduledArrivalSec: arrival,
      delaySec,
      arrivalDelaySec,
      departAt: secondsToTimeString(departure + delaySec),
      arriveAt: secondsToTimeString(arrival + arrivalDelaySec),
    };
  });
  const live = shiftedLegs.some((leg) => leg.live);
  if (
    shiftedLegs.every((leg, index) => leg === connection.legs[index]) &&
    connection.live === live &&
    connection.delayMin === maxDelayMin
  )
    return connection;
  const departureSec = connection.departureSec + (firstShift ?? 0);
  const arrivalSec =
    (connection.arrivalSec ?? connection.departureSec + connection.durationMin * 60) + lastShift;
  return {
    ...connection,
    legs: shiftedLegs,
    live,
    delayMin: maxDelayMin,
    departureSec,
    arrivalSec,
    departAt: secondsToTimeString(departureSec),
    arriveAt: secondsToTimeString(arrivalSec),
    departInMin: connection.departInMin + Math.round((firstShift ?? 0) / 60),
    durationMin: Math.max(1, Math.round((arrivalSec - departureSec) / 60)),
  };
}
