// Kształt pliku video/.cache/data.json. Zapisuje go scripts/prepare.ts,
// czyta strona wideo. Współrzędne płasko: [lon, lat, lon, lat, ...].

export type Mode = 'tram' | 'bus';

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
  journey: {
    line: string;
    color: string;
    walk: number[];
    ride: number[];
    stops: { name: string; lon: number; lat: number; time: number }[];
  };
  /** Kursy w oknie animacji: pozycja na trasie (m) w funkcji czasu (s od północy). */
  vehicles: { shape: number; mode: Mode; line: string; t: number[]; d: number[]; focus: boolean }[];
  cities: { id: string; name: string; lon: number; lat: number }[];
}
