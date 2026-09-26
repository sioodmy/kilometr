// Dopasowanie pozycji pojazdu MPK do konkretnej nogi podróży.
//
// Globalny tracker (liveTracker) dopasowuje każdy pojazd do *jakiegoś*
// kursu w rozkładzie. To za mało, żeby pokazać użytkownikowi „tu jest Twój
// tramwaj”: kilka pojazdów tej samej linii pasuje do tego samego kursu, a
// kurs bywa dopisany do innego pojazdu niż ten, który naprawdę po nim jedzie.
// Efekt był losowy — strzałka skakała po mapie.
//
// Tutaj zawężamy wybór do jednej nogi: pojazd musi
//  1. jechać tą samą linią,
//  2. być blisko geometrii NOGI (korytarz, nie całej linii),
//  3. być zgodny z rozkładem nogi w danym miejscu (opóźnienie w sensownym
//     oknie, inaczej to nie ten pojazd).
// Wygrany jest oceniany scoringiem, a przy remisie zostaje ten sam, którego
// pokazywaliśmy już wcześniej — dzięki temu strzałka nie migocze między
// dwoma autobusami stojącymi na tym samym przystanku.

import {
  distanceM,
  projectRoutePoint,
  type Coord,
  type Projection,
} from './routeGeometry';
import { timeStringToSeconds } from '../gtfs/geo';
import type { TrackedVehicle } from './liveTracker';
import type { MapLeg } from '../map/types';

/** Pojazd dalej niż tyle od linii naszej nogi to nie ten kurs. */
const MAX_CORRIDOR_M = 220;
/** Za dużo opóźnienia też wyklucza — to ktoś z innego kursu. */
const MAX_DELAY_SEC = 1500;
const MIN_DELAY_SEC = -240;
/** Bonus za trafienie w dokładny tripId z rozkładu. */
const TRIP_MATCH_BONUS = 0.45;
/** Ile gorszy może być nowy kandydat, żebyśmy zostawili poprzedni pojazd. */
const SWITCH_TOLERANCE = 45;

export interface LegVehicleMatch {
  vehicle: TrackedVehicle;
  /** Gdzie pojazd jest wzdłuż nogi (0..1). */
  progress: number;
  /** Opóźnienie policzone z rozkładu NOGI (nie z globalnego dopasowania). */
  delaySec: number;
  /** Dystans pojazdu od linii nogi [m]. */
  offsetM: number;
  heading: number;
  score: number;
}

interface SchedulePoint {
  alongM: number;
  timeSec: number;
}

/**
 * Oś czasu wzdłuż nogi: czas rozkładowy dla każdego przystanku + końców.
 * Dzięki temu wiemy, czego oczekiwać w dowolnym miejscu trasy.
 */
function legSchedule(leg: MapLeg, coords: Coord[]): SchedulePoint[] {
  const pts: SchedulePoint[] = [];
  const fromSec = timeStringToSeconds(leg.departAt);
  const toSec = timeStringToSeconds(leg.arriveAt);

  const stops = leg.stops;
  if (stops.length === 0) {
    return [
      { alongM: 0, timeSec: fromSec },
      { alongM: distanceM(coords[0], coords[coords.length - 1]), timeSec: toSec },
    ];
  }

  // Pozycja przystanku wzdłuż geometrii: rzutamy jego współrzędne.
  for (const stop of stops) {
    const p = projectRoutePoint(coords, stop.lat, stop.lon);
    if (!p) continue;
    const t =
      stop.departSec ??
      stop.arriveSec ??
      (stop.role === 'board' ? fromSec : toSec);
    if (t == null || !isFinite(t)) continue;
    pts.push({ alongM: p.alongM, timeSec: t });
  }
  // Pierwsza i ostatnia stopa to końce nogi — czas z planu jest wiążący.
  const first = pts[0];
  if (!first || first.alongM > 1) pts.unshift({ alongM: 0, timeSec: fromSec });
  const last = pts[pts.length - 1];
  if (!last) pts.push({ alongM: 0, timeSec: toSec });
  else if (fromSec < toSec) {
    pts[pts.length - 1] = { alongM: last.alongM, timeSec: toSec };
  }
  pts.sort((a, b) => a.alongM - b.alongM);
  return pts;
}

/** Czas rozkładowy w danym miejscu nogi (interpolacja po przystankach). */
function expectedTimeAt(schedule: SchedulePoint[], alongM: number, projection: Projection): number {
  if (schedule.length === 0) return 0;
  if (schedule.length === 1) return schedule[0].timeSec;
  if (alongM <= schedule[0].alongM) return schedule[0].timeSec;
  const last = schedule[schedule.length - 1];
  if (alongM >= last.alongM) return last.timeSec;
  for (let i = 0; i < schedule.length - 1; i++) {
    const a = schedule[i];
    const b = schedule[i + 1];
    if (alongM >= a.alongM && alongM <= b.alongM) {
      const span = b.alongM - a.alongM;
      const t = span > 0 ? (alongM - a.alongM) / span : 0;
      return a.timeSec + t * (b.timeSec - a.timeSec);
    }
  }
  return projection.alongM;
}

/** Czy noga w ogóle jest teraz obsługiwana (połowa kursu bez sensu pokazywać). */
export function isLegRunning(leg: MapLeg, nowSec: number): boolean {
  const from = timeStringToSeconds(leg.departAt);
  const to = timeStringToSeconds(leg.arriveAt);
  if (!isFinite(from) || !isFinite(to) || to <= from) return false;
  return nowSec >= from - 300 && nowSec <= to + 600;
}

export interface MatchOptions {
  /** vehicleId, którego pokazywaliśmy ostatnio — wolimy je, jeśli wciąż pasuje. */
  preferVehicleId?: string | null;
  /** Czy dopuszczamy pojazd spoza rozkładu (gdy nie ma tripId w nodze). */
  nowSec: number;
}

export function matchVehicleToLeg(
  candidates: TrackedVehicle[],
  leg: MapLeg,
  coords: Coord[],
  options: MatchOptions,
): LegVehicleMatch | null {
  if (!coords || coords.length < 2) return null;
  if (!leg.line || !isLegRunning(leg, options.nowSec)) return null;

  const schedule = legSchedule(leg, coords);
  const line = leg.line.trim().toUpperCase();
  let best: LegVehicleMatch | null = null;
  let bestScore = Infinity;

  for (const v of candidates) {
    if (v.line.trim().toUpperCase() !== line) continue;
    const p = projectRoutePoint(coords, v.lat, v.lon);
    if (!p || p.offsetM > MAX_CORRIDOR_M) continue;

    const expected = expectedTimeAt(schedule, p.alongM, p);
    if (!expected) continue;
    const delay = options.nowSec - expected;
    if (delay < MIN_DELAY_SEC || delay > MAX_DELAY_SEC) continue;

    // Punkt tuż przed startem albo tuż po końcu nóg: to raczej sąsiedni
    // kurs, a nie ten, na który czekamy — odcinamy skrajności.
    if (p.progress < -0.02 || p.progress > 1.02) continue;

    let score = Math.abs(delay) / 60 + p.offsetM / 200;
    if (leg.tripId && v.matchedTripId === leg.tripId) score *= TRIP_MATCH_BONUS;
    if (v.vehicleId === options.preferVehicleId) score *= 0.9;

    if (score < bestScore) {
      bestScore = score;
      best = {
        vehicle: v,
        progress: p.progress,
        delaySec: delay,
        offsetM: p.offsetM,
        heading: p.heading,
        score,
      };
    }
  }

  if (!best) return null;
  // Ten sam pojazd co ostatnio zostaje, dopóki nowy kandydat nie jest
  // wyraźnie lepszy — inaczej strzałka skacze między dwoma pojazdami
  // stojącymi na tym samym przystanku.
  if (
    options.preferVehicleId &&
    best.vehicle.vehicleId !== options.preferVehicleId &&
    best.score < SWITCH_TOLERANCE
  ) {
    const keep = candidates.find((v) => v.vehicleId === options.preferVehicleId);
    if (keep) {
      const p = projectRoutePoint(coords, keep.lat, keep.lon);
      if (p && p.offsetM <= MAX_CORRIDOR_M) {
        const expected = expectedTimeAt(schedule, p.alongM, p);
        const delay = options.nowSec - expected;
        if (delay >= MIN_DELAY_SEC && delay <= MAX_DELAY_SEC && p.progress >= -0.02) {
          return {
            vehicle: keep,
            progress: p.progress,
            delaySec: delay,
            offsetM: p.offsetM,
            heading: p.heading,
            score: 0,
          };
        }
      }
    }
  }
  return best;
}
