// Wyliczanie stanu podróży w czasie: co robi użytkownik, ile mu zostało i
// jak daleko jest pojazd. To jedyne miejsce, które interpretuje surowe
// czasy z rozkładu — reszta (powiadomienie, Live Activity, karta w aplikacji)
// bierze już gotowy TripProgress.
//
// Czasy w GTFS to 'HH:MM' (sekundy od północy), a odcinki mogą się
// przekroczyć północ, dlatego liczymy bezwzględne znaczniki ms i osobno
// dbamy o monotoniczność kolejnych odcinków.

import { buildFallbackStops, findUserSegment, locateVehicle } from '../../components/LegTimeline';
import { getLineColors, inferTransitMode } from '../../components/LineBadge';
import type { Connection, Leg, LegStop, VehiclePosition } from '../../types/models';
import {
  clamp01,
  formatClock,
  parseClock,
  toAbsoluteMs,
} from './format';
import type { TripPhase, TripProgress } from './types';

const DAY = 86400;

export interface TripProgressInput {
  /** Ustaw, żeby dać odcinkom poprawne daty po północy. */
  now?: Date;
  /** Pojazd dopasowany do odcinka (z liveTracker / getVehicles). */
  vehicle?: VehiclePosition | null;
  /** Tempo chodzenia — do estymacji dojścia do przystanku. */
  walkSpeedMps?: number;
}

/** Surowe sekundy odcinków, z monotoniczną poprawką na przejście przez północ. */
function legSecsOf(legs: Leg[]): { departSec: number[]; arriveSec: number[] } {
  const departSec: number[] = [];
  const arriveSec: number[] = [];
  let prevDepart = 0;
  for (const leg of legs) {
    const rawDep = parseClock(leg.departAt) ?? 0;
    const rawArr = parseClock(leg.arriveAt) ?? rawDep;
    // Godzina na GTFS jest zawsze z tego samego dnia; jeśli jest mniejsza niż
    // poprzedni odcinek, to znaczy że przekroczyliśmy północ.
    let dep = rawDep;
    if (dep < prevDepart) dep += DAY;
    let arr = rawArr;
    if (arr < dep) arr += DAY;
    departSec.push(dep);
    arriveSec.push(arr);
    prevDepart = dep;
  }
  return { departSec, arriveSec };
}

function toMsAll(secList: number[], now: Date): number[] {
  return secList.map((s) => toAbsoluteMs(s, now));
}

interface ActiveLeg {
  leg: Leg;
  index: number;
  departMs: number;
  arriveMs: number;
}

function findActiveLeg(legs: Leg[], departMs: number[], arriveMs: number[], nowMs: number): ActiveLeg | null {
  for (let i = 0; i < legs.length; i++) {
    if (nowMs >= departMs[i]) {
      return { leg: legs[i], index: i, departMs: departMs[i], arriveMs: arriveMs[i] };
    }
  }
  return null;
}

function firstTransitLegIndex(legs: Leg[]): number {
  return legs.findIndex((l) => l.mode !== 'walk');
}

function boardingLeg(legs: Leg[]): Leg | null {
  const i = firstTransitLegIndex(legs);
  return i >= 0 ? legs[i] : null;
}

/** Odcinek pieszy prowadzący do wsiadania (może być zarówno na start, jak i przy przesiadce). */
function approachWalkLeg(legs: Leg[], transitIndex: number): Leg | null {
  if (transitIndex <= 0) return null;
  const prev = legs[transitIndex - 1];
  return prev && prev.mode === 'walk' ? prev : null;
}

function pickStops(leg: Leg): LegStop[] {
  return buildFallbackStops(leg);
}

/** Czy podany pojazd pasuje do odcinka. Najmocniejsze kryterium to trip_id. */
function vehicleMatchesLeg(leg: Leg, vehicle: VehiclePosition | null | undefined): boolean {
  if (!vehicle || leg.mode === 'walk') return false;
  if (leg.tripId && vehicle.matchedTripId) return leg.tripId === vehicle.matchedTripId;
  if (!leg.line) return false;
  return leg.line.trim().toUpperCase() === vehicle.line.trim().toUpperCase();
}

/** Odległość do następnego przystanku w twoim odcinku, na podstawie pozycji pojazdu. */
interface VehicleProgress {
  tracked: boolean;
  label: string | null;
  /** 0..1 postęp twojego odcinka z liczenia przesiadkowych przystanków. */
  legProgress: number;
  nextStop: string | null;
  hopsLeft: number | null;
}

function vehicleProgress(
  leg: Leg,
  vehicle: VehiclePosition | null | undefined,
  timeProgress: number,
): VehicleProgress {
  const stops = pickStops(leg);
  const segment = findUserSegment(stops, leg);
  const span = Math.max(1, segment.end - segment.start);
  const hops = Math.max(1, leg.stopsCount || span);

  if (vehicleMatchesLeg(leg, vehicle)) {
    const gap = locateVehicle(stops, leg, vehicle ?? null);
    if (gap.gap >= 0) {
      const idx = Math.min(segment.end, Math.max(segment.start, gap.gap + 1));
      const done = clamp01((idx - segment.start) / span);
      const isLast = idx >= segment.end;
      return {
        tracked: true,
        label: gap.label,
        legProgress: Math.max(timeProgress, done),
        nextStop: isLast ? null : (stops[idx]?.name ?? null),
        hopsLeft: isLast ? 0 : Math.max(1, Math.round((1 - done) * hops)),
      };
    }
    return { tracked: false, label: gap.label, legProgress: timeProgress, nextStop: null, hopsLeft: null };
  }

  // Brak GPS — interpolujemy po czasie i nazwiemy przybliżony przystanek.
  const idx = Math.min(segment.end, segment.start + Math.floor(timeProgress * span));
  const isLast = idx >= segment.end;
  return {
    tracked: false,
    label: null,
    legProgress: timeProgress,
    nextStop: isLast ? null : (stops[idx]?.name ?? null),
    hopsLeft: isLast ? 0 : Math.max(1, Math.round((1 - timeProgress) * hops)),
  };
}

/**
 * Stan podróży w danym momencie. Funkcja czysta: ten sam
 * (connection, now, vehicle) zawsze daje ten sam TripProgress, więc można
 * ją bezpiecznie wołać z tickera, z odświeżenia i z testów.
 */
export function computeTripProgress(
  conn: Connection,
  input: TripProgressInput = {},
): TripProgress {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const walkSpeed = input.walkSpeedMps ?? 1.3;
  const legs = conn.legs;
  const boardIndex = firstTransitLegIndex(legs);
  const boardLeg = boardingLeg(legs);

  const { departSec: rawLegDep, arriveSec: rawLegArr } = legSecsOf(legs);
  const legDepartMs = toMsAll(rawLegDep, now);
  const legArriveMs = toMsAll(rawLegArr, now);

  const departAtMs = toAbsoluteMs(conn.departureSec, now);
  // Godzina przyjazdu bierzemy z ostatniego odcinka (ma poprawkę na północ);
  // fallback na durationMin, gdy rozkład nie miał sekwencji odcinków.
  const lastLegArriveMs = legArriveMs.length > 0 ? legArriveMs[legArriveMs.length - 1] : null;
  const arriveAtMs =
    lastLegArriveMs != null && lastLegArriveMs > departAtMs
      ? lastLegArriveMs
      : departAtMs + conn.durationMin * 60 * 1000;

  const active = findActiveLeg(legs, legDepartMs, legArriveMs, nowMs);
  const arrived = nowMs >= arriveAtMs;
  const beforeDeparture = nowMs < departAtMs;

  const phase = resolvePhase({
    arrived,
    beforeDeparture,
    active,
    boardIndex,
    legs,
  });

  // ─── Postęp całej podróży ────────────────────────────────────────────────
  const totalMs = Math.max(1, arriveAtMs - departAtMs);
  const progress = arrived ? 1 : clamp01((nowMs - departAtMs) / totalMs);

  // ─── Bieżący odcinek i jego postęp ───────────────────────────────────────
  const activeTransit =
    active && active.leg.mode !== 'walk' ? active : null;
  const referenceLeg = activeTransit?.leg ?? boardLeg;
  const legIndex = activeTransit?.index ?? Math.max(0, boardIndex);
  const legCount = legs.length;

  let legProgress = 0;
  if (activeTransit) {
    const span = Math.max(1, activeTransit.arriveMs - activeTransit.departMs);
    legProgress = clamp01((nowMs - activeTransit.departMs) / span);
  } else if (active && active.leg.mode === 'walk') {
    const span = Math.max(1, active.arriveMs - active.departMs);
    legProgress = clamp01((nowMs - active.departMs) / span);
  }

  const vehicle = activeTransit ? input.vehicle ?? null : null;
  const vp = referenceLeg
    ? vehicleProgress(referenceLeg, vehicle, legProgress)
    : { tracked: false, label: null, legProgress, nextStop: null, hopsLeft: null };

  if (vp.tracked && activeTransit) legProgress = vp.legProgress;

  // ─── Następny przystanek i ile do niego ─────────────────────────────────
  const perHopMin =
    activeTransit && activeTransit.leg.stopsCount > 0
      ? (activeTransit.arriveMs - activeTransit.departMs) / 60000 / activeTransit.leg.stopsCount
      : activeTransit
        ? (activeTransit.arriveMs - activeTransit.departMs) / 60000
        : 0;
  const hopsIntoLeg = activeTransit ? legProgress * Math.max(1, activeTransit.leg.stopsCount || 1) : 0;
  const nextStopInMin =
    activeTransit && perHopMin > 0
      ? Math.max(0, (1 - (hopsIntoLeg - Math.floor(hopsIntoLeg))) * perHopMin)
      : null;

  // ─── Przystanki do celu: bieżący odcinek + wszystkie kolejne ─────────────
  const stopsLeft = countStopsLeft(legs, activeTransit, legProgress, vp.hopsLeft, arrived);

  // ─── Dojście do przystanku ──────────────────────────────────────────────
  const approachIndex = activeTransit ? activeTransit.index : boardIndex;
  const walkLeg = approachWalkLeg(legs, approachIndex) ?? (boardIndex === 0 && legs[0]?.mode === 'walk' ? legs[0] : null);
  const walkMeters = walkLeg?.walkM ?? null;
  const walkSec = walkMeters != null ? Math.round(walkMeters / Math.max(0.5, walkSpeed)) : null;
  const boardAtMs = boardLeg
    ? legDepartMs[boardIndex] >= 0 && boardIndex < legDepartMs.length
      ? toAbsoluteMs(rawLegDep[boardIndex], now)
      : departAtMs
    : departAtMs;

  // ─── Linia i kolor akcentu ───────────────────────────────────────────────
  const line = referenceLeg?.line ?? '';
  const lineMode = inferTransitMode(referenceLeg?.mode, line);
  const lineColor = getLineColors(line || undefined, referenceLeg?.mode).bg;

  return {
    phase,
    progress,
    legProgress,
    departInSec: (departAtMs - nowMs) / 1000,
    departAt: conn.departAt || formatClock(rawLegDep[boardIndex] ?? 0),
    arriveAt: conn.arriveAt || formatClock(rawLegArr[legArriveMs.length - 1] ?? 0),
    departAtMs,
    arriveAtMs,
    etaMin: (arriveAtMs - nowMs) / 60000,
    leg: referenceLeg ?? null,
    legIndex,
    legCount,
    line,
    lineMode,
    lineColor,
    direction: referenceLeg?.direction ?? '',
    nextStop: vp.nextStop ?? (arrived ? conn.toTitle : null),
    nextStopInMin,
    stopsLeft,
    delayMin: conn.delayMin,
    live: conn.live,
    vehicleTracked: vp.tracked,
    vehicleLabel: vp.label,
    interchange: conn.interchange ?? null,
    transfers: conn.transfers,
    walkMeters,
    walkSec,
    boardAtMs,
    fromTitle: conn.fromTitle,
    toTitle: conn.toTitle,
  };
}

function resolvePhase(args: {
  arrived: boolean;
  beforeDeparture: boolean;
  active: ActiveLeg | null;
  boardIndex: number;
  legs: Leg[];
}): TripPhase {
  const { arrived, beforeDeparture, active, boardIndex, legs } = args;
  if (arrived) return 'arrived';
  if (!active) {
    // Jeszcze nie zaczęliśmy pierwszego odcinka: dojście albo czekanie.
    return legs[0]?.mode === 'walk' ? 'walking' : 'waiting';
  }
  if (active.leg.mode === 'walk') {
    return active.index > 0 ? 'transfer' : 'walking';
  }
  if (beforeDeparture || active.index !== boardIndex) {
    // Bieżący odcinek jeszcze nie ruszył.
    if (active.index > boardIndex) return 'transfer';
    return 'waiting';
  }
  return 'riding';
}

function countStopsLeft(
  legs: Leg[],
  activeTransit: ActiveLeg | null,
  legProgress: number,
  vehicleHopsLeft: number | null,
  arrived: boolean,
): number | null {
  if (arrived) return 0;
  const transitIdx: number[] = [];
  legs.forEach((l, i) => {
    if (l.mode !== 'walk') transitIdx.push(i);
  });
  if (transitIdx.length === 0) return null;

  const currentPos = activeTransit ? transitIdx.indexOf(activeTransit.index) : -1;
  let total = 0;
  for (let p = Math.max(0, currentPos); p < transitIdx.length; p++) {
    const leg = legs[transitIdx[p]];
    const hops = Math.max(0, leg.stopsCount || 0);
    if (p > Math.max(0, currentPos)) {
      total += hops;
    } else if (p === Math.max(0, currentPos)) {
      if (currentPos < 0) {
        total += hops;
      } else if (vehicleHopsLeft != null) {
        total += vehicleHopsLeft;
      } else {
        total += Math.round((1 - legProgress) * Math.max(1, hops || 1));
      }
    }
  }
  return total;
}

/** Ile sekund zostało do odjazdu pierwszego pojazdu, licząc dojście do przystanku. */
export function boardInSec(p: TripProgress): number {
  return (p.boardAtMs - p.departAtMs) / 1000;
}
