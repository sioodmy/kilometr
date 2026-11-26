import {
  runRaptorQueryAsync,
  runRaptorQuerySync,
  warmupRaptorNetworkAsync,
} from '../../../modules/kilometr-raptor';
import { DayIndex, LocalGtfsStore as GtfsStore } from './store';
import { JourneySegment, RawJourney, TransitModePreference } from './types';
import {
  classifyTransitMode,
  getRaptorNet,
  getRaptorNetAsync,
  packRaptorNet,
  packRaptorNetAsync,
  type RaptorNet,
} from './network';

export { classifyTransitMode };

const INF = 0x3fffffff;
const QUERY_MAGIC = 0x52515231;
const ARRIVE_BY_QUERY_MAGIC = 0x52515232;

const DEFAULT_WALK_SPEED_MPS = 1.34;
/** Najdłuższa piesza przesiadka między przystankami (siatka w store.ts sięga 800 m). */
const MAX_TRANSFER_WALK_M = 800;

interface BoardingStop {
  stopId: string;
  walkSec: number;
  walkM: number;
}

interface AlightingStop {
  stopId: string;
  walkSec: number;
  walkM: number;
}

/** Wagi kosztu uogólnionego (sekundy „odczuwalne”). */
export interface CostParams {
  /** Ile razy sekunda marszu „boli” bardziej niż sekunda jazdy. */
  walkReluctance: number;
  /** Kara za każdą przesiadkę. */
  transferPenaltySec: number;
}

/** Domyślny koszt uogólniony: zrównoważony spacer i przesiadki. */
export const DEFAULT_COST: CostParams = {
  walkReluctance: 1.8,
  transferPenaltySec: 300,
};

export interface RaptorOptions {
  /** maksymalna liczba przesiadek (0 = tylko bezpośrednie). Default 2. */
  maxTransfers?: number;
  /** Minimalny odstęp między przyjazdem a kolejnym odjazdem, domyślnie 120 s. */
  minTransferSec?: number;
  /** indeks dzienny (rozkład sobotni/niedzielny różni się od powszedniego) */
  dayIndex?: DayIndex;
  /** znane opóźnienia kursów (GPS): tripId -> sekundy, zmierzone teraz. */
  tripDelays?: Map<string, number>;
  transferBuffers?: Map<string, number>;
  /**
   * Teraz (sekundy od północy, zegar zapytania). Z nim opóźnienia są
   * prognozowane per przystanek (pojazd nadrabia, patrz delays.ts); bez niego
   * pomiar obowiązuje na całej trasie.
   */
  nowSec?: number;
  /** dozwolone pojazdy. Default 'all'. Filtr działa W silniku (nie post-filtr). */
  allowedModes?: TransitModePreference;
  /** Czy pociągi KD biorą udział (tylko w trybie 'all'). Default true. */
  trainsEnabled?: boolean;
  /** Czy kolej linowa (Polinka) bierze udział (tylko w trybie 'all'). Default true. */
  cableEnabled?: boolean;
  /**
   * Minimalny zapas na wsiadanie do pociągu PO przesiadce (dojście na peron
   * itp.). Pierwszego wsiadania (z domu) nie dotyczy, tam liczy się spacer.
   * Default 300.
   */
  trainMinTransferSec?: number;
  /** Przesunięcie czasu wszystkich odczytów GTFS (sekundy). Domyślnie 0. */
  timeOffsetSec?: number;
  /** Zegar per wzorzec dla zunifikowanego indeksu nocnego (patrz mergeDayIndexes). */
  patternTimeOffsets?: Map<string, number>;
  /** Okno odjazdów po podanej godzinie lub przyjazdów przed nią. 0 = pojedynczy przebieg. */
  windowSec?: number;
  /** Tempo marszu na przesiadkach (m/s). Default 1.34. */
  walkSpeedMps?: number;
  /** Najdłuższa piesza przesiadka (m). Default 800. */
  maxTransferWalkM?: number;
  /** Wagi kosztu uogólnionego. Default DEFAULT_COST. */
  cost?: CostParams;
  /** Tryb „bądź na”: podróże z przyjazdem po tej godzinie są bezużyteczne. */
  latestArrivalSec?: number;
  /** Podana godzina oznacza przyjazd do celu, łącznie z odejściem od przystanku. */
  arriveBy?: boolean;
}

/**
 * Unifikacja indeksu nocnego: wzorce dziś + wzorce wczoraj (te drugie pod
 * prefiksem, np. `y_`) w JEDNEJ mapie + mapa przesunięć zegara per wzorzec.
 * Tripy 24:xx+ wczoraj lądują w zegarze dzisiejszym i łączą się z nogami
 * dzisiejszymi. Mapy kopiowane płytko (współdzielą departures/trips), zbiory
 * stopRoutes kopiowane, cache'owany indeks dzienny pozostaje nietknięty.
 */
export function mergeDayIndexes(
  primary: DayIndex,
  secondary: DayIndex,
  prefix: string,
  offsetSec: number,
): { index: DayIndex; offsets: Map<string, number> } {
  const index: DayIndex = {
    stopRoutes: new Map(),
    routeStops: new Map(primary.routeStops),
    routeTrips: new Map(primary.routeTrips),
    patterns: new Map(primary.patterns),
  };
  const offsets = new Map<string, number>();
  for (const [pid, seq] of secondary.routeStops) index.routeStops.set(`${prefix}${pid}`, seq);
  for (const [pid, trips] of secondary.routeTrips) index.routeTrips.set(`${prefix}${pid}`, trips);
  for (const [pid, pat] of secondary.patterns) {
    const npid = `${prefix}${pid}`;
    index.patterns.set(npid, pat);
    offsets.set(npid, offsetSec);
  }
  const allStops = new Set<string>([...primary.stopRoutes.keys(), ...secondary.stopRoutes.keys()]);
  for (const stopId of allStops) {
    const merged = new Set<string>(primary.stopRoutes.get(stopId) ?? []);
    for (const pid of secondary.stopRoutes.get(stopId) ?? []) merged.add(`${prefix}${pid}`);
    index.stopRoutes.set(stopId, merged);
  }
  return { index, offsets };
}

/**
 * Bezsensowna podróż: "wsiądź i wysiądź po ≤1 przystanku, resztę idź z buta"
 * albo kurs bez przystanków (błąd danych). Odrzucamy je już przy zapisie
 * kandydata: gdyby ustawiły najlepszy przyjazd, ucinałyby później dobre
 * podróże.
 *
 * Wyjątek: kolej linowa. Polinka to z definicji dwa przystanki i ~400 m nad
 * Odrą; bez zastrzeżenia „wsiądź i wysiądź" planer odrzucałby przejazd przez
 * rzekę jako krótszy niż dojście do przystanku MPK.
 */
export function isPointlessShortRide(rj: RawJourney): boolean {
  const transitSegs = rj.segments.filter((s) => s.type === 'transit');
  for (const t of transitSegs) {
    if (t.mode === 'cable') continue;
    if (t.stopsCount <= 0) return true;
  }
  if (
    transitSegs.length === 1 &&
    transitSegs[0].stopsCount <= 1 &&
    transitSegs[0].mode !== 'cable'
  ) {
    let totalWalkM = 0;
    for (const s of rj.segments) {
      if (s.type === 'walk') totalWalkM += s.walkMeters ?? 0;
    }
    if (totalWalkM >= 250) return true;
  }
  return false;
}

function allowedModeToCode(mode: TransitModePreference | undefined): number {
  if (mode === 'tram') return 1;
  if (mode === 'bus') return 2;
  return 0;
}

function packRaptorQuery(
  net: RaptorNet,
  origins: BoardingStop[],
  destinations: AlightingStop[],
  departureTimeSec: number,
  options: RaptorOptions,
): Uint8Array | null {
  const stopIdx = net.base.stopIndex;

  const validOrigins: number[] = [];
  for (let i = 0; i < origins.length; i++) {
    const o = origins[i];
    const s = stopIdx.get(o.stopId);
    if (s !== undefined) {
      validOrigins.push(s, Math.max(0, Math.round(o.walkSec)), Math.max(0, Math.round(o.walkM)));
    }
  }

  const validDests: number[] = [];
  for (let i = 0; i < destinations.length; i++) {
    const d = destinations[i];
    const s = stopIdx.get(d.stopId);
    if (s !== undefined) {
      validDests.push(s, Math.max(0, Math.round(d.walkSec)), Math.max(0, Math.round(d.walkM)));
    }
  }

  if (validOrigins.length === 0 || validDests.length === 0) {
    return null;
  }

  const delayEntries: number[] = [];
  if (options.tripDelays && options.tripDelays.size > 0) {
    for (const [tripId, raw] of options.tripDelays) {
      const d0 = Math.round(raw);
      if (!d0) continue;
      const loc = net.tripLoc.get(tripId);
      if (loc) {
        delayEntries.push(loc[0], loc[1], d0);
      }
    }
  }
  const bufferEntries: number[] = [];
  if (options.transferBuffers && options.transferBuffers.size > 0) {
    for (const [id, extra] of options.transferBuffers) {
      if (extra <= 0) continue;
      const loc = net.tripLoc.get(id);
      if (loc) bufferEntries.push(loc[0], loc[1], Math.round(extra));
    }
  }

  const maxTransfers = Math.max(0, Math.min(3, options.maxTransfers ?? 2));
  const minT = Math.max(0, Math.min(600, options.minTransferSec ?? 120));
  const trainNeed = Math.max(minT, Math.min(1200, options.trainMinTransferSec ?? 300));
  const trainsEnabled = (options.trainsEnabled ?? true) ? 1 : 0;
  const cableEnabled = (options.cableEnabled ?? true) ? 1 : 0;
  const allowedMode = allowedModeToCode(options.allowedModes);
  const windowSec = Math.max(0, Math.round(options.windowSec ?? 0));
  const speedMps = Math.max(0.5, Math.min(3, options.walkSpeedMps ?? DEFAULT_WALK_SPEED_MPS));
  const maxTransferWalkM = Math.max(
    0,
    Math.min(MAX_TRANSFER_WALK_M, Math.round(options.maxTransferWalkM ?? MAX_TRANSFER_WALK_M)),
  );
  const cost = options.cost ?? DEFAULT_COST;
  const wr = Math.max(1, cost.walkReluctance);
  const transferPenaltySec = Math.round(cost.transferPenaltySec);
  const latestArr =
    options.latestArrivalSec !== undefined ? Math.round(options.latestArrivalSec) : INF;
  const hasNow = options.nowSec !== undefined ? 1 : 0;
  const nowVal = options.nowSec !== undefined ? Math.round(options.nowSec) : 0;
  const t0 = Math.round(departureTimeSec);

  const nOrigins = validOrigins.length / 3;
  const nDests = validDests.length / 3;
  const nDelays = delayEntries.length / 3;
  const nBuffers = bufferEntries.length / 3;

  const headerWords = 22;
  const totalWords =
    headerWords + validOrigins.length + validDests.length + delayEntries.length + 1 + bufferEntries.length;
  const buf = new ArrayBuffer(totalWords * 4);
  const i32 = new Int32Array(buf);
  const view = new DataView(buf);
  let w = 0;

  i32[w++] = options.arriveBy ? ARRIVE_BY_QUERY_MAGIC : QUERY_MAGIC;
  i32[w++] = net.id;
  i32[w++] = t0;
  i32[w++] = windowSec;
  i32[w++] = maxTransfers;
  i32[w++] = minT;
  i32[w++] = trainNeed;
  i32[w++] = trainsEnabled;
  i32[w++] = cableEnabled;
  i32[w++] = allowedMode;
  view.setFloat64(w * 4, speedMps, true);
  w += 2;
  i32[w++] = maxTransferWalkM;
  view.setFloat64(w * 4, wr, true);
  w += 2;
  i32[w++] = transferPenaltySec;
  i32[w++] = latestArr;
  i32[w++] = hasNow;
  i32[w++] = nowVal;
  i32[w++] = nOrigins;
  i32[w++] = nDests;
  i32[w++] = nDelays;

  for (let i = 0; i < validOrigins.length; i++) i32[w++] = validOrigins[i];
  for (let i = 0; i < validDests.length; i++) i32[w++] = validDests[i];
  for (let i = 0; i < delayEntries.length; i++) i32[w++] = delayEntries[i];
  i32[w++] = nBuffers;
  for (let i = 0; i < bufferEntries.length; i++) i32[w++] = bufferEntries[i];

  return new Uint8Array(buf);
}

/** Łączy pod rząd idące odcinki piesze w jeden (np. spacer ze stacji na węzeł + dojście do celu). */
export function mergeConsecutiveWalks(segments: JourneySegment[]): JourneySegment[] {
  const out: JourneySegment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (prev && prev.type === "walk" && seg.type === "walk") {
      prev.toStopId = seg.toStopId;
      prev.toStopName = seg.toStopName;
      prev.arriveSec = seg.arriveSec;
      prev.walkMeters = (prev.walkMeters ?? 0) + (seg.walkMeters ?? 0);
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

function unpackJourneys(
  store: GtfsStore,
  net: RaptorNet,
  t0: number,
  bytes: Uint8Array | null,
  arriveBy = false,
): RawJourney[] {
  if (!bytes || bytes.byteLength < 4) return [];
  const words =
    (bytes.byteOffset & 3) === 0
      ? new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2)
      : new Int32Array(bytes.slice().buffer);
  const wordLen = words.length;
  let w = 0;

  const count = words[w++];
  if (count <= 0) return [];

  const P = net.patterns;
  const ids = net.base.stopIds;
  const stopName = (s: number) => store.stops.get(ids[s])?.stop_name || ids[s];
  const out: RawJourney[] = [];

  for (let c = 0; c < count; c++) {
    if (w + 10 > wordLen) break;
    const dest = words[w++];
    const firstStop = words[w++];
    const accessSec = words[w++];
    const accessM = words[w++];
    const egressSec = words[w++];
    const egressM = words[w++];
    const nLegs = words[w++];

    if (nLegs <= 0 || w + nLegs * 8 + 3 > wordLen) break;

    const segments: JourneySegment[] = [];
    let prevStop = -1;
    let prevArr = 0;

    for (let li = 0; li < nLegs; li++) {
      const pIdx = words[w++];
      const jIdx = words[w++];
      const bPos = words[w++];
      const aPos = words[w++];
      const walkIn = words[w++];
      const walkInM = words[w++];
      const depSec = words[w++];
      const arrSec = words[w++];

      const pat = P[pIdx];
      if (!pat) continue;
      const from = pat.stops[bPos];
      const to = pat.stops[aPos];

      if (li === 0 && accessSec > 0 && accessM > 0) {
        segments.push({
          type: 'walk',
          fromStopId: 'origin',
          fromStopName: 'Punkt startowy',
          toStopId: ids[firstStop],
          toStopName: stopName(firstStop),
          departSec: depSec - accessSec,
          arriveSec: depSec,
          stopsCount: 0,
          walkMeters: accessM,
        });
      }

      if (prevStop >= 0 && prevStop !== from) {
        segments.push({
          type: 'walk',
          fromStopId: ids[prevStop],
          fromStopName: stopName(prevStop),
          toStopId: ids[from],
          toStopName: stopName(from),
          departSec: prevArr,
          arriveSec: prevArr + walkIn,
          stopsCount: 0,
          walkMeters: walkInM,
        });
      }

      const tripId = pat.tripIds[jIdx];
      const trip = store.trips.get(tripId);
      const route = store.routes.get(trip?.route_id ?? pat.routeId);
      const line = route?.route_short_name || 'MPK';
      segments.push({
        type: 'transit',
        tripId,
        routeId: route?.route_id ?? pat.routeId,
        line,
        mode: classifyTransitMode(route?.route_type, line),
        direction: trip?.trip_headsign || '',
        fromStopId: ids[from],
        fromStopName: stopName(from),
        toStopId: ids[to],
        toStopName: stopName(to),
        departSec: depSec,
        arriveSec: arrSec,
        stopsCount: aPos - bPos,
      });

      prevStop = to;
      prevArr = arrSec;
    }

    // Opcjonalne dojście pieszo po ostatnim kursie (koniec podróży na spacerze
    // zamiast przymusowej przesiadki na 1 przystanek). Kolejność słów z Rust:
    // stopFrom, sekundy, metry.
    const walkFromStop = words[w++];
    const walkOutSec = words[w++];
    const walkOutM = words[w++];
    if (walkFromStop >= 0 && walkOutSec > 0 && prevStop >= 0 && walkFromStop !== dest) {
      segments.push({
        type: 'walk',
        fromStopId: ids[walkFromStop],
        fromStopName: stopName(walkFromStop),
        toStopId: ids[dest],
        toStopName: stopName(dest),
        departSec: prevArr,
        arriveSec: prevArr + walkOutSec,
        stopsCount: 0,
        walkMeters: walkOutM,
      });
      prevArr += walkOutSec;
    }

    if (segments.length === 0) continue;

    if (egressSec > 0 && egressM > 0) {
      segments.push({
        type: 'walk',
        fromStopId: ids[dest],
        fromStopName: stopName(dest),
        toStopId: 'destination',
        toStopName: 'Cel podróży',
        departSec: prevArr,
        arriveSec: prevArr + egressSec,
        stopsCount: 0,
        walkMeters: egressM,
      });
    }

    const mergedSegments = mergeConsecutiveWalks(segments);
    const firstTransit = mergedSegments.find((s) => s.type === 'transit');
    if (!firstTransit) continue;
    const rj: RawJourney = {
      departureSec: firstTransit.departSec - accessSec,
      arrivalSec: prevArr + egressSec,
      transfers: nLegs - 1,
      segments: mergedSegments,
    };
    if ((!arriveBy || rj.arrivalSec <= t0) && !isPointlessShortRide(rj)) {
      out.push(rj);
    }
  }

  return out;
}

export async function warmupRaptorNet(
  store: GtfsStore,
  dayIndex: DayIndex,
  patternTimeOffsets?: Map<string, number>,
  timeOffsetSec = 0,
): Promise<void> {
  const net = await getRaptorNetAsync(
    store,
    dayIndex,
    patternTimeOffsets,
    Math.round(timeOffsetSec),
  );
  await packRaptorNetAsync(net);
  await warmupRaptorNetworkAsync(net.id, () => packRaptorNet(net));
}

export async function runRaptorAsync(
  store: GtfsStore,
  origins: BoardingStop[],
  destinations: AlightingStop[],
  departureTimeSec: number,
  options: RaptorOptions = {},
): Promise<RawJourney[]> {
  if (origins.length === 0 || destinations.length === 0) return [];
  const idx = options.dayIndex;
  if (!idx) return [];
  const net = await getRaptorNetAsync(
    store,
    idx,
    options.patternTimeOffsets,
    Math.round(options.timeOffsetSec ?? 0),
  );
  await packRaptorNetAsync(net);
  const packedQuery = packRaptorQuery(net, origins, destinations, departureTimeSec, options);
  if (!packedQuery) return [];
  const res = await runRaptorQueryAsync(net.id, () => packRaptorNet(net), packedQuery);
  return unpackJourneys(store, net, Math.round(departureTimeSec), res, options.arriveBy);
}

export function runRaptor(
  store: GtfsStore,
  origins: BoardingStop[],
  destinations: AlightingStop[],
  departureTimeSec: number,
  options: RaptorOptions = {},
): RawJourney[] {
  if (origins.length === 0 || destinations.length === 0) return [];
  const idx = options.dayIndex;
  if (!idx) return [];
  const net = getRaptorNet(
    store,
    idx,
    options.patternTimeOffsets,
    Math.round(options.timeOffsetSec ?? 0),
  );
  const packedQuery = packRaptorQuery(net, origins, destinations, departureTimeSec, options);
  if (!packedQuery) return [];
  const res = runRaptorQuerySync(net.id, () => packRaptorNet(net), packedQuery);
  return unpackJourneys(store, net, Math.round(departureTimeSec), res, options.arriveBy);
}

export interface SelectOptions {
  cost?: CostParams;
  /** Tryb „bądź na”: koszt liczony od wyjścia do celu, nie od teraz. */
  arriveBySec?: number;
  limit?: number;
  uncertaintyPenalty?: ReadonlyMap<string, number>;
}

/**
 * Koszt odczuwalny podróży: przyjazd liczony od chwili zapytania (albo czas
 * od wyjścia do celu w trybie „bądź na”) + dodatkowa waga marszu + kara
 * za przesiadki.
 */
export function journeyCost(j: RawJourney, refSec: number, opts: SelectOptions = {}): number {
  const cost = opts.cost ?? DEFAULT_COST;
  const base =
    opts.arriveBySec !== undefined ? opts.arriveBySec - j.departureSec : j.arrivalSec - refSec;
  let walk = 0;
  let uncertainty = 0;
  const penalty = opts.uncertaintyPenalty;
  for (let i = 0; i < j.segments.length; i++) {
    const s = j.segments[i];
    if (s.type === 'walk') {
      const d = s.arriveSec - s.departSec;
      if (d > 0) walk += d;
    } else if (penalty && s.tripId) {
      uncertainty += penalty.get(s.tripId) ?? 0;
    }
  }
  return (
    base +
    (Math.max(1, cost.walkReluctance) - 1) * walk +
    j.transfers * cost.transferPenaltySec +
    uncertainty
  );
}

/** Usuwa duplikaty i zdominowane warianty, ogranicza powtórzenia linii.
 * Zachowuje najwcześniejszy przyjazd albo najpóźniejsze wyjście przed terminem. */
export function selectJourneys(
  journeys: RawJourney[],
  refSec: number,
  opts: SelectOptions = {},
): RawJourney[] {
  const limit = opts.limit ?? 10;
  const cost = opts.cost ?? DEFAULT_COST;
  const extraWalk = Math.max(1, cost.walkReluctance) - 1;
  const transferPenalty = cost.transferPenaltySec;
  const arriveBySec = opts.arriveBySec;
  const penalty = opts.uncertaintyPenalty;

  const scored: Array<{
    j: RawJourney;
    cost: number;
    walk: number;
    chain: string;
    combo: string;
  }> = [];

  for (let idx = 0; idx < journeys.length; idx++) {
    const j = journeys[idx];
    if (arriveBySec !== undefined && j.arrivalSec > arriveBySec) continue;
    let walk = 0;
    let uncertainty = 0;
    let chain = '';
    let combo = '';
    let hasTransit = false;
    const segs = j.segments;
    for (let si = 0; si < segs.length; si++) {
      const s = segs[si];
      if (s.type === 'walk') {
        const d = s.arriveSec - s.departSec;
        if (d > 0) walk += d;
      } else {
        if (hasTransit) {
          chain += '|';
          combo += '+';
        }
        chain += s.tripId ?? '';
        combo += s.line ?? '';
        hasTransit = true;
        if (penalty && s.tripId) {
          uncertainty += penalty.get(s.tripId) ?? 0;
        }
      }
    }
    const base = arriveBySec !== undefined ? arriveBySec - j.departureSec : j.arrivalSec - refSec;
    scored.push({
      j,
      cost: base + extraWalk * walk + j.transfers * transferPenalty + uncertainty,
      walk,
      chain,
      combo,
    });
  }

  scored.sort(
    (a, b) => a.cost - b.cost || a.j.transfers - b.j.transfers || a.j.arrivalSec - b.j.arrivalSec,
  );

  const byChain = new Set<string>();
  const unique: typeof scored = [];
  for (let i = 0; i < scored.length; i++) {
    const x = scored[i];
    if (byChain.has(x.chain)) continue;
    byChain.add(x.chain);
    unique.push(x);
  }

  // `unique` jest posortowane rosnąco po `cost`: kandydat z `y.cost > x.cost` nie może zdominować `x`.
  const front: typeof unique = [];
  for (let i = 0; i < unique.length; i++) {
    const x = unique[i];
    let dominated = false;
    for (let k = 0; k < unique.length; k++) {
      if (k === i) continue;
      const y = unique[k];
      if (y.cost > x.cost) break;
      if (
        y.j.departureSec >= x.j.departureSec &&
        y.j.arrivalSec <= x.j.arrivalSec &&
        y.j.transfers <= x.j.transfers &&
        y.walk <= x.walk + 30 &&
        (y.j.departureSec > x.j.departureSec ||
          y.j.arrivalSec < x.j.arrivalSec ||
          y.j.transfers < x.j.transfers ||
          y.walk < x.walk - 30 ||
          y.cost < x.cost)
      ) {
        dominated = true;
        break;
      }
    }
    if (!dominated) front.push(x);
  }

  const perCombo = new Map<string, number[]>();
  const result: RawJourney[] = [];
  for (let i = 0; i < front.length; i++) {
    const x = front[i];
    const kept = perCombo.get(x.combo);
    if (kept) {
      if (kept.length >= 4) continue;
      let tooClose = false;
      for (let k = 0; k < kept.length; k++) {
        if (Math.abs(kept[k] - x.j.departureSec) < 180) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      kept.push(x.j.departureSec);
    } else {
      perCombo.set(x.combo, [x.j.departureSec]);
    }
    result.push(x.j);
    if (result.length >= limit) break;
  }

  if (result.length > 0) {
    let fastest = front[0]?.j;
    for (let i = 0; i < front.length; i++) {
      const x = front[i];
      if (
        fastest &&
        (arriveBySec !== undefined
          ? x.j.departureSec > fastest.departureSec
          : x.j.arrivalSec < fastest.arrivalSec)
      ) {
        fastest = x.j;
      }
    }
    if (fastest && !result.includes(fastest)) {
      if (result.length >= limit) result.pop();
      result.push(fastest);
    }
  }
  return result;
}
