import type { SharedLeg } from './connection';

export interface StaticStop {
  id: string;
  name: string;
  arrival: number;
  departure: number;
  lat?: number;
  lon?: number;
}

export interface TimetableShard {
  v: 1;
  trips: Record<string, StaticStop[]>;
  tripShapes?: Record<string, string>;
}

export function tripShard(tripId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < tripId.length; i++) {
    hash = Math.imul(hash ^ tripId.charCodeAt(i), 16777619);
  }
  return (hash & 255).toString(16).padStart(2, '0');
}

export function selectLegStops(leg: SharedLeg, stops: StaticStop[]): StaticStop[] {
  const start = stops.findIndex(
    (stop) =>
      stop.id === leg.board &&
      Math.floor(stop.departure / 60) % 1440 === (leg.scheduledDeparture ?? leg.departure) % 1440,
  );
  if (start < 0) return [];
  const end = stops.findIndex(
    (stop, i) =>
      i > start &&
      stop.id === leg.alight &&
      Math.floor(stop.arrival / 60) % 1440 === (leg.scheduledArrival ?? leg.arrival) % 1440,
  );
  return end > start ? stops.slice(start, end + 1) : [];
}
