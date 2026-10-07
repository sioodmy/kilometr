import path from 'node:path';
import { ensureGtfsData } from './downloader';
import {
  parseCalendar,
  parseCalendarDates,
  parseRoutes,
  parseShapes,
  parseStops,
  parseStopTimes,
  parseTrips,
} from './parser';
import { Footpath, GtfsCalendar, GtfsCalendarDate, GtfsRoute, GtfsStop, GtfsStopTime, GtfsTrip } from './types';
import { distanceMeters, normalizePolish } from './geo';
import { fuzzyMatch } from '../search/fuzzy';

// ────────────────────────────────────────────────────────────────────────────
// Trip Pattern — unikalna sekwencja przystanków.
// Jeden GTFS route_id (np. tramwaj 4) ma tripy w OBU kierunkach i z wariantami
// trasy. Grupujemy tripy po identycznej sekwencji stop_id → „pattern".
// RAPTOR skanuje patterny zamiast route_ids — eliminuje bug odwrotnych kursów.
// ────────────────────────────────────────────────────────────────────────────
export interface TripPattern {
  patternId: string;            // np. "route_4_dir0_patA"
  routeId: string;              // oryginalny GTFS route_id
  stopSequence: string[];       // uporządkowana lista stop_id
  trips: GtfsTrip[];            // tripy tego patternu, posortowane po departure_sec
  /** Pre-indeksowane departure_sec na każdym przystanku per trip.
   *  departures[stopIndex] = tablica departure_sec posortowana rosnąco,
   *  z odpowiadającym tripIndex w tripIndices[stopIndex]. */
  departures: number[][];
  tripIndices: number[][];
}

/** Indeks RAPTOR dla jednego dnia (klucz = weekday lub weekday+dateStr).
 *  Zamiast route → stops, operuje na TripPattern. */
export interface DayIndex {
  stopRoutes: Map<string, Set<string>>;     // stop_id → Set of patternIds
  routeStops: Map<string, string[]>;        // patternId → stop sequence
  routeTrips: Map<string, GtfsTrip[]>;      // patternId → sorted trips
  patterns: Map<string, TripPattern>;       // patternId → full pattern data
}

const WEEKDAY_FIELDS: (keyof Pick<GtfsCalendar, 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'>)[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

// ────────────────────────────────────────────────────────────────────────────
// Parametry pieszych (footpaths i access/egress)
// ────────────────────────────────────────────────────────────────────────────
const WALK_SPEED_MPS = 1.45;          // 1.45 m/s (~5.2 km/h) — jak Jakdojade, żwawy marsz
const WALK_DETOUR_FACTOR = 1.15;     // ulice nie biegną po prostej — mnożnik ~15%
const MAX_TRANSFER_METERS = 800;     // footpath do 800 m — węzły przesiadkowe (jakdojade grupuje perony w promieniu ~1 km i liczy czas, nie dystans)
const MIN_FOOTPATH_SEC = 45;         // minimum 45s na przesiadkę pieszo

export class GtfsStore {
  stops = new Map<string, GtfsStop>();
  routes = new Map<string, GtfsRoute>();
  trips = new Map<string, GtfsTrip>();
  stopTimes = new Map<string, GtfsStopTime[]>();
  shapes = new Map<string, { lat: number; lon: number }[]>();
  footpaths = new Map<string, Footpath[]>();

  // RAPTOR acceleration structures (per weekday/date — sobota/niedziela mają
  // własny rozkład; indeks budowany leniwie i cachowany)
  private dayIndexes = new Map<string, DayIndex>();
  private servicesByWeekday = new Map<number, Set<string>>();
  private calendarDates: GtfsCalendarDate[] = [];
  private calendarLoaded = false;

  routeTrips = new Map<string, GtfsTrip[]>(); // route_id → WSZYSTKIE tripy (dla matchera live; filtr czasu i tak obowiązuje)
  stopWeights = new Map<string, number>();    // normalized_name → sum of departures

  isLoaded = false;

  private buildStopWeights() {
    const idWeights = new Map<string, number>();
    for (const sequence of this.stopTimes.values()) {
      for (const st of sequence) {
        idWeights.set(st.stop_id, (idWeights.get(st.stop_id) || 0) + 1);
      }
    }
    this.stopWeights.clear();
    for (const stop of this.stops.values()) {
      const w = idWeights.get(stop.stop_id) || 0;
      const name = stop.normalized_name;
      this.stopWeights.set(name, (this.stopWeights.get(name) || 0) + w);
    }
  }

  async load(): Promise<void> {
    if (this.isLoaded) return;
    const t0 = performance.now();
    console.log('[GTFS Store] Initializing store...');

    const extractedDir = await ensureGtfsData();

    // 1. Parse stops, routes, calendar
    this.stops = parseStops(path.join(extractedDir, 'stops.txt'));
    this.routes = parseRoutes(path.join(extractedDir, 'routes.txt'));
    const calendar = parseCalendar(path.join(extractedDir, 'calendar.txt'));
    this.calendarDates = parseCalendarDates(path.join(extractedDir, 'calendar_dates.txt'));

    // Serwisy per dzień tygodnia (0 = niedziela). Pusty kalendarz = wszystko, zawsze.
    this.servicesByWeekday.clear();
    for (let d = 0; d < 7; d++) this.servicesByWeekday.set(d, new Set());
    if (calendar.size === 0) {
      // brak kalendarza — wszystkie serwisy aktywne codziennie (ustawiane niżej)
    } else {
      for (const [id, c] of calendar.entries()) {
        WEEKDAY_FIELDS.forEach((field, day) => {
          if ((c[field] as number) > 0) this.servicesByWeekday.get(day)!.add(id);
        });
      }
    }
    this.calendarLoaded = true;

    // 2. Parse trips — WSZYSTKIE (filtrowanie po dniu przy budowie indeksu)
    const { tripsById, tripsByRouteId } = parseTrips(
      path.join(extractedDir, 'trips.txt'),
      undefined
    );
    this.trips = tripsById;
    this.allTripsByRouteId = tripsByRouteId;

    // Jeśli kalendarz był pusty — wszystkie serwisy codziennie
    if (calendar.size === 0) {
      const allServices = new Set<string>();
      for (const t of this.trips.values()) allServices.add(t.service_id);
      for (let d = 0; d < 7; d++) this.servicesByWeekday.set(d, allServices);
    }

    // 3. Parse stop times
    const activeTripIds = new Set(this.trips.keys());
    this.stopTimes = await parseStopTimes(
      path.join(extractedDir, 'stop_times.txt'),
      activeTripIds
    );

    // 4. Parse shapes (for live vehicle matching & polyline geometry)
    this.shapes = await parseShapes(path.join(extractedDir, 'shapes.txt'));

    // 5. RouteTrips dla matchera (wszystkie tripy, posortowane) + footpaths.
    // Indeksy dzienne (RAPTOR) budują się leniwie przez getDayIndex().
    this.buildAllRouteTrips(tripsByRouteId);
    this.buildFootpaths();
    this.buildStopWeights();

    this.isLoaded = true;
    console.log(
      `[GTFS Store] Loaded ${this.stops.size} stops, ${this.routes.size} routes, ${this.trips.size} trips, ${this.stopTimes.size} stop_time sequences in ${(
        performance.now() - t0
      ).toFixed(0)} ms`
    );
  }

  private allTripsByRouteId = new Map<string, GtfsTrip[]>();

  /** Serwisy kursujące w dany dzień tygodnia, z uwzględnieniem wyjątków z calendar_dates.txt.
   *  dateStr format: YYYYMMDD */
  getActiveServices(weekday: number, dateStr?: string): Set<string> {
    const base = new Set(this.servicesByWeekday.get(((weekday % 7) + 7) % 7) ?? []);
    if (dateStr && this.calendarDates.length > 0) {
      for (const cd of this.calendarDates) {
        if (cd.date === dateStr) {
          if (cd.exception_type === 1) {
            base.add(cd.service_id); // serwis dodany na tę datę
          } else if (cd.exception_type === 2) {
            base.delete(cd.service_id); // serwis usunięty na tę datę
          }
        }
      }
    }
    return base;
  }

  /** Indeks RAPTOR dla dnia tygodnia — budowany raz, potem z cache.
   *  dateStr (YYYYMMDD) uwzględnia calendar_dates.txt. */
  getDayIndex(weekday: number, dateStr?: string): DayIndex {
    const day = ((weekday % 7) + 7) % 7;
    const cacheKey = dateStr ? `${day}-${dateStr}` : `${day}`;
    const cached = this.dayIndexes.get(cacheKey);
    if (cached) return cached;

    const active = this.getActiveServices(day, dateStr);
    const useFilter = active.size > 0;
    const stopRoutes = new Map<string, Set<string>>();
    const routeStops = new Map<string, string[]>();
    const routeTrips = new Map<string, GtfsTrip[]>();
    const patterns = new Map<string, TripPattern>();

    for (const [routeId, trips] of this.allTripsByRouteId.entries()) {
      const dayTrips = useFilter ? trips.filter((t) => active.has(t.service_id)) : trips;
      if (!dayTrips.length) continue;

      // ──── Trip Pattern Extraction ────
      // Grupuj tripy po identycznej sekwencji stop_ids (nie po kierunku!).
      // Różne warianty/skrócone kursy tworzą osobne patterny.
      const patternGroups = new Map<string, GtfsTrip[]>();
      for (const trip of dayTrips) {
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

        // Sort trips by departure at first stop
        patTrips.sort((a, b) => {
          const depA = this.stopTimes.get(a.trip_id)![0].departure_sec;
          const depB = this.stopTimes.get(b.trip_id)![0].departure_sec;
          return depA - depB;
        });

        // Pre-compute per-stop departure arrays for binary search
        const departures: number[][] = Array.from({ length: stopSequence.length }, () => []);
        const tripIndicesArr: number[][] = Array.from({ length: stopSequence.length }, () => []);

        for (let tIdx = 0; tIdx < patTrips.length; tIdx++) {
          const times = this.stopTimes.get(patTrips[tIdx].trip_id)!;
          for (let sIdx = 0; sIdx < stopSequence.length && sIdx < times.length; sIdx++) {
            departures[sIdx].push(times[sIdx].departure_sec);
            tripIndicesArr[sIdx].push(tIdx);
          }
        }

        const pattern: TripPattern = {
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

    const idx: DayIndex = { stopRoutes, routeStops, routeTrips, patterns };
    this.dayIndexes.set(cacheKey, idx);
    return idx;
  }

  private buildAllRouteTrips(tripsByRouteId: Map<string, GtfsTrip[]>) {
    // Wszystkie tripy per linia (dla matchera live — on i tak filtruje oknem czasu)
    for (const [routeId, trips] of tripsByRouteId.entries()) {
      if (!trips.length) continue;
      const validTrips = trips.filter((t) => this.stopTimes.has(t.trip_id));
      validTrips.sort((a, b) => {
        const depA = this.stopTimes.get(a.trip_id)![0].departure_sec;
        const depB = this.stopTimes.get(b.trip_id)![0].departure_sec;
        return depA - depB;
      });
      this.routeTrips.set(routeId, validTrips);
    }
  }

  private buildFootpaths() {
    // Spatial grid — dzielimy przystanki na kratki ~100m × ~100m
    // O(N) budowa + O(1) lookup zamiast O(N²) brute-force.
    const GRID_DEG_LAT = 0.001; // ~111m
    const GRID_DEG_LON = 0.0015; // ~104m przy 51°N

    const grid = new Map<string, GtfsStop[]>();
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

    // Promień 800m = ~8 kratek w każdą stronę (węzły przesiadkowe)
    const SEARCH_RADIUS = 8;

    for (const s1 of stopArray) {
      const paths: Footpath[] = [];
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
              // Detour factor: ulice nie biegną po prostej
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

  /** Route_ids dla oznaczenia linii (route_short_name, np. "4", "K"). Case-insensitive. */
  getRouteIdsByShortName(shortName: string): string[] {
    const key = shortName.trim().toUpperCase();
    const out: string[] = [];
    for (const [id, r] of this.routes.entries()) {
      if (r.route_short_name.trim().toUpperCase() === key) out.push(id);
    }
    return out;
  }

  /** Find stops near a coordinate, sorted by distance */
  findNearestStops(
    lat: number,
    lon: number,
    maxDistanceMeters = 800,
    limit = 12
  ): { stop: GtfsStop; distanceM: number }[] {
    const results: { stop: GtfsStop; distanceM: number }[] = [];

    // Quick bounding box pre-filter (degrees)
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

  /** Full-text / prefix / fuzzy search over stop names */
  searchStops(query: string, limit = 8): { stop: GtfsStop; score: number; weight: number }[] {
    const q = normalizePolish(query);
    if (!q) return [];

    const scored: { stop: GtfsStop; score: number; weight: number }[] = [];
    const seenNames = new Set<string>();

    for (const stop of this.stops.values()) {
      const name = stop.normalized_name;
      if (seenNames.has(name)) continue;

      const match = fuzzyMatch(q, stop.stop_name);
      if (match.matches) {
        seenNames.add(name);
        scored.push({
          stop,
          score: match.score,
          weight: this.stopWeights.get(name) || 0,
        });
      }
    }

    scored.sort((a, b) => {
      // Znacząca różnica w dopasowaniu tekstu ma pierwszeństwo
      if (Math.abs(a.score - b.score) > 12) {
        return b.score - a.score;
      }
      // W innym wypadku używamy rankingu popularności przystanku
      return b.weight - a.weight;
    });

    return scored.slice(0, limit);
  }
}

export const gtfsStore = new GtfsStore();
