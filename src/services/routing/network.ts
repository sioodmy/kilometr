import type { GtfsStopTime } from '../../gtfs/types';
import { clearRaptorNetworks } from '../../../modules/kilometr-raptor';
import type { DayIndex, LocalGtfsStore } from './store';
import { getActiveCityIdSync } from '../cityStore';
import { isFareBoundary } from '../../gtfs/fareBoundary';
import { BUS_ONLY_NO_TRAM } from '../lineIdentity';
import { UI_YIELD_BUDGET_MS, yieldToUiFrame } from './yieldFrame';

export type TransitKind = 'tram' | 'bus' | 'train' | 'cable' | 'trolleybus' | 'subway';

const NET_MAGIC = 0x52415031;

let nextNetId = 1;

/**
 * Klasyfikacja linii na tramwaj/trolejbus/pociąg/kolej linową/metro/autobus:
 * ta sama heurystyka co w backtrack i LineBadge (route_type 0 to tramwaj, 11 to
 * trolejbus, 2 to pociąg, 1 to metro, 6 i 7 to kolej powietrzna i funicular,
 * reszta to autobus). Numery 1–33 to wrocławski schemat (tam niskie numery
 * to tramwaje); w GZM niskie numery mają też autobusy, w Opolu wyłącznie
 * autobusy (cała sieć MZK to route_type 3), w Trójmieście trolejbusy
 * (21–33), a w Kielcach, Białymstoku, Rzeszowie i Lublinie nie ma tramwajów wcale
 * (niskie numery to autobusy, a trolejbusy w Lublinie idą przez route_type 11),
 * więc tam liczy się wyłącznie route_type z feedu.
 */
export function classifyTransitMode(
  routeType: number | undefined,
  shortName: string | undefined,
): TransitKind {
  if (routeType === 2) return 'train';
  if (routeType === 1) return 'subway';
  if (routeType === 6 || routeType === 7) return 'cable';
  if (routeType === 0) return 'tram';
  // GTFS: 11 = trolejbus (GZM/Tychy). W UI osobny typ, w silniku jedzie
  // jak autobus (ten sam kod poniżej), więc RAPTOR nie wymaga zmian.
  if (routeType === 11) return 'trolleybus';
  if (numericFallbackApplies(shortName)) return 'tram';
  return 'bus';
}

function numericFallbackApplies(shortName: string | undefined): boolean {
  const lineNum = parseInt((shortName || '').trim(), 10);
  if (isNaN(lineNum) || lineNum < 1 || lineNum > 33) return false;
  try {
    const id = getActiveCityIdSync();
    // Miasta bez tramwajów (Kielce, Białystok, Opole, Rzeszów, Lublin, Radom
    // i miasta z 2026: patrz BUS_ONLY_NO_TRAM w lineIdentity) oraz z własną
    // numeracją (GZM, Trójmiasto) nie powinny zgadywać tramwaju po niskim
    // numerze linii.
    return id !== 'gzm' && id !== 'trojmiasto' && id !== 'grudziadz' && !BUS_ONLY_NO_TRAM.has(id);
  } catch {
    return true;
  }
}

function kindToCode(kind: TransitKind): number {
  switch (kind) {
    case 'tram':
      return 0;
    case 'bus':
    case 'trolleybus':
      return 1;
    case 'train':
      return 2;
    case 'subway':
      // Rust zna osobny KIND_SUBWAY=4: metro działa tylko w trybie
      // „wszystkie” i NIE podlega przełącznikowi „Pociągi regionalne”
      // (wyłączenie pociągów nie może gasić M1/M2). Karę za przesiadkę
      // metro dzieli z tramwajem/autobusem (krótki min_t).
      return 4;
    case 'cable':
      return 3;
  }
}

/** Przystanki i przejścia piesze w tablicach liczbowych (CSR), raz na załadowany sklep. */
interface RaptorBase {
  stopIds: string[];
  stopIndex: Map<string, number>;
  /** 1 = wirtualny punkt taryfowy (strefa), pomijany w kompilacji wzorców. */
  fareBoundary: Uint8Array;
  /** Przystanki objęte tablicami przejść (dopisane później ich nie mają). */
  fpCount: number;
  fpStart: Int32Array;
  fpTo: Int32Array;
  fpDistM: Int32Array;
  /** > 0: stały czas przejścia z bazy (przesiadki MPK-KD przez halę dworca). */
  fpFixedSec: Int32Array;
  stopsSize: number;
  footpathsSize: number;
}

/** Wzorzec po kompilacji. Kursy FIFO: późniejszy kurs nigdy nie wyprzedza wcześniejszego. */
interface CompiledPattern {
  id: string;
  routeId: string;
  kind: TransitKind;
  n: number;
  stops: Int32Array;
  nTrips: number;
  tripIds: string[];
  /** [kurs * n + pozycja], w zegarze zapytania (z przesunięciem dnia serwisowego). */
  dep: Int32Array;
  arr: Int32Array;
  offset: number;
}

export interface RaptorNet {
  id: number;
  base: RaptorBase;
  patterns: CompiledPattern[];
  spCount: number;
  spStart: Int32Array;
  spPat: Int32Array;
  spPos: Int32Array;
  /** tripId -> [wzorzec, kurs] dla kursów z dzisiejszego dnia serwisowego (opóźnienia GPS). */
  tripLoc: Map<string, [number, number]>;
  packed?: Uint8Array;
}

let baseCache = new WeakMap<LocalGtfsStore, RaptorBase>();

function buildBase(store: LocalGtfsStore): RaptorBase {
  const stopIds = Array.from(store.stops.keys());
  const stopIndex = new Map<string, number>();
  const n = stopIds.length;
  const fareBoundary = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const id = stopIds[i];
    stopIndex.set(id, i);
    if (isFareBoundary(store.stops.get(id)?.stop_name ?? '')) {
      fareBoundary[i] = 1;
    }
  }
  const fpStart = new Int32Array(n + 1);
  let total = 0;
  for (let i = 0; i < n; i++) {
    fpStart[i] = total;
    const list = store.footpaths.get(stopIds[i]);
    if (list) {
      for (const fp of list) if (stopIndex.has(fp.to_stop_id)) total++;
    }
  }
  fpStart[n] = total;
  const fpTo = new Int32Array(total);
  const fpDistM = new Int32Array(total);
  const fpFixedSec = new Int32Array(total);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const list = store.footpaths.get(stopIds[i]);
    if (!list) continue;
    for (const fp of list) {
      const to = stopIndex.get(fp.to_stop_id);
      if (to === undefined) continue;
      fpTo[w] = to;
      fpDistM[w] = Math.max(0, Math.round(fp.distance_m ?? 0));
      fpFixedSec[w] = fp.fixed ? Math.max(1, Math.round(fp.duration_sec)) : 0;
      w++;
    }
  }
  return {
    stopIds,
    stopIndex,
    fareBoundary,
    fpCount: n,
    fpStart,
    fpTo,
    fpDistM,
    fpFixedSec,
    stopsSize: store.stops.size,
    footpathsSize: store.footpaths.size,
  };
}

function getRaptorBase(store: LocalGtfsStore): RaptorBase {
  const hit = baseCache.get(store);
  if (hit && hit.stopsSize === store.stops.size && hit.footpathsSize === store.footpaths.size) return hit;
  const base = buildBase(store);
  baseCache.set(store, base);
  return base;
}

function stopIdx(base: RaptorBase, id: string): number {
  let i = base.stopIndex.get(id);
  if (i === undefined) {
    i = base.stopIds.length;
    base.stopIds.push(id);
    base.stopIndex.set(id, i);
  }
  return i;
}

interface TripRef {
  id: string;
  times: GtfsStopTime[];
  firstDep: number;
}

function isFifoRef(
  a: GtfsStopTime[],
  b: GtfsStopTime[],
  positions: number[] | null,
  n: number,
): boolean {
  if (positions === null) {
    for (let i = 0; i < n; i++) {
      const ta = a[i];
      const tb = b[i];
      const aA = ta.arrival_sec ?? ta.departure_sec;
      const dA = ta.departure_sec ?? ta.arrival_sec;
      const aB = tb.arrival_sec ?? tb.departure_sec;
      const dB = tb.departure_sec ?? tb.arrival_sec;
      if (aB < aA || (dB > aB ? dB : aB) < (dA > aA ? dA : aA)) return false;
    }
    return true;
  }
  for (let i = 0; i < n; i++) {
    const pos = positions[i];
    const ta = a[pos];
    const tb = b[pos];
    const aA = ta.arrival_sec ?? ta.departure_sec;
    const dA = ta.departure_sec ?? ta.arrival_sec;
    const aB = tb.arrival_sec ?? tb.departure_sec;
    const dB = tb.departure_sec ?? tb.arrival_sec;
    if (aB < aA || (dB > aB ? dB : aB) < (dA > aA ? dA : aA)) return false;
  }
  return true;
}

/**
 * Kompilacja sieci RAPTOR w krokach. Na wycinku 5 tys. kursów sama pętla
 * blokowała JS na kilka sekund; buildSlice i pierwszy plan mają ustąpić
 * miejsca dotykowi i animacjom.
 */
function* compileSteps(
  store: LocalGtfsStore,
  idx: DayIndex,
  offsets: Map<string, number> | undefined,
  defaultOffset: number,
): Generator<void, RaptorNet, void> {
  const base = getRaptorBase(store);
  const fareBoundary = base.fareBoundary;
  const fbLen = fareBoundary.length;
  const patterns: CompiledPattern[] = [];
  let patternIdx = 0;
  for (const [pid, pat] of idx.patterns) {
    const seq: string[] = pat.stopSequence;
    const seqLen = seq.length;
    if (seqLen < 2 || !pat.trips?.length) continue;

    // Większość wzorców nie ma punktów taryfowych: unikamy wtedy alokacji tablicy positions.
    let positions: number[] | null = null;
    const stopIndices = new Int32Array(seqLen);
    let n = 0;
    for (let i = 0; i < seqLen; i++) {
      const id = seq[i];
      const sIdx = stopIdx(base, id);
      const isBoundary =
        sIdx < fbLen
          ? fareBoundary[sIdx] === 1
          : isFareBoundary(store.stops.get(id)?.stop_name ?? '');
      if (isBoundary) {
        if (positions === null) {
          positions = new Array<number>(n);
          for (let k = 0; k < n; k++) positions[k] = k;
        }
        continue;
      }
      if (positions !== null) positions.push(i);
      stopIndices[n++] = sIdx;
    }
    if (n < 2) continue;
    const stops = n === seqLen ? stopIndices : stopIndices.subarray(0, n);
    const offset = offsets?.get(pid) ?? defaultOffset;
    const route = store.routes.get(pat.routeId);
    const kind = classifyTransitMode(route?.route_type, route?.route_short_name);

    const firstPos = positions === null ? 0 : positions[0];
    const rows: TripRef[] = [];
    let prevFirstDep = -Infinity;
    let alreadySorted = true;
    for (let tripIdx = 0; tripIdx < pat.trips.length; tripIdx++) {
      const trip = pat.trips[tripIdx];
      const times = store.stopTimes.get(trip.trip_id);
      if (!times || times.length < seqLen) continue;
      const t0 = times[firstPos];
      const a0 = t0.arrival_sec ?? t0.departure_sec;
      const d0 = t0.departure_sec ?? t0.arrival_sec;
      const firstDep = d0 > a0 ? d0 : a0;
      if (firstDep < prevFirstDep) alreadySorted = false;
      prevFirstDep = firstDep;
      rows.push({ id: trip.trip_id, times, firstDep });
      if ((tripIdx & 63) === 63) yield;
    }
    if (rows.length === 0) continue;
    if (!alreadySorted) rows.sort((a, b) => a.firstDep - b.firstDep);

    // Wyprzedzanie w obrębie wzorca (szybszy kurs w innej porze dnia) psuje
    // wyszukiwanie binarne po kursach, więc takie kursy idą do osobnej grupy.
    const groups: TripRef[][] = [];
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      let placed = false;
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        if (isFifoRef(g[g.length - 1].times, row.times, positions, n)) {
          g.push(row);
          placed = true;
          break;
        }
      }
      if (!placed) groups.push([row]);
      if ((rowIdx & 127) === 127) yield;
    }

    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const gLen = g.length;
      const dep = new Int32Array(gLen * n);
      const arr = new Int32Array(gLen * n);
      const tripIds = new Array<string>(gLen);
      for (let j = 0; j < gLen; j++) {
        const row = g[j];
        tripIds[j] = row.id;
        const times = row.times;
        const baseOff = j * n;
        if (positions === null) {
          for (let i = 0; i < n; i++) {
            const t = times[i];
            const a = (t.arrival_sec ?? t.departure_sec) + offset;
            const d = (t.departure_sec ?? t.arrival_sec) + offset;
            arr[baseOff + i] = a;
            dep[baseOff + i] = d > a ? d : a;
          }
        } else {
          for (let i = 0; i < n; i++) {
            const t = times[positions[i]];
            const a = (t.arrival_sec ?? t.departure_sec) + offset;
            const d = (t.departure_sec ?? t.arrival_sec) + offset;
            arr[baseOff + i] = a;
            dep[baseOff + i] = d > a ? d : a;
          }
        }
      }
      patterns.push({
        id: gi === 0 ? pid : `${pid}#${gi}`,
        routeId: pat.routeId,
        kind,
        n,
        stops,
        nTrips: gLen,
        tripIds,
        dep,
        arr,
        offset,
      });
      if ((gi & 3) === 3) yield;
    }
    if ((patternIdx++ & 3) === 3) yield;
  }

  const spCount = base.stopIds.length;
  const counts = new Int32Array(spCount + 1);
  for (const p of patterns) for (let i = 0; i < p.n; i++) counts[p.stops[i]]++;
  const spStart = new Int32Array(spCount + 1);
  for (let s = 0; s < spCount; s++) spStart[s + 1] = spStart[s] + counts[s];
  const fill = spStart.slice(0, spCount);
  const spPat = new Int32Array(spStart[spCount]);
  const spPos = new Int32Array(spStart[spCount]);
  const tripLoc = new Map<string, [number, number]>();
  for (let pi = 0; pi < patterns.length; pi++) {
    const p = patterns[pi];
    for (let i = 0; i < p.n; i++) {
      const s = p.stops[i];
      const w = fill[s]++;
      spPat[w] = pi;
      spPos[w] = i;
    }
    if (p.offset === 0) {
      const tids = p.tripIds;
      for (let j = 0; j < tids.length; j++) tripLoc.set(tids[j], [pi, j]);
    }
    if ((pi & 15) === 15) yield;
  }

  const id = nextNetId++;
  if (nextNetId > 0x7fff_ff00) {
    nextNetId = 1;
  }

  return { id, base, patterns, spCount, spStart, spPat, spPos, tripLoc };
}

function compile(
  store: LocalGtfsStore,
  idx: DayIndex,
  offsets: Map<string, number> | undefined,
  defaultOffset: number,
): RaptorNet {
  const steps = compileSteps(store, idx, offsets, defaultOffset);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

async function compileAsync(
  store: LocalGtfsStore,
  idx: DayIndex,
  offsets: Map<string, number> | undefined,
  defaultOffset: number,
): Promise<RaptorNet> {
  const steps = compileSteps(store, idx, offsets, defaultOffset);
  let sliceStart = performance.now();
  let next = steps.next();
  while (!next.done) {
    if (performance.now() - sliceStart >= UI_YIELD_BUDGET_MS) {
      await yieldToUiFrame();
      sliceStart = performance.now();
    }
    next = steps.next();
  }
  return next.value;
}

/**
 * Serializuje skompilowaną sieć RAPTOR do płaskiego bufora binarnego (LE i32)
 * dla silnika Rust (JNI / WASM). Wynik jest cache'owany na obiekcie sieci.
 */
export function packRaptorNet(net: RaptorNet): Uint8Array {
  if (net.packed) return net.packed;

  const { base, patterns, spCount, spStart, spPat, spPos } = net;
  const fpCount = base.fpCount;
  const fpEdges = base.fpTo.length;
  const spEdges = spPat.length;

  let words =
    7 +
    (fpCount + 1) +
    fpEdges * 3 +
    (spCount + 1) +
    spEdges * 2;

  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i];
    words += 3 + p.n + p.dep.length + p.arr.length;
  }

  const buf = new ArrayBuffer(words * 4);
  const i32 = new Int32Array(buf);
  let w = 0;

  i32[w++] = NET_MAGIC;
  i32[w++] = base.stopIds.length;
  i32[w++] = fpCount;
  i32[w++] = fpEdges;
  i32[w++] = patterns.length;
  i32[w++] = spCount;
  i32[w++] = spEdges;

  i32.set(base.fpStart.subarray(0, fpCount + 1), w);
  w += fpCount + 1;
  i32.set(base.fpTo, w);
  w += fpEdges;
  i32.set(base.fpDistM, w);
  w += fpEdges;
  i32.set(base.fpFixedSec, w);
  w += fpEdges;

  i32.set(spStart.subarray(0, spCount + 1), w);
  w += spCount + 1;
  i32.set(spPat, w);
  w += spEdges;
  i32.set(spPos, w);
  w += spEdges;

  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i];
    i32[w++] = kindToCode(p.kind);
    i32[w++] = p.n;
    i32[w++] = p.nTrips;
    i32.set(p.stops, w);
    w += p.n;
    i32.set(p.dep, w);
    w += p.dep.length;
    i32.set(p.arr, w);
    w += p.arr.length;
  }

  const packed = new Uint8Array(buf);
  net.packed = packed;
  return packed;
}

/**
 * Asynchroniczna serializacja sieci RAPTOR oddająca klatki UI między porcjami
 * wzorców, żeby ładowanie nowego wycinka (np. wcześniejsze połączenia) nie rwało scrolla.
 */
export async function packRaptorNetAsync(net: RaptorNet): Promise<Uint8Array> {
  if (net.packed) return net.packed;

  const { base, patterns, spCount, spStart, spPat, spPos } = net;
  const fpCount = base.fpCount;
  const fpEdges = base.fpTo.length;
  const spEdges = spPat.length;

  let words =
    7 +
    (fpCount + 1) +
    fpEdges * 3 +
    (spCount + 1) +
    spEdges * 2;

  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i];
    words += 3 + p.n + p.dep.length + p.arr.length;
  }

  const buf = new ArrayBuffer(words * 4);
  const i32 = new Int32Array(buf);
  let w = 0;

  i32[w++] = NET_MAGIC;
  i32[w++] = base.stopIds.length;
  i32[w++] = fpCount;
  i32[w++] = fpEdges;
  i32[w++] = patterns.length;
  i32[w++] = spCount;
  i32[w++] = spEdges;

  i32.set(base.fpStart.subarray(0, fpCount + 1), w);
  w += fpCount + 1;
  i32.set(base.fpTo, w);
  w += fpEdges;
  i32.set(base.fpDistM, w);
  w += fpEdges;
  i32.set(base.fpFixedSec, w);
  w += fpEdges;

  i32.set(spStart.subarray(0, spCount + 1), w);
  w += spCount + 1;
  i32.set(spPat, w);
  w += spEdges;
  i32.set(spPos, w);
  w += spEdges;

  let sliceStart = performance.now();
  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i];
    i32[w++] = kindToCode(p.kind);
    i32[w++] = p.n;
    i32[w++] = p.nTrips;
    i32.set(p.stops, w);
    w += p.n;
    i32.set(p.dep, w);
    w += p.dep.length;
    i32.set(p.arr, w);
    w += p.arr.length;
    if ((i & 63) === 63 && performance.now() - sliceStart >= UI_YIELD_BUDGET_MS) {
      await yieldToUiFrame();
      sliceStart = performance.now();
    }
  }

  const packed = new Uint8Array(buf);
  net.packed = packed;
  return packed;
}

let netCache = new WeakMap<DayIndex, { net: RaptorNet; base: RaptorBase; key: string }>();
let netBuilds = new WeakMap<DayIndex, Map<string, Promise<RaptorNet>>>();

export function clearRaptorNetCache(): void {
  baseCache = new WeakMap<LocalGtfsStore, RaptorBase>();
  netCache = new WeakMap<DayIndex, { net: RaptorNet; base: RaptorBase; key: string }>();
  netBuilds = new WeakMap<DayIndex, Map<string, Promise<RaptorNet>>>();
  clearRaptorNetworks();
}

/**
 * Skompilowana sieć dla indeksu dnia (wycinka). Cache na obiekcie indeksu:
 * wycinki są cache'owane w sklepie, więc kolejne wyszukiwania tej samej
 * godziny nie płacą za kompilację.
 */
export function getRaptorNet(
  store: LocalGtfsStore,
  idx: DayIndex,
  offsets?: Map<string, number>,
  defaultOffset = 0,
): RaptorNet {
  const base = getRaptorBase(store);
  const key = `${defaultOffset}|${offsets ? offsets.size : -1}`;
  const hit = netCache.get(idx);
  if (hit && hit.base === base && hit.key === key) return hit.net;
  const net = compile(store, idx, offsets, defaultOffset);
  netCache.set(idx, { net, base, key });
  return net;
}

/**
 * Async wariant dla UI: kompilacja oddaje kolejkę JS i dzieli się z równoległym
 * warmupem lub planem tego samego wycinka, zamiast liczyć sieć dwa razy.
 */
export async function getRaptorNetAsync(
  store: LocalGtfsStore,
  idx: DayIndex,
  offsets?: Map<string, number>,
  defaultOffset = 0,
): Promise<RaptorNet> {
  const base = getRaptorBase(store);
  const key = `${defaultOffset}|${offsets ? offsets.size : -1}`;
  const hit = netCache.get(idx);
  if (hit && hit.base === base && hit.key === key) return hit.net;

  let builds = netBuilds.get(idx);
  if (!builds) {
    builds = new Map();
    netBuilds.set(idx, builds);
  }
  const pending = builds.get(key);
  if (pending) return pending;

  const promise = compileAsync(store, idx, offsets, defaultOffset)
    .then((net) => {
      netCache.set(idx, { net, base, key });
      return net;
    })
    .finally(() => {
      if (builds!.get(key) === promise) builds!.delete(key);
    });
  builds.set(key, promise);
  return promise;
}
