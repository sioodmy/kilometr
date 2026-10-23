import {
  runRaptorQueryAsync,
  runRaptorQuerySync,
  warmupRaptorNetworkAsync,
} from '../../../modules/kilometr-raptor';
import { DayIndex, LocalGtfsStore as GtfsStore } from './store';
import { JourneySegment, RawJourney, RouteStyle, TransitModePreference } from './types';
import { classifyTransitMode, getRaptorNet, packRaptorNet, type RaptorNet } from './network';

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

/** Styl trasy z ustawień. Spacer zawsze ważony mocniej niż jazda, żeby 30 s zysku nie wyrzucało z tramwaju. */
const ROUTE_STYLE_COSTS: Record<RouteStyle, CostParams> = {
  fastest: { walkReluctance: 1.25, transferPenaltySec: 120 },
  balanced: { walkReluctance: 1.8, transferPenaltySec: 300 },
  lessWalking: { walkReluctance: 3, transferPenaltySec: 300 },
  fewerTransfers: { walkReluctance: 1.8, transferPenaltySec: 900 },
};

export function costParamsFor(style: RouteStyle | undefined): CostParams {
  return ROUTE_STYLE_COSTS[style ?? 'balanced'] ?? ROUTE_STYLE_COSTS.balanced;
}

export interface RaptorOptions {
  /** maksymalna liczba przesiadek (0 = tylko bezpośrednie). Default 2. */
  maxTransfers?: number;
  /** Minimalny odstęp między przyjazdem a kolejnym odjazdem, domyślnie 120 s. */
  minTransferSec?: number;
  /** indeks dzienny (rozkład sobotni/niedzielny różni się od powszedniego) */
  dayIndex?: DayIndex;
  /** znane opóźnienia kursów (GPS): tripId -> sekundy, zmierzone teraz. */
  tripDelays?: Map<string, number>;
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
  /** Wagi kosztu uogólnionego. Default styl 'balanced'. */
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

  const validOrigins: Array<[number, number, number]> = [];
  for (let i = 0; i < origins.length; i++) {
    const o = origins[i];
    const s = stopIdx.get(o.stopId);
    if (s !== undefined) {
      validOrigins.push([s, Math.max(0, Math.round(o.walkSec)), Math.max(0, Math.round(o.walkM))]);
    }
  }

  const validDests: Array<[number, number, number]> = [];
  for (let i = 0; i < destinations.length; i++) {
    const d = destinations[i];
    const s = stopIdx.get(d.stopId);
    if (s !== undefined) {
      validDests.push([s, Math.max(0, Math.round(d.walkSec)), Math.max(0, Math.round(d.walkM))]);
    }
  }

  if (validOrigins.length === 0 || validDests.length === 0) {
    return null;
  }

  const delayEntries: Array<[number, number, number]> = [];
  if (options.tripDelays && options.tripDelays.size > 0) {
    for (const [tripId, raw] of options.tripDelays) {
      const d0 = Math.round(raw);
      if (!d0) continue;
      const loc = net.tripLoc.get(tripId);
      if (loc) {
        delayEntries.push([loc[0], loc[1], d0]);
      }
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
  const cost = options.cost ?? ROUTE_STYLE_COSTS.balanced;
  const wr = Math.max(1, cost.walkReluctance);
  const transferPenaltySec = Math.round(cost.transferPenaltySec);
  const latestArr =
    options.latestArrivalSec !== undefined ? Math.round(options.latestArrivalSec) : INF;
  const hasNow = options.nowSec !== undefined ? 1 : 0;
  const nowVal = options.nowSec !== undefined ? Math.round(options.nowSec) : 0;
  const t0 = Math.round(departureTimeSec);

  const headerWords = 22;
  const totalWords =
    headerWords + validOrigins.length * 3 + validDests.length * 3 + delayEntries.length * 3;
  const buf = new ArrayBuffer(totalWords * 4);
  const view = new DataView(buf);
  let pos = 0;

  const writeI32 = (v: number) => {
    view.setInt32(pos, v | 0, true);
    pos += 4;
  };
  const writeF64 = (v: number) => {
    view.setFloat64(pos, v, true);
    pos += 8;
  };

  writeI32(options.arriveBy ? ARRIVE_BY_QUERY_MAGIC : QUERY_MAGIC);
  writeI32(net.id);
  writeI32(t0);
  writeI32(windowSec);
  writeI32(maxTransfers);
  writeI32(minT);
  writeI32(trainNeed);
  writeI32(trainsEnabled);
  writeI32(cableEnabled);
  writeI32(allowedMode);
  writeF64(speedMps);
  writeI32(maxTransferWalkM);
  writeF64(wr);
  writeI32(transferPenaltySec);
  writeI32(latestArr);
  writeI32(hasNow);
  writeI32(nowVal);
  writeI32(validOrigins.length);
  writeI32(validDests.length);
  writeI32(delayEntries.length);

  for (let i = 0; i < validOrigins.length; i++) {
    const [s, ws, wm] = validOrigins[i];
    writeI32(s);
    writeI32(ws);
    writeI32(wm);
  }
  for (let i = 0; i < validDests.length; i++) {
    const [s, ws, wm] = validDests[i];
    writeI32(s);
    writeI32(ws);
    writeI32(wm);
  }
  for (let i = 0; i < delayEntries.length; i++) {
    const [p, j, d0] = delayEntries[i];
    writeI32(p);
    writeI32(j);
    writeI32(d0);
  }

  return new Uint8Array(buf);
}

function unpackJourneys(
  store: GtfsStore,
  net: RaptorNet,
  t0: number,
  bytes: Uint8Array | null,
  arriveBy = false,
): RawJourney[] {
  if (!bytes || bytes.byteLength < 4) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const readI32 = (): number => {
    const v = view.getInt32(pos, true);
    pos += 4;
    return v;
  };

  const count = readI32();
  if (count <= 0) return [];

  const P = net.patterns;
  const ids = net.base.stopIds;
  const stopName = (s: number) => store.stops.get(ids[s])?.stop_name || ids[s];
  const out: RawJourney[] = [];

  for (let c = 0; c < count; c++) {
    if (pos + 28 > bytes.byteLength) break;
    const dest = readI32();
    const firstStop = readI32();
    const accessSec = readI32();
    const accessM = readI32();
    const egressSec = readI32();
    const egressM = readI32();
    const nLegs = readI32();

    if (nLegs <= 0 || pos + nLegs * 32 > bytes.byteLength) break;

    const segments: JourneySegment[] = [];
    let prevStop = -1;
    let prevArr = 0;

    for (let li = 0; li < nLegs; li++) {
      const pIdx = readI32();
      const jIdx = readI32();
      const bPos = readI32();
      const aPos = readI32();
      const walkIn = readI32();
      const walkInM = readI32();
      const depSec = readI32();
      const arrSec = readI32();

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

    const firstTransit = segments.find((s) => s.type === 'transit');
    if (!firstTransit) continue;
    const rj: RawJourney = {
      departureSec: firstTransit.departSec - accessSec,
      arrivalSec: prevArr + egressSec,
      transfers: nLegs - 1,
      segments,
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
  const net = getRaptorNet(store, dayIndex, patternTimeOffsets, Math.round(timeOffsetSec));
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
  const net = getRaptorNet(
    store,
    idx,
    options.patternTimeOffsets,
    Math.round(options.timeOffsetSec ?? 0),
  );
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

/** Sekundy marszu w podróży (dojście, przesiadki, odejście). */
function journeyWalkSec(j: RawJourney): number {
  let w = 0;
  for (const s of j.segments) if (s.type === 'walk') w += Math.max(0, s.arriveSec - s.departSec);
  return w;
}

export interface SelectOptions {
  cost?: CostParams;
  /** Tryb „bądź na”: koszt liczony od wyjścia do celu, nie od teraz. */
  arriveBySec?: number;
  limit?: number;
}

/**
 * Koszt odczuwalny podróży: przyjazd liczony od chwili zapytania (albo czas
 * od wyjścia do celu w trybie „bądź na”) + dodatkowa waga marszu + kara
 * za przesiadki.
 */
function journeyCost(j: RawJourney, refSec: number, opts: SelectOptions = {}): number {
  const cost = opts.cost ?? ROUTE_STYLE_COSTS.balanced;
  const base =
    opts.arriveBySec !== undefined ? opts.arriveBySec - j.departureSec : j.arrivalSec - refSec;
  return (
    base +
    (Math.max(1, cost.walkReluctance) - 1) * journeyWalkSec(j) +
    j.transfers * cost.transferPenaltySec
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
  const scored = journeys
    .filter((j) => opts.arriveBySec === undefined || j.arrivalSec <= opts.arriveBySec)
    .map((j) => ({
      j,
      cost: journeyCost(j, refSec, opts),
      walk: journeyWalkSec(j),
      chain: j.segments
        .filter((s) => s.type === 'transit')
        .map((s) => s.tripId)
        .join('|'),
      combo: j.segments
        .filter((s) => s.type === 'transit')
        .map((s) => s.line)
        .join('+'),
    }));
  scored.sort(
    (a, b) => a.cost - b.cost || a.j.transfers - b.j.transfers || a.j.arrivalSec - b.j.arrivalSec,
  );

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
          y.j.departureSec >= x.j.departureSec &&
          y.j.arrivalSec <= x.j.arrivalSec &&
          y.j.transfers <= x.j.transfers &&
          y.walk <= x.walk + 30 &&
          (y.j.departureSec > x.j.departureSec ||
            y.j.arrivalSec < x.j.arrivalSec ||
            y.j.transfers < x.j.transfers ||
            y.walk < x.walk - 30 ||
            y.cost < x.cost),
      ),
  );

  const perCombo = new Map<string, number[]>();
  const result: RawJourney[] = [];
  for (const x of front) {
    const kept = perCombo.get(x.combo) ?? [];
    if (kept.length >= 4) continue;
    if (kept.some((d) => Math.abs(d - x.j.departureSec) < 180)) continue;
    kept.push(x.j.departureSec);
    perCombo.set(x.combo, kept);
    result.push(x.j);
    if (result.length >= limit) break;
  }

  if (result.length > 0) {
    let fastest = front[0]?.j;
    for (const x of front) {
      if (
        fastest &&
        (opts.arriveBySec !== undefined
          ? x.j.departureSec > fastest.departureSec
          : x.j.arrivalSec < fastest.arrivalSec)
      )
        fastest = x.j;
    }
    if (fastest && !result.includes(fastest)) {
      if (result.length >= limit) result.pop();
      result.push(fastest);
    }
  }
  return result;
}
