export type LegMode = 'tram' | 'bus' | 'walk';

/** Jednorazowy filtr pojazdów: 'all' = tramwaje + autobusy (default). */
export type TransitModePreference = 'all' | 'tram' | 'bus';

export interface LegStop {
  stopId: string;
  name: string;
  lat?: number;
  lon?: number;
  seq: number;
  arriveSec?: number;
  departSec?: number;
}

export interface Leg {
  id: string;
  mode: LegMode;
  line?: string;
  direction?: string;
  fromStop: string;
  toStop: string;
  departAt: string;
  arriveAt: string;
  stopsCount: number;
  walkM?: number;
  live: boolean;
  fromStopId?: string;
  toStopId?: string;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
  platformCode?: string;
  tripId?: string;
  routeId?: string;
  intermediateStops?: LegStop[];
}

export interface Connection {
  id: string;
  fromTitle: string;
  toTitle: string;
  departInMin: number;
  departureSec: number;
  departAt: string;
  arriveAt: string;
  durationMin: number;
  transfers: number;
  delayMin: number;
  live: boolean;
  legs: Leg[];
  interchange?: string;
}

export interface JourneySegment {
  type: 'transit' | 'walk';
  tripId?: string;
  routeId?: string;
  line?: string;
  mode?: LegMode;
  direction?: string;
  fromStopId: string;
  fromStopName: string;
  toStopId: string;
  toStopName: string;
  departSec: number;
  arriveSec: number;
  stopsCount: number;
  walkMeters?: number;
}

export interface RawJourney {
  departureSec: number;
  arrivalSec: number;
  transfers: number;
  segments: JourneySegment[];
}
