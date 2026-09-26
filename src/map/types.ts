// View-model mapy — to, co WebView dostaje do narysowania. Świadomie oddzielone
// od domenowego `Connection`: mapa potrzebuje kolorów, ról przystanków i flag
// „geometria jeszcze się dociąga”, a nie całej reszty planera.

import type { LatLon, LegMode } from '../types/models';

export type MapStopRole = 'board' | 'alight' | 'intermediate' | 'walk';

export interface MapStop extends LatLon {
  /** unikalny w obrębie trasy: `${legId}#${seq}` */
  id: string;
  legId: string;
  name: string;
  seq: number;
  role: MapStopRole;
  arriveSec?: number;
  departSec?: number;
}

export interface MapLeg {
  id: string;
  mode: LegMode;
  line?: string;
  /** kierunek kursu (np. "BISKUPIN") */
  direction?: string;
  /** kolor linii z palety TRANSIT_PALETTE (identyczny z LineBadge) */
  color: string;
  fromStop: string;
  toStop: string;
  departAt: string;
  arriveAt: string;
  stopsCount: number;
  walkM?: number;
  live: boolean;
  tripId?: string;
  platformCode?: string;
  stops: MapStop[];
  /**
   * true = noga rysowana po prostych między przystankami, dopóki nie wróci
   * prawdziwa geometria ulic. Użytkownik widzi trasę od razu.
   */
  approx: boolean;
}

export interface MapRoute {
  id: string;
  fromTitle: string;
  toTitle: string;
  departAt: string;
  arriveAt: string;
  durationMin: number;
  legs: MapLeg[];
  /** 'osrm' = cała trasa po ulicach, 'approx' = sama prosta, 'mixed' = w trakcie */
  geometry: 'osrm' | 'approx' | 'mixed';
}

export interface MapVehicle extends LatLon {
  vehicleId: string;
  legId: string;
  line: string;
  mode: 'bus' | 'tram';
  color: string;
  /** kurs pojazdu w stopniach (0 = północ) */
  heading: number;
  delaySec: number;
  currentStopName?: string;
  nextStopName?: string;
  updatedAt: number;
}

/** Komunikat mapa → aplikacja (RouteMap -> rodzic). */
export type MapOutMessage =
  | { t: 'ready' }
  | { t: 'error'; message: string }
  | { t: 'stopTap'; stopId: string; legId: string; name: string; role: MapStopRole; arriveSec?: number }
  | { t: 'legTap'; legId: string }
  | { t: 'tiles'; ok: boolean }
  | { t: 'open'; url: string }
  | { t: 'userMoved' };

/** Komunikat aplikacja → mapa (RouteMap -> WebView). */
export type MapInMessage =
  | { t: 'route'; route: MapRoute }
  | { t: 'geometry'; legId: string; coords: [number, number][]; approx: boolean }
  /** `pad` to marginesy dopasowania widoku (w px), liczone po stronie aplikacji. */
  | { t: 'select'; legId: string | null; pad?: [number, number, number, number] }
  | { t: 'fit'; pad?: [number, number, number, number] }
  | { t: 'vehicle'; vehicle: MapVehicle | null }
  | { t: 'follow'; on: boolean }
  | { t: 'user'; lat: number; lon: number; heading: number | null }
  | { t: 'center'; lat: number; lon: number; zoom?: number; duration?: number }
  | { t: 'cursor'; lat: number; lon: number }
  | { t: 'clearCursor' };
