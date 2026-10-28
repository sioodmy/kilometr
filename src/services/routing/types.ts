/** 'cable' = kolej linowa / powietrzna (Polinka przy Politechnice Wrocławskiej). */
export type LegMode = 'tram' | 'bus' | 'train' | 'cable' | 'trolleybus' | 'subway' | 'walk';

/** Pojazd, na który da się przesiąść. Wszystko poza spacerem. */
export type TransitVehicleMode = Exclude<LegMode, 'walk'>;

/** Które pojazdy biorą udział w wynikach. Wszystko true = brak ograniczeń. */
export type AllowedTransferModes = Record<TransitVehicleMode, boolean>;

/** Jednorazowy filtr pojazdów: 'all' = tramwaje + autobusy + pociągi KD (default). */
export type TransitModePreference = 'all' | 'tram' | 'bus';

/** Styl trasy z ustawień: wagi spaceru i przesiadek w koszcie planera. */
export type RouteStyle = 'fastest' | 'balanced' | 'lessWalking' | 'fewerTransfers';

export type JourneyTimeMode = 'departure' | 'arrival';

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
  scheduledDepartureSec?: number;
  scheduledArrivalSec?: number;
  delaySec?: number;
  arrivalDelaySec?: number;
  stopsCount: number;
  walkM?: number;
  live: boolean;
  delayConfidence?: import('../../types/models').DelayConfidence;
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
  arrivalSec?: number;
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
