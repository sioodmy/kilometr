import type { DayIndex, LocalGtfsStore } from './store';

export type TransitKind = 'tram' | 'bus' | 'train' | 'cable';

/**
 * Klasyfikacja linii na tramwaj/pociąg/kolej linową/autobus: ta sama heurystyka
 * co w backtrack i LineBadge (Wrocław: route_type 0 albo numer 1–33 to tramwaj,
 * route_type 2 to pociąg KD, route_type 6 i 7 to kolej powietrzna i funicular,
 * reszta to autobus).
 */
export function classifyTransitMode(
  routeType: number | undefined,
  shortName: string | undefined,
): TransitKind {
  if (routeType === 2) return 'train';
  if (routeType === 6 || routeType === 7) return 'cable';
  if (routeType === 0) return 'tram';
  const lineNum = parseInt((shortName || '').trim(), 10);
  if (!isNaN(lineNum) && lineNum >= 1 && lineNum <= 33) return 'tram';
  return 'bus';
}

/** Przystanki i przejścia piesze w tablicach liczbowych (CSR), raz na załadowany sklep. */
export interface RaptorBase {
  stopIds: string[];
  stopIndex: Map<string, number>;
  /** Przystanki objęte tablicami przejść (dopisane później ich nie mają). */
  fpCount: number;
  fpStart: Int32Array;
  fpTo: Int32Array;
  fpDistM: Int32Array;
  /** > 0: stały czas przejścia z bazy (przesiadki MPK-KD przez halę dworca). */
  fpFixedSec: Int32Array;
  fpDurCache: Map<string, Int32Array>;
  stopsSize: number;
  footpathsSize: number;
}

/** Wzorzec po kompilacji. Kursy FIFO: późniejszy kurs nigdy nie wyprzedza wcześniejszego. */
export interface CompiledPattern {
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
  base: RaptorBase;
  patterns: CompiledPattern[];
  spCount: number;
  spStart: Int32Array;
  spPat: Int32Array;
  spPos: Int32Array;
  /** tripId -> [wzorzec, kurs] dla kursów z dzisiejszego dnia serwisowego (opóźnienia GPS). */
  tripLoc: Map<string, [number, number]>;
}

const baseCache = new WeakMap<LocalGtfsStore, RaptorBase>();

function buildBase(store: LocalGtfsStore): RaptorBase {
  const stopIds = Array.from(store.stops.keys());
  const stopIndex = new Map<string, number>();
  stopIds.forEach((id, i) => stopIndex.set(id, i));
  const n = stopIds.length;
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
    fpCount: n,
    fpStart,
    fpTo,
    fpDistM,
    fpFixedSec,
    fpDurCache: new Map(),
    stopsSize: store.stops.size,
    footpathsSize: store.footpaths.size,
  };
}

export function getRaptorBase(store: LocalGtfsStore): RaptorBase {
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

const MIN_FOOTPATH_SEC = 45;

/** Czasy przejść pieszych dla tempa użytkownika. -1 = za daleko. */
export function footDurations(base: RaptorBase, speedMps: number, maxM: number, detour: number): Int32Array {
  const key = `${speedMps.toFixed(3)}|${maxM}|${detour}`;
  const hit = base.fpDurCache.get(key);
  if (hit) return hit;
  const out = new Int32Array(base.fpTo.length);
  for (let e = 0; e < out.length; e++) {
    const fixed = base.fpFixedSec[e];
    if (fixed > 0) {
      out[e] = fixed;
    } else if (base.fpDistM[e] > maxM) {
      out[e] = -1;
    } else {
      out[e] = Math.max(MIN_FOOTPATH_SEC, Math.round((base.fpDistM[e] * detour) / speedMps));
    }
  }
  base.fpDurCache.set(key, out);
  return out;
}

interface TripRow {
  id: string;
  dep: number[];
  arr: number[];
}

function isFifo(a: TripRow, b: TripRow): boolean {
  for (let i = 0; i < a.dep.length; i++) {
    if (b.dep[i] < a.dep[i] || b.arr[i] < a.arr[i]) return false;
  }
  return true;
}

function compile(
  store: LocalGtfsStore,
  idx: DayIndex,
  offsets: Map<string, number> | undefined,
  defaultOffset: number,
): RaptorNet {
  const base = getRaptorBase(store);
  const patterns: CompiledPattern[] = [];
  for (const [pid, pat] of idx.patterns) {
    const seq: string[] = pat.stopSequence;
    const n = seq.length;
    if (n < 2 || !pat.trips?.length) continue;
    const offset = offsets?.get(pid) ?? defaultOffset;
    const route = store.routes.get(pat.routeId);
    const kind = classifyTransitMode(route?.route_type, route?.route_short_name);
    const stops = new Int32Array(n);
    for (let i = 0; i < n; i++) stops[i] = stopIdx(base, seq[i]);

    const rows: TripRow[] = [];
    for (const trip of pat.trips) {
      const times = store.stopTimes.get(trip.trip_id);
      if (!times || times.length < n) continue;
      const dep: number[] = new Array(n);
      const arr: number[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const t = times[i];
        const a = (t.arrival_sec ?? t.departure_sec) + offset;
        const d = (t.departure_sec ?? t.arrival_sec) + offset;
        arr[i] = a;
        dep[i] = Math.max(a, d);
      }
      rows.push({ id: trip.trip_id, dep, arr });
    }
    if (!rows.length) continue;
    rows.sort((a, b) => a.dep[0] - b.dep[0]);

    // Wyprzedzanie w obrębie wzorca (szybszy kurs w innej porze dnia) psuje
    // wyszukiwanie binarne po kursach, więc takie kursy idą do osobnej grupy.
    const groups: TripRow[][] = [];
    for (const row of rows) {
      let placed = false;
      for (const g of groups) {
        if (isFifo(g[g.length - 1], row)) {
          g.push(row);
          placed = true;
          break;
        }
      }
      if (!placed) groups.push([row]);
    }

    groups.forEach((g, gi) => {
      const dep = new Int32Array(g.length * n);
      const arr = new Int32Array(g.length * n);
      g.forEach((row, j) => {
        for (let i = 0; i < n; i++) {
          dep[j * n + i] = row.dep[i];
          arr[j * n + i] = row.arr[i];
        }
      });
      patterns.push({
        id: gi === 0 ? pid : `${pid}#${gi}`,
        routeId: pat.routeId,
        kind,
        n,
        stops,
        nTrips: g.length,
        tripIds: g.map((r) => r.id),
        dep,
        arr,
        offset,
      });
    });
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
  patterns.forEach((p, pi) => {
    for (let i = 0; i < p.n; i++) {
      const s = p.stops[i];
      const w = fill[s]++;
      spPat[w] = pi;
      spPos[w] = i;
    }
    if (p.offset === 0) p.tripIds.forEach((id, j) => tripLoc.set(id, [pi, j]));
  });

  return { base, patterns, spCount, spStart, spPat, spPos, tripLoc };
}

const netCache = new WeakMap<DayIndex, { net: RaptorNet; base: RaptorBase; key: string }>();

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
