// Polinka, kolejka linowa Politechniki Wrocławskiej nad Odrą, między stacją
// przy wyb. Wyspiańskiego 23 (budynek C-13) a stacją przy ul. Na Grobli
// (Geocentrum). Działa od 2013, ~373 m trasy, dwa wagoniki po 15 osób.
//
// Linia NIE wchodzi w GTFS MPK (to uczelnia, nie przewoźnik miejski), więc
// dokładamy ją do sklepu jako syntetyczne dane w formacie GTFS. Forma jest
// celowo identyczna z tym, czego RAPTOR oczekuje (stops/routes/trips/stop_times),
// dzięki czemu planer traktuje Polinkę jak każdy inny kurs, bez osobnego
// trybu w algorytmie, bez drugiego silnika.
//
// Źródła parametrów: pwr.edu.pl/polinka (godziny, bilety), regulamin kolei
// linowej 2019 (min. 5 min, pon.–pt. 07:00–21:00), OSM (aerialway=cable_car,
// nazwy stacji, współrzędne wejść).

import { normalizePolish } from '../gtfs/geo';

export const POLINKA_ROUTE_ID = 'pwr_polinka';
export const POLINKA_LINE = 'Polinka';
export const POLINKA_LONG_NAME = 'Kolej linowa Polinka';

export const POLINKA_WYSPIANSKIEGO_STOP_ID = 'pwr_pol_wyspianskiego';
export const POLINKA_NA_GROBLI_STOP_ID = 'pwr_pol_na_grobli';

/** Przejazd w obie strony: „niecałe trzy minuty" (pwr.edu.pl, OSM aerialway:duration). */
export const POLINKA_RIDE_SEC = 180;

/** Regulamin: „nie rzadziej niż co 5 minut". */
export const POLINKA_HEADWAY_SEC = 300;

// Poniedziałek–piątek 07:00–21:00, przerwa techniczna 13:30–14:00.
// W weekendy i dni świąteczne Polinka nie kursuje.
const FIRST_DEPARTURE_SEC = 7 * 3600;
const LAST_ARRIVAL_SEC = 21 * 3600;
const BREAK_START_SEC = 13 * 3600 + 30 * 60;
const BREAK_END_SEC = 14 * 3600;

export interface PolinkaStop {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  normalized_name: string;
}

const STOP_DEFS: Array<Omit<PolinkaStop, 'normalized_name'>> = [
  {
    stop_id: POLINKA_WYSPIANSKIEGO_STOP_ID,
    stop_code: '',
    stop_name: 'Polinka Wybrzeże Wyspiańskiego',
    stop_lat: 51.107243,
    stop_lon: 17.05851,
  },
  {
    stop_id: POLINKA_NA_GROBLI_STOP_ID,
    stop_code: '',
    stop_name: 'Polinka Na Grobli',
    stop_lat: 51.105898,
    stop_lon: 17.053252,
  },
];

/** Stacje Polinki w formacie GTFS (normalizacja nazw jak w seedzie). */
export function polinkaStops(): PolinkaStop[] {
  return STOP_DEFS.map((s) => ({ ...s, normalized_name: normalizePolish(s.stop_name) }));
}

export function polinkaRoute(): {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_type: number;
} {
  return {
    route_id: POLINKA_ROUTE_ID,
    route_short_name: POLINKA_LINE,
    route_long_name: POLINKA_LONG_NAME,
    route_type: 6, // GTFS: 6 = kolej powietrzna (cable car / gondola)
  };
}

type DirectionId = 0 | 1;

const DIRECTIONS: Record<
  DirectionId,
  { from: string; to: string; headsign: string; tag: string }
> = {
  0: {
    from: POLINKA_WYSPIANSKIEGO_STOP_ID,
    to: POLINKA_NA_GROBLI_STOP_ID,
    headsign: 'Na Grobli',
    tag: 'w2g',
  },
  1: {
    from: POLINKA_NA_GROBLI_STOP_ID,
    to: POLINKA_WYSPIANSKIEGO_STOP_ID,
    headsign: 'Wybrzeże Wyspiańskiego',
    tag: 'g2w',
  },
};

function isPolinkaDeparture(sec: number): boolean {
  if (sec < FIRST_DEPARTURE_SEC) return false;
  if (sec + POLINKA_RIDE_SEC > LAST_ARRIVAL_SEC) return false;
  if (sec >= BREAK_START_SEC && sec < BREAK_END_SEC) return false;
  return true;
}

/**
 * Godziny odjazdów w obu kierunkach (ten sam zegar: wagoniki chodzą naprzeciwko).
 * Ostatni odjazd musi zdążyć z przyjazdem przed zamknięciem.
 */
export function polinkaDepartureSeconds(): number[] {
  const out: number[] = [];
  const lastStart = LAST_ARRIVAL_SEC - POLINKA_RIDE_SEC;
  for (let sec = FIRST_DEPARTURE_SEC; sec <= lastStart; sec += POLINKA_HEADWAY_SEC) {
    if (isPolinkaDeparture(sec)) out.push(sec);
  }
  return out;
}

export interface PolinkaTrip {
  trip_id: string;
  route_id: string;
  service_id: string;
  trip_headsign: string;
  direction_id: DirectionId;
  shape_id: string;
}

export interface PolinkaStopTime {
  trip_id: string;
  stop_id: string;
  arrival_sec: number;
  departure_sec: number;
  stop_sequence: number;
}

export interface PolinkaTripBundle {
  trip: PolinkaTrip;
  times: PolinkaStopTime[];
  /** najwcześniejszy odjazd kursu (kryterium przecięcia horyzontu) */
  departSec: number;
  /** najpóźniejszy przyjazd kursu */
  arriveSec: number;
}

export const POLINKA_SERVICE_ID = 'pwr_polinka_weekday';

/**
 * Kursy nachodzące na horyzont [fromSec, toSec] (sekundy od północy, mogą
 * przekraczać 86400). Ten sam warunek SQL, którego używa sklep dla GTFS MPK:
 * MIN(dep) <= to AND MAX(arr) >= from.
 */
export function polinkaTripsOverlapping(fromSec: number, toSec: number): PolinkaTripBundle[] {
  const out: PolinkaTripBundle[] = [];
  for (const sec of polinkaDepartureSeconds()) {
    const arrive = sec + POLINKA_RIDE_SEC;
    if (sec > toSec || arrive < fromSec) continue;
    for (const dir of [0, 1] as DirectionId[]) {
      const d = DIRECTIONS[dir];
      const tripId = `pwr_polinka_${d.tag}_${sec}`;
      out.push({
        trip: {
          trip_id: tripId,
          route_id: POLINKA_ROUTE_ID,
          service_id: POLINKA_SERVICE_ID,
          trip_headsign: d.headsign,
          direction_id: dir,
          shape_id: `${POLINKA_ROUTE_ID}_${d.tag}`,
        },
        times: [
          {
            trip_id: tripId,
            stop_id: d.from,
            arrival_sec: sec,
            departure_sec: sec,
            stop_sequence: 0,
          },
          {
            trip_id: tripId,
            stop_id: d.to,
            arrival_sec: arrive,
            departure_sec: arrive,
            stop_sequence: 1,
          },
        ],
        departSec: sec,
        arriveSec: arrive,
      });
    }
  }
  return out;
}