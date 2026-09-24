// Lokalny tracker pojazdów MPK: poll bus_position + dopasowanie kursów do
// rozkładu (opóźnienia). Zasilanie RAPTOR-a (tripDelays) i flag live w UI.
// Działa w całości na telefonie — bez serwera pośredniczącego.
//
// Matcher celowo bez kształtów (shapes nie importujemy na urządzenie):
// pojazd dopasowujemy do najbliższego przystanku jego linii w oknie ±30 min.
// Dokładność ±1–2 min wystarcza do "opóźniony / na czas".

import { MPK } from './gtfsConfig';
import { gtfsStore } from './routing/store';
import { distanceMeters } from '../gtfs/geo';
import type { VehiclePosition } from '../types/models';

const POLL_MS = 30000;
const FRESH_MS = 30000;
const WINDOW_SEC = 1800;
const MATCH_RADIUS_M = 150;
const DELAY_CAP_SEC = 1800;

interface RawVehicleRow {
  name: string;
  type: string;
  x: number;
  y: number;
  k: number;
}

export interface TrackedVehicle extends VehiclePosition {
  type: 'bus' | 'tram';
}

function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

class LiveTracker {
  private byId = new Map<string, TrackedVehicle>();
  private byLine = new Map<string, TrackedVehicle[]>();
  private tripDelays = new Map<string, number>();
  private lastOk = 0;
  private inFlight = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Idempotentny start tickera (pierwsze ensureFresh też go stawia). */
  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_MS);
  }

  /**
   * Szybka ścieżka przed planowaniem: gdy snapshot świeży — nic nie robi,
   * w przeciwnym razie odpala poll W TLE i wraca od razu (planowanie nigdy
   * nie czeka na sieć; najwyżej użyje opóźnień sprzed ≤30 s).
   */
  async ensureFresh(): Promise<void> {
    this.start();
    if (Date.now() - this.lastOk < FRESH_MS || this.inFlight) return;
    void this.poll();
  }

  /** Opóźnienia kursów: tripId -> sekundy. Do RAPTOR-a. */
  getTripDelays(): Map<string, number> {
    return this.tripDelays;
  }

  /** Ostatni snapshot (np. do spinania pozycji z kartą przejazdu). */
  lookup(vehicleId: string): TrackedVehicle | undefined {
    return this.byId.get(vehicleId);
  }

  snapshot(line?: string): TrackedVehicle[] {
    if (line) return this.byLine.get(line.trim().toUpperCase()) ?? [];
    return Array.from(this.byId.values());
  }

  async poll(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const rows = await this.fetchAll();
      if (rows) {
        this.matchAll(rows);
        this.lastOk = Date.now();
      }
    } catch (err) {
      console.warn('[LiveTracker] poll failed:', err);
    } finally {
      this.inFlight = false;
    }
  }

  private async fetchAll(): Promise<RawVehicleRow[] | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MPK.timeoutMs);
    try {
      // Jeden POST po wszystkie linie (jak serwer) — mniej requestów niż per linia.
      const body = new URLSearchParams();
      const TRAMS = ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23'];
      const BUSES = ['A','C','D','K','N',
        '100','101','102','103','104','105','106','107','108','109','110','111','112','113','114','115','116','118','119','120','121','122',
        '124','125','126','127','128','129','130','131','132','133','134','136','140','142','143','144','145','146','147','148','149','150','151','152'];
      for (const t of TRAMS) body.append('busList[tram][]', t);
      for (const b of BUSES) body.append('busList[bus][]', b);
      const res = await fetch(MPK.busPositionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'Mozilla/5.0',
        },
        body: body.toString(),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`MPK HTTP ${res.status}`);
      const rows = (await res.json()) as RawVehicleRow[];
      return Array.isArray(rows) ? rows : null;
    } catch (err) {
      console.warn('[LiveTracker] MPK direct fetch failed:', err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async matchAll(rows: RawVehicleRow[]): Promise<void> {
    try {
      await gtfsStore.load();
    } catch {
      return;
    }
    const now = new Date();
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    let dayIndex = null;
    try {
      dayIndex = await gtfsStore.getDayIndexSlice(now.getDay(), toDateStr(now), nowSec - WINDOW_SEC, nowSec + 3600);
    } catch {
      return;
    }

    // Kursy w oknie per linia — raz na poll, nie per pojazd.
    const tripsByLine = new Map<string, any[]>();
    const routeIdsByLine = new Map<string, string[]>();

    const windowTripsFor = (line: string): any[] => {
      const hit = tripsByLine.get(line);
      if (hit) return hit;
      let routeIds = routeIdsByLine.get(line);
      if (!routeIds) {
        routeIds = gtfsStore.getRouteIdsByShortName(line);
        routeIdsByLine.set(line, routeIds);
      }
      const out: any[] = [];
      for (const [patternId, pattern] of dayIndex!.patterns.entries()) {
        void patternId;
        if (!routeIds.includes(pattern.routeId)) continue;
        for (const trip of pattern.trips as any[]) {
          const times = gtfsStore.stopTimes.get(trip.trip_id);
          if (!times || times.length === 0) continue;
          const firstDep = times[0].departure_sec;
          const lastArr = times[times.length - 1].arrival_sec;
          if (nowSec >= firstDep - WINDOW_SEC && nowSec <= lastArr + WINDOW_SEC) {
            out.push(trip);
          }
        }
      }
      tripsByLine.set(line, out);
      return out;
    };

    const newById = new Map<string, TrackedVehicle>();
    const newByLine = new Map<string, TrackedVehicle[]>();
    const newDelays = new Map<string, number>();
    const stamp = Date.now();

    for (const row of rows) {
      if (!row.x || !row.y || !row.name) continue;
      const line = row.name.trim().toUpperCase();
      const vehicleId = `${line}-${row.k}`;
      const candidates = windowTripsFor(line);

      let bestTripId: string | undefined;
      let bestDelay = 0;
      let bestDist = MATCH_RADIUS_M;
      let bestIdx = -1;
      let bestTimes: any[] | null = null;

      for (const trip of candidates) {
        const times = gtfsStore.stopTimes.get(trip.trip_id);
        if (!times) continue;
        for (let i = 0; i < times.length; i++) {
          const stop = gtfsStore.stops.get(times[i].stop_id);
          if (!stop) continue;
          const d = distanceMeters(row.x, row.y, stop.stop_lat, stop.stop_lon);
          if (d < bestDist) {
            bestDist = d;
            bestTripId = trip.trip_id;
            bestTimes = times;
            bestIdx = i;
            // Pojazd "jest" przy tym przystanku o czasie z rozkładu.
            const expected = times[i].departure_sec ?? times[i].arrival_sec ?? nowSec;
            bestDelay = Math.round(nowSec - expected);
          }
        }
      }

      if (bestDelay !== 0 && Math.abs(bestDelay) > DELAY_CAP_SEC) bestDelay = 0;

      let currentStopName: string | undefined;
      let nextStopName: string | undefined;
      if (bestTripId && bestTimes && bestIdx >= 0) {
        currentStopName = gtfsStore.stops.get(bestTimes[bestIdx].stop_id)?.stop_name;
        const next = bestTimes[Math.min(bestTimes.length - 1, bestIdx + 1)];
        nextStopName = gtfsStore.stops.get(next.stop_id)?.stop_name;
        newDelays.set(bestTripId, bestDelay);
      }

      const v: TrackedVehicle = {
        vehicleId,
        line,
        lat: row.x,
        lon: row.y,
        type: row.type === 'tram' ? 'tram' : 'bus',
        delaySec: bestDelay,
        matchedTripId: bestTripId,
        currentStopName,
        nextStopName,
        updatedAt: stamp,
      };
      newById.set(vehicleId, v);
      let list = newByLine.get(line);
      if (!list) {
        list = [];
        newByLine.set(line, list);
      }
      list.push(v);
    }

    this.byId = newById;
    this.byLine = newByLine;
    this.tripDelays = newDelays;
  }
}

export const liveTracker = new LiveTracker();
