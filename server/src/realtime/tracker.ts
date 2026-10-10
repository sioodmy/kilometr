import { config } from '../config';
import { gtfsStore } from '../gtfs/store';
import { matchVehicleToSchedule, VehicleMatch } from './matcher';

export class VehicleTracker {
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
      // Build active bus & tram lines from GTFS store or common Wrocław defaults
      const tramLines = [
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
        '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
        '21', '22', '23', '24', '70', '72', '74'
      ];
      const busLines = [
        'A', 'C', 'D', 'K', 'N',
        '100', '101', '102', '103', '104', '105', '106', '107', '108', '109', '110',
        '111', '112', '113', '114', '115', '116', '117', '118', '119', '120', '121', '122',
        '123', '124', '125', '126', '127', '128', '129', '130', '131', '132', '133', '134',
        '136', '137', '138', '140', '142', '143', '144', '145', '146', '147', '148', '149',
        '150', '151', '152', '153',
        '206', '240', '241', '242', '243', '244', '245', '246', '247', '248', '249',
        '250', '251', '253', '255', '257', '259',
        '306', '310', '315', '319', '343', '345',
        '602', '607', '612',
        '704', '715', '747',
        '903', '904', '905', '906', '907', '908', '909', '911', '914', '920', '921',
        '924', '927', '930', '931', '934', '936', '947', '948', '955', '958', '967'
      ];

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

  getLiveStatusForTrip(tripId?: string, line?: string): { delaySec: number; vehicle: VehicleMatch } | null {
    if (this.isStale()) return null;
    // Tylko konkretny pojazd dopasowany do tripId = prawdziwy GPS.
    // Celowo BEZ fallbacku po linii: "pierwszy pojazd linii" dawał fałszywe
    // "na czas" / opóźnienia dla kursów bez własnego GPS.
    if (tripId) {
      const match = this.vehiclesByTripId.get(tripId);
      if (match) return { delaySec: match.delaySec, vehicle: match };
    }

    return null;
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
