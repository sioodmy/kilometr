// Wyszukiwanie i podmiana alternatywnych miejskich nóg podróży w szczegółach połączenia.
//
// Zasady domenowe:
// - Wymieniamy WYŁĄCZNIE połączenia miejskie (tramwaj, autobus, metro, trolejbus, kolejka linowa).
// - Pociągi (regionalne i dalekobieżne) nigdy nie są wymieniane ani proponowane jako zamiennik.
// - Kandydat musi pasować do sąsiednich nóg z uwzględnieniem dojścia pieszego i bufora przesiadki.
// - Skany działają wyłącznie na wczytanym wycinku DayIndex w pamięci (bez przebudowy RAPTOR-a).

import {
  distanceMeters,
  secondsToTimeString,
  timeStringToSeconds,
  warsawNow,
} from '../../gtfs/geo';
import { isFareBoundary } from '../../gtfs/fareBoundary';
import type { GtfsRoute, GtfsStop, GtfsStopTime } from '../../gtfs/types';
import type { Connection, Leg, LegMode } from '../../types/models';
import { isTrainLeg } from '../railIdentity';
import {
  getSettingsSync,
  profileWalkSpeedMps,
  type RoutingSettings,
} from '../settings';
import { liveTracker } from '../liveTracker';
import { stableConnectionId } from './connectionIdentity';
import { scheduledLegTimes } from './connectionTimes';
import { predictDelaySec } from './delays';
import { buildLegStops, buildSearchSlices, snapMetroEntranceLegs } from './engine';
import { classifyTransitMode } from './network';
import { gtfsStore, type DayIndex, type Footpath, type LocalGtfsStore } from './store';
import type { AllowedTransferModes } from './types';

const WALK_DETOUR_FACTOR = 1.15;
/** Maksymalne przesunięcie przystanku względem kotwicy (ten sam węzeł / sąsiednie słupki). */
const MAX_ANCHOR_SHIFT_M = 280;
/** Maksymalny spacer na przesiadce dla alternatywnego słupka. */
const MAX_TRANSFER_WALK_M = 600;
/** Minimalny sensowny bufor przesiadki między pojazdami miejskimi (s). */
const MIN_URBAN_TRANSFER_FLOOR_SEC = 45;
/** Minimalny bufor przed pociągiem, nawet jeśli pierwotna przesiadka była ciaśniejsza (s). */
const MIN_TRAIN_TRANSFER_FLOOR_SEC = 180;
/** Domyślne okno wstecz i w przód przy pierwszym leniwym załadowaniu (s). */
export const INITIAL_LOOKBACK_SEC = 60 * 60;
export const INITIAL_LOOKAHEAD_SEC = 90 * 60;
/** Krok rozszerzania okna po dojściu do krawędzi listy (s). */
export const EXPAND_STEP_SEC = 90 * 60;
/** Maksymalny zasięg rozszerzania w jedną stronę (s). */
export const MAX_EXPAND_SPAN_SEC = 4 * 60 * 60;

/** Lekki podgląd alternatywnego kursu bez rozwijania listy przystanków pośrednich. */
export interface LegAlternative {
  key: string;
  tripId: string;
  routeId: string;
  line: string;
  mode: LegMode;
  direction: string;
  fromStopId: string;
  fromStop: string;
  fromLat?: number;
  fromLon?: number;
  platformCode?: string;
  toStopId: string;
  toStop: string;
  toLat?: number;
  toLon?: number;
  scheduledDepartureSec: number;
  scheduledArrivalSec: number;
  effectiveDepartureSec: number;
  effectiveArrivalSec: number;
  delaySec: number;
  arrivalDelaySec: number;
  live: boolean;
  stopsCount: number;
  boardWalkM: number;
  boardWalkSec: number;
  alightWalkM: number;
  alightWalkSec: number;
  isCurrent: boolean;
  /** Przesunięcie zegara wzorca względem dnia serwisowego (0, -86400 lub +86400). */
  patternOffsetSec: number;
  /** Przesunięcie dnia serwisowego (0 dla dziś, 86400 dla jutra itd.). */
  dayOffsetSec: number;
}

/** Ograniczenia czasowe i przestrzenne sąsiednich nóg dla wybranej nogi komunikacji. */
export interface LegSwapConstraints {
  legIndex: number;
  /** Znormalizowany odjazd bieżącej nogi (sekundy na monotonicznej osi podróży). */
  currentDepartSec: number;
  /** Znormalizowany przyjazd bieżącej nogi (sekundy na monotonicznej osi podróży). */
  currentArriveSec: number;
  /** Najwcześniejszy możliwy odjazd przed doliczeniem spaceru i bufora, albo null gdy pierwsza noga. */
  prevArriveSec: number | null;
  /** Najpóźniejszy możliwy przyjazd po odliczeniu spaceru i bufora, albo null gdy ostatnia noga. */
  nextDepartSec: number | null;
  prevTransitIndex: number | null;
  nextTransitIndex: number | null;
  prevTransitLeg?: Leg;
  nextTransitLeg?: Leg;
  prevWalkLeg?: Leg;
  nextWalkLeg?: Leg;
  minTransferBeforeSec: number;
  minTransferAfterSec: number;
  origBeforeWalkM: number;
  origAfterWalkM: number;
  walkSpeedMps: number;
  maxWalkM: number;
  /** Znormalizowany czas bazowy dnia (0 dla dziś, 86400 dla jutra itd.). */
  dayOffsetSec: number;
}

/** Minimalny interfejs magazynu potrzebny do skanowania (ułatwia testy bez SQLite). */
export interface LegAlternativeStoreView {
  stops: Map<string, GtfsStop>;
  routes: Map<string, GtfsRoute>;
  stopTimes: Map<string, GtfsStopTime[]>;
  footpaths: Map<string, Footpath[]>;
}

/** Kandydat na przystanek wsiadania lub wysiadania wraz z kosztem dojścia. */
interface StopOption {
  stopId: string;
  stop: GtfsStop;
  walkM: number;
  walkSec: number;
  isAnchor: boolean;
}

/** Wynik wyszukania alternatyw dla danej nogi w zadanym oknie. */
export interface LegAlternativesResult {
  alternatives: LegAlternative[];
  currentIndex: number;
  windowStartSec: number;
  windowEndSec: number;
  canExpandEarlier: boolean;
  canExpandLater: boolean;
  constraints: LegSwapConstraints;
}

/** Sprawdza, czy noga jest pociągiem (regionalnym lub ogólnopolskim). */
function isRailOrNationalLeg(leg: Leg): boolean {
  if (isTrainLeg(leg)) return true;
  if (leg.routeId?.startsWith('pl:')) return true;
  if (leg.toStopId?.startsWith('pl:') || leg.toStopId?.startsWith('stop-pl:')) return true;
  return false;
}

/**
 * Zwraca true, jeśli nogę pod `legIndex` wolno wymieniać na wcześniejszy/późniejszy
 * kurs miejski. Pociągi, odcinki piesze i pojazd, w którym pasażer już jedzie, są wykluczone.
 */
export function isSwappableUrbanLeg(connection: Connection, legIndex: number): boolean {
  const leg = connection.legs[legIndex];
  if (!leg || leg.mode === 'walk') return false;
  if (isRailOrNationalLeg(leg)) return false;
  if (!leg.fromStopId || !leg.toStopId) return false;
  if (connection.boarded) {
    const firstTransitIndex = connection.legs.findIndex((item) => item.mode !== 'walk');
    if (legIndex === firstTransitIndex) return false;
  }
  return true;
}

/** Oblicza czas przejścia pieszo z dystansu w metrach (z uwzględnieniem krętości ulic). */
function walkSecondsFromMeters(meters: number, walkSpeedMps: number): number {
  if (meters <= 0) return 0;
  return Math.max(30, Math.round((meters * WALK_DETOUR_FACTOR) / Math.max(0.6, walkSpeedMps)));
}

/** Zwraca monotoniczne czasy [departSec, arriveSec] dla każdej nogi połączenia. */
function normalizeConnectionTimeline(
  connection: Connection,
): Array<{ departSec: number; arriveSec: number }> {
  const result: Array<{ departSec: number; arriveSec: number }> = [];
  const baseDayOffset =
    typeof connection.departureSec === 'number' && Number.isFinite(connection.departureSec)
      ? Math.floor(connection.departureSec / 86400) * 86400
      : 0;

  let cursor =
    typeof connection.departureSec === 'number' && Number.isFinite(connection.departureSec)
      ? connection.departureSec
      : baseDayOffset + timeStringToSeconds(connection.departAt);

  for (const leg of connection.legs) {
    const sched = scheduledLegTimes(leg, cursor);
    let dep =
      sched.departure != null
        ? sched.departure + (leg.delaySec ?? 0)
        : baseDayOffset + timeStringToSeconds(leg.departAt);
    while (dep < cursor - 12 * 3600) dep += 86400;
    while (dep > cursor + 18 * 3600) dep -= 86400;

    let arr =
      sched.arrival != null
        ? sched.arrival + (leg.arrivalDelaySec ?? leg.delaySec ?? 0)
        : baseDayOffset + timeStringToSeconds(leg.arriveAt);
    while (arr < dep) arr += 86400;
    while (arr > dep + 18 * 3600) arr -= 86400;

    result.push({ departSec: dep, arriveSec: arr });
    cursor = arr;
  }

  return result;
}

/** Wyznacza przesunięcie dnia serwisowego połączenia względem dzisiejszej daty w Warszawie. */
function resolveConnectionDayShift(connection: Connection): number {
  if (connection.serviceDate) {
    const match = connection.serviceDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const today = warsawNow();
      const tMatch = today.dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (tMatch) {
        const targetUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        const todayUtc = Date.UTC(Number(tMatch[1]), Number(tMatch[2]) - 1, Number(tMatch[3]));
        const diff = Math.round((targetUtc - todayUtc) / 86_400_000);
        if (diff >= -2 && diff <= 14) return diff;
      }
    }
  }
  if (typeof connection.departureSec === 'number' && Number.isFinite(connection.departureSec)) {
    return Math.floor(connection.departureSec / 86400);
  }
  return 0;
}

/**
 * Wyznacza ograniczenia czasowe i bufor przesiadki dla nogi pod `legIndex`.
 * Sąsiednie nogi komunikacji pozostają zakotwiczone na swoich efektywnych godzinach.
 */
export function extractLegSwapConstraints(
  connection: Connection,
  legIndex: number,
  settings?: Partial<RoutingSettings>,
): LegSwapConstraints {
  const walkSpeedMps = settings?.walkPace ? profileWalkSpeedMps(settings.walkPace) : 1.34;
  const baseMinTransfer = settings?.minTransferSec ?? 120;
  const baseTrainTransfer = settings?.trainMinTransferSec ?? 300;
  const maxWalkM = settings?.maxWalkM ?? 800;

  const timeline = normalizeConnectionTimeline(connection);
  const current = timeline[legIndex];

  let prevTransitIndex: number | null = null;
  for (let i = legIndex - 1; i >= 0; i--) {
    if (connection.legs[i].mode !== 'walk') {
      prevTransitIndex = i;
      break;
    }
  }

  let nextTransitIndex: number | null = null;
  for (let i = legIndex + 1; i < connection.legs.length; i++) {
    if (connection.legs[i].mode !== 'walk') {
      nextTransitIndex = i;
      break;
    }
  }

  const prevWalkLeg =
    legIndex > 0 && connection.legs[legIndex - 1].mode === 'walk'
      ? connection.legs[legIndex - 1]
      : undefined;
  const nextWalkLeg =
    legIndex + 1 < connection.legs.length && connection.legs[legIndex + 1].mode === 'walk'
      ? connection.legs[legIndex + 1]
      : undefined;

  const prevTransitLeg = prevTransitIndex !== null ? connection.legs[prevTransitIndex] : undefined;
  const nextTransitLeg = nextTransitIndex !== null ? connection.legs[nextTransitIndex] : undefined;

  const prevArriveSec = prevTransitIndex !== null ? timeline[prevTransitIndex].arriveSec : null;
  const nextDepartSec = nextTransitIndex !== null ? timeline[nextTransitIndex].departSec : null;

  const origBeforeWalkM = prevWalkLeg?.walkM ?? 0;
  const origAfterWalkM = nextWalkLeg?.walkM ?? 0;
  const origBeforeWalkSec = walkSecondsFromMeters(origBeforeWalkM, walkSpeedMps);
  const origAfterWalkSec = walkSecondsFromMeters(origAfterWalkM, walkSpeedMps);

  let minTransferBeforeSec = 0;
  if (prevArriveSec !== null) {
    const origGap = Math.max(0, current.departSec - prevArriveSec - origBeforeWalkSec);
    minTransferBeforeSec = Math.min(
      baseMinTransfer,
      Math.max(MIN_URBAN_TRANSFER_FLOOR_SEC, origGap),
    );
  }

  let minTransferAfterSec = 0;
  if (nextDepartSec !== null && nextTransitLeg) {
    const origGap = Math.max(0, nextDepartSec - current.arriveSec - origAfterWalkSec);
    if (isRailOrNationalLeg(nextTransitLeg)) {
      minTransferAfterSec = Math.min(
        baseTrainTransfer,
        Math.max(MIN_TRAIN_TRANSFER_FLOOR_SEC, origGap),
      );
    } else {
      minTransferAfterSec = Math.min(
        baseMinTransfer,
        Math.max(MIN_URBAN_TRANSFER_FLOOR_SEC, origGap),
      );
    }
  }

  const dayOffsetSec = Math.floor(current.departSec / 86400) * 86400;

  return {
    legIndex,
    currentDepartSec: current.departSec,
    currentArriveSec: current.arriveSec,
    prevArriveSec,
    nextDepartSec,
    prevTransitIndex,
    nextTransitIndex,
    prevTransitLeg,
    nextTransitLeg,
    prevWalkLeg,
    nextWalkLeg,
    minTransferBeforeSec,
    minTransferAfterSec,
    origBeforeWalkM,
    origAfterWalkM,
    walkSpeedMps,
    maxWalkM,
    dayOffsetSec,
  };
}

/** Zwraca bezpośredni spacer między dwoma przystankami (z footpatha lub z odległości). */
function transferWalkBetween(
  fromStopId: string,
  toStopId: string,
  walkSpeedMps: number,
  store: LegAlternativeStoreView,
): { walkM: number; walkSec: number } | null {
  if (fromStopId === toStopId) return { walkM: 0, walkSec: 0 };
  const paths = store.footpaths.get(fromStopId);
  if (paths) {
    const hit = paths.find((p) => p.to_stop_id === toStopId);
    if (hit) {
      return {
        walkM: Math.round(hit.distance_m),
        walkSec: hit.fixed
          ? hit.duration_sec
          : walkSecondsFromMeters(hit.distance_m, walkSpeedMps),
      };
    }
  }
  const from = store.stops.get(fromStopId);
  const to = store.stops.get(toStopId);
  if (!from || !to) return null;
  const distM = Math.round(distanceMeters(from.stop_lat, from.stop_lon, to.stop_lat, to.stop_lon));
  return {
    walkM: distM,
    walkSec: walkSecondsFromMeters(distM, walkSpeedMps),
  };
}

/**
 * Zbiera przystanki kandydackie wokół przystanku kotwicy (ten sam słupek + pobliskie
 * słupki tego samego węzła przesiadkowego), pilnując dopuszczalnego spaceru.
 */
function collectCandidateStops(params: {
  anchorStopId: string;
  neighborStopId?: string;
  endpointCoords?: { lat: number; lon: number };
  origWalkM: number;
  walkSpeedMps: number;
  maxWalkM: number;
  direction: 'board' | 'alight';
  store: LegAlternativeStoreView;
}): StopOption[] {
  const {
    anchorStopId,
    neighborStopId,
    endpointCoords,
    origWalkM,
    walkSpeedMps,
    maxWalkM,
    direction,
    store,
  } = params;
  const anchor = store.stops.get(anchorStopId);
  if (!anchor || isFareBoundary(anchor.stop_name ?? '')) return [];

  const maxAllowedTransferM = Math.min(MAX_TRANSFER_WALK_M, Math.max(300, origWalkM + 200));
  const maxAllowedEndpointM = Math.min(maxWalkM, Math.max(350, origWalkM + 250));

  const seen = new Set<string>();
  const out: StopOption[] = [];

  const consider = (stopId: string, isAnchor: boolean) => {
    if (seen.has(stopId)) return;
    const stop = store.stops.get(stopId);
    if (!stop || isFareBoundary(stop.stop_name ?? '')) return;

    if (!isAnchor) {
      const shiftM = distanceMeters(anchor.stop_lat, anchor.stop_lon, stop.stop_lat, stop.stop_lon);
      if (shiftM > MAX_ANCHOR_SHIFT_M) return;
    }

    let walkM = origWalkM;
    let walkSec = walkSecondsFromMeters(origWalkM, walkSpeedMps);

    if (neighborStopId) {
      const fromId = direction === 'board' ? neighborStopId : stopId;
      const toId = direction === 'board' ? stopId : neighborStopId;
      const walk = transferWalkBetween(fromId, toId, walkSpeedMps, store);
      if (!walk) {
        if (!isAnchor) return;
      } else {
        if (!isAnchor && walk.walkM > maxAllowedTransferM) return;
        walkM = walk.walkM;
        walkSec = walk.walkSec;
      }
    } else if (endpointCoords) {
      const distM = Math.round(
        distanceMeters(endpointCoords.lat, endpointCoords.lon, stop.stop_lat, stop.stop_lon),
      );
      if (!isAnchor && distM > maxAllowedEndpointM) return;
      walkM = isAnchor && origWalkM > 0 ? origWalkM : distM;
      walkSec = walkSecondsFromMeters(walkM, walkSpeedMps);
    } else if (!isAnchor) {
      const shiftM = Math.round(
        distanceMeters(anchor.stop_lat, anchor.stop_lon, stop.stop_lat, stop.stop_lon),
      );
      walkM = shiftM;
      walkSec = walkSecondsFromMeters(shiftM, walkSpeedMps);
    }

    seen.add(stopId);
    out.push({ stopId, stop, walkM, walkSec, isAnchor });
  };

  consider(anchorStopId, true);

  for (const fp of store.footpaths.get(anchorStopId) ?? []) {
    if (fp.distance_m <= MAX_ANCHOR_SHIFT_M) {
      consider(fp.to_stop_id, false);
    }
  }
  if (neighborStopId && neighborStopId !== anchorStopId) {
    for (const fp of store.footpaths.get(neighborStopId) ?? []) {
      if (fp.distance_m <= maxAllowedTransferM) {
        consider(fp.to_stop_id, false);
      }
    }
  }

  return out;
}

function isModeAllowed(
  mode: LegMode,
  originalMode: LegMode,
  allowedModes?: AllowedTransferModes,
  cableEnabled = true,
): boolean {
  // Pociągów nigdy nie dopuszczamy jako zamiennika miejskiego.
  if (mode === 'train' || mode === 'walk') return false;
  if (mode === originalMode) return true;
  if (mode === 'cable' && !cableEnabled) return false;
  if (!allowedModes) return true;
  return allowedModes[mode] !== false;
}

/** Tworzy wpis `LegAlternative` reprezentujący bieżącą nogę, aby zawsze była na liście. */
function buildCurrentAlternative(
  leg: Leg,
  constraints: LegSwapConstraints,
): LegAlternative {
  const sched = scheduledLegTimes(leg, constraints.currentDepartSec);
  const schedDep = sched.departure ?? constraints.currentDepartSec - (leg.delaySec ?? 0);
  const schedArr =
    sched.arrival ?? constraints.currentArriveSec - (leg.arrivalDelaySec ?? leg.delaySec ?? 0);
  return {
    key: leg.tripId ? `trip:${leg.tripId}` : `leg:${leg.id}:${constraints.currentDepartSec}`,
    tripId: leg.tripId ?? '',
    routeId: leg.routeId ?? '',
    line: leg.line ?? '',
    mode: leg.mode,
    direction: leg.direction ?? '',
    fromStopId: leg.fromStopId ?? '',
    fromStop: leg.fromStop,
    fromLat: leg.fromLat,
    fromLon: leg.fromLon,
    platformCode: leg.platformCode,
    toStopId: leg.toStopId ?? '',
    toStop: leg.toStop,
    toLat: leg.toLat,
    toLon: leg.toLon,
    scheduledDepartureSec: schedDep,
    scheduledArrivalSec: schedArr,
    effectiveDepartureSec: constraints.currentDepartSec,
    effectiveArrivalSec: constraints.currentArriveSec,
    delaySec: leg.delaySec ?? 0,
    arrivalDelaySec: leg.arrivalDelaySec ?? leg.delaySec ?? 0,
    live: leg.live,
    stopsCount: leg.stopsCount,
    boardWalkM: constraints.origBeforeWalkM,
    boardWalkSec: walkSecondsFromMeters(constraints.origBeforeWalkM, constraints.walkSpeedMps),
    alightWalkM: constraints.origAfterWalkM,
    alightWalkSec: walkSecondsFromMeters(constraints.origAfterWalkM, constraints.walkSpeedMps),
    isCurrent: true,
    patternOffsetSec: 0,
    dayOffsetSec: constraints.dayOffsetSec,
  };
}

export interface FindInIndexParams {
  leg: Leg;
  constraints: LegSwapConstraints;
  anchorFromStopId: string;
  anchorToStopId: string;
  dayIndex: DayIndex;
  patternTimeOffsets?: ReadonlyMap<string, number>;
  store: LegAlternativeStoreView;
  windowStartSec: number;
  windowEndSec: number;
  tripDelays?: ReadonlyMap<string, number>;
  nowSec?: number;
  allowedModes?: AllowedTransferModes;
  cableEnabled?: boolean;
  originCoords?: { lat: number; lon: number };
  destinationCoords?: { lat: number; lon: number };
}

/**
 * Skanuje wzorce w gotowym `DayIndex` i zwraca wszystkie pasujące miejskie alternatywy
 * posortowane chronologicznie. Czysta funkcja w pamięci, bez wywołań SQL.
 */
export function findLegAlternativesInIndex(params: FindInIndexParams): LegAlternativesResult {
  const {
    leg,
    constraints,
    anchorFromStopId,
    anchorToStopId,
    dayIndex,
    patternTimeOffsets,
    store,
    windowStartSec,
    windowEndSec,
    tripDelays,
    nowSec,
    allowedModes,
    cableEnabled = true,
    originCoords,
    destinationCoords,
  } = params;

  const currentAlt = buildCurrentAlternative(leg, constraints);

  const boardStops = collectCandidateStops({
    anchorStopId: anchorFromStopId,
    neighborStopId: constraints.prevTransitLeg?.toStopId,
    endpointCoords: constraints.prevTransitLeg ? undefined : originCoords,
    origWalkM: constraints.origBeforeWalkM,
    walkSpeedMps: constraints.walkSpeedMps,
    maxWalkM: constraints.maxWalkM,
    direction: 'board',
    store,
  });
  const alightStops = collectCandidateStops({
    anchorStopId: anchorToStopId,
    neighborStopId: constraints.nextTransitLeg?.fromStopId,
    endpointCoords: constraints.nextTransitLeg ? undefined : destinationCoords,
    origWalkM: constraints.origAfterWalkM,
    walkSpeedMps: constraints.walkSpeedMps,
    maxWalkM: constraints.maxWalkM,
    direction: 'alight',
    store,
  });

  if (boardStops.length === 0 || alightStops.length === 0) {
    return {
      alternatives: [currentAlt],
      currentIndex: 0,
      windowStartSec,
      windowEndSec,
      canExpandEarlier: false,
      canExpandLater: false,
      constraints,
    };
  }

  const boardMap = new Map(boardStops.map((opt) => [opt.stopId, opt]));
  const alightMap = new Map(alightStops.map((opt) => [opt.stopId, opt]));

  const boardPatterns = new Set<string>();
  for (const b of boardStops) {
    const pats = dayIndex.stopRoutes.get(b.stopId);
    if (!pats) continue;
    for (const patId of pats) boardPatterns.add(patId);
  }

  const candidatePatterns: string[] = [];
  const seenPatterns = new Set<string>();
  for (const a of alightStops) {
    const pats = dayIndex.stopRoutes.get(a.stopId);
    if (!pats) continue;
    for (const patId of pats) {
      if (boardPatterns.has(patId) && !seenPatterns.has(patId)) {
        seenPatterns.add(patId);
        candidatePatterns.push(patId);
      }
    }
  }

  const origRideSec = Math.max(60, constraints.currentArriveSec - constraints.currentDepartSec);
  const maxRideSec = Math.max(origRideSec * 2 + 600, origRideSec + 1800);

  // Deduplikacja po tripId: dla jednego kursu wybieramy najlepszą parę przystanków.
  const bestByTrip = new Map<string, { alt: LegAlternative; score: number }>();

  for (const patId of candidatePatterns) {
    const pattern = dayIndex.patterns.get(patId);
    if (!pattern) continue;
    const route = store.routes.get(pattern.routeId);
    if (!route) continue;
    const mode = classifyTransitMode(route.route_type, route.route_short_name);
    if (!isModeAllowed(mode, leg.mode, allowedModes, cableEnabled)) continue;

    // Znajdź pary (bIdx < aIdx) w tym wzorcu.
    const boardIndices: number[] = [];
    const alightIndices: number[] = [];
    for (let idx = 0; idx < pattern.stopSequence.length; idx++) {
      const stopId = pattern.stopSequence[idx];
      if (boardMap.has(stopId)) boardIndices.push(idx);
      if (alightMap.has(stopId)) alightIndices.push(idx);
    }
    if (boardIndices.length === 0 || alightIndices.length === 0) continue;

    const patOffset = patternTimeOffsets?.get(patId) ?? 0;
    const totalOffset = constraints.dayOffsetSec + patOffset;

    for (const bIdx of boardIndices) {
      const boardOpt = boardMap.get(pattern.stopSequence[bIdx])!;
      const depRow = pattern.departures[bIdx];
      if (!depRow) continue;

      for (const aIdx of alightIndices) {
        if (aIdx <= bIdx) continue;
        const alightOpt = alightMap.get(pattern.stopSequence[aIdx])!;

        for (let tIdx = 0; tIdx < pattern.trips.length; tIdx++) {
          const rawDep = depRow[tIdx];
          if (rawDep === undefined) continue;
          const schedDep = rawDep + totalOffset;
          if (schedDep < windowStartSec - 1200 || schedDep > windowEndSec + 1200) continue;

          const trip = pattern.trips[tIdx];
          const times = store.stopTimes.get(trip.trip_id);
          if (!times || aIdx >= times.length) continue;

          const schedArr = times[aIdx].arrival_sec + totalOffset;
          const rideSec = schedArr - schedDep;
          if (rideSec <= 0 || rideSec > maxRideSec) continue;

          const measuredDelay = tripDelays?.get(trip.trip_id);
          let depDelaySec = 0;
          let arrDelaySec = 0;
          let isLive = false;
          if (measuredDelay !== undefined) {
            isLive = true;
            if (nowSec !== undefined) {
              const refNow = constraints.dayOffsetSec + nowSec;
              const vehicleClock = refNow - measuredDelay;
              depDelaySec = predictDelaySec(measuredDelay, schedDep - vehicleClock, 'board', mode);
              arrDelaySec = predictDelaySec(measuredDelay, schedArr - vehicleClock, 'arrive', mode);
            } else {
              depDelaySec = measuredDelay;
              arrDelaySec = measuredDelay;
            }
          }

          const effDep = schedDep + depDelaySec;
          const effArr = schedArr + arrDelaySec;

          if (effDep < windowStartSec || effDep > windowEndSec) continue;

          const isSameCurrentTrip =
            Boolean(leg.tripId) &&
            trip.trip_id === leg.tripId &&
            boardOpt.stopId === leg.fromStopId &&
            alightOpt.stopId === leg.toStopId;

          if (!isSameCurrentTrip) {
            if (constraints.prevArriveSec !== null) {
              const earliestBoard =
                constraints.prevArriveSec + boardOpt.walkSec + constraints.minTransferBeforeSec;
              if (effDep < earliestBoard) continue;
            }
            if (constraints.nextDepartSec !== null) {
              const latestAlight =
                constraints.nextDepartSec - alightOpt.walkSec - constraints.minTransferAfterSec;
              if (effArr > latestAlight) continue;
            }
          }

          // Policz fizyczne przystanki między bIdx i aIdx (bez granic stref).
          let physicalStops = 0;
          for (let s = bIdx + 1; s <= aIdx; s++) {
            const st = store.stops.get(pattern.stopSequence[s]);
            if (!isFareBoundary(st?.stop_name ?? '')) physicalStops++;
          }

          const alt: LegAlternative = {
            key: `trip:${trip.trip_id}`,
            tripId: trip.trip_id,
            routeId: route.route_id,
            line: route.route_short_name || route.route_id,
            mode,
            direction: trip.trip_headsign || route.route_long_name || alightOpt.stop.stop_name,
            fromStopId: boardOpt.stopId,
            fromStop: boardOpt.stop.stop_name || boardOpt.stopId,
            fromLat: boardOpt.stop.stop_lat,
            fromLon: boardOpt.stop.stop_lon,
            platformCode: boardOpt.stop.stop_code || undefined,
            toStopId: alightOpt.stopId,
            toStop: alightOpt.stop.stop_name || alightOpt.stopId,
            toLat: alightOpt.stop.stop_lat,
            toLon: alightOpt.stop.stop_lon,
            scheduledDepartureSec: schedDep,
            scheduledArrivalSec: schedArr,
            effectiveDepartureSec: effDep,
            effectiveArrivalSec: effArr,
            delaySec: depDelaySec,
            arrivalDelaySec: arrDelaySec,
            live: isLive,
            stopsCount: Math.max(1, physicalStops),
            boardWalkM: boardOpt.walkM,
            boardWalkSec: boardOpt.walkSec,
            alightWalkM: alightOpt.walkM,
            alightWalkSec: alightOpt.walkSec,
            isCurrent: isSameCurrentTrip,
            patternOffsetSec: patOffset,
            dayOffsetSec: constraints.dayOffsetSec,
          };

          // Preferuj dokładnie oryginalne przystanki, potem krótszy łączny spacer i przejazd.
          const anchorBonus = (boardOpt.isAnchor ? 0 : 90) + (alightOpt.isAnchor ? 0 : 90);
          const score = rideSec + (boardOpt.walkSec + alightOpt.walkSec) * 1.8 + anchorBonus;
          const prevBest = bestByTrip.get(trip.trip_id);
          if (!prevBest || isSameCurrentTrip || (!prevBest.alt.isCurrent && score < prevBest.score)) {
            bestByTrip.set(trip.trip_id, { alt, score });
          }
        }
      }
    }
  }

  const list = Array.from(bestByTrip.values()).map((entry) => entry.alt);

  const hasCurrent = list.some((item) => item.isCurrent);
  if (!hasCurrent) {
    // Gdy bieżący trip nie był w bestByTrip (albo był pod innym przystankiem), usuń duplikat tripId i dodaj bieżącą nogę.
    const filtered = leg.tripId ? list.filter((item) => item.tripId !== leg.tripId) : list;
    filtered.push(currentAlt);
    list.length = 0;
    list.push(...filtered);
  }

  const origLine = (leg.line ?? '').toUpperCase();
  list.sort((a, b) => {
    if (a.effectiveDepartureSec !== b.effectiveDepartureSec) {
      return a.effectiveDepartureSec - b.effectiveDepartureSec;
    }
    if (a.effectiveArrivalSec !== b.effectiveArrivalSec) {
      return a.effectiveArrivalSec - b.effectiveArrivalSec;
    }
    const aSame = a.line.toUpperCase() === origLine ? 0 : 1;
    const bSame = b.line.toUpperCase() === origLine ? 0 : 1;
    if (aSame !== bSame) return aSame - bSame;
    return a.boardWalkM + a.alightWalkM - (b.boardWalkM + b.alightWalkM);
  });

  const currentIndex = Math.max(
    0,
    list.findIndex((item) => item.isCurrent),
  );

  const canExpandEarlier =
    constraints.prevArriveSec === null || windowStartSec > constraints.prevArriveSec;
  const canExpandLater =
    constraints.nextDepartSec === null || windowEndSec < constraints.nextDepartSec;

  return {
    alternatives: list,
    currentIndex,
    windowStartSec,
    windowEndSec,
    canExpandEarlier,
    canExpandLater,
    constraints,
  };
}

export interface LoadLegAlternativesOptions {
  anchorFromStopId?: string;
  anchorToStopId?: string;
  lookbackSec?: number;
  lookaheadSec?: number;
  store?: LocalGtfsStore;
  tripDelays?: ReadonlyMap<string, number>;
  nowSec?: number;
  settings?: Partial<RoutingSettings>;
}

/**
 * Leniwie ładuje alternatywne kursy miejskie z lokalnej bazy GTFS (korzystając z LRU cache wycinków).
 */
export async function loadLegAlternatives(
  connection: Connection,
  legIndex: number,
  options: LoadLegAlternativesOptions = {},
): Promise<LegAlternativesResult | null> {
  if (!isSwappableUrbanLeg(connection, legIndex)) return null;

  const store = options.store ?? gtfsStore;
  await store.load();

  const leg = connection.legs[legIndex];
  const anchorFromStopId = options.anchorFromStopId ?? leg.fromStopId!;
  const anchorToStopId = options.anchorToStopId ?? leg.toStopId!;

  // Noga należy do innego miasta niż załadowany magazyn (np. zapisana trasa z innego miasta).
  if (!store.stops.has(anchorFromStopId) || !store.stops.has(anchorToStopId)) {
    return null;
  }

  const settings = options.settings ?? getSettingsSync();
  const constraints = extractLegSwapConstraints(connection, legIndex, settings);

  const lookbackSec = Math.min(MAX_EXPAND_SPAN_SEC, options.lookbackSec ?? INITIAL_LOOKBACK_SEC);
  const lookaheadSec = Math.min(MAX_EXPAND_SPAN_SEC, options.lookaheadSec ?? INITIAL_LOOKAHEAD_SEC);

  const hardMinStart =
    constraints.prevArriveSec !== null
      ? constraints.prevArriveSec
      : constraints.currentDepartSec - MAX_EXPAND_SPAN_SEC;
  const hardMaxEnd =
    constraints.nextDepartSec !== null
      ? constraints.nextDepartSec
      : constraints.currentDepartSec + MAX_EXPAND_SPAN_SEC;

  const windowStartSec = Math.max(hardMinStart, constraints.currentDepartSec - lookbackSec);
  const windowEndSec = Math.min(hardMaxEnd, constraints.currentDepartSec + lookaheadSec);

  const dayShift = resolveConnectionDayShift(connection);
  const queryStart = Math.max(0, windowStartSec - constraints.dayOffsetSec);
  const spanSec = Math.max(3600, windowEndSec - windowStartSec + 3600);
  const rawTargetSec = dayShift * 86400 + queryStart;

  const slice = await buildSearchSlices(rawTargetSec, false, store, spanSec);

  const firstLeg = connection.legs[0];
  const lastLeg = connection.legs[connection.legs.length - 1];
  const originCoords =
    firstLeg?.mode === 'walk' && firstLeg.fromLat != null && firstLeg.fromLon != null
      ? { lat: firstLeg.fromLat, lon: firstLeg.fromLon }
      : undefined;
  const destinationCoords =
    lastLeg?.mode === 'walk' && lastLeg.toLat != null && lastLeg.toLon != null
      ? { lat: lastLeg.toLat, lon: lastLeg.toLon }
      : undefined;

  const tripDelays = options.tripDelays ?? liveTracker.getTripDelays();
  const nowSec = options.nowSec ?? warsawNow().sec;

  const result = findLegAlternativesInIndex({
    leg,
    constraints,
    anchorFromStopId,
    anchorToStopId,
    dayIndex: slice.searchIndex,
    patternTimeOffsets: slice.patternOffsets,
    store,
    windowStartSec,
    windowEndSec,
    tripDelays,
    nowSec,
    allowedModes: settings.allowedModes,
    cableEnabled: settings.cableEnabled ?? true,
    originCoords,
    destinationCoords,
  });

  // Ogranicz dalsze rozszerzanie po osiągnięciu twardego limitu lub granicy sąsiedniej nogi.
  const canExpandEarlier =
    result.canExpandEarlier && lookbackSec < MAX_EXPAND_SPAN_SEC && windowStartSec > hardMinStart;
  const canExpandLater =
    result.canExpandLater && lookaheadSec < MAX_EXPAND_SPAN_SEC && windowEndSec < hardMaxEnd;

  return {
    ...result,
    canExpandEarlier,
    canExpandLater,
  };
}

/**
 * Materializuje pełny obiekt `Leg` (wraz z `intermediateStops`) dopiero w momencie wyboru
 * alternatywy przez użytkownika, aby nie alokować tablic przystanków na zapas.
 */
export function materializeAlternativeLeg(
  alt: LegAlternative,
  baseLeg: Leg,
  store: LocalGtfsStore = gtfsStore,
  nowSec: number = warsawNow().sec,
): Leg {
  const gtfsDep = alt.effectiveDepartureSec - alt.dayOffsetSec - alt.patternOffsetSec;
  const gtfsArr = alt.effectiveArrivalSec - alt.dayOffsetSec - alt.patternOffsetSec;
  const intermediateStops = alt.tripId
    ? buildLegStops(
        alt.tripId,
        alt.fromStopId,
        alt.toStopId,
        gtfsDep,
        gtfsArr,
        alt.live ? alt.delaySec : undefined,
        nowSec,
        alt.mode,
        store,
      )
    : undefined;

  const physicalCount =
    intermediateStops && intermediateStops.length >= 2
      ? Math.max(1, intermediateStops.filter((s) => !isFareBoundary(s.name)).length - 1)
      : alt.stopsCount;

  return {
    ...baseLeg,
    // Zachowujemy `id` slotu, żeby lista kart w LegTimeline nie przeładowywała komponentu.
    id: baseLeg.id,
    mode: alt.mode,
    line: alt.line,
    direction: alt.direction,
    fromStop: alt.fromStop,
    toStop: alt.toStop,
    departAt: secondsToTimeString(alt.effectiveDepartureSec),
    arriveAt: secondsToTimeString(alt.effectiveArrivalSec),
    scheduledDepartureSec: alt.scheduledDepartureSec,
    scheduledArrivalSec: alt.scheduledArrivalSec,
    delaySec: alt.live ? alt.delaySec : undefined,
    arrivalDelaySec: alt.live ? alt.arrivalDelaySec : undefined,
    live: alt.live,
    delayConfidence: alt.live ? 'live' : undefined,
    stopsCount: physicalCount,
    fromStopId: alt.fromStopId,
    toStopId: alt.toStopId,
    fromLat: alt.fromLat,
    fromLon: alt.fromLon,
    toLat: alt.toLat,
    toLon: alt.toLon,
    platformCode: alt.platformCode,
    trackCode: undefined,
    fromEntrance: undefined,
    toEntrance: undefined,
    stopHint: undefined,
    liveNextStop: undefined,
    vehicleModel: undefined,
    geometry: undefined,
    tripId: alt.tripId || undefined,
    routeId: alt.routeId || undefined,
    intermediateStops:
      intermediateStops && intermediateStops.length >= 2 ? intermediateStops : undefined,
  };
}

export interface ApplyLegSwapOptions {
  boardWalkM?: number;
  boardWalkSec?: number;
  alightWalkM?: number;
  alightWalkSec?: number;
  walkSpeedMps?: number;
  nowSec?: number;
}

/**
 * Podmienia jedną miejską nogę w połączeniu i przelicza sąsiednie dojścia piesze,
 * godziny startu/końca, czas trwania, opis przesiadek oraz stabilne ID połączenia.
 */
export function applyLegSwapToConnection(
  connection: Connection,
  legIndex: number,
  newLeg: Leg,
  options: ApplyLegSwapOptions = {},
): Connection {
  const walkSpeedMps = options.walkSpeedMps ?? 1.34;
  const oldTimeline = normalizeConnectionTimeline(connection);
  const oldLeg = connection.legs[legIndex];
  const legs = connection.legs.map((l) => ({ ...l }));
  legs[legIndex] = { ...newLeg, id: oldLeg.id };

  const newSched = scheduledLegTimes(newLeg, oldTimeline[legIndex].departSec);
  const newEffDep =
    newSched.departure != null
      ? newSched.departure + (newLeg.delaySec ?? 0)
      : oldTimeline[legIndex].departSec;
  const newEffArr =
    newSched.arrival != null
      ? newSched.arrival + (newLeg.arrivalDelaySec ?? newLeg.delaySec ?? 0)
      : oldTimeline[legIndex].arriveSec;

  const boardChanged = oldLeg.fromStopId !== newLeg.fromStopId;
  const alightChanged = oldLeg.toStopId !== newLeg.toStopId;

  // 1. Zaktualizuj (lub dodaj/usuń) odcinek pieszy PRZED podmienioną nogą.
  let swappedIdx = legIndex;
  const hasPrevWalk = swappedIdx > 0 && legs[swappedIdx - 1].mode === 'walk';
  let prevTransitIdx = -1;
  for (let i = swappedIdx - 1; i >= 0; i--) {
    if (legs[i].mode !== 'walk') {
      prevTransitIdx = i;
      break;
    }
  }

  if (hasPrevWalk) {
    const walk = legs[swappedIdx - 1];
    const nextWalkM = boardChanged
      ? options.boardWalkM ??
        (walk.fromLat != null &&
        walk.fromLon != null &&
        newLeg.fromLat != null &&
        newLeg.fromLon != null
          ? Math.round(distanceMeters(walk.fromLat, walk.fromLon, newLeg.fromLat, newLeg.fromLon))
          : walk.walkM ?? 0)
      : walk.walkM ?? 0;

    if (prevTransitIdx >= 0 && nextWalkM < 25 && legs[prevTransitIdx].toStopId === newLeg.fromStopId) {
      // Przesiadka na dokładnie ten sam słupek: zbędny spacer usuwamy.
      legs.splice(swappedIdx - 1, 1);
      swappedIdx -= 1;
    } else {
      const existingWalkDur = Math.max(
        30,
        oldTimeline[legIndex - 1].arriveSec - oldTimeline[legIndex - 1].departSec,
      );
      const walkSec = !boardChanged
        ? existingWalkDur
        : options.boardWalkSec != null
          ? options.boardWalkSec
          : walkSecondsFromMeters(nextWalkM, walkSpeedMps);
      const isInitialWalk = prevTransitIdx < 0;
      const walkDepSec = isInitialWalk ? newEffDep - walkSec : oldTimeline[prevTransitIdx].arriveSec;
      const walkArrSec = isInitialWalk ? newEffDep : Math.min(newEffDep, walkDepSec + walkSec);
      legs[swappedIdx - 1] = {
        ...walk,
        toStop: newLeg.fromStop,
        toStopId: newLeg.fromStopId,
        toLat: newLeg.fromLat,
        toLon: newLeg.fromLon,
        toEntrance: undefined,
        walkM: nextWalkM,
        departAt: secondsToTimeString(walkDepSec),
        arriveAt: secondsToTimeString(walkArrSec),
        scheduledDepartureSec: walkDepSec,
        scheduledArrivalSec: walkArrSec,
        geometry: boardChanged ? undefined : walk.geometry,
      };
    }
  } else if (
    prevTransitIdx >= 0 &&
    boardChanged &&
    legs[prevTransitIdx].toStopId !== newLeg.fromStopId &&
    (options.boardWalkM ?? 0) >= 30
  ) {
    const prevLeg = legs[prevTransitIdx];
    const walkM = options.boardWalkM ?? 0;
    const walkSec = options.boardWalkSec ?? walkSecondsFromMeters(walkM, walkSpeedMps);
    const walkDepSec = oldTimeline[prevTransitIdx].arriveSec;
    const walkArrSec = Math.min(newEffDep, walkDepSec + walkSec);
    const walkLeg: Leg = {
      id: `${oldLeg.id}-walk-before`,
      mode: 'walk',
      fromStop: prevLeg.toStop,
      fromStopId: prevLeg.toStopId,
      fromLat: prevLeg.toLat,
      fromLon: prevLeg.toLon,
      toStop: newLeg.fromStop,
      toStopId: newLeg.fromStopId,
      toLat: newLeg.fromLat,
      toLon: newLeg.fromLon,
      departAt: secondsToTimeString(walkDepSec),
      arriveAt: secondsToTimeString(walkArrSec),
      scheduledDepartureSec: walkDepSec,
      scheduledArrivalSec: walkArrSec,
      stopsCount: 0,
      walkM,
      live: false,
    };
    legs.splice(swappedIdx, 0, walkLeg);
    swappedIdx += 1;
  }

  // 2. Zaktualizuj (lub dodaj/usuń) odcinek pieszy PO podmienionej nodze.
  const hasNextWalk = swappedIdx + 1 < legs.length && legs[swappedIdx + 1].mode === 'walk';
  let nextTransitOrigIdx = -1;
  for (let i = legIndex + 1; i < connection.legs.length; i++) {
    if (connection.legs[i].mode !== 'walk') {
      nextTransitOrigIdx = i;
      break;
    }
  }
  const nextTransitLeg =
    nextTransitOrigIdx >= 0 ? connection.legs[nextTransitOrigIdx] : undefined;

  if (hasNextWalk) {
    const walk = legs[swappedIdx + 1];
    const nextWalkM = alightChanged
      ? options.alightWalkM ??
        (newLeg.toLat != null &&
        newLeg.toLon != null &&
        walk.toLat != null &&
        walk.toLon != null
          ? Math.round(distanceMeters(newLeg.toLat, newLeg.toLon, walk.toLat, walk.toLon))
          : walk.walkM ?? 0)
      : walk.walkM ?? 0;

    if (nextTransitLeg && nextWalkM < 25 && newLeg.toStopId === nextTransitLeg.fromStopId) {
      legs.splice(swappedIdx + 1, 1);
    } else {
      const existingWalkDur = Math.max(
        30,
        oldTimeline[legIndex + 1].arriveSec - oldTimeline[legIndex + 1].departSec,
      );
      const walkSec = !alightChanged
        ? existingWalkDur
        : options.alightWalkSec != null
          ? options.alightWalkSec
          : walkSecondsFromMeters(nextWalkM, walkSpeedMps);
      const walkDepSec = newEffArr;
      const walkArrSec =
        nextTransitOrigIdx >= 0
          ? Math.min(oldTimeline[nextTransitOrigIdx].departSec, walkDepSec + walkSec)
          : walkDepSec + walkSec;
      legs[swappedIdx + 1] = {
        ...walk,
        fromStop: newLeg.toStop,
        fromStopId: newLeg.toStopId,
        fromLat: newLeg.toLat,
        fromLon: newLeg.toLon,
        fromEntrance: undefined,
        walkM: nextWalkM,
        departAt: secondsToTimeString(walkDepSec),
        arriveAt: secondsToTimeString(walkArrSec),
        scheduledDepartureSec: walkDepSec,
        scheduledArrivalSec: walkArrSec,
        geometry: alightChanged ? undefined : walk.geometry,
      };
    }
  } else if (
    nextTransitLeg &&
    alightChanged &&
    newLeg.toStopId !== nextTransitLeg.fromStopId &&
    (options.alightWalkM ?? 0) >= 30
  ) {
    const walkM = options.alightWalkM ?? 0;
    const walkSec = options.alightWalkSec ?? walkSecondsFromMeters(walkM, walkSpeedMps);
    const walkDepSec = newEffArr;
    const walkArrSec = Math.min(oldTimeline[nextTransitOrigIdx].departSec, walkDepSec + walkSec);
    const walkLeg: Leg = {
      id: `${oldLeg.id}-walk-after`,
      mode: 'walk',
      fromStop: newLeg.toStop,
      fromStopId: newLeg.toStopId,
      fromLat: newLeg.toLat,
      fromLon: newLeg.toLon,
      toStop: nextTransitLeg.fromStop,
      toStopId: nextTransitLeg.fromStopId,
      toLat: nextTransitLeg.fromLat,
      toLon: nextTransitLeg.fromLon,
      departAt: secondsToTimeString(walkDepSec),
      arriveAt: secondsToTimeString(walkArrSec),
      scheduledDepartureSec: walkDepSec,
      scheduledArrivalSec: walkArrSec,
      stopsCount: 0,
      walkM,
      live: false,
    };
    legs.splice(swappedIdx + 1, 0, walkLeg);
  }

  // Odśwież wejścia metra, jeśli w trasie jest metro.
  if (legs.some((l) => l.mode === 'subway')) {
    const first = legs[0];
    const last = legs[legs.length - 1];
    snapMetroEntranceLegs(legs, {
      fromLat: first?.fromLat,
      fromLon: first?.fromLon,
      toLat: last?.toLat,
      toLon: last?.toLon,
      boardedTrip: Boolean(connection.boarded),
    });
  }

  // 3. Przelicz podsumowanie całego połączenia z nowej osi czasu.
  const firstDepHint = legs[0]?.scheduledDepartureSec ?? connection.departureSec;
  const newTimeline = normalizeConnectionTimeline({ ...connection, departureSec: firstDepHint, legs });
  const totalDepartureSec = newTimeline[0]?.departSec ?? connection.departureSec;
  let totalArrivalSec = newTimeline[newTimeline.length - 1]?.arriveSec ?? totalDepartureSec;
  if (totalArrivalSec < totalDepartureSec) totalArrivalSec += 86400;

  const durationMin = Math.max(1, Math.round((totalArrivalSec - totalDepartureSec) / 60));
  const transitLegs = legs.filter((l) => l.mode !== 'walk');
  const transfers = Math.max(0, transitLegs.length - 1);

  let maxDelayMin = 0;
  let overallLive = false;
  for (const l of transitLegs) {
    if (l.live) overallLive = true;
    const dMin = Math.round((l.delaySec ?? 0) / 60);
    if (Math.abs(dMin) > Math.abs(maxDelayMin)) maxDelayMin = dMin;
  }

  let interchange: string | undefined;
  if (transfers > 0) {
    const via = Array.from(new Set(transitLegs.slice(0, -1).map((l) => l.toStop)));
    if (via.length > 0) {
      interchange = via.length === 1 ? `Przesiadka: ${via[0]}` : `Przesiadki: ${via.join(' \u2022 ')}`;
    }
  }

  const nowSec = options.nowSec ?? warsawNow().sec;
  const draft: Connection = {
    ...connection,
    legs,
    departureSec: totalDepartureSec,
    arrivalSec: totalArrivalSec,
    departAt: secondsToTimeString(totalDepartureSec),
    arriveAt: secondsToTimeString(totalArrivalSec),
    durationMin,
    transfers,
    delayMin: maxDelayMin,
    live: overallLive,
    interchange,
  };

  let diffSec = totalDepartureSec - nowSec;
  if (diffSec < -43200) diffSec += 86400;
  draft.departInMin = connection.boarded ? 0 : Math.max(0, Math.round(diffSec / 60));
  draft.id = stableConnectionId(draft);

  return draft;
}

