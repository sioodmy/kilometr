import { distanceMeters, projectPointToPolyline } from '../gtfs/geo';
import type { Leg, LegStop } from '../types/models';

// Dopasowanie GPS pasażera do osi toru między stacjami.
//
// Estymator z onboardGps.ts liczył opóźnienie tylko z przejazdów stacji:
// między nimi (po kilometry toru) marker prowadził szacunek z rozkładu,
// a opóźnienie zamierało na wartości z ostatniej stacji. Tu rzutujemy
// pomiar na oś toru z bazy ogólnopolskiej (shapes PLK) zakotwiczoną
// w stacjach nogi, więc między stacjami też wiemy, na którym odcinku
// jedzie pociąg i jak bardzo się spóźnia.
//
// Czysta logika bez react-native: shape dociąga ensureTrainTrack
// (dynamiczny import, bo routeGeometry ciągnie storage expo), skrypt
// check-onboard-gps.ts testuje bez urządzenia.

/** Zakotwiczona w stacjach oś toru naszej nogi. */
export interface TrainTrack {
  /** Punkty osi w kolejności jazdy. */
  shape: { lat: number; lon: number }[];
  /** stops[i] → metry od początku osi; -1 poza oknem/bez zakotwiczenia. */
  anchorsM: number[];
  /** Długość całej osi [m]. */
  totalM: number;
}

export interface TrainTrackMatch {
  /** Pociąg między stops[gap] a stops[gap + 1]. */
  gap: number;
  /** Postęp w odcinku 0..1. */
  progress: number;
  /** Dystans pomiaru od osi toru [m]. */
  offsetM: number;
  /** Azymut odcinka osi w miejscu pomiaru (0 = północ). */
  heading: number;
}

/** Korytarz wokół osi toru dla pomiaru z pociągu (jak dla pojazdów z API). */
export const TRAIN_TRACK_CORRIDOR_M = 120;
/** Stacja musi leżeć przy torze; jak przy cięciu shape'u w routeGeometry. */
const STATION_ANCHOR_MAX_M = 2500;

/**
 * Zakotwicza stacje okna wzdłuż osi toru. Każda kolejna jest szukana dalej
 * niż poprzednia, bo linie pętlowe przechodzą przez ten sam punkt dwa razy.
 * Null, gdy któraś stacja nie leży przy torze: bez pełnej kotwicy mapa
 * odcinków byłaby niejednoznaczna, więc wracamy do dopasowania po stacjach.
 */
export function buildTrainTrack(
  shape: { lat: number; lon: number }[],
  stops: LegStop[],
  window: { start: number; end: number },
): TrainTrack | null {
  if (shape.length < 2 || window.end <= window.start || window.end >= stops.length) return null;

  const cum = [0];
  for (let i = 0; i < shape.length - 1; i++) {
    cum.push(cum[i] + distanceMeters(shape[i].lat, shape[i].lon, shape[i + 1].lat, shape[i + 1].lon));
  }
  const totalM = cum[cum.length - 1];
  if (totalM <= 0) return null;

  const anchorsM = new Array<number>(stops.length).fill(-1);
  let segStart = 0;
  for (let i = window.start; i <= window.end; i++) {
    const stop = stops[i];
    if (!stop || stop.lat == null || stop.lon == null) return null;
    const slice = shape.slice(segStart);
    const p = projectPointToPolyline(stop.lat, stop.lon, slice);
    if (p.distanceMeters > STATION_ANCHOR_MAX_M) return null;
    // fractionAlongShape jest względem wycinka, przesuwamy na pełną oś.
    anchorsM[i] = cum[segStart] + p.fractionAlongShape * (totalM - cum[segStart]);
    segStart += p.segmentIndex;
  }
  for (let i = window.start + 1; i <= window.end; i++) {
    if (anchorsM[i] < anchorsM[i - 1]) return null;
  }
  return { shape, anchorsM, totalM };
}

/**
 * Rzutuje pomiar GPS na oś toru i mówi, na którym odcinku między stacjami
 * leży. Null poza korytarzem: pomiar z autobusu jadącego drogą obok toru
 * nie może przestawiać markera ani psuć opóźnienia.
 */
export function matchOnTrack(
  track: TrainTrack,
  window: { start: number; end: number },
  lat: number,
  lon: number,
  maxOffsetM: number,
): TrainTrackMatch | null {
  if (window.end <= window.start || window.end >= track.anchorsM.length) return null;
  const p = projectPointToPolyline(lat, lon, track.shape);
  if (p.distanceMeters > maxOffsetM) return null;
  const along = p.fractionAlongShape * track.totalM;

  // Odcinek, którego stacja początkowa jest ostatnia za pomiarem.
  let gap = window.start;
  for (let i = window.start; i < window.end; i++) {
    if (track.anchorsM[i] >= 0 && track.anchorsM[i] <= along) gap = i;
  }
  const from = track.anchorsM[gap];
  const to = track.anchorsM[gap + 1];
  const span = to - from;
  const progress = span > 0 ? Math.min(1, Math.max(0, (along - from) / span)) : 0;
  return { gap, progress, offsetM: p.distanceMeters, heading: p.segmentHeading };
}

// ─── Ładowanie i cache ───────────────────────────────────────────────────────

type TrackShape = { lat: number; lon: number }[];
/** Cache shape'ów po nodze: unpack z bazy robi się raz na kurs. */
const shapeCache = new Map<string, Promise<TrackShape | null>>();
/** Kotwice liczone per lista stops (UI ma pełny kurs, monitor samą nogę). */
const trackCache = new Map<string, TrainTrack | null>();
const CACHE_MAX = 8;

/** Klucz zakotwiczonej geometrii: kurs + stacje okna + ich indeksy w stops. */
export function trainTrackKey(
  leg: Leg,
  stops: LegStop[],
  window: { start: number; end: number },
): string | null {
  if (leg.mode !== 'train' || window.end <= window.start || window.end >= stops.length) return null;
  const trip = leg.tripId ?? `${leg.line ?? ''}@${leg.fromStopId ?? leg.fromStop}`;
  return `${trip}|${stops[window.start]?.stopId ?? stops[window.start]?.name ?? window.start}|${stops[window.end]?.stopId ?? stops[window.end]?.name ?? window.end}|${window.start}|${window.end}`;
}

async function loadShape(leg: Leg): Promise<TrackShape | null> {
  const { loadTrainTrackShape } = await import('./routeGeometry');
  // loadTrainTrackShape zwraca Coord[] ([lat, lon]); oś trzymamy jako {lat, lon}.
  const coords = await loadTrainTrackShape(leg);
  return coords ? coords.map(([lat, lon]) => ({ lat, lon })) : null;
}

/**
 * Geometria toru nogi do dopasowania GPS. Null, gdy noga nie jest kolejowa,
 * nie ma jej w bazie (brak shape'u PLK) albo baza jeszcze się nie otworzyła
 * (wtedy bez cache, kolejne odświeżenie spróbuje znowu).
 */
export async function ensureTrainTrack(
  leg: Leg,
  stops: LegStop[],
  window: { start: number; end: number },
): Promise<TrainTrack | null> {
  const key = trainTrackKey(leg, stops, window);
  if (key == null) return null;
  if (trackCache.has(key)) return trackCache.get(key) ?? null;

  const shapeKey = `${leg.tripId ?? leg.line ?? leg.id}|${leg.fromStopId ?? leg.fromStop}|${leg.toStopId ?? leg.toStop}`;
  let shapePromise = shapeCache.get(shapeKey);
  if (!shapePromise) {
    // Błędu nie cache'ujemy: niedomknięta baza nie może zablokować
    // geometrii na całą jazdę.
    shapePromise = loadShape(leg).catch((err) => {
      shapeCache.delete(shapeKey);
      throw err;
    });
    shapeCache.set(shapeKey, shapePromise);
    if (shapeCache.size > CACHE_MAX) {
      const oldest = shapeCache.keys().next().value;
      if (oldest !== undefined && oldest !== shapeKey) shapeCache.delete(oldest);
    }
  }
  let shape: TrackShape | null;
  try {
    shape = await shapePromise;
  } catch {
    return null;
  }
  const track = shape ? buildTrainTrack(shape, stops, window) : null;
  trackCache.set(key, track);
  if (trackCache.size > CACHE_MAX) {
    const oldest = trackCache.keys().next().value;
    if (oldest !== undefined && oldest !== key) trackCache.delete(oldest);
  }
  return track;
}
