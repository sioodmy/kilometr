// Lokalny tracker pojazdów MPK: poll bus_position + dopasowanie kursów do
// rozkładu (opóźnienia). Zasilanie RAPTOR-a (tripDelays) i flag live w UI.
// Działa w całości na telefonie — bez serwera pośredniczącego.
//
// Matcher rzutuje pozycję GPS na geometrię trasy kursu (odcinki między
// kolejnymi przystankami) oraz sprawdza oczekiwany czas w rozkładzie.
// Eliminuje to błędy pojazdów w ruchu między przystankami i fałszywe dopasowania.

import { MPK, WROCLAW_BUS_LINES, WROCLAW_TRAM_LINES } from './gtfsConfig';
import { DayIndex, gtfsStore } from './routing/store';
import { distanceMeters, projectPointToPolyline } from '../gtfs/geo';
import type { VehiclePosition } from '../types/models';

const POLL_MS = 30000;
const FRESH_MS = 30000;
const WINDOW_SEC = 1800;
const MAX_CORRIDOR_DIST_M = 350;
const DELAY_CAP_SEC = 1800;

export interface RawVehicleRow {
  name: string;
  type: string;
  x: number;
  y: number;
  k: number;
}

export interface TrackedVehicle extends VehiclePosition {
  type: 'bus' | 'tram';
}

interface PatternPolylineNode {
  lat: number;
  lon: number;
  stopId: string;
  name: string;
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

  /** Czyści stan trackera (np. po resecie bazy lub nowym imporcie). */
  reset(): void {
    this.byId.clear();
    this.byLine.clear();
    this.tripDelays.clear();
    this.lastOk = 0;
  }

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
      if (rows && rows.length > 0) {
        await this.matchAll(rows);
        this.lastOk = Date.now();
      }
    } catch (err) {
      console.warn('[LiveTracker] poll failed:', err);
    } finally {
      this.inFlight = false;
    }
  }

  /** Dopasowanie pojedynczego pojazdu na żądanie (np. przy wejściu w kartę przejazdu). */
  async matchSingle(row: RawVehicleRow): Promise<TrackedVehicle | null> {
    if (!row.x || !row.y || !row.name) return null;
    const line = row.name.trim().toUpperCase();
    const vehicleId = `${line}-${row.k}`;

    const existing = this.byId.get(vehicleId);
    if (existing && Date.now() - existing.updatedAt < 10000) {
      return existing;
    }

    try {
      if (!gtfsStore.isLoaded) await gtfsStore.load();
      const now = new Date();
      const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      const dayIndex = await gtfsStore.getDayIndexSlice(
        now.getDay(),
        toDateStr(now),
        nowSec - WINDOW_SEC,
        nowSec + 3600,
      );

      const patternPolylines = new Map<string, PatternPolylineNode[]>();
      const tracked = this.matchRow(row, dayIndex, nowSec, patternPolylines);

      this.byId.set(vehicleId, tracked);
      if (tracked.matchedTripId) {
        this.tripDelays.set(tracked.matchedTripId, tracked.delaySec);
      }
      let list = this.byLine.get(line);
      if (!list) {
        list = [];
        this.byLine.set(line, list);
      }
      const idx = list.findIndex((v) => v.vehicleId === vehicleId);
      if (idx >= 0) list[idx] = tracked;
      else list.push(tracked);

      return tracked;
    } catch (err) {
      console.warn('[LiveTracker] matchSingle error:', err);
      return null;
    }
  }

  private async fetchAll(): Promise<RawVehicleRow[] | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MPK.timeoutMs);
    try {
      const body = new URLSearchParams();
      for (const t of WROCLAW_TRAM_LINES) body.append('busList[tram][]', t);
      for (const b of WROCLAW_BUS_LINES) body.append('busList[bus][]', b);
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

  private matchRow(
    row: RawVehicleRow,
    dayIndex: DayIndex,
    nowSec: number,
    patternPolylines: Map<string, PatternPolylineNode[]>,
  ): TrackedVehicle {
    const line = row.name.trim().toUpperCase();
    const vehicleId = `${line}-${row.k}`;
    const lat = row.x;
    const lon = row.y;
    const type: 'bus' | 'tram' = row.type === 'tram' ? 'tram' : 'bus';

    let routeIds = gtfsStore.getRouteIdsByShortName(line);
    if (routeIds.length === 0) routeIds = [line];

    let bestTripId: string | undefined;
    let bestDelay = 0;
    let bestScore = Infinity;
    let bestCurrentStop: string | undefined;
    let bestNextStop: string | undefined;

    for (const [patternId, pattern] of dayIndex.patterns.entries()) {
      if (!routeIds.includes(pattern.routeId)) continue;
      const trips = pattern.trips as any[];
      if (!trips || trips.length === 0) continue;

      let polyline = patternPolylines.get(patternId);
      if (!polyline) {
        polyline = [];
        for (const stopId of pattern.stopSequence as string[]) {
          const s = gtfsStore.stops.get(stopId);
          if (s && s.stop_lat != null && s.stop_lon != null) {
            polyline.push({
              lat: s.stop_lat,
              lon: s.stop_lon,
              stopId,
              name: s.stop_name || stopId,
            });
          }
        }
        patternPolylines.set(patternId, polyline);
      }

      if (polyline.length < 2) continue;

      const proj = projectPointToPolyline(lat, lon, polyline);
      if (proj.distanceMeters > MAX_CORRIDOR_DIST_M) continue;

      const segIdx = Math.max(0, Math.min(polyline.length - 2, proj.segmentIndex));
      const p1 = polyline[segIdx];
      const p2 = polyline[segIdx + 1];
      const d1 = distanceMeters(p1.lat, p1.lon, proj.closestLat, proj.closestLon);
      const dSeg = distanceMeters(p1.lat, p1.lon, p2.lat, p2.lon);
      const t = dSeg > 0 ? Math.min(1, Math.max(0, d1 / dSeg)) : 0;

      for (const trip of trips) {
        const times = gtfsStore.stopTimes.get(trip.trip_id);
        if (!times || times.length <= segIdx + 1) continue;

        const dep1 = times[segIdx].departure_sec;
        const arr2 = times[segIdx + 1].arrival_sec;
        const expectedSec = Math.round(dep1 + t * (arr2 - dep1));
        const delay = nowSec - expectedSec;

        // Odfiltruj kursy spoza realistycznego okna opóźnienia (-5 min do +35 min)
        if (delay < -300 || delay > 2100) continue;

        const score = Math.abs(delay) + proj.distanceMeters * 2;
        if (score < bestScore) {
          bestScore = score;
          bestTripId = trip.trip_id;
          bestDelay = delay;
          bestCurrentStop = p1.name;
          bestNextStop = p2.name;
        }
      }
    }

    // Fallback: dopasowanie do pojedynczych przystanków (np. pętla końcowa lub ostre zakręty)
    if (!bestTripId) {
      for (const [patternId, pattern] of dayIndex.patterns.entries()) {
        void patternId;
        if (!routeIds.includes(pattern.routeId)) continue;
        const trips = pattern.trips as any[];
        if (!trips) continue;

        for (const trip of trips) {
          const times = gtfsStore.stopTimes.get(trip.trip_id);
          if (!times) continue;

          for (let i = 0; i < times.length; i++) {
            const stop = gtfsStore.stops.get(times[i].stop_id);
            if (!stop || stop.stop_lat == null || stop.stop_lon == null) continue;

            const d = distanceMeters(lat, lon, stop.stop_lat, stop.stop_lon);
            if (d > 200) continue;

            const expectedSec = times[i].departure_sec ?? times[i].arrival_sec ?? nowSec;
            const delay = nowSec - expectedSec;
            if (delay < -300 || delay > 2100) continue;

            const score = Math.abs(delay) + d * 2;
            if (score < bestScore) {
              bestScore = score;
              bestTripId = trip.trip_id;
              bestDelay = delay;
              bestCurrentStop = stop.stop_name;
              bestNextStop = times[i + 1] ? gtfsStore.stops.get(times[i + 1].stop_id)?.stop_name : undefined;
            }
          }
        }
      }
    }

    if (bestDelay !== 0 && Math.abs(bestDelay) > DELAY_CAP_SEC) {
      bestDelay = 0;
    }

    return {
      vehicleId,
      line,
      lat,
      lon,
      type,
      delaySec: bestTripId ? bestDelay : 0,
      matchedTripId: bestTripId,
      currentStopName: bestCurrentStop,
      nextStopName: bestNextStop,
      updatedAt: Date.now(),
    };
  }

  private async matchAll(rows: RawVehicleRow[]): Promise<void> {
    try {
      if (!gtfsStore.isLoaded) await gtfsStore.load();
    } catch {
      return;
    }
    const now = new Date();
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    let dayIndex: DayIndex | null = null;
    try {
      dayIndex = await gtfsStore.getDayIndexSlice(
        now.getDay(),
        toDateStr(now),
        nowSec - WINDOW_SEC,
        nowSec + 3600,
      );
    } catch {
      return;
    }

    const patternPolylines = new Map<string, PatternPolylineNode[]>();
    const newById = new Map<string, TrackedVehicle>();
    const newByLine = new Map<string, TrackedVehicle[]>();
    const newDelays = new Map<string, number>();

    for (const row of rows) {
      if (!row.x || !row.y || !row.name) continue;
      const tracked = this.matchRow(row, dayIndex, nowSec, patternPolylines);
      newById.set(tracked.vehicleId, tracked);
      if (tracked.matchedTripId) {
        newDelays.set(tracked.matchedTripId, tracked.delaySec);
      }
      let list = newByLine.get(tracked.line);
      if (!list) {
        list = [];
        newByLine.set(tracked.line, list);
      }
      list.push(tracked);
    }

    this.byId = newById;
    this.byLine = newByLine;
    this.tripDelays = newDelays;
  }
}

export const liveTracker = new LiveTracker();
