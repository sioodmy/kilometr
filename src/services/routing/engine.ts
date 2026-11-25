import { DayIndex, gtfsStore, polskaStore, LocalGtfsStore } from './store';
import { classifyTransitMode, DEFAULT_COST, isPointlessShortRide, mergeDayIndexes, runRaptorAsync, selectJourneys, warmupRaptorNet, type CostParams } from './raptor';
import { AllowedTransferModes, Connection, JourneySegment, Leg, LegMode, LegStop, RawJourney, TransitModePreference } from './types';
import type { BoardedTripOrigin, DelayConfidence } from '../../types/models';
import { distanceMeters, secondsToTimeString, shiftWarsawDate, warsawNow } from '../../gtfs/geo';
import { liveTracker } from '../liveTracker';
import { MAX_DELAY_SEC } from '../liveQuality';
import { emptyRoutingSnapshot, type RoutingSnapshot } from './reliability';
import { deduplicateConnections, stableConnectionId } from './connectionIdentity';
import { isFareBoundary } from '../../gtfs/fareBoundary';
import { refreshConnectionTimes, scheduledLegTimes } from './connectionTimes';
import { predictDelaySec } from './delays';
import { projectRoutePoint } from '../routeGeometry';
import {
  extractMetroStationId,
  findOptimalMetroEntrance,
  findReachableMetroStationsByEntrance,
  isWarsawMetroStopId,
  toMetroEntranceRef,
  warmupMetroEntrances,
} from '../metroEntrances';

// ────────────────────────────────────────────────────────────────────────────
// Parametry spacerowe (spójne z raptor.ts i store.ts)
// ────────────────────────────────────────────────────────────────────────────
const WALK_SPEED_MPS = 1.34;
const WALK_DETOUR_FACTOR = 1.15;
/** Poniżej tego dystansu start i cel to praktycznie ten sam punkt (spacer, nie przejazd). */
export const SAME_POINT_M = 40;
/** Do ilu sekund spaceru wolno wycinać warianty z przesiadką wolniejsze od marszu. */
const WALK_BEATS_TRANSIT_MAX_SEC = 15 * 60;
/**
 * Ile przystanków w zasięgu dojścia bierzemy pod uwagę. Dawne 12 najbliższych
 * w centrum sięgało ledwie 300 m, więc dalszy przystanek z tramwajem prosto
 * pod cel w ogóle nie był kandydatem, a planer dokładał spacer przez inny
 * słupek.
 */
const MAX_ACCESS_STOPS = 80;

/** Nocny indeks zunifikowany per para wycinków (dziś, wczoraj/jutro): kompilacja raz. */
const mergedCache = new WeakMap<DayIndex, WeakMap<DayIndex, { index: DayIndex; offsets: Map<string, number> }>>();
function mergedOvernight(today: DayIndex, other: DayIndex, prefix = 'y_', offsetSec = -86400) {
  let inner = mergedCache.get(today);
  if (!inner) {
    inner = new WeakMap();
    mergedCache.set(today, inner);
  }
  let hit = inner.get(other);
  if (!hit) {
    hit = mergeDayIndexes(today, other, prefix, offsetSec);
    inner.set(other, hit);
  }
  return hit;
}

/** Pełna sekwencja przystanków kursu (cała linia) z GTFS stop_times + stops.
 * Kursy `pl:` (kolej ogólnopolska) czyta z magazynu polskaStore. */
export async function buildTripStops(tripId: string, store: LocalGtfsStore = tripId.startsWith('pl:') ? polskaStore : gtfsStore): Promise<LegStop[]> {
  const isNational = store === polskaStore || tripId.startsWith('pl:');
  const mem = store.stopTimes.get(tripId);
  const toLegStops = (times: { stop_id: string; arrival_sec: number; departure_sec: number; stop_sequence: number }[]) =>
    times.map((t) => {
      const s = store.stops.get(t.stop_id);
      return {
        stopId: t.stop_id,
        name: s?.stop_name || t.stop_id,
        lat: s?.stop_lat,
        lon: s?.stop_lon,
        seq: t.stop_sequence,
        arriveSec: t.arrival_sec,
        departSec: t.departure_sec,
      };
    });
  if (mem && mem.length > 0 && !isNational) return toLegStops(mem);
  // Kurs spoza aktywnego wycinka (albo kolej ogólnopolska z peronami/torami na każdej stacji):
  // dociągnij z SQLite razem z nazwami i peronami.
  try {
    const { getTripStopTimes } = await import('../gtfsDatabase');
    const rows = await getTripStopTimes(tripId, isNational);
    if (rows.length > 0) {
      return rows.map((r) => ({
        stopId: r.stop_id,
        name: r.name || r.stop_id,
        lat: r.lat ?? undefined,
        lon: r.lon ?? undefined,
        seq: r.seq,
        arriveSec: r.arr_sec,
        departSec: r.dep_sec,
        platform: r.platform || undefined,
        track: r.track || undefined,
      }));
    }
  } catch {
    // ignoruj - fallback do pamięci niżej
  }
  if (mem && mem.length > 0) return toLegStops(mem);
  return [];
}

/** Wycinek (i nocny merge) na parametry wyszukiwania: jedno źródło prawdy */
interface SearchSlices {
  /** Porą dnia (bez przesunięcia dnia serwisowego). */
  departureSec: number;
  /** Sekundy od teraz co dzień docelowego (dodawane do wyników, nie do RAPTOR-a). */
  dayOffsetSec: number;
  searchStartSec: number;
  searchIndex: DayIndex;
  /** Offsets zegara nocnego (patternTimeOffsets w opcjach RAPTOR-a). */
  patternOffsets?: Map<string, number>;
}

/**
 * Buduje wycinek planera dla odjazdu (lub przyjazdu) o rawTargetSec - pełny
 * czas RAW (pora dnia + offset dni). planConnections i rozgrzewka idą przez
 * TEN SAM kod, żeby rozgrzany indeks był dokładnie tym, na który wyszukiwanie
 * zaraz wpadnie (w tym nocny merge przed 07:00).
 */
export async function buildSearchSlices(
  rawTargetSec: number,
  arrivalMode = false,
  store: LocalGtfsStore = gtfsStore,
  horizonSec = 10800,
): Promise<SearchSlices> {
  const now = new Date();
  const nowWarsaw = warsawNow(now);
  // departureTimeSec / arriveBySec mogą wskazywać jutro (DepartureTimeSheet
  // dodaje +86400). RAPTOR jeździ po porze dnia, a offset dokładamy do wyników.
  const dayOffsetSec = Math.floor(rawTargetSec / 86400) * 86400;
  let departureSec = rawTargetSec % 86400;
  if (departureSec < 0) departureSec += 86400;
  const dayShift = Math.round(dayOffsetSec / 86400);
  const targetWarsaw = dayShift === 0 ? nowWarsaw : shiftWarsawDate(nowWarsaw, dayShift);
  const weekday = targetWarsaw.weekday;
  const dateStr = targetWarsaw.dateStr;
  // Wycinek horyzontu zamiast pełnej doby: okna RAPTOR-a sięgają +3600 s,
  // a przesiadkowe nogi jeszcze dalej, bierzemy zapas do +3 h.
  // Przyjazd obejmuje też wyjście przed północą poprzedniego dnia.
  // Kolej (store=polskaStore) dostaje szerszy horyzont: pociągi jeżdżą
  // rzadziej niż tramwaje i pierwszy sensowny odjazd bywa poza +3 h.
  const searchStartSec = arrivalMode ? departureSec - horizonSec : departureSec;
  const dayIndex = arrivalMode
    ? await store.getDayIndexSlice(weekday, dateStr, searchStartSec - MAX_DELAY_SEC, departureSec + 600)
    : await store.getDayIndexSlice(weekday, dateStr, departureSec - MAX_DELAY_SEC, departureSec + horizonSec);

  // Nocny indeks ZUNIFIKOWANY (mergeDayIndexes): po północy kursy 24:xx+
  // należą do wczorajszego dnia serwisowego, ale nogi z obu dni muszą łączyć
  // się w JEDNEJ podróży (np. 145 dziś + 255 wczoraj o 04:30).
  let searchIndex = dayIndex;
  let patternOffsets: Map<string, number> | undefined;
  if (searchStartSec < 7 * 3600) {
    const yWarsaw = shiftWarsawDate(targetWarsaw, -1);
    const overnightIdx = await store.getDayIndexSlice(
      yWarsaw.weekday,
      yWarsaw.dateStr,
      86400 + Math.min(-7200, searchStartSec - MAX_DELAY_SEC),
      86400 + (arrivalMode ? departureSec + 600 : departureSec + horizonSec),
    );
    const merged = mergedOvernight(dayIndex, overnightIdx);
    searchIndex = merged.index;
    patternOffsets = merged.offsets;
  } else if (!arrivalMode && departureSec + horizonSec > 86400) {
    // Lustro nocnego merge'a: wieczorem horyzont sięga po północy, a część
    // feedów (np. GZM) zapisuje kursy 00:xx w jutrzejszym dniu serwisowym.
    const tWarsaw = shiftWarsawDate(targetWarsaw, 1);
    const tomorrowIdx = await store.getDayIndexSlice(
      tWarsaw.weekday,
      tWarsaw.dateStr,
      0,
      departureSec + horizonSec - 86400,
    );
    const merged = mergedOvernight(dayIndex, tomorrowIdx, 't_', 86400);
    searchIndex = merged.index;
    patternOffsets = merged.offsets;
  }
  return { departureSec, dayOffsetSec, searchStartSec, searchIndex, patternOffsets };
}

/**
 * Rozgrzewka po starcie / imporcie: buduje wycinek na bieżącą porę w tle,
 * żeby pierwsze wyszukiwanie nie płaciło pełnego kosztu budowy indeksu.
 * Idzie przez buildSearchSlices, więc obejmuje też nocny merge przed 07:00.
 */
export async function warmupRouting(): Promise<void> {
  try {
    await gtfsStore.load();
    const now = new Date();
    const currentSec = warsawNow(now).sec;
    // Tylko godzina w przód, dokładnie jak liveTracker i pierwsze wyszukiwanie
    // „Teraz". Trzygodzinny wycinek na starcie ważył 6 s JS i nie był nikomu
    // potrzebny, zanim użytkownik przewinął listę albo wybrał późniejszą porę.
    const slices = await buildSearchSlices(currentSec, false, gtfsStore, 3600);
    await warmupRaptorNet(gtfsStore, slices.searchIndex, slices.patternOffsets);
  } catch (err) {
    console.warn('[Routing] warmup failed:', err);
  }
}

/** Przystanki kursu TYLKO od boardStop do alightStop (to co użytkownik widzi).
 * `delaySec` i `nowSec` to prognoza opóźnienia z RAPTOR-a: czasy segmentów są
 * już efektywne, więc cofamy je tą samą prognozą przed dopasowaniem
 * przystanku. Bez tego pętla z opóźnieniem łapie pierwsze wystąpienie
 * przystanku i pokazuje cały kurs. */
export function buildLegStops(
  tripId: string,
  boardStopId: string,
  alightStopId: string,
  departSec?: number,
  arriveSec?: number,
  delaySec?: number,
  nowSec?: number,
  mode?: LegMode,
  store: LocalGtfsStore = tripId.startsWith('pl:') ? polskaStore : gtfsStore,
): LegStop[] {
  // Legi pochodzą z aktywnego wycinka, więc kurs jest w pamięci (sync, bez IO).
  const times = store.stopTimes.get(tripId);
  if (!times || times.length === 0) return [];
  const allStops: LegStop[] = times.map((t) => {
    const s = store.stops.get(t.stop_id);
    return {
      stopId: t.stop_id,
      name: s?.stop_name || t.stop_id,
      lat: s?.stop_lat,
      lon: s?.stop_lon,
      seq: t.stop_sequence,
      arriveSec: t.arrival_sec,
      departSec: t.departure_sec,
    };
  });

  const expectedSec = (stop: LegStop, use: 'board' | 'arrive'): number | undefined => {
    const scheduled = use === 'board' ? stop.departSec : stop.arriveSec;
    if (scheduled === undefined) return undefined;
    if (delaySec === undefined || nowSec === undefined) return scheduled;
    return scheduled + predictDelaySec(delaySec, scheduled - (nowSec - delaySec), use, mode);
  };

  let boardIdx = -1;
  if (departSec !== undefined) {
    boardIdx = allStops.findIndex((s) => {
      const expected = expectedSec(s, 'board');
      return s.stopId === boardStopId && expected !== undefined && Math.abs(expected - departSec) <= 120;
    });
  }
  if (boardIdx < 0) {
    boardIdx = allStops.findIndex((s) => s.stopId === boardStopId);
  }

  let alightIdx = -1;
  if (arriveSec !== undefined && boardIdx >= 0) {
    alightIdx = allStops.findIndex((s, idx) => {
      const expected = expectedSec(s, 'arrive');
      return (
        idx > boardIdx &&
        s.stopId === alightStopId &&
        expected !== undefined &&
        Math.abs(expected - arriveSec) <= 120
      );
    });
  }
  if (alightIdx < 0 && boardIdx >= 0) {
    alightIdx = allStops.findIndex((s, idx) => idx > boardIdx && s.stopId === alightStopId);
  }
  if (alightIdx < 0) {
    alightIdx = allStops.findIndex((s) => s.stopId === alightStopId);
  }

  if (boardIdx < 0 || alightIdx < 0 || boardIdx >= alightIdx) return allStops;

  // Zwracamy przystanki od wsiadania do wysiadania (włącznie z obu)
  return allStops.slice(boardIdx, alightIdx + 1);
}

export interface PlanOptions {
  fromId?: string;
  fromTitle: string;
  fromLat: number;
  fromLon: number;
  toTitle: string;
  toLat: number;
  toLon: number;
  toId?: string;
  departureTimeSec?: number;
  /** Przyjazd najpóźniej o tej godzinie. RAPTOR szuka wstecz od celu. */
  arriveBySec?: number;
  /** 0–3, default 2. 0 = tylko bezpośrednie. */
  maxTransfers?: number;
  /** Jednorazowy filtr pojazdów, default 'all'. Wpuszczane tylko kursy danego typu. */
  modes?: TransitModePreference;
  /** Pociągi KD w trybie 'all' (default true). Szybki filtr ich nie rusza. */
  trainsEnabled?: boolean;
  /** Koleje linowe (Polinka) w trybie 'all' (default true). Jak trainsEnabled. */
  cableEnabled?: boolean;
  /**
   * Na które pojazdy wolno się przesiadać (default wszystko true).
   * Wyłączony środek nie pojawia się w wynikach wcale.
   */
  allowedTransferModes?: Partial<AllowedTransferModes>;
  /** sekundy, default 300. Minimalny zapas na wsiadanie do pociągu po przesiadce. */
  trainMinTransferSec?: number;
  /** Minimalny czas na przesiadkę, domyślnie 120 s. */
  minTransferSec?: number;
  /** metry, default 800. Jak daleko wolno iść na przystanek / z przystanku. */
  maxWalkM?: number;
  /** m/s, default 1.34. Tempo chodzenia użytkownika (dojścia i przesiadki). */
  walkSpeedMps?: number;
  /**
   * Preferowany przystanek startowy (kotwica). fromLat/fromLon to PRAWDZIWA
   * pozycja (GPS) - silnik liczy realny spacer do kotwicy i daje jej tylko
   * mały bonus rozstrzygający remisy, zamiast zerować koszt dojścia.
   */
  anchorStopId?: string;
  anchorStopLat?: number;
  anchorStopLon?: number;
  /**
   * Progresywne oddawanie wyników: wywoływane po każdym oknie czasowym
   * RAPTOR-a z połączeniami policzonymi dotąd. UI podmienia listę na
   * bieżąco ("po kolei"), zamiast trzymać pełny spinner do samego końca.
   */
  onProgress?: (partial: Connection[]) => void;
  /**
   * Jak daleko w przód szukać wsiadania (sekundy). Default 10800 (3 h).
   * Kolej ogólnopolska podaje 6 h: pociągi dalekobieżne jeżdżą rzadko.
   * Steruje też szerokością wycinka (buildSearchSlices) i okien RAPTOR-a.
   */
  searchAheadSec?: number;
  /**
   * Jawne przystanki startowe (omijają szukanie po współrzędnych).
   * Intercity: stacje kolejowe bramowe miasta, patrz routing/intercity.ts.
   */
  originStopIds?: string[];
  /** Jawne przystanki docelowe (omijają szukanie po współrzędnych). */
  destinationStopIds?: string[];
  /** Aktywny pojazd jako punkt startowy podróży (bez szukania dojścia na przystanek). */
  boardedTrip?: BoardedTripOrigin;
  /** Opcjonalny indeks dnia (np. do testów jednostkowych bez SQLite). */
  dayIndex?: DayIndex;
}


interface MapCtx {
  currentSec: number;
  dayOffsetSec: number;
  tripDelays: Map<string, number>;
  confidence: RoutingSnapshot['confidence'];
  serviceDate?: string;
}

/** Stosuje wagi RAPTOR-a także na liście: czas, marsz i przesiadki.
 * Dla przyjazdu premiuje późniejsze wyjście przed terminem. */
export function sortConnectionsByCost(
  connections: Connection[],
  walkSpeedMps: number,
  arriveBySec?: number,
  cost: CostParams = DEFAULT_COST,
): Connection[] {
  const extraWalk = Math.max(0, cost.walkReluctance - 1);
  const costOf = (c: Connection) => {
    let walkM = 0;
    for (const l of c.legs) if (l.mode === 'walk') walkM += l.walkM ?? 0;
    return (
      (arriveBySec !== undefined ? arriveBySec - c.departureSec : (c.arrivalSec ?? c.departureSec + c.durationMin * 60)) +
      (extraWalk * walkM * WALK_DETOUR_FACTOR) / walkSpeedMps +
      c.transfers * cost.transferPenaltySec +
      c.legs.reduce((sum, leg) => sum + (leg.delayConfidence === 'estimated' || leg.delayConfidence === 'untracked' ? 120 : 0), 0)
    );
  };
  const costs = new Map(connections.map((c) => [c, costOf(c)]));
  connections.sort((a, b) => {
    const d = costs.get(a)! - costs.get(b)!;
    if (Math.abs(d) > 1e-6) return d;
    if (a.transfers !== b.transfers) return a.transfers - b.transfers;
    return arriveBySec !== undefined ? b.departureSec - a.departureSec : a.departureSec - b.departureSec;
  });
  return connections;
}

/**
 * Mapowanie RawJourney → Connection (legi, flagi live, czasy finalne).
 * Bez opcji "na piechotę" - tę dokłada wywołujący na samym końcu.
 * Używane i dla emisji progresywnych (po każdym oknie), i dla wyniku finalnego.
 */
/** Łączy bezpośrednio sąsiadujące odcinki piesze w jeden. */

/**
 * Dla odcinków pieszych dochodzących do stacji metra warszawskiego lub z niej wychodzących
 * przypina współrzędne i dystans do najbardziej optymalnego wejścia/wyjścia.
 * Przesiadki podziemne między liniami metra na tej samej stacji (np. Świętokrzyska M1<->M2)
 * pozostają pod ziemią i nie dostają ulicznego wejścia.
 */
export function snapMetroEntranceLegs(
  legs: Leg[],
  endpoints?: {
    fromLat?: number;
    fromLon?: number;
    toLat?: number;
    toLon?: number;
    boardedTrip?: boolean;
  },
): void {
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const prev = i > 0 ? legs[i - 1] : undefined;
    const next = i + 1 < legs.length ? legs[i + 1] : undefined;

    if (leg.mode === 'walk') {
      const sameMetroStation =
        prev?.mode === 'subway' &&
        next?.mode === 'subway' &&
        Boolean(extractMetroStationId(prev.toStopId)) &&
        extractMetroStationId(prev.toStopId) === extractMetroStationId(next.fromStopId);
      if (sameMetroStation) continue;

      if (next?.mode === 'subway' && leg.fromLat !== undefined && leg.fromLon !== undefined) {
        const hit = findOptimalMetroEntrance(next.fromStopId, leg.fromLat, leg.fromLon);
        if (hit) {
          leg.toLat = hit.entrance.lat;
          leg.toLon = hit.entrance.lon;
          leg.walkM = hit.distanceM;
          const ref = toMetroEntranceRef(hit.entrance);
          leg.toEntrance = ref;
          next.fromEntrance = ref;
        }
      }
      if (prev?.mode === 'subway' && leg.toLat !== undefined && leg.toLon !== undefined) {
        const hit = findOptimalMetroEntrance(prev.toStopId, leg.toLat, leg.toLon);
        if (hit) {
          leg.fromLat = hit.entrance.lat;
          leg.fromLon = hit.entrance.lon;
          leg.walkM = hit.distanceM;
          const ref = toMetroEntranceRef(hit.entrance);
          leg.fromEntrance = ref;
          prev.toEntrance = ref;
        }
      }
      continue;
    }

    if (leg.mode === 'subway') {
      if (!leg.fromEntrance) {
        if (i === 0 && !endpoints?.boardedTrip && endpoints?.fromLat !== undefined && endpoints?.fromLon !== undefined) {
          const hit = findOptimalMetroEntrance(leg.fromStopId, endpoints.fromLat, endpoints.fromLon);
          if (hit) leg.fromEntrance = toMetroEntranceRef(hit.entrance);
        } else if (prev && prev.mode !== 'walk' && prev.mode !== 'subway' && prev.toLat !== undefined && prev.toLon !== undefined) {
          const hit = findOptimalMetroEntrance(leg.fromStopId, prev.toLat, prev.toLon);
          if (hit) leg.fromEntrance = toMetroEntranceRef(hit.entrance);
        }
      }
      if (!leg.toEntrance) {
        if (i === legs.length - 1 && endpoints?.toLat !== undefined && endpoints?.toLon !== undefined) {
          const hit = findOptimalMetroEntrance(leg.toStopId, endpoints.toLat, endpoints.toLon);
          if (hit) leg.toEntrance = toMetroEntranceRef(hit.entrance);
        } else if (next && next.mode !== 'walk' && next.mode !== 'subway' && next.fromLat !== undefined && next.fromLon !== undefined) {
          const hit = findOptimalMetroEntrance(leg.toStopId, next.fromLat, next.fromLon);
          if (hit) leg.toEntrance = toMetroEntranceRef(hit.entrance);
        }
      }
    }
  }
}

function resolveNearbyAccessStops(
  lat: number,
  lon: number,
  maxWalkM: number,
  userWalkSpeed: number,
  store: LocalGtfsStore,
): Array<{ stopId: string; walkM: number; walkSec: number }> {
  const nearby = store.findNearestStops(lat, lon, maxWalkM, MAX_ACCESS_STOPS);
  const seen = new Set<string>();
  const out: Array<{ stopId: string; walkM: number; walkSec: number }> = [];

  for (const n of nearby) {
    let distM = n.distanceM;
    if (isWarsawMetroStopId(n.stop.stop_id)) {
      const hit = findOptimalMetroEntrance(n.stop.stop_id, lat, lon);
      if (hit) distM = hit.distanceM;
    }
    seen.add(n.stop.stop_id);
    out.push({
      stopId: n.stop.stop_id,
      walkM: distM,
      walkSec: Math.max(30, Math.round((distM * WALK_DETOUR_FACTOR) / userWalkSpeed)),
    });
  }

  for (const reach of findReachableMetroStationsByEntrance(lat, lon, maxWalkM)) {
    for (const suffix of [':P1', ':P2']) {
      const platformId = `${reach.stationId}${suffix}`;
      if (seen.has(platformId) || !store.stops.has(platformId)) continue;
      seen.add(platformId);
      out.push({
        stopId: platformId,
        walkM: reach.distanceM,
        walkSec: Math.max(30, Math.round((reach.distanceM * WALK_DETOUR_FACTOR) / userWalkSpeed)),
      });
    }
  }

  return out;
}

async function maybeWarmupMetroEntrances(options: PlanOptions, store: LocalGtfsStore): Promise<void> {
  const inWarsawBox =
    (options.fromLat >= 52.0 && options.fromLat <= 52.4 && options.fromLon >= 20.7 && options.fromLon <= 21.3) ||
    (options.toLat >= 52.0 && options.toLat <= 52.4 && options.toLon >= 20.7 && options.toLon <= 21.3);
  if (inWarsawBox || store.stops.has('7014M:P1') || store.stops.has('7013M:P1')) {
    await warmupMetroEntrances();
  }
}

export function mergeConsecutiveWalkLegs(legs: Leg[]): Leg[] {
  const out: Leg[] = [];
  for (const leg of legs) {
    const prev = out[out.length - 1];
    if (prev && prev.mode === "walk" && leg.mode === "walk") {
      prev.toStop = leg.toStop;
      prev.toStopId = leg.toStopId;
      prev.toLat = leg.toLat;
      prev.toLon = leg.toLon;
      prev.arriveAt = leg.arriveAt;
      prev.walkM = (prev.walkM ?? 0) + (leg.walkM ?? 0);
    } else {
      out.push({ ...leg });
    }
  }
  return out;
}

function mapJourneysToConnections(
  journeys: RawJourney[],
  options: PlanOptions,
  ctx: MapCtx,
  store: LocalGtfsStore = gtfsStore,
  skipPointlessCheck = false,
): Connection[] {
  const connections: Connection[] = [];

  for (let idx = 0; idx < journeys.length; idx++) {
    const rj = journeys[idx];
    // Kotwica nie może wymuszać bezsensu: "wsiądź i wysiądź po 1 przystanku,
    // resztę idź z buta" odrzucamy niezależnie od preferencji startu.
    if (!skipPointlessCheck && isPointlessShortRide(rj)) continue;
    // Przejazd w jedną stronę i z powrotem (ten sam przystanek dwa razy)
    // nic nie daje, a RAPTOR potrafi go zaproponować przy bliskim celu.
    if (revisitsStops(rj)) continue;
    const legs: Leg[] = [];
    let overallLive = false;
    let maxDelayMin = 0;

    for (let lIdx = 0; lIdx < rj.segments.length; lIdx++) {
      const seg = rj.segments[lIdx];
      let legLive = false;

      if (seg.type === 'transit') {
        // Ten sam snapshot opóźnień co w RAPTOR-ze: czasy segmentów są już
        // efektywne (NIE dodajemy opóźnienia drugi raz). Tu tylko flaga live
        // i wartość do wyświetlenia.
        const dSec = ctx.tripDelays.get(seg.tripId ?? '');
        if (dSec !== undefined && ctx.confidence.get(seg.tripId ?? '') === 'live') {
          legLive = true;
          overallLive = true;
        }
      }

      // Czasy już finalne (efektywne) - prosto z segmentów.
      const adjDepartSec = seg.departSec;
      const adjArriveSec = seg.arriveSec;
      // Ostatnia noga piesza do celu dziedziczy nazwę celu podróży.
      const toName =
        seg.toStopId === 'destination' ? options.toTitle : seg.toStopName;
      const fromName =
        seg.fromStopId === 'origin' ? options.fromTitle : seg.fromStopName;

      const fromStopObj = store.stops.get(seg.fromStopId);
      const toStopObj = store.stops.get(seg.toStopId);

      const fromLat = seg.fromStopId === 'origin' ? options.fromLat : fromStopObj?.stop_lat;
      const fromLon = seg.fromStopId === 'origin' ? options.fromLon : fromStopObj?.stop_lon;
      const toLat = seg.toStopId === 'destination' ? options.toLat : toStopObj?.stop_lat;
      const toLon = seg.toStopId === 'destination' ? options.toLon : toStopObj?.stop_lon;

      // Intermediate stops: TYLKO board→alight, nie cały kurs
      const tripDelaySec =
        seg.type === 'transit' && seg.tripId ? ctx.tripDelays.get(seg.tripId) : undefined;
      const intermediateStops =
        seg.type === 'transit' && seg.tripId && seg.fromStopId && seg.toStopId
          ? buildLegStops(
              seg.tripId,
              seg.fromStopId,
              seg.toStopId,
              seg.departSec,
              seg.arriveSec,
              tripDelaySec,
              ctx.currentSec,
              seg.mode,
              store,
            )
          : undefined;

      const leg: Leg = {
        id: `c${idx + 1}l${lIdx + 1}`,
        mode: seg.type === 'walk' ? 'walk' : seg.mode || 'bus',
        line: seg.line,
        direction: seg.direction,
        fromStop: fromName,
        toStop: toName,
        fromStopId: seg.fromStopId,
        toStopId: seg.toStopId,
        fromLat,
        fromLon,
        toLat,
        toLon,
        platformCode: fromStopObj?.stop_code,
        departAt: secondsToTimeString(adjDepartSec),
        arriveAt: secondsToTimeString(adjArriveSec),
        stopsCount: seg.stopsCount,
        walkM: seg.walkMeters,
        live: legLive,
        delayConfidence: seg.type === 'transit' ? (ctx.confidence.get(seg.tripId ?? '') ?? 'scheduled') : undefined,
        tripId: seg.type === 'transit' ? seg.tripId : undefined,
        routeId: seg.type === 'transit' ? seg.routeId : undefined,
        intermediateStops,
      };
      if (seg.type === 'transit') {
        const scheduled = scheduledLegTimes(leg, adjDepartSec + ctx.dayOffsetSec);
        leg.scheduledDepartureSec = scheduled.departure;
        leg.scheduledArrivalSec = scheduled.arrival;
        leg.delaySec = scheduled.departure == null ? undefined : adjDepartSec + ctx.dayOffsetSec - scheduled.departure;
        leg.arrivalDelaySec = scheduled.arrival == null ? undefined : adjArriveSec + ctx.dayOffsetSec - scheduled.arrival;
        const delayMin = Math.round((leg.delaySec ?? ctx.tripDelays.get(seg.tripId ?? '') ?? 0) / 60);
        if (Math.abs(delayMin) > Math.abs(maxDelayMin)) maxDelayMin = delayMin;
      }
      legs.push(leg);
    }

    const mergedLegs = mergeConsecutiveWalkLegs(legs);
    snapMetroEntranceLegs(mergedLegs, {
      fromLat: options.fromLat,
      fromLon: options.fromLon,
      toLat: options.toLat,
      toLon: options.toLon,
      boardedTrip: Boolean(options.boardedTrip),
    });
    const transitLegs = mergedLegs.filter((l) => l.mode !== 'walk');
    if (transitLegs.length === 0) continue;

    // Czasy z RAPTOR-a są już efektywne (z opóźnieniami GPS) - dokładamy
    // tylko offset dnia (zapytanie o jutro): RAPTOR liczył porą dnia.
    const adjDepartureSec = rj.departureSec + ctx.dayOffsetSec;
    const adjArrivalSec = rj.arrivalSec + ctx.dayOffsetSec;
    const durationMin = Math.max(1, Math.round((adjArrivalSec - adjDepartureSec) / 60));
    const departInMin = Math.max(0, Math.round((adjDepartureSec - ctx.currentSec) / 60));

    // Interchange description if transfers exist
    let interchange: string | undefined;
    if (rj.transfers > 0) {
      const via = Array.from(new Set(transitLegs.slice(0, -1).map((l) => l.toStop)));
      if (via.length > 0) {
        interchange = via.length === 1 ? `Przesiadka: ${via[0]}` : `Przesiadki: ${via.join(' • ')}`;
      }
    }

    connections.push({
      id: `conn-${idx + 1}-${rj.departureSec + ctx.dayOffsetSec}`,
      fromTitle: options.fromTitle,
      toTitle: options.toTitle,
      departInMin,
      departureSec: adjDepartureSec,
      arrivalSec: adjArrivalSec,
      departAt: secondsToTimeString(adjDepartureSec),
      arriveAt: secondsToTimeString(adjArrivalSec),
      durationMin,
      transfers: rj.transfers,
      delayMin: maxDelayMin,
      live: overallLive,
      legs: mergedLegs,
      interchange,
      serviceDate: ctx.serviceDate,
    });
  }

  for (const connection of connections) {
    connection.id = stableConnectionId(connection);
  }
  return deduplicateConnections(connections);
}

/** Odświeża godziny i flagi live. Niezmienione połączenia zachowują referencje. */
export function applyLiveDelays(
  connections: Connection[],
  tripDelays: Map<string, number>,
  arrivalDelays: ReadonlyMap<string, number> = new Map(),
): Connection[] {
  if (connections.length === 0) return connections;
  const neededTripIds = new Set<string>();
  for (const connection of connections) {
    for (const leg of connection.legs) {
      if (leg.mode !== 'walk' && leg.tripId) neededTripIds.add(leg.tripId);
    }
  }
  const snapshot =
    neededTripIds.size > 0 && tripDelays.size > 0
      ? liveTracker.getRoutingSnapshot()
      : emptyRoutingSnapshot();
  // Kopiujemy wyłącznie wpisy dla kursów z przekazanej listy połączeń,
  // bez klonowania tysięcy wpisów całego miasta przy wejściu w szczegóły.
  const delays = new Map<string, number>();
  const confidence = new Map<string, DelayConfidence>();
  for (const tripId of neededTripIds) {
    const direct = tripDelays.get(tripId);
    if (direct !== undefined) {
      delays.set(tripId, direct);
      confidence.set(tripId, 'live');
    } else {
      const snapDelay = snapshot.delays.get(tripId);
      if (snapDelay !== undefined) delays.set(tripId, snapDelay);
      const snapConfidence = snapshot.confidence.get(tripId);
      if (snapConfidence !== undefined) confidence.set(tripId, snapConfidence);
    }
  }
  const now = new Date();
  const updated = connections.map((connection) =>
    refreshConnectionTimes(connection, delays, now, confidence, arrivalDelays),
  );
  return updated.every((connection, index) => connection === connections[index]) ? connections : updated;
}

/**
 * Wyznacza kandydatów przystanków początkowych (origins) wokół pozycji startu.
 * Celowo szeroko (wszystko do maxWalkM): dalszy przystanek z bezpośrednim
 * odjazdem wygrywa z najbliższym słupkiem wymagającym 3 przesiadek.
 * Kotwica jako ułatwienie może wyjść minimalnie poza limit (do +20%),
 * ale odległa kotwica (np. 1+ km) nie może wypierać bliższych przystanków.
 */
export function resolveCandidateOrigins(
  fromLat: number,
  fromLon: number,
  maxWalkM: number,
  userWalkSpeed: number,
  anchor?: { stopId?: string; lat?: number; lon?: number },
  store: LocalGtfsStore = gtfsStore,
): Array<{ stopId: string; walkM: number; walkSec: number }> {
  const origins = resolveNearbyAccessStops(fromLat, fromLon, maxWalkM, userWalkSpeed, store);

  if (
    (anchor?.stopId || (anchor?.lat !== undefined && anchor?.lon !== undefined)) &&
    Number.isFinite(fromLat) && Number.isFinite(fromLon)
  ) {
    let anchorStop: { stop_id: string; stop_lat: number; stop_lon: number } | undefined;
    if (anchor?.stopId) {
      const byId = store.stops.get(anchor.stopId);
      if (byId && !isFareBoundary(byId.stop_name ?? '')) anchorStop = { stop_id: byId.stop_id, stop_lat: byId.stop_lat, stop_lon: byId.stop_lon };
    }
    if (!anchorStop && anchor?.lat !== undefined && anchor?.lon !== undefined) {
      const near = store.findNearestStops(anchor.lat, anchor.lon, 400, 1);
      if (near.length > 0) {
        anchorStop = { stop_id: near[0].stop.stop_id, stop_lat: near[0].stop.stop_lat, stop_lon: near[0].stop.stop_lon };
      }
    }
    if (anchorStop) {
      const trueDistM = Math.round(
        distanceMeters(fromLat, fromLon, anchorStop.stop_lat, anchorStop.stop_lon)
      );
      if (trueDistM <= maxWalkM * 1.2) {
        const trueWalkSec = Math.max(30, Math.round((trueDistM * WALK_DETOUR_FACTOR) / userWalkSpeed));
        const bonusWalkSec = Math.max(30, trueWalkSec - 30);
        const existing = origins.find((o) => o.stopId === anchorStop!.stop_id);
        if (existing) {
          existing.walkSec = Math.min(existing.walkSec, bonusWalkSec);
        } else {
          origins.push({ stopId: anchorStop.stop_id, walkM: trueDistM, walkSec: bonusWalkSec });
        }
      }
    }
  }

  return origins;
}

/**
 * Podróż wraca po własnych śladach: ten sam przystanek dwa razy, np. kurs
 * w jedną stronę i z powrotem, żeby dojść pieszo. Takie warianty tylko
 * marnują czas, więc odrzucamy je przed mapowaniem na UI.
 */
function revisitsStops(rj: RawJourney): boolean {
  const seen = new Set<string>();
  let prev = '';
  for (const seg of rj.segments) {
    if (seg.type !== 'transit') continue;
    for (const id of [seg.fromStopId, seg.toStopId]) {
      if (!id || id === prev) continue;
      if (seen.has(id)) return true;
      seen.add(id);
      prev = id;
    }
  }
  return false;
}

/** Pojedyncza noga piesza jako połączenie. Używane też dla startu = celu. */
function buildWalkOnlyConnection(
  options: PlanOptions,
  directM: number,
  walkDepSec: number,
  walkArrSec: number,
  walkSec: number,
  currentSec: number,
  serviceDate?: string,
): Connection {
  const walkInMin = Math.max(0, Math.round((walkDepSec - currentSec) / 60));
  return {
    id: `walk-only-${walkDepSec}`,
    fromTitle: options.fromTitle,
    toTitle: options.toTitle,
    departInMin: walkInMin,
    departureSec: walkDepSec,
    arrivalSec: walkArrSec,
    departAt: secondsToTimeString(walkDepSec),
    arriveAt: secondsToTimeString(walkArrSec),
    durationMin: Math.max(1, Math.round(walkSec / 60)),
    transfers: 0,
    delayMin: 0,
    live: false,
    serviceDate,
    legs: [
      {
        id: 'walk-only-l1',
        mode: 'walk',
        fromStop: options.fromTitle,
        toStop: options.toTitle,
        fromStopId: 'origin',
        toStopId: 'destination',
        fromLat: options.fromLat,
        fromLon: options.fromLon,
        toLat: options.toLat,
        toLon: options.toLon,
        departAt: secondsToTimeString(walkDepSec),
        arriveAt: secondsToTimeString(walkArrSec),
        stopsCount: 0,
        walkM: directM,
        live: false,
      },
    ],
  };
}


interface BoardedStopFeed {
  alightIdx: number;
  alightStop: LegStop;
  alightSec: number;
  walkM: number;
  walkSec: number;
  readySec: number;
}

function selectBoardedJourneys(
  journeys: RawJourney[],
  refSec: number,
  cost: CostParams,
  uncertaintyPenalty: ReadonlyMap<string, number>,
  limit = 12,
): RawJourney[] {
  const walkSecOf = (j: RawJourney) =>
    j.segments.reduce((sum, s) => (s.type === "walk" ? sum + Math.max(0, s.arriveSec - s.departSec) : sum), 0);
  const scored = journeys.map((j) => {
    const walk = walkSecOf(j);
    const transit = j.segments.filter((s) => s.type === "transit");
    const c =
      j.arrivalSec -
      refSec +
      (Math.max(1, cost.walkReluctance) - 1) * walk +
      j.transfers * cost.transferPenaltySec +
      transit.reduce((sum, s) => sum + (uncertaintyPenalty.get(s.tripId ?? "") ?? 0), 0);
    return {
      j,
      cost: c,
      walk,
      chain: transit.map((s) => `${s.tripId ?? ""}@${s.fromStopId}>${s.toStopId}`).join("|"),
      combo: transit.map((s) => s.line ?? "").join("+"),
    };
  });

  scored.sort((a, b) => a.cost - b.cost || a.j.transfers - b.j.transfers || a.j.arrivalSec - b.j.arrivalSec);

  const byChain = new Set<string>();
  const unique = scored.filter((x) => {
    if (byChain.has(x.chain)) return false;
    byChain.add(x.chain);
    return true;
  });

  const front = unique.filter(
    (x) =>
      !unique.some(
        (y) =>
          y !== x &&
          y.j.arrivalSec <= x.j.arrivalSec &&
          y.j.transfers <= x.j.transfers &&
          y.walk <= x.walk + 30 &&
          y.cost <= x.cost &&
          (y.j.arrivalSec < x.j.arrivalSec ||
            y.j.transfers < x.j.transfers ||
            y.walk < x.walk - 30 ||
            y.cost < x.cost),
      ),
  );

  const perCombo = new Map<string, number>();
  const result: RawJourney[] = [];
  for (const x of front) {
    const count = perCombo.get(x.combo) ?? 0;
    if (count >= 3) continue;
    perCombo.set(x.combo, count + 1);
    result.push(x.j);
    if (result.length >= limit) break;
  }

  if (result.length > 0 && front.length > 0) {
    let fastest = front[0].j;
    for (const x of front) {
      if (x.j.arrivalSec < fastest.arrivalSec) fastest = x.j;
    }
    if (!result.includes(fastest)) {
      if (result.length >= limit) result.pop();
      result.push(fastest);
    }
  }
  return result;
}

/**
 * Planuje dalszą podróż z pokładu jadącego pojazdu: zwraca opcje bez przesiadki
 * (wysiadka przy celu + dojście) oraz warianty z 1+ przesiadkami od kolejnych
 * przystanków na trasie kursu (włącznie z sąsiednimi słupkami w zasięgu spaceru).
 */
async function planFromBoardedTrip(
  options: PlanOptions,
  store: LocalGtfsStore = gtfsStore,
): Promise<Connection[]> {
  const boarded = options.boardedTrip!;
  const now = new Date();
  const nowWarsaw = warsawNow(now);
  const currentSec = nowWarsaw.sec;

  const rawTarget = Math.max(-86400 * 2, Math.round(options.departureTimeSec ?? currentSec));
  const horizonSec = options.searchAheadSec ?? 10800;
  const slices = options.dayIndex
    ? {
        departureSec: ((rawTarget % 86400) + 86400) % 86400,
        dayOffsetSec: Math.floor(rawTarget / 86400) * 86400,
        searchStartSec: ((rawTarget % 86400) + 86400) % 86400,
        searchIndex: options.dayIndex,
        patternOffsets: undefined,
      }
    : await buildSearchSlices(rawTarget, false, store, horizonSec);

  const { dayOffsetSec, searchStartSec, searchIndex, patternOffsets } = slices;
  const dayShift = Math.round(dayOffsetSec / 86400);
  const targetWarsaw = dayShift === 0 ? nowWarsaw : shiftWarsawDate(nowWarsaw, dayShift);

  const maxTransfers = Math.max(0, Math.min(3, Math.round(options.maxTransfers ?? 2)));
  const modes: TransitModePreference =
    options.modes === "tram" || options.modes === "bus" ? options.modes : "all";
  const minTransferSec = Math.max(0, Math.min(600, Math.round(options.minTransferSec ?? 120)));
  const allow = options.allowedTransferModes;
  const trainsEnabled = allow?.train ?? options.trainsEnabled ?? true;
  const cableEnabled = allow?.cable ?? options.cableEnabled ?? true;
  const trainMinTransferSec = Math.max(0, Math.min(1200, Math.round(options.trainMinTransferSec ?? 300)));
  const maxWalkM = Math.max(100, Math.min(2000, Math.round(options.maxWalkM ?? 800)));
  const userWalkSpeed = Math.max(0.8, Math.min(2.0, options.walkSpeedMps ?? WALK_SPEED_MPS));
  const cost = DEFAULT_COST;

  await liveTracker.ensureFresh();
  const snapshot =
    dayOffsetSec === 0
      ? liveTracker.getRoutingSnapshot(searchIndex, patternOffsets)
      : emptyRoutingSnapshot();

  const tripStops = await buildTripStops(boarded.tripId, store);
  if (tripStops.length < 2) return [];

  const trip = store.trips.get(boarded.tripId);
  const route = trip
    ? store.routes.get(trip.route_id)
    : boarded.routeId
      ? store.routes.get(boarded.routeId)
      : undefined;
  const line = boarded.line || route?.route_short_name || "MPK";
  const mode: LegMode = boarded.mode ?? classifyTransitMode(route?.route_type, line);
  const direction = boarded.direction || trip?.trip_headsign || "";
  const routeId = boarded.routeId || trip?.route_id || route?.route_id;

  const tripDelays = new Map(snapshot.delays);
  const confidence = new Map(snapshot.confidence);
  if (boarded.delaySec !== undefined && !tripDelays.has(boarded.tripId)) {
    tripDelays.set(boarded.tripId, boarded.delaySec);
    confidence.set(boarded.tripId, "live");
  }
  const rawDelaySec = tripDelays.get(boarded.tripId) ?? 0;
  const delayRefSec = options.departureTimeSec !== undefined ? searchStartSec : currentSec;

  // stop_times mogą mieć godziny 24:xx+ (nocny kurs z poprzedniej doby).
  // Sprowadź cały kurs do doby punktu startowego, inaczej porównania z
  // searchStartSec (0..86399) dają przyjazd +1 dzień i ogromny czas podróży.
  const firstSchedSec = tripStops[0].arriveSec ?? tripStops[0].departSec ?? searchStartSec;
  const tripDayShiftSec = Math.round((searchStartSec - firstSchedSec) / 86400) * 86400;
  const delayRefTripSec = delayRefSec + tripDayShiftSec;

  const effArr: number[] = [];
  const effDep: number[] = [];
  for (let i = 0; i < tripStops.length; i++) {
    const st = tripStops[i];
    const schedArr = (st.arriveSec ?? st.departSec ?? searchStartSec) + tripDayShiftSec;
    const schedDep = (st.departSec ?? st.arriveSec ?? searchStartSec) + tripDayShiftSec;
    let a =
      rawDelaySec === 0
        ? schedArr
        : schedArr + predictDelaySec(rawDelaySec, schedArr - (delayRefTripSec - rawDelaySec), "arrive", mode);
    let d =
      rawDelaySec === 0
        ? schedDep
        : schedDep + predictDelaySec(rawDelaySec, schedDep - (delayRefTripSec - rawDelaySec), "board", mode);
    if (i > 0) {
      a = Math.max(a, effArr[i - 1]);
      d = Math.max(d, a);
    } else {
      d = Math.max(d, a);
    }
    effArr.push(a);
    effDep.push(d);
  }

  // Zbuduj dystanse narastające wzdłuż przystanków kursu (dla projekcji pozycji pojazdu/usera).
  const cumDist: number[] = new Array(tripStops.length).fill(0);
  const polyCoords: [number, number][] = [];
  const polyStopIndices: number[] = [];
  for (let i = 0; i < tripStops.length; i++) {
    const st = tripStops[i];
    if (st.lat !== undefined && st.lon !== undefined && Number.isFinite(st.lat) && Number.isFinite(st.lon)) {
      if (polyCoords.length > 0) {
        const prev = polyCoords[polyCoords.length - 1];
        const segD = distanceMeters(prev[0], prev[1], st.lat, st.lon);
        cumDist[i] = cumDist[polyStopIndices[polyStopIndices.length - 1]] + segD;
      }
      polyCoords.push([st.lat, st.lon]);
      polyStopIndices.push(i);
    } else if (i > 0) {
      cumDist[i] = cumDist[i - 1];
    }
  }

  const refLat = boarded.currentLat ?? (boarded.boardStopId ? undefined : options.fromLat);
  const refLon = boarded.currentLon ?? (boarded.boardStopId ? undefined : options.fromLon);
  const proj =
    refLat !== undefined &&
    refLon !== undefined &&
    Number.isFinite(refLat) &&
    Number.isFinite(refLon) &&
    polyCoords.length >= 2
      ? projectRoutePoint(polyCoords, refLat, refLon)
      : null;
  const hasSpatialPos = Boolean(proj && proj.offsetM <= 500);

  let boardIdx = -1;
  if (boarded.boardStopId) {
    let bestScore = Infinity;
    for (let i = 0; i < tripStops.length - 1; i++) {
      if (tripStops[i].stopId !== boarded.boardStopId) continue;
      const score = hasSpatialPos
        ? Math.abs((cumDist[i] ?? 0) - proj!.alongM)
        : Math.abs(effDep[i] - searchStartSec);
      if (score < bestScore) {
        bestScore = score;
        boardIdx = i;
      }
    }
  }
  if (boardIdx < 0 && hasSpatialPos) {
    boardIdx = 0;
    for (let i = 0; i < tripStops.length - 1; i++) {
      if (cumDist[i] <= proj!.alongM + 35) boardIdx = i;
    }
  }
  if (boardIdx < 0) {
    boardIdx = 0;
    for (let i = 0; i < tripStops.length - 1; i++) {
      if (effDep[i] <= searchStartSec) boardIdx = i;
    }
  }

  let minAlightIdx = Math.min(tripStops.length - 1, boardIdx + 1);
  if (hasSpatialPos) {
    if (proj!.alongM > proj!.totalM + 100 && effArr[tripStops.length - 1] < searchStartSec - 60) {
      return [];
    }
    while (
      minAlightIdx < tripStops.length - 1 &&
      (cumDist[minAlightIdx] - proj!.alongM < 60 || effArr[minAlightIdx] < searchStartSec - 120)
    ) {
      minAlightIdx++;
    }
  } else {
    while (minAlightIdx < tripStops.length - 1 && effArr[minAlightIdx] < searchStartSec + 15) {
      minAlightIdx++;
    }
  }

  const alightSec: number[] = new Array(tripStops.length).fill(0);
  for (let i = minAlightIdx; i < tripStops.length; i++) {
    let t = effArr[i];
    if (hasSpatialPos) {
      const remM = Math.max(0, cumDist[i] - proj!.alongM);
      const minTravel = remM > 0 ? Math.max(15, Math.round(remM / 6.0)) : 15;
      t = Math.max(t, searchStartSec + minTravel);
    } else {
      t = Math.max(t, searchStartSec + 15);
    }
    if (i > minAlightIdx) {
      t = Math.max(t, alightSec[i - 1] + 10);
    }
    alightSec[i] = t;
  }

  const boardStop = tripStops[boardIdx];
  const boardDepartSec = effDep[boardIdx];

  const isBanned = (m: string | undefined): boolean => {
    if (!m || m === "walk") return false;
    if (m === "train") return !trainsEnabled;
    if (m === "cable") return !cableEnabled;
    const v = (allow as Record<string, boolean | undefined> | undefined)?.[m];
    return v === false;
  };
  const transferAllowed = (j: RawJourney): boolean => {
    const transit = j.segments.filter((s) => s.type === "transit");
    if (transit.some((s) => isBanned(s.mode))) return false;
    if (modes === "all") return true;
    return transit.every((s) => s.mode === modes || (modes === "bus" && s.mode === "trolleybus"));
  };

  const makeBoardedSeg = (alightStop: LegStop, arrSec: number, stopsCount: number): JourneySegment => ({
    type: "transit",
    tripId: boarded.tripId,
    routeId,
    line,
    mode,
    direction,
    fromStopId: boardStop.stopId,
    fromStopName: boardStop.name,
    toStopId: alightStop.stopId,
    toStopName: alightStop.name,
    departSec: boardDepartSec,
    arriveSec: arrSec,
    stopsCount,
  });

  const combinedJourneys: RawJourney[] = [];

  // 1. Opcje bez przesiadek: jedź dalej tym samym pojazdem aż pod cel.
  const destStopIdSet = options.destinationStopIds?.length ? new Set(options.destinationStopIds) : null;
  for (let i = minAlightIdx; i < tripStops.length; i++) {
    const s = tripStops[i];
    if (isFareBoundary(s.name) && s.stopId !== options.toId && !destStopIdSet?.has(s.stopId)) {
      continue;
    }
    let walkM = 0;
    let walkSec = 0;
    if (destStopIdSet) {
      if (!destStopIdSet.has(s.stopId)) continue;
    } else if (s.stopId === options.toId) {
      const d =
        s.lat !== undefined && s.lon !== undefined
          ? Math.round(distanceMeters(s.lat, s.lon, options.toLat, options.toLon))
          : 0;
      walkM = Math.min(d, 50);
      walkSec = walkM <= 20 ? 0 : Math.max(30, Math.round((walkM * WALK_DETOUR_FACTOR) / userWalkSpeed));
    } else if (s.lat !== undefined && s.lon !== undefined) {
      const entranceHit = isWarsawMetroStopId(s.stopId) ? findOptimalMetroEntrance(s.stopId, options.toLat, options.toLon) : null;
      const d = entranceHit ? entranceHit.distanceM : Math.round(distanceMeters(s.lat, s.lon, options.toLat, options.toLon));
      if (d > maxWalkM) continue;
      walkM = d;
      walkSec = walkM <= 20 ? 0 : Math.max(30, Math.round((walkM * WALK_DETOUR_FACTOR) / userWalkSpeed));
    } else {
      continue;
    }

    const segs: JourneySegment[] = [makeBoardedSeg(s, alightSec[i], i - boardIdx)];
    if (walkM > 20 || walkSec > 0) {
      segs.push({
        type: "walk",
        fromStopId: s.stopId,
        fromStopName: s.name,
        toStopId: "destination",
        toStopName: options.toTitle,
        departSec: alightSec[i],
        arriveSec: alightSec[i] + walkSec,
        stopsCount: 0,
        walkMeters: walkM,
      });
    }
    combinedJourneys.push({
      departureSec: searchStartSec,
      arrivalSec: alightSec[i] + walkSec,
      transfers: 0,
      segments: segs,
    });
  }

  // 2. Opcje z przesiadkami (1..maxTransfers) od kolejnych przystanków na trasie kursu.
  if (maxTransfers >= 1) {
    const destinations = options.destinationStopIds?.length
      ? options.destinationStopIds.map((stopId) => ({ stopId, walkM: 0, walkSec: 0 }))
      : resolveNearbyAccessStops(options.toLat, options.toLon, maxWalkM, userWalkSpeed, store);

    if (destinations.length > 0) {
      const bestFeedByStop = new Map<string, BoardedStopFeed>();
      const registerFeed = (targetStopId: string, candidate: BoardedStopFeed) => {
        const prev = bestFeedByStop.get(targetStopId);
        if (!prev || candidate.readySec < prev.readySec) {
          bestFeedByStop.set(targetStopId, candidate);
        }
      };

      const transferWalkCap = Math.min(maxWalkM, 800);
      for (let i = minAlightIdx; i < tripStops.length; i++) {
        const s = tripStops[i];
        if (isFareBoundary(s.name)) continue;
        const arr = alightSec[i];

        registerFeed(s.stopId, {
          alightIdx: i,
          alightStop: s,
          alightSec: arr,
          walkM: 0,
          walkSec: 0,
          readySec: arr + minTransferSec,
        });

        const fps = store.footpaths.get(s.stopId);
        if (fps && fps.length > 0) {
          for (const fp of fps) {
            if (!fp.fixed && fp.distance_m > transferWalkCap) continue;
            const toStop = store.stops.get(fp.to_stop_id);
            if (!toStop || isFareBoundary(toStop.stop_name ?? "")) continue;
            const walkSec = fp.fixed
              ? fp.duration_sec
              : Math.max(45, Math.round((fp.distance_m * WALK_DETOUR_FACTOR) / userWalkSpeed));
            registerFeed(fp.to_stop_id, {
              alightIdx: i,
              alightStop: s,
              alightSec: arr,
              walkM: fp.distance_m,
              walkSec,
              readySec: arr + Math.max(minTransferSec, walkSec + 60),
            });
          }
        } else if (s.lat !== undefined && s.lon !== undefined) {
          const near = store.findNearestStops(s.lat, s.lon, Math.min(transferWalkCap, 500), 20);
          for (const n of near) {
            if (n.stop.stop_id === s.stopId) continue;
            if (isFareBoundary(n.stop.stop_name ?? "")) continue;
            const walkSec = Math.max(45, Math.round((n.distanceM * WALK_DETOUR_FACTOR) / userWalkSpeed));
            registerFeed(n.stop.stop_id, {
              alightIdx: i,
              alightStop: s,
              alightSec: arr,
              walkM: n.distanceM,
              walkSec,
              readySec: arr + Math.max(minTransferSec, walkSec + 60),
            });
          }
        }
      }

      const MAX_BOARD_AHEAD_SEC = Math.max(7200, horizonSec);
      const raptorOrigins = Array.from(bestFeedByStop.entries())
        .filter(([, feed]) => feed.readySec <= searchStartSec + MAX_BOARD_AHEAD_SEC)
        .map(([stopId, feed]) => ({
          stopId,
          walkSec: Math.max(0, feed.readySec - searchStartSec),
          walkM: 0,
        }));

      if (raptorOrigins.length > 0) {
        const batch = await runRaptorAsync(store, raptorOrigins, destinations, searchStartSec, {
          maxTransfers: maxTransfers - 1,
          minTransferSec,
          trainsEnabled,
          cableEnabled,
          trainMinTransferSec,
          dayIndex: searchIndex,
          tripDelays,
          transferBuffers: snapshot.transferBuffers,
          nowSec: currentSec,
          allowedModes: modes,
          patternTimeOffsets: patternOffsets,
          windowSec: Math.min(MAX_BOARD_AHEAD_SEC, 5400),
          walkSpeedMps: userWalkSpeed,
          maxTransferWalkM: maxWalkM,
          cost,
        });

        for (const rj of batch) {
          if (rj.transfers > maxTransfers - 1) continue;
          if (!transferAllowed(rj)) continue;
          const transit = rj.segments.filter((seg) => seg.type === "transit");
          if (transit.length === 0) continue;
          if (transit.some((seg) => seg.tripId === boarded.tripId)) continue;

          const firstTransit = transit[0];
          const feed = bestFeedByStop.get(firstTransit.fromStopId);
          if (!feed || feed.alightIdx <= boardIdx) continue;
          if (firstTransit.departSec < feed.readySec) continue;
          if (firstTransit.mode === "train") {
            const needTrain = Math.max(trainMinTransferSec, feed.walkSec > 0 ? feed.walkSec + 60 : 0);
            if (firstTransit.departSec < feed.alightSec + needTrain) continue;
          }

          const segs: JourneySegment[] = [
            makeBoardedSeg(feed.alightStop, feed.alightSec, feed.alightIdx - boardIdx),
          ];
          if (firstTransit.fromStopId !== feed.alightStop.stopId) {
            segs.push({
              type: "walk",
              fromStopId: feed.alightStop.stopId,
              fromStopName: feed.alightStop.name,
              toStopId: firstTransit.fromStopId,
              toStopName: firstTransit.fromStopName,
              departSec: feed.alightSec,
              arriveSec: feed.alightSec + feed.walkSec,
              stopsCount: 0,
              walkMeters: feed.walkM,
            });
          }
          segs.push(...rj.segments);

          const candidate: RawJourney = {
            departureSec: searchStartSec,
            arrivalSec: rj.arrivalSec,
            transfers: rj.transfers + 1,
            segments: segs,
          };
          if (!revisitsStops(candidate)) {
            combinedJourneys.push(candidate);
          }
        }
      }
    }
  }

  if (combinedJourneys.length === 0) return [];

  const uncertaintyPenalty = new Map([...snapshot.transferBuffers.keys()].map((id) => [id, 120]));
  const selected = selectBoardedJourneys(combinedJourneys, searchStartSec, cost, uncertaintyPenalty);
  const mapCtx: MapCtx = {
    currentSec,
    dayOffsetSec,
    tripDelays,
    confidence,
    serviceDate: targetWarsaw.isoDate,
  };
  const connections = mapJourneysToConnections(selected, options, mapCtx, store, true);
  const nowStartSec = searchStartSec + dayOffsetSec;
  for (const c of connections) {
    c.boarded = true;
    c.departureSec = nowStartSec;
    c.departAt = secondsToTimeString(nowStartSec);
    c.departInMin = 0;
    c.durationMin = Math.max(1, Math.round(((c.arrivalSec ?? nowStartSec) - nowStartSec) / 60));
    c.id = stableConnectionId(c);
  }
  const deduped = deduplicateConnections(connections);
  sortConnectionsByCost(deduped, userWalkSpeed, undefined, cost);
  // "Bądź na" obowiązuje też z pokładu: odrzuć przyjazdy po terminie.
  const arriveBySec = options.arriveBySec;
  const result =
    arriveBySec !== undefined && Number.isFinite(arriveBySec)
      ? deduped.filter((c) => (c.arrivalSec ?? Infinity) <= arriveBySec)
      : deduped;
  if (options.onProgress && result.length > 0) {
    options.onProgress(result);
  }
  return result;
}

export async function planConnections(
  options: PlanOptions,
  store: LocalGtfsStore = gtfsStore,
): Promise<Connection[]> {
  await store.load();
  await maybeWarmupMetroEntrances(options, store);

  if (options.boardedTrip) {
    return planFromBoardedTrip(options, store);
  }

  const now = new Date();
  const nowWarsaw = warsawNow(now);
  const currentSec = nowWarsaw.sec;

  // Wycinek dnia (+ nocny merge) przez SHARED buildSearchSlices: rozgrzewka
  // uruchamiana tym samym kodem, co samo wyszukiwanie.
  const arrivalTarget = options.arriveBySec;
  const arrivalMode = arrivalTarget !== undefined && Number.isFinite(arrivalTarget);
  const rawTarget = Math.max(
    -86400 * 2,
    Math.round(arrivalMode ? arrivalTarget : (options.departureTimeSec ?? currentSec)),
  );
  // Horyzont wypychania: tramwaje jeżdżą często (3 h), kolej rzadko (6 h,
  // pierwszy pociąg do celu bywa poza standardowym zapasem).
  const horizonSec = options.searchAheadSec ?? 10800;
  const slices = await buildSearchSlices(rawTarget, arrivalMode, store, horizonSec);
  const { departureSec, dayOffsetSec, searchStartSec, searchIndex, patternOffsets } = slices;
  const dayShift = Math.round(dayOffsetSec / 86400);
  const targetWarsaw = dayShift === 0 ? nowWarsaw : shiftWarsawDate(nowWarsaw, dayShift);
  // Przyjazd na jutro: kurs może wyjechać jeszcze dziś wieczorem, więc dolna
  // granica to „teraz” w zegarze dnia docelowego, a nie start okna przyjazdu.
  const earliestDepartureSec = arrivalMode && rawTarget >= currentSec
    ? currentSec - dayOffsetSec
    : searchStartSec;

  const maxTransfers = Math.max(0, Math.min(3, Math.round(options.maxTransfers ?? 2)));
  const modes: TransitModePreference =
    options.modes === 'tram' || options.modes === 'bus' ? options.modes : 'all';
  const minTransferSec = Math.max(0, Math.min(600, Math.round(options.minTransferSec ?? 120)));
  // Pille z ustawień wygrywają ze starymi przełącznikami: jawny wpis w
  // allowedTransferModes nadpisuje trainsEnabled i cableEnabled.
  const allow = options.allowedTransferModes;
  const trainsEnabled = allow?.train ?? options.trainsEnabled ?? true;
  const cableEnabled = allow?.cable ?? options.cableEnabled ?? true;
  const trainMinTransferSec = Math.max(0, Math.min(1200, Math.round(options.trainMinTransferSec ?? 300)));
  const maxWalkM = Math.max(100, Math.min(2000, Math.round(options.maxWalkM ?? 800)));
  const userWalkSpeed = Math.max(0.8, Math.min(2.0, options.walkSpeedMps ?? WALK_SPEED_MPS));
  const cost = DEFAULT_COST;

  // Start i cel w tym samym miejscu: RAPTOR umie tu wymyślić przejazd w jedną
  // stronę i z powrotem, a to zwykły spacer. Jedna noga piesza i koniec.
  const directM = Math.round(
    distanceMeters(options.fromLat, options.fromLon, options.toLat, options.toLon)
  );
  const directWalkSec = Math.max(60, Math.round((directM * WALK_DETOUR_FACTOR) / userWalkSpeed));
  const walkArrSec = arrivalMode ? rawTarget : departureSec + dayOffsetSec + directWalkSec;
  const walkDepSec = walkArrSec - directWalkSec;
  if (directM <= SAME_POINT_M) {
    return [buildWalkOnlyConnection(options, directM, walkDepSec, walkArrSec, directWalkSec, currentSec, targetWarsaw.isoDate)];
  }

  // 1. Resolve candidate boarding stops near origin. Jawne id (intercity:
  // stacje kolejowe z magazynu polska) pomijają szukanie po współrzędnych.
  const origins = options.originStopIds?.length
    ? options.originStopIds.map((stopId) => ({ stopId, walkM: 0, walkSec: 0 }))
    : resolveCandidateOrigins(
        options.fromLat,
        options.fromLon,
        maxWalkM,
        userWalkSpeed,
        {
          stopId: options.anchorStopId,
          lat: options.anchorStopLat,
          lon: options.anchorStopLon,
        },
        store,
      );

  // 2. Resolve candidate alighting stops near destination
  const destinations = options.destinationStopIds?.length
    ? options.destinationStopIds.map((stopId) => ({ stopId, walkM: 0, walkSec: 0 }))
    : resolveNearbyAccessStops(options.toLat, options.toLon, maxWalkM, userWalkSpeed, store);

  if (!origins.length || !destinations.length) {
    return [];
  }

  // 3. Range RAPTOR (z limitami z ustawień, na rozkładzie właściwego dnia).
  // Opóźnienia GPS tylko dla dzisiejszych kursów: ten sam trip_id jutro to
  // inny kurs. Tracker odświeża się w tle; planowanie nigdy nie czeka na sieć.
  await liveTracker.ensureFresh();
  const snapshot = dayOffsetSec === 0 ? liveTracker.getRoutingSnapshot(searchIndex, patternOffsets) : emptyRoutingSnapshot();
  const tripDelays = snapshot.delays;
  const uncertaintyPenalty = new Map([...snapshot.transferBuffers.keys()].map(id => [id, 120]));
  const rawJourneys: RawJourney[] = [];
  // Przyjazdy: ostatnia godzina przed celem. Odjazdy: dwa okna do przodu
  // (a przy szerszym horyzoncie kolejowym dokładamy kolejne, żeby pociągi
  // rzadkie jak IC nie zniknęły poza pierwszymi 45 minutami).
  const timeWindows: [number, number][] = arrivalMode
    ? [[0, 3600]]
    : horizonSec <= 2700
      ? [
          [0, 900],
          [900, 2700],
        ]
      : (() => {
          const windows: [number, number][] = [
            [0, 900],
            [900, 2700],
            [2700, 7200],
          ];
          let from = 7200;
          while (from < horizonSec) {
            windows.push([from, Math.min(from + 7200, horizonSec)]);
            from += 7200;
          }
          return windows;
        })();

  // Siatka bezpieczeństwa: gdyby klasyfikacja na poziomie segmentu rozjechała
  // się z klasyfikacją wzorca, odrzuć podróże z niedozwolonym pojazdem.
  // Pociągi (mode 'train') i metro (mode 'subway') wypadają z wąskich filtrów
  // same, bo nigdy nie są równe 'tram' ani 'bus'. Trolejbus jedzie z filtrem
  // autobusowym.
  // Pille z ustawień odcinają zbanowane środki na poziomie podróży: wyłączony
  // pojazd nie pojawia się w wynikach wcale (ani na start, ani na przesiadce).
  const isBanned = (mode: string | undefined): boolean => {
    if (!mode || mode === 'walk') return false;
    if (mode === 'train') return !trainsEnabled;
    if (mode === 'cable') return !cableEnabled;
    const v = (allow as Record<string, boolean | undefined> | undefined)?.[mode];
    return v === false;
  };
  const applyModeFilter = (list: RawJourney[]) =>
    list.filter((j) => {
      const transit = j.segments.filter((s) => s.type === 'transit');
      if (transit.some((s) => isBanned(s.mode))) return false;
      if (modes === 'all') return true;
      return transit.every((s) => s.mode === modes || (modes === 'bus' && s.mode === 'trolleybus'));
    });
  const mapCtx: MapCtx = { currentSec, dayOffsetSec, tripDelays, confidence: snapshot.confidence, serviceDate: targetWarsaw.isoDate };
  const sortPartial = (list: Connection[]) =>
    sortConnectionsByCost(list, userWalkSpeed, arrivalMode ? rawTarget : undefined, cost);
  const select = (list: RawJourney[]) =>
    selectJourneys(applyModeFilter(list), searchStartSec, {
      cost,
      uncertaintyPenalty,
      arriveBySec: arrivalMode ? departureSec : undefined,
    });

  // Brak górnego limitu wsiadania w RAPTOR-ze: „pierwszy kurs po przybyciu"
  // bywa wiele godzin później (np. zapytanie 07:20 → wsiadanie 23:29, bo to
  // pierwszy kurs danego wzorca na tym przystanku). Wszystko ponad +2 h od
  // startu wyszukiwania to nie propozycja dla użytkownika - odrzucamy od razu,
  // żeby takie kursy nie psuły listy wariantów (też częściowej w onProgress).
  // Kolej (searchAheadSec) sięga dalej: pociągi dalekobieżne jeżdżą rzadko.
  const MAX_BOARD_AHEAD_SEC = Math.max(7200, horizonSec);

  for (const [offsetSec, windowSec] of timeWindows) {
    const batch = await runRaptorAsync(store, origins, destinations, (arrivalMode ? departureSec : searchStartSec) + offsetSec, {
      maxTransfers,
      minTransferSec,
      trainsEnabled,
      cableEnabled,
      trainMinTransferSec,
      dayIndex: searchIndex,
      tripDelays,
      transferBuffers: snapshot.transferBuffers,
      nowSec: currentSec,
      allowedModes: modes,
      patternTimeOffsets: patternOffsets,
      windowSec,
      walkSpeedMps: userWalkSpeed,
      maxTransferWalkM: maxWalkM,
      cost,
      latestArrivalSec: arrivalMode ? departureSec : undefined,
      arriveBy: arrivalMode,
    });
    for (const j of batch) {
      const inWindow = arrivalMode
        ? j.arrivalSec <= departureSec && j.departureSec >= earliestDepartureSec
        : j.departureSec <= searchStartSec + MAX_BOARD_AHEAD_SEC;
      if (j.transfers <= maxTransfers && inWindow) {
        rawJourneys.push(j);
      }
    }
    // Progres: po każdym oknie wydaj to, co mamy - UI dokłada wiersze
    // "po kolei" zamiast czekać na całość. await ustępuje wątek JS,
    // żeby FlatList zdążyła się przemalować między oknami.
    if (options.onProgress && rawJourneys.length > 0) {
      const partial = sortPartial(
        mapJourneysToConnections(select(rawJourneys), options, mapCtx, store),
      );
      if (partial.length > 0) {
        options.onProgress(partial);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  // Jedna wspólna selekcja (dominacja + różnorodność) na CAŁYM zbiorze
  // (osobno na okno dublowałyby się te same kursy).
  const filtered = select(rawJourneys);

  // 4. Map into Connection model
  const connections = mapJourneysToConnections(filtered, options, mapCtx, store);

  // Opcja "na piechotę" dla bliskich celów (jak w Jakdojade) - jeśli prosto
  // jest w zasięgu spaceru z ustawień, dokładamy ją do listy.
  const canStartWalk = !arrivalMode || walkDepSec >= earliestDepartureSec + dayOffsetSec;
  const walkAdded = directM > 0 && directM <= maxWalkM && canStartWalk;
  if (walkAdded) {
    connections.push(buildWalkOnlyConnection(options, directM, walkDepSec, walkArrSec, directWalkSec, currentSec, targetWarsaw.isoDate));
  }

  // Marsz bije przesiadki: gdy pieszo docierasz równie szybko jak wariantem
  // z przesiadką, taki wariant jest tylko stratą czasu (typowy przypadek:
  // cel o jeden przystanek, a RAPTOR proponuje jazdę tam i z powrotem).
  // Tylko dla krótkich spacerów, żeby nie wycinać kursów, które ktoś woła
  // wybrać zamiast 20 minut na nogach.
  if (walkAdded && directWalkSec <= WALK_BEATS_TRANSIT_MAX_SEC) {
    for (let i = connections.length - 1; i >= 0; i--) {
      const c = connections[i];
      if (c.id.startsWith('walk-only-') || c.transfers === 0) continue;
      const arrivalSec = c.arrivalSec ?? c.departureSec + c.durationMin * 60;
      const worse = arrivalMode ? c.departureSec <= walkDepSec : arrivalSec >= walkArrSec;
      if (worse) connections.splice(i, 1);
    }
  }

  sortPartial(connections);
  for (const connection of connections) {
    connection.id = stableConnectionId(connection);
  }
  return deduplicateConnections(connections);
}
