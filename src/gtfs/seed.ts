// Bundlowany pierwowzór danych MPK (seed): leci razem z APK, zero sieci.
// Po pierwszym starcie ląduje w SQLite i od razu da się szukać przystanków
// oraz planować trasy — idealne do debugowania w Expo bez pobierania ~46 MB
// stop_times.txt. Użytkownik nadpisuje go pełnym rozkładem z Ustawień
// (import z sieci robi clearGtfsTables, więc seed znika w całości).
//
// Dwie linie na prawdziwych współrzędnych Wrocławia (Rynek ↔ pl. Grunwaldzki
// tramwajem, Galeria ↔ Dworzec Autobusowy autobusem), kursy co 10 min
// 05:00–23:00 w obie strony, serwis 7 dni w tygodniu. Celowo bez nocnych
// kursów — jak w prawdziwym GTFS, po północy RAPTOR nic nie znajduje.

import { normalizePolish } from './geo';
import type { GtfsCalendar, GtfsRoute, GtfsStop, GtfsStopTime, GtfsTrip } from './types';

/** Podbij przy każdej zmianie kształtu seeda (wymusza reseed na starych bazach). */
export const GTFS_SEED_VERSION = 1;
export const GTFS_SEED_SERVICE_ID = 'seed-week';

interface SeedStopDef {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
}

const SEED_STOP_DEFS: SeedStopDef[] = [
  { stop_id: 'seed-nadodrze', stop_code: '120616', stop_name: 'DWORZEC NADODRZE', stop_lat: 51.12484091, stop_lon: 17.03481634 },
  { stop_id: 'seed-rynek', stop_code: '10103', stop_name: 'Rynek', stop_lat: 51.1110606, stop_lon: 17.0272088 },
  { stop_id: 'seed-galeria', stop_code: '10111', stop_name: 'GALERIA DOMINIKAŃSKA', stop_lat: 51.10740171, stop_lon: 17.03975322 },
  { stop_id: 'seed-most', stop_code: '120822', stop_name: 'most Grunwaldzki', stop_lat: 51.11021216, stop_lon: 17.05538488 },
  { stop_id: 'seed-grunwaldzki', stop_code: '20920', stop_name: 'PL. GRUNWALDZKI', stop_lat: 51.11198112, stop_lon: 17.06403361 },
  { stop_id: 'seed-renoma', stop_code: '10335', stop_name: 'Renoma', stop_lat: 51.10412651, stop_lon: 17.03231779 },
  { stop_id: 'seed-arkady', stop_code: '10233', stop_name: 'Arkady (Capitol)', stop_lat: 51.10165238, stop_lon: 17.02925954 },
  { stop_id: 'seed-dworzec', stop_code: '11321', stop_name: 'DWORZEC AUTOBUSOWY', stop_lat: 51.09726779, stop_lon: 17.03228367 },
];

export const SEED_STOPS: GtfsStop[] = SEED_STOP_DEFS.map((s) => ({
  ...s,
  normalized_name: normalizePolish(s.stop_name),
}));

export const SEED_ROUTES: GtfsRoute[] = [
  { route_id: 'seed-4', route_short_name: '4', route_long_name: 'DWORZEC NADODRZE – PL. GRUNWALDZKI (seed)', route_type: 0 },
  { route_id: 'seed-133', route_short_name: '133', route_long_name: 'GALERIA DOMINIKAŃSKA – DWORZEC AUTOBUSOWY (seed)', route_type: 3 },
];

export const SEED_CALENDAR: GtfsCalendar[] = [
  {
    service_id: GTFS_SEED_SERVICE_ID,
    monday: 1,
    tuesday: 1,
    wednesday: 1,
    thursday: 1,
    friday: 1,
    saturday: 1,
    sunday: 1,
    start_date: '20200101',
    end_date: '20301231',
  },
];

interface SeedLineSpec {
  route_id: string;
  short: string;
  /** przystanki w kierunku dir0 (dir1 to odwrócona lista) */
  stops: string[];
  headsign0: string;
  headsign1: string;
}

const SEED_LINES: SeedLineSpec[] = [
  {
    route_id: 'seed-4',
    short: '4',
    stops: ['seed-nadodrze', 'seed-rynek', 'seed-galeria', 'seed-most', 'seed-grunwaldzki'],
    headsign0: 'PL. GRUNWALDZKI',
    headsign1: 'DWORZEC NADODRZE',
  },
  {
    route_id: 'seed-133',
    short: '133',
    stops: ['seed-galeria', 'seed-renoma', 'seed-arkady', 'seed-dworzec'],
    headsign0: 'DWORZEC AUTOBUSOWY',
    headsign1: 'GALERIA DOMINIKAŃSKA',
  },
];

const SEED_FIRST_DEP_SEC = 5 * 3600;
const SEED_LAST_DEP_SEC = 23 * 3600;
const SEED_HEADWAY_SEC = 600;
const SEED_HOP_SEC = 180;

function toHms(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Kursy seeda: deterministyczne, niezależne od dnia — serwis jeździ codziennie. */
export function buildSeedTrips(): GtfsTrip[] {
  const out: GtfsTrip[] = [];
  for (const line of SEED_LINES) {
    const dirs = [
      { dir: 0, stops: line.stops, headsign: line.headsign0 },
      { dir: 1, stops: [...line.stops].reverse(), headsign: line.headsign1 },
    ];
    for (const d of dirs) {
      let k = 0;
      for (let dep = SEED_FIRST_DEP_SEC; dep <= SEED_LAST_DEP_SEC; dep += SEED_HEADWAY_SEC) {
        out.push({
          trip_id: `seed-${line.short}-${d.dir}-${k}`,
          service_id: GTFS_SEED_SERVICE_ID,
          route_id: line.route_id,
          trip_headsign: d.headsign,
          direction_id: d.dir,
          shape_id: '',
        });
        k++;
      }
    }
  }
  return out;
}

/** Czasy seeda: +3 min na każdy kolejny przystanek, bez postojów. */
export function buildSeedStopTimes(): GtfsStopTime[] {
  const out: GtfsStopTime[] = [];
  for (const line of SEED_LINES) {
    const dirs = [line.stops, [...line.stops].reverse()];
    dirs.forEach((stops, dir) => {
      let k = 0;
      for (let dep = SEED_FIRST_DEP_SEC; dep <= SEED_LAST_DEP_SEC; dep += SEED_HEADWAY_SEC) {
        const tripId = `seed-${line.short}-${dir}-${k}`;
        stops.forEach((stopId, idx) => {
          const sec = dep + idx * SEED_HOP_SEC;
          const hms = toHms(sec);
          out.push({
            trip_id: tripId,
            arrival_time: hms,
            departure_time: hms,
            arrival_sec: sec,
            departure_sec: sec,
            stop_id: stopId,
            stop_sequence: idx + 1,
          });
        });
        k++;
      }
    });
  }
  return out;
}
