import { DayIndex, LocalGtfsStore as GtfsStore } from './store';
import { JourneySegment, RawJourney, RouteStyle, TransitModePreference } from './types';
import { classifyTransitMode, footDurations, getRaptorNet, type CompiledPattern, type RaptorNet } from './network';
import { predictDelaySec } from './delays';

export { classifyTransitMode };

const INF = 0x3fffffff;

const DEFAULT_WALK_SPEED_MPS = 1.34;
/** Spójne z engine.ts: odległość w linii prostej razy objazd ulicami. */
const WALK_DETOUR_FACTOR = 1.15;
/** Najdłuższa piesza przesiadka między przystankami (siatka w store.ts sięga 800 m). */
const MAX_TRANSFER_WALK_M = 800;
/** Szacunek dojścia jest ostrożny (objazd ×1,15, min. 30 s), więc kurs minutę „za wcześnie” wciąż łapiemy. */
const CATCH_SLACK_SEC = 60;
/** Zapas ponad sam czas przejścia przy przesiadce z dojściem (światła, przejścia). */
const TRANSFER_WALK_SLACK_SEC = 60;
/** Dopracowanie przystanków może opóźnić przyjazd najwyżej o tyle. */
const MAX_REFINE_LATER_SEC = 480;
/** Ile najtańszych kandydatów przechodzi przez dopracowanie przystanków. */
const REFINE_LIMIT = 48;

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
export const ROUTE_STYLE_COSTS: Record<RouteStyle, CostParams> = {
  fastest: { walkReluctance: 1.25, transferPenaltySec: 240 },
  balanced: { walkReluctance: 1.8, transferPenaltySec: 600 },
  lessWalking: { walkReluctance: 3, transferPenaltySec: 600 },
  fewerTransfers: { walkReluctance: 1.8, transferPenaltySec: 1200 },
};

export function costParamsFor(style: RouteStyle | undefined): CostParams {
  return ROUTE_STYLE_COSTS[style ?? 'balanced'] ?? ROUTE_STYLE_COSTS.balanced;
}

interface RaptorOptions {
  /** maksymalna liczba przesiadek (0 = tylko bezpośrednie). Default 2. */
  maxTransfers?: number;
  /** minimalny odstęp między przyjazdem a kolejnym odjazdem w sekundach. Default 60. */
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
  /**
   * Okno odjazdów (sekundy) od departureTimeSec. Range RAPTOR liczy w nim
   * wszystkie sensowne odjazdy naraz, zamiast osobnego przebiegu na każdy
   * start. 0 = jeden przebieg od departureTimeSec. Zawsze dochodzi też
   * najszybsza podróż z odjazdem po oknie.
   */
  windowSec?: number;
  /** Tempo marszu na przesiadkach (m/s). Default 1.34. */
  walkSpeedMps?: number;
  /** Najdłuższa piesza przesiadka (m). Default 800. */
  maxTransferWalkM?: number;
  /** Wagi kosztu uogólnionego. Default styl 'balanced'. */
  cost?: CostParams;
  /** Tryb „bądź na”: podróże z przyjazdem po tej godzinie są bezużyteczne. */
  latestArrivalSec?: number;
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
  if (transitSegs.length === 1 && transitSegs[0].stopsCount <= 1 && transitSegs[0].mode !== 'cable') {
    let totalWalkM = 0;
    for (const s of rj.segments) {
      if (s.type === 'walk') totalWalkM += s.walkMeters ?? 0;
    }
    const last = rj.segments[rj.segments.length - 1];
    const egressWalkM = last && last.type === 'walk' ? (last.walkMeters ?? 0) : 0;
    if (totalWalkM > 500 || egressWalkM > 350) return true;
  }
  return false;
}

/** Noga kandydata: wzorzec, kurs, pozycje wsiadania/wysiadania, dojście przed nią. */
interface ILeg {
  p: number;
  j: number;
  b: number;
  a: number;
  /** Przejście piesze od poprzedniej nogi (sekundy, 0 = ten sam słupek). */
  walkIn: number;
}

interface ICand {
  legs: ILeg[];
  /** Przystanek wysiadania ostatniej nogi (dojście do celu). */
  dest: number;
}

interface CandInfo {
  c: ICand;
  dep: number;
  arr: number;
  walkSec: number;
  cost: number;
}

/** Binary search: indeks pierwszego kursu z odjazdem >= target na pozycji pos. */
function lowerBoundTrips(dep: Int32Array, n: number, nTrips: number, pos: number, target: number): number {
  let lo = 0;
  let hi = nTrips;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (dep[mid * n + pos] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Range RAPTOR (Delling i in.) na skompilowanej sieci.
 *
 * Odjazdy z przystanków startowych w oknie przetwarzamy od najpóźniejszego,
 * a etykiety zostają między przebiegami: późniejszy odjazd to zawsze górne
 * ograniczenie dla wcześniejszego. W kolejnym przebiegu znakujemy tylko
 * przystanek, z którego ten odjazd wynika, więc praca rośnie z liczbą odjazdów,
 * a nie z liczbą przebiegów razy cała sieć.
 *
 * Cel oceniamy dwiema miarami: najwcześniejszy przyjazd i przyjazd z karą za
 * dojście (koszt uogólniony). Kandydaci przechodzą potem przez dopracowanie
 * przystanków na tych samych kursach (refine), więc „wysiądź wcześniej i idź”
 * przegrywa z jazdą pod sam cel, jeśli różnica w czasie jest mała.
 */
export function runRaptor(
  store: GtfsStore,
  origins: BoardingStop[],
  destinations: AlightingStop[],
  departureTimeSec: number,
  opts: RaptorOptions = {},
): RawJourney[] {
  if (!origins.length || !destinations.length) return [];
  const idx = opts.dayIndex;
  if (!idx) return [];

  const net = getRaptorNet(store, idx, opts.patternTimeOffsets, Math.round(opts.timeOffsetSec ?? 0));
  const P = net.patterns;
  const nPat = P.length;
  const base = net.base;
  const nStops = base.stopIds.length;

  const maxTransfers = Math.max(0, Math.min(3, Math.round(opts.maxTransfers ?? 2)));
  const R = maxTransfers + 1;
  const minT = Math.max(0, Math.min(600, Math.round(opts.minTransferSec ?? 60)));
  const trainsEnabled = opts.trainsEnabled ?? true;
  const cableEnabled = opts.cableEnabled ?? true;
  const trainNeed = Math.max(minT, Math.max(0, Math.min(1200, Math.round(opts.trainMinTransferSec ?? 300))));
  const speed = Math.max(0.5, Math.min(3, opts.walkSpeedMps ?? DEFAULT_WALK_SPEED_MPS));
  const maxTransferWalkM = Math.max(0, Math.min(MAX_TRANSFER_WALK_M, Math.round(opts.maxTransferWalkM ?? MAX_TRANSFER_WALK_M)));
  const cost = opts.cost ?? ROUTE_STYLE_COSTS.balanced;
  const wr = Math.max(1, cost.walkReluctance);
  const t0 = Math.round(departureTimeSec);
  const W = Math.max(0, Math.round(opts.windowSec ?? 0));
  const latestArr = opts.latestArrivalSec !== undefined ? Math.round(opts.latestArrivalSec) : INF;
  const fpDur = footDurations(base, speed, maxTransferWalkM, WALK_DETOUR_FACTOR);

  // ── Filtr pojazdów na poziomie wzorca. Pociągi KD i kolej linowa jeżdżą
  //    tylko w trybie 'all' (szybki filtr tramwaj/autobus ich nie rusza).
  const enabled = new Uint8Array(nPat);
  for (let p = 0; p < nPat; p++) {
    const kind = P[p].kind;
    let ok = true;
    if (kind === 'train') ok = trainsEnabled && (!opts.allowedModes || opts.allowedModes === 'all');
    else if (kind === 'cable') ok = cableEnabled && (!opts.allowedModes || opts.allowedModes === 'all');
    else if (opts.allowedModes && opts.allowedModes !== 'all') ok = kind === opts.allowedModes;
    enabled[p] = ok ? 1 : 0;
  }

  // ── Czasy efektywne: rozkład + prognoza opóźnienia GPS. Kopiujemy tylko
  //    wzorce z opóźnionymi kursami; reszta czyta skompilowane tablice.
  const depV: Int32Array[] = new Array(nPat);
  const arrV: Int32Array[] = new Array(nPat);
  const lateMax = new Int32Array(nPat);
  const earlyMax = new Int32Array(nPat);
  for (let p = 0; p < nPat; p++) {
    depV[p] = P[p].dep;
    arrV[p] = P[p].arr;
  }
  if (opts.tripDelays && opts.tripDelays.size > 0) {
    for (const [tripId, d0raw] of opts.tripDelays) {
      const d0 = Math.round(d0raw);
      if (!d0) continue;
      const loc = net.tripLoc.get(tripId);
      if (!loc) continue;
      const [p, j] = loc;
      const pat = P[p];
      if (depV[p] === pat.dep) {
        depV[p] = pat.dep.slice();
        arrV[p] = pat.arr.slice();
      }
      const n = pat.n;
      const vehicleAt = opts.nowSec !== undefined ? opts.nowSec - d0 : undefined;
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const sd = pat.dep[k];
        const sa = pat.arr[k];
        const db = vehicleAt === undefined ? d0 : predictDelaySec(d0, sd - vehicleAt, 'board');
        const da = vehicleAt === undefined ? d0 : predictDelaySec(d0, sa - vehicleAt, 'arrive');
        depV[p][k] = sd + db;
        arrV[p][k] = sa + da;
        if (db > lateMax[p]) lateMax[p] = db;
        if (-db > earlyMax[p]) earlyMax[p] = -db;
      }
    }
  }

  /** Najwcześniejszy kurs wzorca p do złapania na pozycji pos przy gotowości r. */
  const earliestTrip = (p: number, pos: number, r: number): number => {
    const pat = P[p];
    const n = pat.n;
    const dep = depV[p];
    if (dep === pat.dep) {
      const j = lowerBoundTrips(dep, n, pat.nTrips, pos, r);
      return j < pat.nTrips ? j : -1;
    }
    // Z opóźnieniami kolejność kursów może się rozjechać: start od rozkładu
    // cofniętego o największe opóźnienie, koniec, gdy żaden dalszy kurs nie
    // pobije najlepszego nawet przy maksymalnym wyprzedzeniu.
    const sched = pat.dep;
    const early = earlyMax[p];
    let best = -1;
    let bestT = INF;
    for (let j = lowerBoundTrips(sched, n, pat.nTrips, pos, r - lateMax[p]); j < pat.nTrips; j++) {
      if (sched[j * n + pos] - early > bestT) break;
      const t = dep[j * n + pos];
      if (t >= r && t < bestT) {
        bestT = t;
        best = j;
      }
    }
    return best;
  };

  // ── Dojścia i odejścia
  const accessSec = new Int32Array(nStops).fill(-1);
  const accessM = new Int32Array(nStops);
  for (const o of origins) {
    const s = base.stopIndex.get(o.stopId);
    if (s === undefined) continue;
    const w = Math.max(0, Math.round(o.walkSec));
    if (accessSec[s] < 0 || w < accessSec[s]) {
      accessSec[s] = w;
      accessM[s] = Math.round(o.walkM);
    }
  }
  const egressSec = new Int32Array(nStops).fill(-1);
  const egressM = new Int32Array(nStops);
  for (const d of destinations) {
    const s = base.stopIndex.get(d.stopId);
    if (s === undefined) continue;
    const w = Math.max(0, Math.round(d.walkSec));
    if (egressSec[s] < 0 || w < egressSec[s]) {
      egressSec[s] = w;
      egressM[s] = Math.round(d.walkM);
    }
  }
  const originList: number[] = [];
  for (let s = 0; s < nStops; s++) if (accessSec[s] >= 0) originList.push(s);
  if (!originList.length) return [];

  const occStart = (s: number) => (s < net.spCount ? net.spStart[s] : 0);
  const occEnd = (s: number) => (s < net.spCount ? net.spStart[s + 1] : 0);

  // ── Stan RAPTOR-a: [runda * nStops + przystanek]
  //    tau = gotowość do wsiadania (przyjazd + zapas na przesiadkę),
  //    arrAt = fizyczny przyjazd, pType: 1 start, 2 kurs, 3 przejście.
  const RS = R + 1;
  const tau = new Int32Array(RS * nStops).fill(INF);
  const arrAt = new Int32Array(RS * nStops).fill(INF);
  const pType = new Uint8Array(RS * nStops);
  const pA = new Int32Array(RS * nStops);
  const pB = new Int32Array(RS * nStops);
  const pC = new Int32Array(RS * nStops);
  const pD = new Int32Array(RS * nStops);
  const bestArr = new Int32Array(RS).fill(INF);
  const bestVal = new Int32Array(RS).fill(INF);

  const marked = new Uint8Array(nStops);
  const markList = new Int32Array(nStops);
  let markCount = 0;
  const mark = (s: number) => {
    if (!marked[s]) {
      marked[s] = 1;
      markList[markCount++] = s;
    }
  };
  const improvedFlag = new Uint8Array(nStops);
  const improvedList = new Int32Array(nStops);
  let improvedCount = 0;
  const queue = new Int32Array(nPat).fill(-1);
  const queued = new Int32Array(nPat);

  const cands: ICand[] = [];

  /** Etykieta (runda, przystanek) -> nogi podróży od startu. null = zepsuty łańcuch. */
  const backtrack = (round: number, stop: number): ILeg[] | null => {
    const legs: ILeg[] = [];
    let k = round;
    let s = stop;
    let walkIn = 0;
    for (let guard = 0; guard < 32; guard++) {
      const id = k * nStops + s;
      const t = pType[id];
      if (t === 1) {
        if (legs.length) legs[0].walkIn = 0;
        return legs;
      }
      if (t === 3) {
        walkIn = pB[id];
        s = pA[id];
        continue;
      }
      if (t !== 2 || k === 0) return null;
      const p = pA[id];
      if (legs.length) legs[0].walkIn = walkIn;
      walkIn = 0;
      legs.unshift({ p, j: pB[id], b: pC[id], a: pD[id], walkIn: 0 });
      s = P[p].stops[pC[id]];
      k--;
    }
    return null;
  };

  const pointless = (legs: ILeg[], dest: number): boolean => {
    for (const l of legs) if (l.a - l.b <= 0) return true;
    if (legs.length !== 1) return false;
    const l = legs[0];
    if (l.a - l.b > 1 || P[l.p].kind === 'cable') return false;
    const origin = P[l.p].stops[l.b];
    const totalM = accessM[origin] + egressM[dest];
    return totalM > 500 || egressM[dest] > 350;
  };

  /** Gotowość do wsiadania w rundzie k+1 z etykiety (k, s) dla rodzaju pojazdu. */
  const boardReady = (km1: number, s: number, isTrain: boolean): number => {
    const id = km1 * nStops + s;
    const r = tau[id];
    if (km1 === 0 || !isTrain || trainNeed <= minT) return r;
    if (pType[id] === 3) return Math.max(r, pC[id] + Math.max(trainNeed, pB[id] + TRANSFER_WALK_SLACK_SEC));
    return Math.max(r, arrAt[id] + trainNeed);
  };

  let boundVal = INF;

  const checkTarget = (k: number, p: number, j: number, bPos: number, aPos: number, s: number, a: number) => {
    const e = egressSec[s];
    const arrT = a + e;
    if (arrT > latestArr) return;
    const valT = a + Math.round(wr * e);
    let ba = INF;
    let bv = INF;
    for (let r = 1; r <= k; r++) {
      if (bestArr[r] < ba) ba = bestArr[r];
      if (bestVal[r] < bv) bv = bestVal[r];
    }
    if (arrT >= ba && valT >= bv) return;
    const prev = backtrack(k - 1, P[p].stops[bPos]);
    if (!prev) return;
    const legs = [...prev, { p, j, b: bPos, a: aPos, walkIn: 0 }];
    if (legs.length > 1) {
      // dojście do bieżącej nogi: z etykiety przystanku wsiadania
      const id = (k - 1) * nStops + P[p].stops[bPos];
      legs[legs.length - 1].walkIn = pType[id] === 3 ? pB[id] : 0;
    }
    if (pointless(legs, s)) return;
    cands.push({ legs, dest: s });
    if (arrT < bestArr[k]) bestArr[k] = arrT;
    if (valT < bestVal[k]) bestVal[k] = valT;
    if (valT < boundVal) boundVal = valT;
  };

  const scanPattern = (k: number, p: number, start: number) => {
    const pat = P[p];
    const n = pat.n;
    const stops = pat.stops;
    const dep = depV[p];
    const arr = arrV[p];
    const isTrain = pat.kind === 'train';
    const kk = k * nStops;
    const km1 = k - 1;
    const km1Base = km1 * nStops;
    let cur = -1;
    let row = 0;
    let boardPos = -1;
    for (let i = start; i < n; i++) {
      const s = stops[i];
      if (cur >= 0) {
        const a = arr[row + i];
        if (egressSec[s] >= 0) checkTarget(k, p, cur, boardPos, i, s, a);
        if (a < boundVal) {
          const ready = a + minT;
          let bestS = INF;
          for (let r = 0; r <= k; r++) {
            const v = tau[r * nStops + s];
            if (v < bestS) bestS = v;
          }
          if (ready < bestS) {
            const id = kk + s;
            tau[id] = ready;
            arrAt[id] = a;
            pType[id] = 2;
            pA[id] = p;
            pB[id] = cur;
            pC[id] = boardPos;
            pD[id] = i;
            if (!improvedFlag[s]) {
              improvedFlag[s] = 1;
              improvedList[improvedCount++] = s;
            }
            mark(s);
          }
        }
      }
      if (i < n - 1 && tau[km1Base + s] < INF) {
        const r = boardReady(km1, s, isTrain);
        if (cur < 0 || r <= dep[row + i]) {
          const j = earliestTrip(p, i, r);
          if (j >= 0 && (cur < 0 || dep[j * n + i] < dep[row + i])) {
            cur = j;
            row = j * n;
            boardPos = i;
          }
        }
      }
    }
  };

  const relaxFootpaths = (k: number) => {
    const kk = k * nStops;
    for (let x = 0; x < improvedCount; x++) {
      const s = improvedList[x];
      improvedFlag[s] = 0;
      // Tylko z przyjazdu kursem: bez łańcuchów przejść (s' -> s -> dalej).
      if (s >= base.fpCount || pType[kk + s] !== 2) continue;
      const src = arrAt[kk + s];
      if (src >= boundVal) continue;
      for (let e = base.fpStart[s]; e < base.fpStart[s + 1]; e++) {
        const w = fpDur[e];
        if (w < 0) continue;
        const to = base.fpTo[e];
        if (src + w >= boundVal) continue;
        const ready = src + Math.max(minT, w + TRANSFER_WALK_SLACK_SEC);
        let bestS = INF;
        for (let r = 0; r <= k; r++) {
          const v = tau[r * nStops + to];
          if (v < bestS) bestS = v;
        }
        if (ready >= bestS) continue;
        const id = kk + to;
        tau[id] = ready;
        arrAt[id] = src + w;
        pType[id] = 3;
        pA[id] = s;
        pB[id] = w;
        pC[id] = src;
        mark(to);
      }
    }
    improvedCount = 0;
  };

  const runIteration = (tau0: number, triggerStops: number[] | null) => {
    for (const o of originList) {
      const v = tau0 + accessSec[o];
      if (v < tau[o]) {
        tau[o] = v;
        arrAt[o] = v;
        pType[o] = 1;
      }
    }
    markCount = 0;
    if (triggerStops) for (const s of triggerStops) mark(s);
    else for (const o of originList) mark(o);

    for (let k = 1; k <= R; k++) {
      let qCount = 0;
      for (let m = 0; m < markCount; m++) {
        const s = markList[m];
        marked[s] = 0;
        for (let e = occStart(s); e < occEnd(s); e++) {
          const p = net.spPat[e];
          if (!enabled[p]) continue;
          const pos = net.spPos[e];
          if (pos >= P[p].n - 1) continue;
          if (queue[p] < 0) {
            queue[p] = pos;
            queued[qCount++] = p;
          } else if (pos < queue[p]) {
            queue[p] = pos;
          }
        }
      }
      markCount = 0;
      if (qCount === 0) break;
      boundVal = INF;
      for (let r = 1; r <= k; r++) if (bestVal[r] < boundVal) boundVal = bestVal[r];
      for (let q = 0; q < qCount; q++) {
        const p = queued[q];
        const start = queue[p];
        queue[p] = -1;
        scanPattern(k, p, start);
      }
      relaxFootpaths(k);
      if (markCount === 0) break;
    }
    for (let m = 0; m < markCount; m++) marked[markList[m]] = 0;
    markCount = 0;
  };

  // ── Odjazdy w oknie: każdy kurs z przystanku startowego wyznacza moment
  //    wyjścia z domu (odjazd minus dojście).
  const lo = t0 - CATCH_SLACK_SEC;
  const hi = t0 + W;
  const trigTimes: number[] = [];
  const trigStops: number[] = [];
  for (const o of originList) {
    const acc = accessSec[o];
    for (let e = occStart(o); e < occEnd(o); e++) {
      const p = net.spPat[e];
      if (!enabled[p]) continue;
      const pos = net.spPos[e];
      const pat = P[p];
      if (pos >= pat.n - 1) continue;
      const dep = depV[p];
      const from = lowerBoundTrips(pat.dep, pat.n, pat.nTrips, pos, lo + acc - lateMax[p]);
      for (let j = from; j < pat.nTrips; j++) {
        if (pat.dep[j * pat.n + pos] - earlyMax[p] - acc >= hi) break;
        const tau0 = dep[j * pat.n + pos] - acc;
        if (tau0 >= lo && tau0 < hi) {
          trigTimes.push(tau0);
          trigStops.push(o);
        }
      }
    }
  }
  const order = trigTimes.map((_, i) => i).sort((x, y) => trigTimes[y] - trigTimes[x]);

  // Przebieg od końca okna: najszybsze podróże z odjazdem po oknie (rzadkie
  // nocne kursy, długie dojścia), potem odjazdy w oknie od najpóźniejszego.
  runIteration(hi, null);
  for (let x = 0; x < order.length; ) {
    const t = trigTimes[order[x]];
    const group: number[] = [];
    while (x < order.length && trigTimes[order[x]] === t) {
      group.push(trigStops[order[x]]);
      x++;
    }
    runIteration(t, group);
  }

  // ── Kandydaci -> koszt -> dopracowanie przystanków -> podróże
  const legDep = (l: ILeg) => depV[l.p][l.j * P[l.p].n + l.b];
  const legArr = (l: ILeg) => arrV[l.p][l.j * P[l.p].n + l.a];
  const info = (c: ICand): CandInfo => {
    const first = c.legs[0];
    const last = c.legs[c.legs.length - 1];
    const access = accessSec[P[first.p].stops[first.b]];
    const egress = egressSec[c.dest];
    const dep = Math.max(t0, legDep(first) - access);
    const arr = legArr(last) + egress;
    let walkSec = access + egress;
    for (const l of c.legs) walkSec += l.walkIn;
    const transfers = c.legs.length - 1;
    const time = latestArr < INF ? latestArr - dep : arr - t0;
    const costV = time + (wr - 1) * walkSec + transfers * cost.transferPenaltySec;
    return { c, dep, arr, walkSec, cost: costV };
  };
  const chainKey = (c: ICand) => c.legs.map((l) => `${l.p}:${l.j}`).join('|');
  const fullKey = (c: ICand) => `${c.legs.map((l) => `${l.p}:${l.j}:${l.b}:${l.a}`).join('|')}>${c.dest}`;

  const byChain = new Map<string, CandInfo>();
  for (const c of cands) {
    const ci = info(c);
    const key = chainKey(c);
    const prev = byChain.get(key);
    if (!prev || ci.cost < prev.cost) byChain.set(key, ci);
  }
  const shortlist = [...byChain.values()].sort((x, y) => x.cost - y.cost).slice(0, REFINE_LIMIT);

  const refineCtx: RefineCtx = {
    P, depV, arrV, net, accessSec, egressSec, fpDur,
    minT, trainNeed, wr, t0, latestArr,
  };
  const out: RawJourney[] = [];
  const seen = new Set<string>();
  for (const ci of shortlist) {
    const refined = refine(refineCtx, ci.c, ci.arr) ?? ci.c;
    const key = fullKey(refined);
    if (seen.has(key)) continue;
    seen.add(key);
    const rj = materialize(store, net, depV, arrV, refined, accessSec, accessM, egressSec, egressM, t0);
    if (rj && !isPointlessShortRide(rj)) out.push(rj);
  }
  return out;
}

interface RefineCtx {
  P: CompiledPattern[];
  depV: Int32Array[];
  arrV: Int32Array[];
  net: RaptorNet;
  accessSec: Int32Array;
  egressSec: Int32Array;
  fpDur: Int32Array;
  minT: number;
  trainNeed: number;
  wr: number;
  t0: number;
  latestArr: number;
}

/**
 * Dopracowanie przystanków przy STAŁYCH kursach: programowanie dynamiczne po
 * pozycjach wsiadania i wysiadania każdej nogi, minimalizujące koszt
 * odczuwalny (jazda + oczekiwanie + spacer × waga). Naprawia trzy klasyczne
 * błędy samego RAPTOR-a (który liczy wyłącznie najwcześniejszy przyjazd):
 * - „wysiądź przystanek wcześniej i idź”, gdy ten sam tramwaj jedzie pod cel,
 * - przesiadka z przejściem, choć pierwszy kurs dojeżdża na przystanek
 *   drugiego,
 * - dojście do dalszego przystanku tej samej linii zamiast najbliższego.
 */
function refine(ctx: RefineCtx, c: ICand, origArr: number): ICand | null {
  const { P, depV, arrV, net, accessSec, egressSec, fpDur, minT, trainNeed, wr, t0, latestArr } = ctx;
  const base = net.base;
  const m = c.legs.length;
  const B: Float64Array[] = [];
  const Bfrom: Int32Array[] = [];
  const Bwalk: Int32Array[] = [];
  const C: Float64Array[] = [];
  const Cfrom: Int32Array[] = [];

  for (let li = 0; li < m; li++) {
    const l = c.legs[li];
    const pat = P[l.p];
    const n = pat.n;
    const row = l.j * n;
    const dep = depV[l.p];
    const b = new Float64Array(n).fill(Infinity);
    const bf = new Int32Array(n).fill(-1);
    const bw = new Int32Array(n);
    if (li === 0) {
      for (let pos = 0; pos < n - 1; pos++) {
        const acc = accessSec[pat.stops[pos]];
        if (acc < 0) continue;
        const d = dep[row + pos];
        if (d - acc < t0 - CATCH_SLACK_SEC) continue;
        b[pos] = wr * acc - d;
      }
    } else {
      const prev = c.legs[li - 1];
      const pp = P[prev.p];
      const prow = prev.j * pp.n;
      const parr = arrV[prev.p];
      const need = pat.kind === 'train' ? trainNeed : minT;
      const positions = new Map<number, number[]>();
      for (let pos = 0; pos < n - 1; pos++) {
        const s = pat.stops[pos];
        const list = positions.get(s);
        if (list) list.push(pos);
        else positions.set(s, [pos]);
      }
      const Cp = C[li - 1];
      const tryBoard = (s: number, ready: number, val: number, from: number, walk: number) => {
        const list = positions.get(s);
        if (!list) return;
        for (const pos of list) {
          if (dep[row + pos] < ready) continue;
          if (val < b[pos]) {
            b[pos] = val;
            bf[pos] = from;
            bw[pos] = walk;
          }
        }
      };
      for (let a = 1; a < pp.n; a++) {
        const cv = Cp[a];
        if (cv === Infinity) continue;
        const s = pp.stops[a];
        const t = parr[prow + a];
        tryBoard(s, t + need, cv, a, 0);
        if (s < base.fpCount) {
          for (let e = base.fpStart[s]; e < base.fpStart[s + 1]; e++) {
            const w = fpDur[e];
            if (w < 0) continue;
            tryBoard(base.fpTo[e], t + Math.max(need, w + TRANSFER_WALK_SLACK_SEC), cv + (wr - 1) * w, a, w);
          }
        }
      }
    }
    const cArr = new Float64Array(n).fill(Infinity);
    const cf = new Int32Array(n).fill(-1);
    let run = Infinity;
    let runPos = -1;
    for (let pos = 0; pos < n; pos++) {
      if (pos > 0 && run < Infinity) {
        cArr[pos] = run;
        cf[pos] = runPos;
      }
      if (b[pos] < run) {
        run = b[pos];
        runPos = pos;
      }
    }
    B.push(b);
    Bfrom.push(bf);
    Bwalk.push(bw);
    C.push(cArr);
    Cfrom.push(cf);
  }

  const last = c.legs[m - 1];
  const lp = P[last.p];
  const lrow = last.j * lp.n;
  const larr = arrV[last.p];
  const arrCap = Math.min(latestArr, origArr + MAX_REFINE_LATER_SEC);
  let bestTotal = Infinity;
  let bestA = -1;
  for (let a = 1; a < lp.n; a++) {
    const cv = C[m - 1][a];
    if (cv === Infinity) continue;
    const s = lp.stops[a];
    const e = egressSec[s];
    if (e < 0) continue;
    const t = larr[lrow + a];
    if (t + e > arrCap) continue;
    const total = cv + t + wr * e;
    if (total < bestTotal - 1e-6) {
      bestTotal = total;
      bestA = a;
    }
  }
  if (bestA < 0) return null;

  const legs: ILeg[] = new Array(m);
  let a = bestA;
  for (let li = m - 1; li >= 0; li--) {
    const l = c.legs[li];
    const b = Cfrom[li][a];
    if (b < 0) return null;
    legs[li] = { p: l.p, j: l.j, b, a, walkIn: li > 0 ? Bwalk[li][b] : 0 };
    if (li > 0) {
      a = Bfrom[li][b];
      if (a < 0) return null;
    }
  }
  return { legs, dest: lp.stops[bestA] };
}

function footDistanceM(net: RaptorNet, from: number, to: number, walkSec: number): number {
  const base = net.base;
  if (from < base.fpCount) {
    for (let e = base.fpStart[from]; e < base.fpStart[from + 1]; e++) {
      if (base.fpTo[e] === to) return Math.max(20, base.fpDistM[e]);
    }
  }
  return Math.max(20, Math.round(walkSec * DEFAULT_WALK_SPEED_MPS));
}

function materialize(
  store: GtfsStore,
  net: RaptorNet,
  depV: Int32Array[],
  arrV: Int32Array[],
  c: ICand,
  accessSec: Int32Array,
  accessM: Int32Array,
  egressSec: Int32Array,
  egressM: Int32Array,
  t0: number,
): RawJourney | null {
  if (!c.legs.length) return null;
  const P = net.patterns;
  const ids = net.base.stopIds;
  const stopName = (s: number) => store.stops.get(ids[s])?.stop_name || 'Przystanek';
  const segments: JourneySegment[] = [];

  const first = c.legs[0];
  const firstPat = P[first.p];
  const firstStop = firstPat.stops[first.b];
  const firstDep = depV[first.p][first.j * firstPat.n + first.b];
  if (accessM[firstStop] > 50) {
    segments.push({
      type: 'walk',
      fromStopId: 'origin',
      fromStopName: 'Twoja lokalizacja',
      toStopId: ids[firstStop],
      toStopName: stopName(firstStop),
      departSec: Math.max(t0, firstDep - accessSec[firstStop]),
      arriveSec: firstDep,
      stopsCount: 0,
      walkMeters: accessM[firstStop],
    });
  }

  let prevStop = -1;
  let prevArr = 0;
  for (const l of c.legs) {
    const pat = P[l.p];
    const row = l.j * pat.n;
    const from = pat.stops[l.b];
    const to = pat.stops[l.a];
    if (prevStop >= 0 && prevStop !== from) {
      segments.push({
        type: 'walk',
        fromStopId: ids[prevStop],
        fromStopName: stopName(prevStop),
        toStopId: ids[from],
        toStopName: stopName(from),
        departSec: prevArr,
        arriveSec: prevArr + l.walkIn,
        stopsCount: 0,
        walkMeters: footDistanceM(net, prevStop, from, l.walkIn),
      });
    }
    const tripId = pat.tripIds[l.j];
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
      departSec: depV[l.p][row + l.b],
      arriveSec: arrV[l.p][row + l.a],
      stopsCount: l.a - l.b,
    });
    prevStop = to;
    prevArr = arrV[l.p][row + l.a];
  }

  if (egressM[c.dest] > 50) {
    segments.push({
      type: 'walk',
      fromStopId: ids[c.dest],
      fromStopName: stopName(c.dest),
      toStopId: 'destination',
      toStopName: 'Cel podróży',
      departSec: prevArr,
      arriveSec: prevArr + egressSec[c.dest],
      stopsCount: 0,
      walkMeters: egressM[c.dest],
    });
  }

  return {
    departureSec: segments[0].departSec,
    arrivalSec: segments[segments.length - 1].arriveSec,
    transfers: c.legs.length - 1,
    segments,
  };
}

/** Sekundy marszu w podróży (dojście, przesiadki, odejście). */
export function journeyWalkSec(j: RawJourney): number {
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
export function journeyCost(j: RawJourney, refSec: number, opts: SelectOptions = {}): number {
  const cost = opts.cost ?? ROUTE_STYLE_COSTS.balanced;
  const base = opts.arriveBySec !== undefined ? opts.arriveBySec - j.departureSec : j.arrivalSec - refSec;
  return base + (Math.max(1, cost.walkReluctance) - 1) * journeyWalkSec(j) + j.transfers * cost.transferPenaltySec;
}

/**
 * Selekcja listy: duplikaty kursów, dominacja (później wyjść, wcześniej być,
 * mniej przesiadek i nie więcej marszu), różnorodność linii i limit.
 * Najszybszy przyjazd zawsze zostaje na liście.
 */
export function selectJourneys(journeys: RawJourney[], refSec: number, opts: SelectOptions = {}): RawJourney[] {
  const limit = opts.limit ?? 10;
  const scored = journeys.map((j) => ({
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
  scored.sort((a, b) => a.cost - b.cost || a.j.arrivalSec - b.j.arrivalSec);

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

  if (result.length > 0 && opts.arriveBySec === undefined) {
    let fastest = front[0]?.j;
    for (const x of front) if (fastest && x.j.arrivalSec < fastest.arrivalSec) fastest = x.j;
    if (fastest && !result.includes(fastest)) {
      if (result.length >= limit) result.pop();
      result.push(fastest);
    }
  }
  return result;
}
