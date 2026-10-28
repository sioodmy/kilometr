import type { DelayConfidence } from '../../types/models';
import type { TrackedVehicle } from '../liveTracker';
import { MAX_SAMPLE_AGE_MS } from '../liveQuality';
import type { DayIndex } from './store';

export interface RoutingSnapshot {
  delays: Map<string, number>;
  confidence: Map<string, DelayConfidence>;
  transferBuffers: Map<string, number>;
}

export interface ReliabilityStore {
  routes: ReadonlyMap<string, { route_type: number }>;
  stopTimes: ReadonlyMap<string, { stop_id: string; departure_sec: number; arrival_sec: number }[]>;
}

export function emptyRoutingSnapshot(): RoutingSnapshot {
  return { delays: new Map(), confidence: new Map(), transferBuffers: new Map() };
}

/** Estymuje wyłącznie z dwóch świeżych pojazdów na tym samym kierunku lub odcinku. */
export function buildRoutingSnapshot(
  index: DayIndex | null,
  store: ReliabilityStore,
  vehicles: TrackedVehicle[],
  feedFresh: boolean,
  now: number,
  offsets = new Map<string, number>(),
): RoutingSnapshot {
  const result = emptyRoutingSnapshot();
  if (!feedFresh || !index) return result;
  const clock = new Date(now);
  const sec = clock.getHours() * 3600 + clock.getMinutes() * 60 + clock.getSeconds();
  const samples = new Map<string, { delay: number; start: number; edge?: string }[]>();
  const edgeSamples = new Map<string, { delay: number; start: number }[]>();
  const fresh = new Map(
    vehicles
      .filter(
        (v) =>
          now - v.updatedAt <= MAX_SAMPLE_AGE_MS &&
          v.updatedAt <= now &&
          v.matchedTripId &&
          v.delaySec != null,
      )
      .map((v) => [v.matchedTripId!, v]),
  );
  for (const [id, v] of fresh) {
    result.delays.set(id, v.delaySec!);
    result.confidence.set(id, 'live');
  }
  if (![...fresh.values()].some((v) => !v.vehicleId.includes(':'))) return result;
  for (const [pid, raw] of index.patterns) {
    if (offsets.get(pid)) continue;
    const pattern: { routeId: string; stopSequence: string[]; trips: { trip_id: string }[] } = raw;
    const kind = store.routes.get(pattern.routeId)?.route_type;
    if (kind !== 3 && kind !== 11) continue;
    const list: { delay: number; start: number; edge?: string }[] = [];
    for (const trip of pattern.trips) {
      const v = fresh.get(trip.trip_id);
      const times = store.stopTimes.get(trip.trip_id);
      if (!v || v.delaySec == null || !times?.length) continue;
      const position = sec - v.delaySec;
      const i = times.findIndex(
        (t, i) =>
          i + 1 < times.length &&
          t.departure_sec <= position &&
          times[i + 1].arrival_sec >= position,
      );
      const sample = {
        delay: Math.max(0, v.delaySec),
        start: times[0].departure_sec,
        edge: i < 0 ? undefined : `${times[i].stop_id}>${times[i + 1].stop_id}`,
      };
      list.push(sample);
      if (sample.edge) {
        const onEdge = edgeSamples.get(sample.edge) ?? [];
        onEdge.push(sample);
        edgeSamples.set(sample.edge, onEdge);
      }
    }
    samples.set(pid, list);
  }
  for (const [pid, raw] of index.patterns) {
    if (offsets.get(pid)) continue;
    const pattern: { routeId: string; stopSequence: string[]; trips: { trip_id: string }[] } = raw;
    if (!samples.has(pid)) continue;
    const edges = new Set(
      pattern.stopSequence.slice(1).map((to, i) => `${pattern.stopSequence[i]}>${to}`),
    );
    for (const trip of pattern.trips) {
      if (fresh.has(trip.trip_id)) continue;
      const times = store.stopTimes.get(trip.trip_id);
      if (!times?.length) continue;
      const start = times[0].departure_sec;
      const end = times[times.length - 1].arrival_sec;
      if (start > sec + 2700 || end < sec - 5400) continue;
      const nearby = (s: { start: number }) => Math.abs(s.start - start) <= 2700;
      let evidence = samples.get(pid)!.filter(nearby);
      if (evidence.length < 2) {
        evidence = [];
        for (const edge of edges) {
          const onEdge = (edgeSamples.get(edge) ?? []).filter(nearby);
          if (onEdge.length >= 2) {
            evidence = onEdge;
            break;
          }
        }
      }
      if (evidence.length >= 2) {
        const values = evidence.map((s) => s.delay).sort((a, b) => a - b);
        const mid = Math.floor(values.length / 2);
        const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
        const estimate = Math.round(median * 0.8);
        if (estimate >= 120) {
          result.delays.set(trip.trip_id, estimate);
          result.confidence.set(trip.trip_id, 'estimated');
          result.transferBuffers.set(trip.trip_id, 180);
          continue;
        }
      }
      if (start <= sec - 300 && end >= sec - 5400) {
        result.confidence.set(trip.trip_id, 'untracked');
        result.transferBuffers.set(trip.trip_id, 180);
      }
    }
  }
  return result;
}
