import { config } from '../config';
import { gtfsStore } from '../gtfs/store';
import { matchVehicleToSchedule, VehicleMatch } from './matcher';

class VehicleTracker {
  private vehiclesById = new Map<string, VehicleMatch>();
  private vehiclesByLine = new Map<string, VehicleMatch[]>();
  private vehiclesByTripId = new Map<string, VehicleMatch>();
  private pollTimer: NodeJS.Timeout | null = null;
  private isPolling = false;
  // Znacznik ostatniego udanego pollingu: po przerwie w łączności stare
  // opóźnienia nie mogą dalej zasilać RAPTOR-a ani UI jako świeże.
  private lastSuccessAt = 0;
  private static readonly STALE_AFTER_MS = 120000;

  start() {
    if (this.pollTimer) return;
    console.log('[Realtime Tracker] Starting live vehicle tracker...');
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), config.mpk.pollIntervalMs);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async poll() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      // Lista linii pochodzi z GTFS: nowa linia w rozkładzie od razu trafia
      // do live, bez ręcznej listy, która się rozjeżdża z danymi.
      const tramLines = new Set<string>();
      const busLines = new Set<string>();
      for (const route of gtfsStore.routes.values()) {
        const name = route.route_short_name.trim().toUpperCase();
        if (!name) continue;
        if (route.route_type === 0) tramLines.add(name);
        else if (route.route_type === 3) busLines.add(name);
      }

      const body = new URLSearchParams();
      for (const t of tramLines) body.append('busList[tram][]', t);
      for (const b of busLines) body.append('busList[bus][]', b);

      const res = await fetch(config.mpk.busPositionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'Mozilla/5.0',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(config.mpk.timeoutMs),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const rows = (await res.json()) as { name: string; type: string; x: number; y: number; k: number }[];
      if (!Array.isArray(rows)) return;

      const newById = new Map<string, VehicleMatch>();
      const newByLine = new Map<string, VehicleMatch[]>();
      const newByTripId = new Map<string, VehicleMatch>();

      for (const row of rows) {
        if (!row.x || !row.y || !row.name) continue;
        const line = row.name.trim().toUpperCase();
        const prev = this.vehiclesById.get(`${line}-${row.k}`);

        const match = matchVehicleToSchedule(gtfsStore, row, prev?.lat, prev?.lon);
        newById.set(match.vehicleId, match);

        let lineList = newByLine.get(line);
        if (!lineList) {
          lineList = [];
          newByLine.set(line, lineList);
        }
        lineList.push(match);

        if (match.matchedTripId) {
          newByTripId.set(match.matchedTripId, match);
        }
      }

      this.vehiclesById = newById;
      this.vehiclesByLine = newByLine;
      this.vehiclesByTripId = newByTripId;
      this.lastSuccessAt = Date.now();
    } catch (err: any) {
      console.warn('[Realtime Tracker] Poll warning:', err?.message || err);
    } finally {
      this.isPolling = false;
    }
  }

  getVehicles(line?: string): VehicleMatch[] {
    if (line) {
      return this.vehiclesByLine.get(line.toUpperCase()) || [];
    }
    return Array.from(this.vehiclesById.values());
  }

  private isStale(): boolean {
    return this.lastSuccessAt === 0 || Date.now() - this.lastSuccessAt > VehicleTracker.STALE_AFTER_MS;
  }

  /** Opóźnienia wszystkich śledzonych kursów: tripId -> sekundy. Do RAPTOR-a. */
  getTripDelays(): Map<string, number> {
    const out = new Map<string, number>();
    if (this.isStale()) return out;
    for (const [tripId, match] of this.vehiclesByTripId.entries()) {
      out.set(tripId, match.delaySec);
    }
    return out;
  }
}

export const vehicleTracker = new VehicleTracker();
