import type { SharedLeg } from './connection';
import type { StaticStop } from './timetable';

const day = 86400;
const warsawClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function sharedJourneySeconds(date: string, now = new Date()): number {
  const parts = warsawClock.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((value) => value.type === type)?.value);
  const elapsedDays =
    (Date.UTC(part('year'), part('month') - 1, part('day')) - Date.parse(date)) / 1000;
  return elapsedDays + part('hour') * 3600 + part('minute') * 60 + part('second');
}

export function sharedLegStops(leg: SharedLeg, stops: StaticStop[] = []): StaticStop[] {
  if (stops.length >= 2) {
    const offset = Math.round((leg.departure * 60 - stops[0].departure) / day) * day;
    return stops.map((stop) => ({
      ...stop,
      arrival: stop.arrival + offset,
      departure: stop.departure + offset,
    }));
  }
  const align = (scheduled: number | undefined, shared: number) => {
    const clock = (scheduled ?? shared) * 60;
    return clock + Math.round((shared * 60 - clock) / day) * day;
  };
  const departure = align(leg.scheduledDeparture, leg.departure);
  let arrival = align(leg.scheduledArrival, leg.arrival);
  while (arrival < departure) arrival += day;
  return [
    { id: leg.board ?? 'from', name: leg.from, arrival: departure, departure },
    { id: leg.alight ?? 'to', name: leg.to, arrival, departure: arrival },
  ];
}

export function scheduledVehiclePosition(
  stops: StaticStop[],
  now: number,
): { index: number; fraction: number } | null {
  if (stops.length < 2 || now < stops[0].departure || now > stops[stops.length - 1].arrival)
    return null;
  for (let index = 0; index < stops.length - 1; index++) {
    const start = stops[index].departure;
    const end = stops[index + 1].arrival;
    if (now < end)
      return { index, fraction: Math.max(0, Math.min(1, (now - start) / (end - start))) };
    if (now <= stops[index + 1].departure) return { index: index + 1, fraction: 0 };
  }
  return { index: stops.length - 1, fraction: 0 };
}
