import type { DelayConfidence } from '../../types/models';
import type { BackendDelayIntel } from '../kilometrApi';
import type { TrackedVehicle } from '../liveTracker';
import { MAX_SAMPLE_AGE_MS } from '../liveQuality';
import type { DayIndex } from './store';

export interface RoutingSnapshot {
  delays: Map<string, number>;
  confidence: Map<string, DelayConfidence>;
  transferBuffers: Map<string, number>;
}

export interface ReliabilityStore {
  routes: ReadonlyMap<string, { route_type: number; route_short_name?: string }>;
  stopTimes: ReadonlyMap<string, { stop_id: string; departure_sec: number; arrival_sec: number }[]>;
}

export function emptyRoutingSnapshot(): RoutingSnapshot {
  return { delays: new Map(), confidence: new Map(), transferBuffers: new Map() };
}

/**
 * Estymuje opóźnienia kursów bez nadajnika GPS:
 * 1. Z dwóch świeżych pojazdów lokalnych na tym samym kierunku lub odcinku.
 * 2. Awaryjnie ze statystyk Data Science backendu (linie, węzły, profil historyczny),
 *    w tym dla tramwajów i kolei oraz dynamicznego bufora przesiadki z p90.
 */
export function buildRoutingSnapshot(
  index: DayIndex | null,
  store: ReliabilityStore,
  vehicles: TrackedVehicle[],
  feedFresh: boolean,
  now: number,
  offsets = new Map<string, number>(),
  backendIntel?: BackendDelayIntel | null,
  filterRouteIds?: ReadonlySet<string>,
): RoutingSnapshot {
  const result = emptyRoutingSnapshot();
  if (!index) return result;
  const hasBackendIntel = Boolean(backendIntel && backendIntel.byLine.size > 0);
  if (!feedFresh && !hasBackendIntel) return result;

  const clock = new Date(now);
  const sec = clock.getHours() * 3600 + clock.getMinutes() * 60 + clock.getSeconds();
  const samples = new Map<string, { delay: number; start: number; edge?: string }[]>();
  const edgeSamples = new Map<string, { delay: number; start: number }[]>();
  const fresh = new Map<string, TrackedVehicle>();
  let hasUrbanLive = false;
  if (feedFresh) {
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (
        now - v.updatedAt <= MAX_SAMPLE_AGE_MS &&
        v.updatedAt <= now &&
        v.matchedTripId &&
        v.delaySec != null
      ) {
        fresh.set(v.matchedTripId, v);
        result.delays.set(v.matchedTripId, v.delaySec);
        result.confidence.set(v.matchedTripId, 'live');
        if (!hasUrbanLive && !v.vehicleId.includes(':')) hasUrbanLive = true;
      }
    }
  }

  // Gdy caller pyta tylko o konkretne linie (np. widoczne na liście połączeń),
  // możemy pominąć zbieranie próbek, jeśli żadna z tych linii nie ma ani live, ani backendu.
  if (filterRouteIds && filterRouteIds.size === 0) return result;

  if (hasUrbanLive) {
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
  }

  for (const [pid, raw] of index.patterns) {
    if (offsets.get(pid)) continue;
    const pattern: { routeId: string; stopSequence: string[]; trips: { trip_id: string }[] } = raw;
    if (filterRouteIds && !filterRouteIds.has(pattern.routeId)) continue;
    const route = store.routes.get(pattern.routeId);
    const lineKey = route?.route_short_name?.trim().toUpperCase();
    const backendLine = lineKey && backendIntel ? backendIntel.byLine.get(lineKey) : undefined;
    const hasLocalSamples = samples.has(pid);

    if (!hasLocalSamples && !backendLine) continue;

    const edges = hasLocalSamples
      ? new Set(
          pattern.stopSequence.slice(1).map((to, i) => `${pattern.stopSequence[i]}>${to}`),
        )
      : null;

    for (const trip of pattern.trips) {
      if (fresh.has(trip.trip_id)) {
        // Nawet dla kursu live dokladamy bufor przesiadki, jesli p90 linii jest wysokie.
        if (backendLine && backendLine.recommendedTransferBufferSec >= 180) {
          const currentBuf = result.transferBuffers.get(trip.trip_id) ?? 0;
          if (backendLine.recommendedTransferBufferSec > currentBuf) {
            result.transferBuffers.set(trip.trip_id, backendLine.recommendedTransferBufferSec);
          }
        }
        continue;
      }
      const times = store.stopTimes.get(trip.trip_id);
      if (!times?.length) continue;
      const start = times[0].departure_sec;
      const end = times[times.length - 1].arrival_sec;
      if (start > sec + 2700 || end < sec - 5400) continue;

      if (hasLocalSamples) {
        const nearby = (s: { start: number }) => Math.abs(s.start - start) <= 2700;
        let evidence = samples.get(pid)!.filter(nearby);
        if (evidence.length < 2 && edges) {
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
            const buffer = Math.max(180, backendLine?.recommendedTransferBufferSec ?? 0);
            result.transferBuffers.set(trip.trip_id, buffer);
            continue;
          }
        }
      }

      // Estymacja z backendu Data Science (linie bez lokalnych par GPS, tramwaje, kolej).
      if (
        backendLine &&
        backendLine.estimateConfidence >= 0.45 &&
        backendLine.estimatedUntrackedDelaySec >= 120
      ) {
        result.delays.set(trip.trip_id, backendLine.estimatedUntrackedDelaySec);
        result.confidence.set(trip.trip_id, 'estimated');
        result.transferBuffers.set(
          trip.trip_id,
          Math.max(180, backendLine.recommendedTransferBufferSec),
        );
        continue;
      }

      if (hasLocalSamples && start <= sec - 300 && end >= sec - 5400) {
        result.confidence.set(trip.trip_id, 'untracked');
        result.transferBuffers.set(
          trip.trip_id,
          Math.max(180, backendLine?.recommendedTransferBufferSec ?? 0),
        );
      }
    }
  }
  return result;
}
