import { awaitImportSettled, importInProgress } from '../dataManager';
import { getGtfsDb, getActiveServices } from '../gtfsDatabase';
import { distanceMeters } from '../../gtfs/geo';

const WALK_SPEED_MPS = 1.45;
const WALK_DETOUR_FACTOR = 1.2;
const MAX_TRANSFER_METERS = 800;
const MIN_FOOTPATH_SEC = 45;

export interface DayIndex {
  stopRoutes: Map<string, Set<string>>;
  routeStops: Map<string, string[]>;
  routeTrips: Map<string, any[]>;
  patterns: Map<string, any>;
}

export class LocalGtfsStore {
  stops = new Map<string, any>();
  routes = new Map<string, any>();
  trips = new Map<string, any>();
  stopTimes = new Map<string, any[]>();
  footpaths = new Map<string, any[]>();

  private dayIndexes = new Map<string, DayIndex>();
  /** Wycinki horyzontu (szybkie): klucz dzien+kubelki godzin, max 4 w pamięci. */
  private sliceIndexes = new Map<string, DayIndex>();
  private slicePromises = new Map<string, Promise<DayIndex>>();
  isLoaded = false;

  /**
   * Czyści pamięć podręczną po imporcie (seed / sieć): bez tego store
   * załadowany na pustej bazie zostaje pusty aż do restartu apki.
   */
  reset(): void {
    this.stops.clear();
    this.routes.clear();
    this.trips.clear();
    this.stopTimes.clear();
    this.footpaths.clear();
    this.dayIndexes.clear();
    this.sliceIndexes.clear();
    this.slicePromises.clear();
    this.isLoaded = false;
  }

  async load() {
    if (this.isLoaded) return;
    // Import w toku = sklep musi zostać pusty do jego końca (reset() czyści
    // je na końcu importu). Bez czekania load() wracał „wstecz" z pustymi
    // przystankami, a planer oddawał zero połączeń zamiast „rozkład się
    // importuje" — ekran pokazywał wtedy „nie znaleziono połączeń".
    if (importInProgress) {
      await awaitImportSettled();
      if (this.isLoaded) return;
    }
    console.log('[LocalGtfsStore] Initializing...');
    if (importInProgress) return;
    const db = await getGtfsDb();

    // 1. Load stops
    const stopsRows = await db.getAllAsync<{stop_id: string, code: string, name: string, lat: number, lon: number, norm: string}>('SELECT * FROM stops');
    for (const r of stopsRows) {
      this.stops.set(r.stop_id, {
        stop_id: r.stop_id,
        stop_code: r.code,
        stop_name: r.name,
        stop_lat: r.lat,
        stop_lon: r.lon,
        normalized_name: r.norm
      });
    }

    // 2. Load routes
    const routesRows = await db.getAllAsync<{route_id: string, short: string, long_name: string, type: number}>('SELECT * FROM routes');
    for (const r of routesRows) {
      this.routes.set(r.route_id, {
        route_id: r.route_id,
        route_short_name: r.short,
        route_long_name: r.long_name,
        route_type: r.type
      });
    }

    // 3. Build footpaths
    this.buildFootpaths();

    this.isLoaded = true;
    console.log(`[LocalGtfsStore] Loaded ${this.stops.size} stops, ${this.routes.size} routes.`);
  }

  private buildFootpaths() {
    const GRID_DEG_LAT = 0.001;
    const GRID_DEG_LON = 0.0015;

    const grid = new Map<string, any[]>();
    const stopArray = Array.from(this.stops.values());

    for (const s of stopArray) {
      const gx = Math.floor(s.stop_lon / GRID_DEG_LON);
      const gy = Math.floor(s.stop_lat / GRID_DEG_LAT);
      const key = `${gx},${gy}`;
      let cell = grid.get(key);
      if (!cell) {
        cell = [];
        grid.set(key, cell);
      }
      cell.push(s);
    }

    const SEARCH_RADIUS = 8;

    for (const s1 of stopArray) {
      const paths: any[] = [];
      const gx = Math.floor(s1.stop_lon / GRID_DEG_LON);
      const gy = Math.floor(s1.stop_lat / GRID_DEG_LAT);

      for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
        for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
          const cell = grid.get(`${gx + dx},${gy + dy}`);
          if (!cell) continue;

          for (const s2 of cell) {
            if (s1.stop_id === s2.stop_id) continue;
            const dist = distanceMeters(s1.stop_lat, s1.stop_lon, s2.stop_lat, s2.stop_lon);
            if (dist <= MAX_TRANSFER_METERS) {
              const effectiveDist = dist * WALK_DETOUR_FACTOR;
              paths.push({
                from_stop_id: s1.stop_id,
                to_stop_id: s2.stop_id,
                distance_m: Math.round(dist),
                duration_sec: Math.max(MIN_FOOTPATH_SEC, Math.round(effectiveDist / WALK_SPEED_MPS)),
              });
            }
          }
        }
      }

      if (paths.length > 0) {
        this.footpaths.set(s1.stop_id, paths);
      }
    }
  }

  /** route_ids dla oznaczenia linii ("4", "K") — case-insensitive. */
  getRouteIdsByShortName(shortName: string): string[] {
    const key = shortName.trim().toUpperCase();
    const out: string[] = [];
    for (const [id, r] of this.routes.entries()) {
      if (String(r.route_short_name ?? '').trim().toUpperCase() === key) out.push(id);
    }
    return out;
  }

  /**
   * Wycinkowy indeks na horyzont [fromSec, toSec] (sekundy, mogą >86400).
   * Ładuje tylko kursy nachodzące na horyzont — ~6× mniej wierszy przez mostek
   * JS niż pełny indeks dobowy. Cache kubelkowany po godzinach (max 4).
   */
  async getDayIndexSlice(
    weekday: number,
    dateStr: string | undefined,
    fromSec: number,
    toSec: number,
  ): Promise<DayIndex> {
    const day = ((weekday % 7) + 7) % 7;
    const qFrom = Math.floor(fromSec / 3600);
    const qTo = Math.floor(toSec / 3600);
    const cacheKey = `${day}|${dateStr ?? ''}|${qFrom}|${qTo}`;
    const hit = this.sliceIndexes.get(cacheKey);
    if (hit) {
      // LRU: odśwież kolejność
      this.sliceIndexes.delete(cacheKey);
      this.sliceIndexes.set(cacheKey, hit);
      return hit;
    }
    const inFlight = this.slicePromises.get(cacheKey);
    if (inFlight) return inFlight;

    const promise = this.buildSlice(day, dateStr, qFrom, qTo).finally(() => {
      this.slicePromises.delete(cacheKey);
    });
    this.slicePromises.set(cacheKey, promise);
    return promise;
  }

  private async buildSlice(
    day: number,
    dateStr: string | undefined,
    qFrom: number,
    qTo: number,
  ): Promise<DayIndex> {
    const cacheKey = `${day}|${dateStr ?? ''}|${qFrom}|${qTo}`;
    // Wycinek budujemy z marginesem całego kubła — zapytania z tej samej
    // godziny (i ticker co minutę) trafiają w ten sam klucz.
    const bFrom = qFrom * 3600 - 1800;
    const bTo = (qTo + 1) * 3600 + 1800;
    const t0 = performance.now();

    const emptyIdx: DayIndex = {
      stopRoutes: new Map(), routeStops: new Map(), routeTrips: new Map(), patterns: new Map(),
    };
    if (importInProgress) return emptyIdx;
    const activeServices = await getActiveServices(day, dateStr);
    const db = await getGtfsDb();
    const serviceList = Array.from(activeServices).map((s) => `'${s.replace(/'/g, "''")}'`).join(',');
    if (!serviceList) {
      this.rememberSlice(cacheKey, emptyIdx);
      return emptyIdx;
    }

    // 1. Kursy nachodzące na horyzont (agregacja natywnie w SQL — lecą tylko id).
    const overlapping = await db.getAllAsync<{ trip_id: string }>(
      `SELECT st.trip_id AS trip_id
       FROM stop_times st
       JOIN trips t ON st.trip_id = t.trip_id
       WHERE t.service_id IN (${serviceList})
       GROUP BY st.trip_id
       HAVING MIN(st.dep_sec) <= ? AND MAX(st.arr_sec) >= ?`,
      bTo,
      bFrom,
    );
    if (overlapping.length === 0) {
      this.rememberSlice(cacheKey, emptyIdx);
      return emptyIdx;
    }
    const tripIds = overlapping.map((r) => r.trip_id);

    // 2. Szczegóły kursów + czasy — porcjami (IN z tysiącami id na raz dławi mostek).
    const tripsByRouteId = new Map<string, any[]>();
    const CHUNK = 400;
    for (let i = 0; i < tripIds.length; i += CHUNK) {
      const chunk = tripIds.slice(i, i + CHUNK);
      const list = chunk.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
      const tripsRows = await db.getAllAsync<{trip_id: string, route_id: string, service_id: string, headsign: string, direction: number, shape: string}>(
        `SELECT trip_id, route_id, service_id, headsign, direction, shape FROM trips WHERE trip_id IN (${list})`
      );
      for (const r of tripsRows) {
        const t = {
          trip_id: r.trip_id,
          route_id: r.route_id,
          service_id: r.service_id,
          trip_headsign: r.headsign,
          direction_id: r.direction,
          shape_id: r.shape,
        };
        this.trips.set(r.trip_id, t);
        let group = tripsByRouteId.get(r.route_id);
        if (!group) {
          group = [];
          tripsByRouteId.set(r.route_id, group);
        }
        group.push(t);
      }
      const stRows = await db.getAllAsync<{trip_id: string, stop_id: string, arr_sec: number, dep_sec: number, seq: number}>(
        `SELECT trip_id, stop_id, arr_sec, dep_sec, seq FROM stop_times WHERE trip_id IN (${list}) ORDER BY trip_id, seq`
      );
      // Zastępujemy, nie dopisujemy: te same kursy trafiają do kolejnych
      // wycinków (o innej godzinie), a dopisanie duplikowało wiersze
      // stop_times. Wzorzec budowany z podwojonej sekwencji przystanków
      // psuł RAPTOR-a — „wsiądź i wysiądź” na tym samym przystanku,
      // a wszystkie podróże leciały do odrzucenia jako bezsensowne.
      const timesByTrip = new Map<string, any[]>();
      for (const r of stRows) {
        let group = timesByTrip.get(r.trip_id);
        if (!group) {
          group = [];
          timesByTrip.set(r.trip_id, group);
        }
        group.push({
          trip_id: r.trip_id,
          stop_id: r.stop_id,
          arrival_sec: r.arr_sec,
          departure_sec: r.dep_sec,
          stop_sequence: r.seq,
        });
      }
      for (const [tripId, group] of timesByTrip) {
        this.stopTimes.set(tripId, group);
      }
    }

    const idx = this.buildPatterns(tripsByRouteId);
    this.rememberSlice(cacheKey, idx);
    console.log(`[LocalGtfsStore] Slice ${cacheKey} in ${(performance.now() - t0).toFixed(0)} ms. Trips: ${tripIds.length}`);
    return idx;
  }

  private rememberSlice(key: string, idx: DayIndex): void {
    this.sliceIndexes.set(key, idx);
    if (this.sliceIndexes.size > 4) {
      const oldest = this.sliceIndexes.keys().next().value;
      if (oldest) this.sliceIndexes.delete(oldest);
    }
  }

  /** Buduje patterns/stopRoutes z mapy kursów (wspólne dla indeksu i wycinków). */
  private buildPatterns(tripsByRouteId: Map<string, any[]>): DayIndex {
    const stopRoutes = new Map<string, Set<string>>();
    const routeStops = new Map<string, string[]>();
    const routeTrips = new Map<string, any[]>();
    const patterns = new Map<string, any>();

    for (const [routeId, trips] of tripsByRouteId.entries()) {
      const patternGroups = new Map<string, any[]>();
      for (const trip of trips) {
        const times = this.stopTimes.get(trip.trip_id);
        if (!times || times.length === 0) continue;
        const key = times.map((t) => t.stop_id).join(',');
        let group = patternGroups.get(key);
        if (!group) {
          group = [];
          patternGroups.set(key, group);
        }
        group.push(trip);
      }

      let patIdx = 0;
      for (const [stopKey, patTrips] of patternGroups.entries()) {
        const patternId = `${routeId}_p${patIdx++}`;
        const stopSequence = stopKey.split(',');

        patTrips.sort((a, b) => {
          const depA = this.stopTimes.get(a.trip_id)![0].departure_sec;
          const depB = this.stopTimes.get(b.trip_id)![0].departure_sec;
          return depA - depB;
        });

        const departures: number[][] = Array.from({ length: stopSequence.length }, () => []);
        const tripIndicesArr: number[][] = Array.from({ length: stopSequence.length }, () => []);

        for (let tIdx = 0; tIdx < patTrips.length; tIdx++) {
          const times = this.stopTimes.get(patTrips[tIdx].trip_id)!;
          for (let sIdx = 0; sIdx < stopSequence.length && sIdx < times.length; sIdx++) {
            departures[sIdx].push(times[sIdx].departure_sec);
            tripIndicesArr[sIdx].push(tIdx);
          }
        }

        const pattern = {
          patternId,
          routeId,
          stopSequence,
          trips: patTrips,
          departures,
          tripIndices: tripIndicesArr,
        };

        patterns.set(patternId, pattern);
        routeStops.set(patternId, stopSequence);
        routeTrips.set(patternId, patTrips);

        for (const stopId of stopSequence) {
          let routesSet = stopRoutes.get(stopId);
          if (!routesSet) {
            routesSet = new Set();
            stopRoutes.set(stopId, routesSet);
          }
          routesSet.add(patternId);
        }
      }
    }

    return { stopRoutes, routeStops, routeTrips, patterns };
  }

  async getDayIndex(weekday: number, dateStr?: string): Promise<DayIndex> {
    const day = ((weekday % 7) + 7) % 7;
    const cacheKey = dateStr ? `${day}-${dateStr}` : `${day}`;
    if (this.dayIndexes.has(cacheKey)) return this.dayIndexes.get(cacheKey)!;

    console.log(`[LocalGtfsStore] Building DayIndex for ${cacheKey}...`);
    const activeServices = await getActiveServices(weekday, dateStr);
    
    const emptyIdx: DayIndex = {
      stopRoutes: new Map(), routeStops: new Map(), routeTrips: new Map(), patterns: new Map()
    };
    if (importInProgress) return emptyIdx;
    const db = await getGtfsDb();
    
    const serviceList = Array.from(activeServices).map(s => `'${s.replace(/'/g, "''")}'`).join(',');
    if (!serviceList) {
       console.warn('[LocalGtfsStore] No active services found for the day.');
       this.dayIndexes.set(cacheKey, emptyIdx);
       return emptyIdx;
    }

    const t0 = performance.now();

    // Fetch active trips
    const tripsRows = await db.getAllAsync<{trip_id: string, route_id: string, service_id: string, headsign: string, direction: number, shape: string}>(
      `SELECT trip_id, route_id, service_id, headsign, direction, shape FROM trips WHERE service_id IN (${serviceList})`
    );

    const activeTripsById = new Map<string, any>();
    const tripsByRouteId = new Map<string, any[]>();

    for (const r of tripsRows) {
      const t = {
        trip_id: r.trip_id,
        route_id: r.route_id,
        service_id: r.service_id,
        trip_headsign: r.headsign,
        direction_id: r.direction,
        shape_id: r.shape
      };
      this.trips.set(r.trip_id, t);
      activeTripsById.set(r.trip_id, t);
      let group = tripsByRouteId.get(r.route_id);
      if (!group) {
        group = [];
        tripsByRouteId.set(r.route_id, group);
      }
      group.push(t);
    }

    // Fetch active stop times
    const stRows = await db.getAllAsync<{trip_id: string, stop_id: string, arr_sec: number, dep_sec: number, seq: number}>(
      `SELECT st.trip_id, st.stop_id, st.arr_sec, st.dep_sec, st.seq 
       FROM stop_times st
       JOIN trips t ON st.trip_id = t.trip_id
       WHERE t.service_id IN (${serviceList})
       ORDER BY st.trip_id, st.seq`
    );

    for (const r of stRows) {
      let group = this.stopTimes.get(r.trip_id);
      if (!group) {
        group = [];
        this.stopTimes.set(r.trip_id, group);
      }
      group.push({
        trip_id: r.trip_id,
        stop_id: r.stop_id,
        arrival_sec: r.arr_sec,
        departure_sec: r.dep_sec,
        stop_sequence: r.seq
      });
    }

    const idx = this.buildPatterns(tripsByRouteId);
    this.dayIndexes.set(cacheKey, idx);
    console.log(`[LocalGtfsStore] DayIndex built in ${(performance.now() - t0).toFixed(0)} ms. Trips: ${activeTripsById.size}`);
    return idx;
  }

  findNearestStops(lat: number, lon: number, maxDistanceMeters = 800, limit = 12) {
    const results: any[] = [];
    const latRange = maxDistanceMeters / 111000;
    const lonRange = maxDistanceMeters / (111000 * Math.cos(lat * Math.PI / 180));

    for (const stop of this.stops.values()) {
      if (Math.abs(stop.stop_lat - lat) > latRange) continue;
      if (Math.abs(stop.stop_lon - lon) > lonRange) continue;

      const dist = distanceMeters(lat, lon, stop.stop_lat, stop.stop_lon);
      if (dist <= maxDistanceMeters) {
        results.push({ stop, distanceM: Math.round(dist) });
      }
    }

    results.sort((a, b) => a.distanceM - b.distanceM);
    return results.slice(0, limit);
  }
}

export const gtfsStore = new LocalGtfsStore();
