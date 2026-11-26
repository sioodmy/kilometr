// Wyznaczanie i rzutowanie opóźnień komunikacji na realne drogi oraz torowiska.
// Zamiast rozmytej heatmapy grupuje świeże pojazdy na odcinkach międzyprzystankowych
// z lokalnego GTFS, scala sąsiednie spowolnienia w spójne korytarze i nanosi je na
// geometrię dróg lub torów z lokalnego routera MVT.

import { bearingDegrees, distanceMeters, normalizePolish } from '../gtfs/geo';
import { isFareBoundary } from '../gtfs/fareBoundary';
import { routeTransitLocal, type TransitLocalMode } from './footRouter';
import type { DelayHubSummary } from './kilometrApi';
import { inferTransitMode } from './lineIdentity';
import type { TrackedVehicle } from './liveTracker';
import { projectRoutePoint } from './routeGeometry';
import { classifyTransitMode } from './routing/raptor';
import type { DayIndex, LocalGtfsStore } from './routing/store';

type DayPattern = DayIndex['patterns'] extends Map<string, infer P> ? P : never;

type DelaySeverity = 'moderate' | 'heavy' | 'severe';

export interface LiveMapDelayCorridor {
  id: string;
  mode: TransitLocalMode;
  title: string;
  fromStopName: string;
  toStopName: string;
  /** Kolejne przystanki odcinka jako [lat, lon] do wyznaczenia geometrii na drodze/torach. */
  waypoints: [number, number][];
  avgDelaySec: number;
  p90DelaySec: number;
  maxDelaySec: number;
  vehicleCount: number;
  delayedCount: number;
  severity: DelaySeverity;
  topLines: string[];
  typicalDelaySec?: number;
  deltaVsTypicalSec?: number;
}

interface StopPoint {
  id: string;
  name: string;
  normName: string;
  lat: number;
  lon: number;
}

interface RawEdgeAcc {
  canonKey: string;
  mode: TransitLocalMode;
  delays: number[];
  delayedCount: number;
  lines: Map<string, number>;
  dir0Weight: number;
  dir1Weight: number;
  dir0Pair: [StopPoint, StopPoint] | null;
  dir1Pair: [StopPoint, StopPoint] | null;
}

interface ClassifiedEdge {
  mode: TransitLocalMode;
  from: StopPoint;
  to: StopPoint;
  delays: number[];
  delayedCount: number;
  lines: Map<string, number>;
  avgDelaySec: number;
  p90DelaySec: number;
  maxDelaySec: number;
  severity: DelaySeverity;
}

const LATE_VEHICLE_SEC = 180;
const MIN_AVG_DELAY_SEC = 150;
const SINGLE_VEHICLE_MIN_SEC = 240;
const MAX_PLAUSIBLE_DELAY_SEC = 3600;
const MAX_VEHICLE_OFFSET_M = 300;
const MAX_CORRIDORS = 32;
const MAX_MERGED_STOPS = 5;
const MAX_TURN_ANGLE_DEG = 115;

const ROAD_CACHE_MAX = 400;
const FAILED_RETRY_MS = 60_000;

interface RoadCacheEntry {
  coords: [number, number][] | null;
  ts: number;
}

const roadGeometryCache = new Map<string, RoadCacheEntry>();
const roadGeometryInFlight = new Map<string, Promise<[number, number][] | null>>();

function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p))];
}

function classifyDelay(
  avgSec: number,
  p90Sec: number,
  delayedCount: number,
  vehicleCount: number,
): DelaySeverity | null {
  if (delayedCount <= 0) return null;
  if (vehicleCount === 1 && avgSec < SINGLE_VEHICLE_MIN_SEC) return null;
  if (avgSec < MIN_AVG_DELAY_SEC) return null;
  if ((avgSec >= 420 && delayedCount >= 2) || avgSec >= 540 || (p90Sec >= 720 && delayedCount >= 2)) {
    return 'severe';
  }
  if (avgSec >= 240 || (p90Sec >= 420 && delayedCount >= 2)) {
    return 'heavy';
  }
  return 'moderate';
}

function severityRank(sev: DelaySeverity): number {
  if (sev === 'severe') return 3;
  if (sev === 'heavy') return 2;
  return 1;
}

function toRouterMode(mode: string): TransitLocalMode {
  if (mode === 'tram') return 'tram';
  if (mode === 'subway') return 'subway';
  if (mode === 'train' || mode === 'rail') return 'rail';
  return 'bus';
}

function resolveStopSequencePoints(stopIds: readonly string[], store: LocalGtfsStore): StopPoint[] {
  const pts: StopPoint[] = [];
  for (const sid of stopIds) {
    const st = store.stops.get(sid);
    if (!st || !Number.isFinite(st.stop_lat) || !Number.isFinite(st.stop_lon)) continue;
    const name = (st.stop_name || '').trim();
    if (!name || isFareBoundary(name)) continue;
    const normName = normalizePolish(name);
    if (!normName) continue;
    pts.push({
      id: st.stop_id,
      name,
      normName,
      lat: st.stop_lat,
      lon: st.stop_lon,
    });
  }
  return pts;
}

function projectVehicleOntoStops(
  pts: StopPoint[],
  vehicle: TrackedVehicle,
): { from: StopPoint; to: StopPoint; offsetM: number; heading: number } | null {
  if (pts.length < 2) return null;
  const coords: [number, number][] = pts.map((p) => [p.lat, p.lon]);
  const proj = projectRoutePoint(coords, vehicle.lat, vehicle.lon);
  if (!proj || proj.offsetM > MAX_VEHICLE_OFFSET_M) return null;
  // Pojazd na pętli startowej lub końcowej często stoi na przerwie technicznej.
  if (proj.alongM < 60 && proj.progress < 0.02) return null;
  if (proj.progress > 0.985) return null;

  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + distanceMeters(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]));
  }
  let segIdx = 0;
  for (let i = 0; i < cum.length - 1; i++) {
    if (cum[i] <= proj.alongM) segIdx = i;
    else break;
  }
  const from = pts[segIdx];
  const to = pts[Math.min(pts.length - 1, segIdx + 1)];
  if (!from || !to || from.normName === to.normName) return null;
  return { from, to, offsetM: proj.offsetM, heading: proj.heading };
}

function resolveVehicleEdge(
  vehicle: TrackedVehicle,
  store: LocalGtfsStore,
  patternsByLine: Map<string, DayPattern[]> | null,
  cityId: string,
): { from: StopPoint; to: StopPoint; mode: TransitLocalMode } | null {
  const modeBase = inferTransitMode(vehicle.type, vehicle.line, cityId);
  const mode = toRouterMode(modeBase);
  const maxHopM = mode === 'rail' ? 8000 : 3500;
  const minHopM = mode === 'rail' ? 120 : 50;

  if (vehicle.matchedTripId) {
    const times = store.stopTimes.get(vehicle.matchedTripId);
    if (times && times.length >= 2) {
      const trip = store.trips.get(vehicle.matchedTripId);
      const route = trip ? store.routes.get(trip.route_id) : undefined;
      const routeMode = route
        ? toRouterMode(
            inferTransitMode(
              classifyTransitMode(route.route_type, route.route_short_name),
              route.route_short_name,
              cityId,
            ),
          )
        : mode;
      const pts = resolveStopSequencePoints(
        times.map((t) => t.stop_id),
        store,
      );
      const match = projectVehicleOntoStops(pts, vehicle);
      if (match) {
        const hopM = distanceMeters(match.from.lat, match.from.lon, match.to.lat, match.to.lon);
        const hopLimit = routeMode === 'rail' ? 8000 : 3500;
        const hopMin = routeMode === 'rail' ? 120 : 50;
        if (hopM >= hopMin && hopM <= hopLimit) {
          return { from: match.from, to: match.to, mode: routeMode };
        }
      }
    }
  }

  if (!patternsByLine || !vehicle.line) return null;
  const candidates = patternsByLine.get(vehicle.line.trim().toUpperCase());
  if (!candidates || candidates.length === 0) return null;

  const hasBearing = typeof vehicle.bearing === 'number' && Number.isFinite(vehicle.bearing);
  const nextHint = vehicle.nextStopName ? normalizePolish(vehicle.nextStopName) : '';
  let bestScore = Infinity;
  let bestMatch: { from: StopPoint; to: StopPoint; mode: TransitLocalMode } | null = null;

  for (const pattern of candidates) {
    const pts = resolveStopSequencePoints(pattern.stopSequence, store);
    const match = projectVehicleOntoStops(pts, vehicle);
    if (!match) continue;
    const hopM = distanceMeters(match.from.lat, match.from.lon, match.to.lat, match.to.lon);
    if (hopM < minHopM || hopM > maxHopM) continue;

    let score = match.offsetM;
    if (hasBearing) {
      const diff = angleDiffDeg(vehicle.bearing!, match.heading);
      if (diff > 95) continue;
      score += diff * 1.4;
    }
    if (nextHint && match.to.normName === nextHint) {
      score -= 90;
    }
    if (score < bestScore) {
      const route = store.routes.get(pattern.routeId);
      const routeMode = route
        ? toRouterMode(
            inferTransitMode(
              classifyTransitMode(route.route_type, route.route_short_name),
              route.route_short_name,
              cityId,
            ),
          )
        : mode;
      bestScore = score;
      bestMatch = { from: match.from, to: match.to, mode: routeMode };
    }
  }

  return bestMatch;
}

function mergeLines(maps: readonly Map<string, number>[]): string[] {
  const merged = new Map<string, number>();
  for (const m of maps) {
    for (const [line, count] of m) {
      merged.set(line, (merged.get(line) ?? 0) + count);
    }
  }
  return Array.from(merged.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }))
    .slice(0, 6)
    .map(([line]) => line);
}

function mergeAdjacentEdges(edges: ClassifiedEdge[]): LiveMapDelayCorridor[] {
  const byGroup = new Map<string, ClassifiedEdge[]>();
  for (const e of edges) {
    const key = `${e.mode}:${e.severity}`;
    const list = byGroup.get(key);
    if (list) list.push(e);
    else byGroup.set(key, [e]);
  }

  const corridors: LiveMapDelayCorridor[] = [];

  for (const group of byGroup.values()) {
    const nodeDegree = new Map<string, number>();
    for (const e of group) {
      nodeDegree.set(e.from.normName, (nodeDegree.get(e.from.normName) ?? 0) + 1);
      nodeDegree.set(e.to.normName, (nodeDegree.get(e.to.normName) ?? 0) + 1);
    }

    const used = new Array<boolean>(group.length).fill(false);

    const canChain = (prevEnd: StopPoint, prevStart: StopPoint, nextStart: StopPoint, nextEnd: StopPoint): boolean => {
      if (prevEnd.normName !== nextStart.normName) return false;
      if ((nodeDegree.get(prevEnd.normName) ?? 0) > 2) return false;
      if (distanceMeters(prevEnd.lat, prevEnd.lon, nextStart.lat, nextStart.lon) > 140) return false;
      const b1 = bearingDegrees(prevStart.lat, prevStart.lon, prevEnd.lat, prevEnd.lon);
      const b2 = bearingDegrees(nextStart.lat, nextStart.lon, nextEnd.lat, nextEnd.lon);
      return angleDiffDeg(b1, b2) <= MAX_TURN_ANGLE_DEG;
    };

    for (let i = 0; i < group.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const chain: ClassifiedEdge[] = [group[i]];
      const stops: StopPoint[] = [group[i].from, group[i].to];

      // Rozwijamy łańcuch do przodu.
      while (stops.length < MAX_MERGED_STOPS) {
        const tail = stops[stops.length - 1];
        const prev = stops[stops.length - 2];
        let foundIdx = -1;
        let flip = false;
        for (let j = 0; j < group.length; j++) {
          if (used[j]) continue;
          const cand = group[j];
          if (canChain(tail, prev, cand.from, cand.to)) {
            foundIdx = j;
            flip = false;
            break;
          }
          if (canChain(tail, prev, cand.to, cand.from)) {
            foundIdx = j;
            flip = true;
            break;
          }
        }
        if (foundIdx === -1) break;
        used[foundIdx] = true;
        const nextEdge = group[foundIdx];
        chain.push(nextEdge);
        stops.push(flip ? nextEdge.from : nextEdge.to);
      }

      // Rozwijamy łańcuch do tyłu.
      while (stops.length < MAX_MERGED_STOPS) {
        const head = stops[0];
        const second = stops[1];
        let foundIdx = -1;
        let flip = false;
        for (let j = 0; j < group.length; j++) {
          if (used[j]) continue;
          const cand = group[j];
          if (canChain(cand.to, cand.from, head, second)) {
            foundIdx = j;
            flip = false;
            break;
          }
          if (canChain(cand.from, cand.to, head, second)) {
            foundIdx = j;
            flip = true;
            break;
          }
        }
        if (foundIdx === -1) break;
        used[foundIdx] = true;
        const prevEdge = group[foundIdx];
        chain.unshift(prevEdge);
        stops.unshift(flip ? prevEdge.to : prevEdge.from);
      }

      const allDelays: number[] = [];
      let delayedCount = 0;
      for (const c of chain) {
        allDelays.push(...c.delays);
        delayedCount += c.delayedCount;
      }
      allDelays.sort((a, b) => a - b);
      const n = allDelays.length;
      const avgDelaySec = Math.round(allDelays.reduce((a, b) => a + b, 0) / Math.max(1, n));
      const p90DelaySec = percentileSorted(allDelays, 0.9);
      const maxDelaySec = allDelays[n - 1] ?? avgDelaySec;
      const firstStop = stops[0];
      const lastStop = stops[stops.length - 1];
      const waypoints: [number, number][] = stops.map((s) => [s.lat, s.lon]);
      const id = `delay:${group[i].mode}:${firstStop.normName}:${lastStop.normName}`;

      corridors.push({
        id,
        mode: group[i].mode,
        title: `${firstStop.name} → ${lastStop.name}`,
        fromStopName: firstStop.name,
        toStopName: lastStop.name,
        waypoints,
        avgDelaySec,
        p90DelaySec,
        maxDelaySec,
        vehicleCount: n,
        delayedCount,
        severity: group[i].severity,
        topLines: mergeLines(chain.map((c) => c.lines)),
      });
    }
  }

  return corridors;
}

/**
 * Buduje korytarze opóźnień na podstawie aktywnych pojazdów i lokalnego GTFS.
 * Uwzględnia również punktualne pojazdy na tym samym odcinku, aby pojedynczy
 * opóźniony kurs nie tworzył fałszywego zatoru na sprawnej ulicy.
 */
export function buildLiveMapDelayCorridors(
  vehicles: readonly TrackedVehicle[],
  store: LocalGtfsStore | null | undefined,
  dayIndex: DayIndex | null | undefined,
  cityId: string,
  backendHubs?: readonly DelayHubSummary[] | null,
): LiveMapDelayCorridor[] {
  if (!store || store.stops.size === 0 || vehicles.length === 0) return [];

  let patternsByLine: Map<string, DayPattern[]> | null = null;
  if (dayIndex) {
    const neededLines = new Set<string>();
    for (const v of vehicles) {
      if (v.delaySec == null || !Number.isFinite(v.delaySec)) continue;
      if (!v.matchedTripId && v.line) neededLines.add(v.line.trim().toUpperCase());
    }
    if (neededLines.size > 0) {
      patternsByLine = new Map();
      for (const pattern of dayIndex.patterns.values()) {
        const route = store.routes.get(pattern.routeId);
        const shortName = (route?.route_short_name || '').trim().toUpperCase();
        if (!shortName || !neededLines.has(shortName)) continue;
        const list = patternsByLine.get(shortName);
        if (list) list.push(pattern);
        else patternsByLine.set(shortName, [pattern]);
      }
    }
  }

  const edges = new Map<string, RawEdgeAcc>();

  for (const v of vehicles) {
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
    if (v.delaySec == null || !Number.isFinite(v.delaySec)) continue;
    if (v.delaySec > MAX_PLAUSIBLE_DELAY_SEC) continue;

    const resolved = resolveVehicleEdge(v, store, patternsByLine, cityId);
    if (!resolved) continue;

    const { from, to, mode } = resolved;
    const isDir0 = from.normName < to.normName;
    const canonKey = isDir0
      ? `${mode}:${from.normName}|${to.normName}`
      : `${mode}:${to.normName}|${from.normName}`;

    let acc = edges.get(canonKey);
    if (!acc) {
      acc = {
        canonKey,
        mode,
        delays: [],
        delayedCount: 0,
        lines: new Map(),
        dir0Weight: 0,
        dir1Weight: 0,
        dir0Pair: null,
        dir1Pair: null,
      };
      edges.set(canonKey, acc);
    }

    const posDelay = Math.max(0, Math.min(2700, Math.round(v.delaySec)));
    acc.delays.push(posDelay);
    if (v.delaySec >= LATE_VEHICLE_SEC) {
      acc.delayedCount += 1;
      const lineKey = (v.line || '').trim();
      if (lineKey) acc.lines.set(lineKey, (acc.lines.get(lineKey) ?? 0) + 1);
    }

    if (isDir0) {
      acc.dir0Weight += Math.max(1, posDelay);
      if (!acc.dir0Pair || v.delaySec >= LATE_VEHICLE_SEC) acc.dir0Pair = [from, to];
    } else {
      acc.dir1Weight += Math.max(1, posDelay);
      if (!acc.dir1Pair || v.delaySec >= LATE_VEHICLE_SEC) acc.dir1Pair = [from, to];
    }
  }

  const classified: ClassifiedEdge[] = [];
  for (const acc of edges.values()) {
    const n = acc.delays.length;
    if (n === 0 || acc.delayedCount === 0) continue;
    const sorted = [...acc.delays].sort((a, b) => a - b);
    const avg = Math.round(sorted.reduce((a, b) => a + b, 0) / n);
    const p90 = percentileSorted(sorted, 0.9);
    const maxD = sorted[n - 1] ?? avg;
    const severity = classifyDelay(avg, p90, acc.delayedCount, n);
    if (!severity) continue;

    const pair =
      acc.dir0Weight >= acc.dir1Weight
        ? (acc.dir0Pair ?? acc.dir1Pair)
        : (acc.dir1Pair ?? acc.dir0Pair);
    if (!pair) continue;

    classified.push({
      mode: acc.mode,
      from: pair[0],
      to: pair[1],
      delays: acc.delays,
      delayedCount: acc.delayedCount,
      lines: acc.lines,
      avgDelaySec: avg,
      p90DelaySec: p90,
      maxDelaySec: maxD,
      severity,
    });
  }

  const corridors = mergeAdjacentEdges(classified);

  if (backendHubs && backendHubs.length > 0) {
    const hubByNorm = new Map<string, DelayHubSummary>();
    for (const h of backendHubs) {
      const k = normalizePolish(h.name);
      if (k && !hubByNorm.has(k)) hubByNorm.set(k, h);
    }
    for (const c of corridors) {
      const match =
        hubByNorm.get(normalizePolish(c.toStopName)) ??
        hubByNorm.get(normalizePolish(c.fromStopName));
      if (match && typeof match.typicalDelaySec === 'number') {
        c.typicalDelaySec = match.typicalDelaySec;
        c.deltaVsTypicalSec = c.avgDelaySec - match.typicalDelaySec;
      }
    }
  }

  corridors.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      b.delayedCount - a.delayedCount ||
      b.avgDelaySec - a.avgDelaySec,
  );

  return corridors.slice(0, MAX_CORRIDORS);
}

/**
 * Sprawdza, czy wyznaczona ścieżka drogowa/torowa naturalnie odpowiada przystankom
 * bez zawrotek, pętli wokół kwartału ani teleportów.
 */
export function validateRoadGeometry(
  routedLatLon: readonly [number, number][],
  waypointsLatLon: readonly [number, number][],
  maxDetourRatio = 2.3,
): boolean {
  if (routedLatLon.length < 2 || waypointsLatLon.length < 2) return false;

  const firstW = waypointsLatLon[0];
  const lastW = waypointsLatLon[waypointsLatLon.length - 1];
  const firstR = routedLatLon[0];
  const lastR = routedLatLon[routedLatLon.length - 1];

  if (distanceMeters(firstR[0], firstR[1], firstW[0], firstW[1]) > 160) return false;
  if (distanceMeters(lastR[0], lastR[1], lastW[0], lastW[1]) > 160) return false;

  let straightSum = 0;
  for (let i = 1; i < waypointsLatLon.length; i++) {
    straightSum += distanceMeters(
      waypointsLatLon[i - 1][0],
      waypointsLatLon[i - 1][1],
      waypointsLatLon[i][0],
      waypointsLatLon[i][1],
    );
  }
  if (straightSum < 20) return false;

  let routedLen = 0;
  let maxStep = 0;
  for (let i = 1; i < routedLatLon.length; i++) {
    const d = distanceMeters(
      routedLatLon[i - 1][0],
      routedLatLon[i - 1][1],
      routedLatLon[i][0],
      routedLatLon[i][1],
    );
    routedLen += d;
    if (d > maxStep) maxStep = d;
  }

  if (routedLen < straightSum * 0.65) return false;
  if (routedLen > Math.max(straightSum * maxDetourRatio, straightSum + 650)) return false;
  if (routedLatLon.length >= 4 && maxStep > Math.max(1200, straightSum * 0.92)) return false;

  return true;
}

export function corridorGeometryCacheKey(
  waypointsLatLon: readonly [number, number][],
  mode: TransitLocalMode,
): string {
  return `${mode}:${waypointsLatLon.map(([lat, lon]) => `${lat.toFixed(4)},${lon.toFixed(4)}`).join(';')}`;
}

function setRoadCache(key: string, coords: [number, number][] | null): void {
  if (roadGeometryCache.has(key)) roadGeometryCache.delete(key);
  roadGeometryCache.set(key, { coords, ts: Date.now() });
  if (roadGeometryCache.size > ROAD_CACHE_MAX) {
    const oldest = roadGeometryCache.keys().next().value;
    if (oldest !== undefined) roadGeometryCache.delete(oldest);
  }
}

/** Zwraca geometrię [lon, lat][] z pamięciowego cache albo undefined, jeśli jeszcze nie liczono. */
export function getCachedRoadCorridorGeometry(
  waypointsLatLon: readonly [number, number][],
  mode: TransitLocalMode,
): [number, number][] | null | undefined {
  const key = corridorGeometryCacheKey(waypointsLatLon, mode);
  const hit = roadGeometryCache.get(key);
  if (!hit) return undefined;
  if (hit.coords === null && Date.now() - hit.ts >= FAILED_RETRY_MS) {
    roadGeometryCache.delete(key);
    return undefined;
  }
  return hit.coords;
}

/**
 * Wyznacza lokalnie w silniku MVT przebieg korytarza po realnej drodze lub torowisku.
 * Zwraca współrzędne GeoJSON [lon, lat][] albo null, gdy nie da się czysto dopasować do sieci.
 */
export async function resolveRoadCorridorGeometry(
  waypointsLatLon: readonly [number, number][],
  mode: TransitLocalMode,
  signal?: AbortSignal,
): Promise<[number, number][] | null> {
  if (waypointsLatLon.length < 2 || signal?.aborted) return null;

  const key = corridorGeometryCacheKey(waypointsLatLon, mode);
  const cached = getCachedRoadCorridorGeometry(waypointsLatLon, mode);
  if (cached !== undefined) return cached;

  const inflight = roadGeometryInFlight.get(key);
  if (inflight) return inflight;

  const task = (async (): Promise<[number, number][] | null> => {
    try {
      let routed = await routeTransitLocal(waypointsLatLon, mode, signal);
      if (routed && !validateRoadGeometry(routed, waypointsLatLon, 2.3)) {
        routed = null;
      }

      // Na wspólnych pasach autobusowo-tramwajowych tory w OSM bywają podpięte do jezdni.
      if (!routed && mode === 'tram' && !signal?.aborted) {
        let straightSum = 0;
        for (let i = 1; i < waypointsLatLon.length; i++) {
          straightSum += distanceMeters(
            waypointsLatLon[i - 1][0],
            waypointsLatLon[i - 1][1],
            waypointsLatLon[i][0],
            waypointsLatLon[i][1],
          );
        }
        if (straightSum <= 1200) {
          const busFallback = await routeTransitLocal(waypointsLatLon, 'bus', signal);
          if (busFallback && validateRoadGeometry(busFallback, waypointsLatLon, 1.45)) {
            routed = busFallback;
          }
        }
      }

      if (signal?.aborted) return null;
      if (!routed || routed.length < 2) {
        setRoadCache(key, null);
        return null;
      }

      const lonLat: [number, number][] = routed.map(([lat, lon]) => [lon, lat]);
      setRoadCache(key, lonLat);
      return lonLat;
    } catch {
      return null;
    } finally {
      roadGeometryInFlight.delete(key);
    }
  })();

  roadGeometryInFlight.set(key, task);
  return task;
}

/** Wylicza dokładny punkt środkowy wzdłuż linii GeoJSON [lon, lat][] do zakotwiczenia etykiety. */
export function polylineMidpointLonLat(coords: readonly [number, number][]): { lat: number; lon: number } {
  if (coords.length === 0) return { lat: 0, lon: 0 };
  if (coords.length === 1) return { lon: coords[0][0], lat: coords[0][1] };
  let total = 0;
  const segLens: number[] = [];
  for (let i = 1; i < coords.length; i++) {
    const len = distanceMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    segLens.push(len);
    total += len;
  }
  if (total <= 0) {
    const mid = coords[Math.floor(coords.length / 2)];
    return { lon: mid[0], lat: mid[1] };
  }
  const half = total / 2;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    const len = segLens[i];
    if (acc + len >= half && len > 0) {
      const t = (half - acc) / len;
      const a = coords[i];
      const b = coords[i + 1];
      return {
        lon: a[0] + (b[0] - a[0]) * t,
        lat: a[1] + (b[1] - a[1]) * t,
      };
    }
    acc += len;
  }
  const last = coords[coords.length - 1];
  return { lon: last[0], lat: last[1] };
}
