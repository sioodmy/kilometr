import type { Connection, Leg, LegStop, VehiclePosition } from '../../types/models';
import { buildFallbackStops, findUserSegment, locateVehicle } from '../vehiclePosition';
import { getLineColors, inferTransitMode } from '../lineIdentity';
import { clamp01, formatClock, parseClock, toAbsoluteMs } from './format';
import type { TripPhase, TripProgress } from './types';

const DAY = 86400;

export interface TripProgressInput {
  /** Ustaw, żeby dać odcinkom poprawne daty po północy. */
  now?: Date;
  /** Pojazd dopasowany do odcinka (z liveTracker). */
  vehicle?: VehiclePosition | null;
  /** Tempo chodzenia — do estymacji dojścia do przystanku. */
  walkSpeedMps?: number;
}

interface LegClock {
  departSec: number[];
  arriveSec: number[];
}

/**
 * Surowe sekundy odcinków, przestawione tak, żeby:
 *  1. były monotoniczne (kolejne odcinki nie mogą się cofnąć), oraz
 *  2. odjazd pierwszego pojazdu zgadzał się z `connection.departureSec`.
 *
 * Punkt 2 jest istotny po północy: godziny w GTFS to 'HH:MM' z jednego dnia,
 * a `departureSec` ma już offset dnia dodany przez engine. Bez kotwicy
 * podróż o 23:58 dostałaby legs o 14:10 i licznik pokazywałby 23 godziny.
 */
function legClock(legs: Leg[], boardIndex: number, departureSec: number): LegClock {
  const departSec: number[] = [];
  const arriveSec: number[] = [];
  let prevDepart = -1;
  for (const leg of legs) {
    const rawDep = parseClock(leg.departAt) ?? 0;
    const rawArr = parseClock(leg.arriveAt) ?? rawDep;
    let dep = rawDep;
    if (dep < prevDepart) dep += DAY;
    let arr = rawArr;
    if (arr < dep) arr += DAY;
    departSec.push(dep);
    arriveSec.push(arr);
    prevDepart = dep;
  }
  if (boardIndex >= 0 && boardIndex < departSec.length) {
    // Przesuwamy cały ciąg o całe doby, żeby kotwica siadła.
    const shift = Math.round((departureSec - departSec[boardIndex]) / DAY) * DAY;
    if (shift !== 0) {
      for (let i = 0; i < departSec.length; i++) {
        departSec[i] += shift;
        arriveSec[i] += shift;
      }
    }
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

/** Ostatni odcinek, który się już zaczął — nie pierwszy! */
function findActiveLeg(
  legs: Leg[],
  departMs: number[],
  arriveMs: number[],
  nowMs: number,
): ActiveLeg | null {
  let found: ActiveLeg | null = null;
  for (let i = 0; i < legs.length; i++) {
    if (nowMs >= departMs[i]) {
      found = { leg: legs[i], index: i, departMs: departMs[i], arriveMs: arriveMs[i] };
    }
  }
  return found;
}

function firstTransitLegIndex(legs: Leg[]): number {
  return legs.findIndex((l) => l.mode !== 'walk');
}

/** Pierwszy pojazd, na który jeszcze nie wsiadliśmy. */
function nextTransitLegIndex(legs: Leg[], departMs: number[], nowMs: number): number {
  for (let i = 0; i < legs.length; i++) {
    if (legs[i].mode !== 'walk' && departMs[i] > nowMs) return i;
  }
  const last = firstTransitLegIndex(legs);
  return last >= 0 ? last : 0;
}

/** Odcinek pieszy prowadzący do wsiadania (może być na start albo przy przesiadce). */
function approachWalkLeg(legs: Leg[], transitIndex: number): Leg | null {
  if (transitIndex <= 0) return null;
  const prev = legs[transitIndex - 1];
  return prev && prev.mode === 'walk' ? prev : null;
}

interface VehicleProgress {
  tracked: boolean;
  label: string | null;
  /** 0..1 postęp twojego odcinka z liczenia przesiadkowych przystanków. */
  legProgress: number;
  nextStop: string | null;
  hopsLeft: number | null;
}

/** Odległość do następnego przystanku w twoim odcinku, na podstawie pozycji pojazdu. */
function vehicleProgress(
  leg: Leg,
  vehicle: VehiclePosition | null | undefined,
  timeProgress: number,
  now: Date,
): VehicleProgress {
  const stops: LegStop[] = buildFallbackStops(leg);
  const segment = findUserSegment(stops, leg);
  const span = Math.max(1, segment.end - segment.start);
  const hops = Math.max(1, leg.stopsCount || span);
  // Lista przystanków bywa tylko wejściowa (gdy plan nie zdążył dociągnąć
  // sekwencji kursu). Wtedy nie znamy nazw pośrednich, ale nadal wiemy, ile
  // ich zostało — dzielimy po prostu odcinek na `stopsCount` części.
  const synthetic = stops.length < 3;

  if (!synthetic && vehicleMatchesLeg(leg, vehicle)) {
    const gap = locateVehicle(stops, leg, vehicle ?? null, now);
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

  const byTime = Math.max(0, Math.round((1 - timeProgress) * hops));
  if (synthetic) {
    return { tracked: false, label: null, legProgress: timeProgress, nextStop: null, hopsLeft: byTime };
  }

  // Brak GPS — interpolujemy po czasie i nazywamy przybliżony przystanek.
  // `+ 1`, bo w chwili odjazdu stoimy jeszcze na stops[start]; następny jest
  // dopiero stops[start + 1].
  const idx = Math.min(segment.end, segment.start + 1 + Math.floor(timeProgress * span));
  const isLast = idx >= segment.end;
  return {
    tracked: false,
    label: null,
    legProgress: timeProgress,
    nextStop: isLast ? null : (stops[idx]?.name ?? null),
    hopsLeft: isLast ? 0 : byTime,
  };
}

/** Czy podany pojazd pasuje do odcinka. Najmocniejsze kryterium to trip_id. */
function vehicleMatchesLeg(leg: Leg, vehicle: VehiclePosition | null | undefined): boolean {
  if (!vehicle || leg.mode === 'walk') return false;
  if (leg.tripId && vehicle.matchedTripId) return leg.tripId === vehicle.matchedTripId;
  if (!leg.line) return false;
  return leg.line.trim().toUpperCase() === vehicle.line.trim().toUpperCase();
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
  const hasTransit = boardIndex >= 0;

  const clock = legClock(legs, boardIndex, conn.departureSec);
  const legDepartMs = toMsAll(clock.departSec, now);
  const legArriveMs = toMsAll(clock.arriveSec, now);

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

  const phase = resolvePhase({ arrived, nowMs, active, boardIndex, legs });

  // ─── Postęp całej podróży ────────────────────────────────────────────────
  const totalMs = Math.max(1, arriveAtMs - departAtMs);
  const progress = arrived ? 1 : clamp01((nowMs - departAtMs) / totalMs);

  // ─── Bieżący odcinek i jego postęp ───────────────────────────────────────
  const activeTransit = active && active.leg.mode !== 'walk' ? active : null;
  const activeWalk = active && active.leg.mode === 'walk' ? active : null;
  const legIndex = active?.index ?? Math.max(0, boardIndex);
  const legCount = legs.length;

  let legProgress = 0;
  if (active) {
    const span = Math.max(1, active.arriveMs - active.departMs);
    legProgress = clamp01((nowMs - active.departMs) / span);
  }

  // ─── Wsiadanie ───────────────────────────────────────────────────────────
  // Gdy jesteśmy w trakcie, `boardAtMs` to najbliższy jeszcze nieodjechany
  // pojazd (przesiadka), a nie ten, którym właśnie jedziemy.
  const nextTransitIndex = nextTransitLegIndex(legs, legDepartMs, nowMs);
  // Odcinek pokazywany w powiadomieniu (linia, kierunek, kolor) to zawsze
  // pojazd: ten, którym jedziemy, albo ten, do którego idziemy. Odcinek
  // pieszy nie ma linii, a pokazywanie „Pieszo" zamiast „Tramwaj 4" w chwili
  // dojścia do przystanku myliłoby.
  const lineLeg = activeTransit?.leg ?? legs[nextTransitIndex] ?? legs[boardIndex] ?? null;
  const boardAtMs =
    hasTransit && nextTransitIndex < legDepartMs.length
      ? legDepartMs[nextTransitIndex]
      : departAtMs;

  const vehicle = activeTransit ? (input.vehicle ?? null) : null;
  const vp = lineLeg
    ? vehicleProgress(lineLeg, vehicle, legProgress, now)
    : { tracked: false, label: null, legProgress, nextStop: null, hopsLeft: null };

  if (vp.tracked && activeTransit) legProgress = vp.legProgress;

  // Postęp samego dojścia do przystanku — jedyna liczba, która ma sens
  // w fazie „idę", bo podróż jeszcze się nie zaczęła.
  const approachProgress = activeWalk ? legProgress : null;

  // ─── Następny przystanek i ile do niego ─────────────────────────────────
  const legHops = activeTransit ? Math.max(1, activeTransit.leg.stopsCount || 1) : 1;
  const perHopMin =
    activeTransit && activeTransit.leg.stopsCount > 0
      ? (activeTransit.arriveMs - activeTransit.departMs) / 60000 / activeTransit.leg.stopsCount
      : activeTransit
        ? (activeTransit.arriveMs - activeTransit.departMs) / 60000
        : 0;
  const hopsIntoLeg = activeTransit ? legProgress * legHops : 0;
  const nextStopInMin =
    activeTransit && perHopMin > 0
      ? Math.max(0, (1 - (hopsIntoLeg - Math.floor(hopsIntoLeg))) * perHopMin)
      : null;

  // ─── Przystanki do celu: bieżący odcinek + wszystkie kolejne ─────────────
  const stopsLeft = countStopsLeft(legs, activeTransit, legProgress, vp.hopsLeft, arrived);

  const walkLeg = approachWalkLeg(
    legs,
    phase === 'transfer' ? nextTransitIndex : (active?.index ?? boardIndex),
  );
  const walkMeters = walkLeg?.walkM ?? null;
  const walkSec = walkMeters != null ? Math.round(walkMeters / Math.max(0.5, walkSpeed)) : null;

  // ─── Linia i kolor akcentu ───────────────────────────────────────────────
  const line = lineLeg?.line ?? '';
  const lineMode = inferTransitMode(lineLeg?.mode, line);
  const lineColor = getLineColors(line || undefined, lineLeg?.mode).bg;
  // Przystanek, na którym stoimy: idziemy do `toStop` odcinka pieszego,
  // a w pojeździe jesteśmy na `fromStop` odcinka, którym jedziemy.
  const stopName = activeWalk
    ? (activeWalk.leg.toStop || lineLeg?.fromStop)
    : (lineLeg?.fromStop ?? conn.toTitle);

  return {
    phase,
    progress,
    legProgress,
    approachProgress,
    departInSec: (departAtMs - nowMs) / 1000,
    departAt: conn.departAt || formatClock(clock.departSec[boardIndex] ?? 0),
    arriveAt: conn.arriveAt || formatClock(clock.arriveSec[legArriveMs.length - 1] ?? 0),
    departAtMs,
    arriveAtMs,
    etaMin: (arriveAtMs - nowMs) / 60000,
    leg: lineLeg,
    legIndex,
    legCount,
    line,
    lineMode,
    lineColor,
    direction: lineLeg?.direction ?? '',
    // Przed odjazdem nie ma jeszcze „następnego przystanku" — stoimy na tym,
    // do którego mamy dojść. Wtedy pokazujemy nazwę przystanku jako `stopName`.
    nextStop: activeTransit ? (vp.nextStop ?? null) : arrived ? conn.toTitle : null,
    stopName,
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
    boardInSec: (boardAtMs - nowMs) / 1000,
    fromTitle: conn.fromTitle,
    toTitle: conn.toTitle,
  };
}

/**
 * Ile po odjeździe uznajemy, że użytkownik jest w pojeździe. Z rozkładu
 * nie da się tego ustalić (nie wiemy, czy zdążył do przystanku), więc
 * przyjmujemy krótką grzeczność: sekundy wokół odjazdu to jeszcze
 * „czekanie / wsiadanie", a nie „w trasie".
 */
const BOARDING_GRACE_SEC = 45;

function resolvePhase(args: {
  arrived: boolean;
  nowMs: number;
  active: ActiveLeg | null;
  boardIndex: number;
  legs: Leg[];
}): TripPhase {
  const { arrived, nowMs, active, boardIndex, legs } = args;
  if (arrived) return 'arrived';
  if (boardIndex < 0) return 'walking';
  if (!active) {
    // Żaden odcinek się nie zaczął: idziemy albo stoimy na przystanku.
    return legs[0]?.mode === 'walk' ? 'walking' : 'waiting';
  }
  if (active.leg.mode === 'walk') {
    return active.index > 0 ? 'transfer' : 'walking';
  }
  if (nowMs < active.departMs + BOARDING_GRACE_SEC * 1000) {
    // Jeszcze okno wsiadania. Przy przesiadce to wciąż „przesiadka",
    // bo użytkownik dopiero wychodzi z pierwszego pojazdu.
    return active.index === boardIndex ? 'waiting' : 'transfer';
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
  const transitLegs = legs.filter((l) => l.mode !== 'walk');
  if (transitLegs.length === 0) return null;

  // Pozycja wśród pojazdów, -1 = jeszcze nie wsiedliśmy.
  const pos = activeTransit ? transitLegs.indexOf(activeTransit.leg) : -1;
  const from = pos < 0 ? 0 : pos;
  let total = 0;
  for (let p = from; p < transitLegs.length; p++) {
    const hops = Math.max(0, transitLegs[p].stopsCount || 0);
    if (p > from) {
      total += hops;
    } else if (pos < 0) {
      // Cały pierwszy pojazd jeszcze przed nami.
      total += hops;
    } else if (vehicleHopsLeft != null) {
      total += vehicleHopsLeft;
    } else {
      total += Math.round((1 - legProgress) * Math.max(1, hops));
    }
  }
  return total;
}
