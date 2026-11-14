// Kształt pliku video/.cache/data.json. Zapisuje go scripts/prepare.ts,
// czyta strona wideo. Współrzędne płasko: [lon, lat, lon, lat, ...].

export type Mode = 'tram' | 'bus';

export interface VideoStop {
  id: string;
  name: string;
  lon: number;
  lat: number;
}

/** Pieszo do `to`: ze startu albo z przystanku z poprzedniego odcinka. Metry w linii prostej. */
export interface VideoWalk {
  kind: 'walk';
  walkM: number;
  to: VideoStop;
  dep: number;
  arr: number;
}

/** Przejazd jednym kursem; czasy w sekundach od północy. */
export interface VideoRide {
  kind: 'ride';
  trip: string;
  line: string;
  mode: Mode;
  color: string;
  direction: string;
  from: VideoStop;
  to: VideoStop;
  dep: number;
  arr: number;
  stopCount: number;
}

/** Połączenie z wyszukiwarki, odcinek po odcinku. */
export type VideoOption = (VideoWalk | VideoRide)[];

export interface VideoData {
  feed: { publisher: string; start: string; end: string };
  /** Styl mapy aplikacji (buildMapStyle) jako MapLibre style JSON. */
  style: unknown;
  /** Start podróży i fali, sekundy od północy. */
  depart: number;
  origin: { name: string; lon: number; lat: number };
  shapes: number[][];
  /** Trasy linii z czasem dotarcia fali w każdym wierzchołku (s od startu, -1 = poza zasięgiem). */
  lines: { shape: number; mode: Mode; reach: number[] }[];
  /** Przystanki: lon, lat, czas dotarcia fali (s od startu, -1 = poza zasięgiem). */
  stops: number[];
  /** Najszybsza podróż do celu: dojście i jeden kurs, z geometrią do mapy. */
  journey: {
    line: string;
    color: string;
    walk: number[];
    ride: number[];
    /** Przystanki kursu: `time` to odjazd, `arr` przyjazd. */
    stops: (VideoStop & { seq: number; arr: number; time: number })[];
    /** Połączenia na ekranie wyszukiwarki; pierwsze to ta podróż. */
    options: VideoOption[];
  };
  /** Kursy w oknie animacji: pozycja na trasie (m) w funkcji czasu (s od północy). */
  vehicles: { shape: number; mode: Mode; line: string; t: number[]; d: number[]; focus: boolean }[];
  /** IC Wrocław → Warszawa: geometria i przystanki do sceny kolejowej. */
  rail: {
    line: string;
    color: string;
    ride: number[];
    stops: VideoStop[];
    /** Punkt „Warszawa” na mapie (etykieta w scenie pociągu). */
    warsaw: { name: string; lon: number; lat: number };
    trainNumber: string;
    trainName: string;
  };
  cities: { id: string; name: string; lon: number; lat: number }[];
}
