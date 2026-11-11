import type { Leg, LegStop } from '../types/models';
import {
  buildFallbackStops,
  findUserSegment,
  legClock,
  nearestStationIndex,
  nowSecOfDay,
  TRAIN_STATION_RADIUS_M,
  withinTrainLegWindow,
} from './vehiclePosition';
import { matchOnTrack, TRAIN_TRACK_CORRIDOR_M, type TrainTrack } from './trainTrack';

// Opóźnienie pociągu z GPS telefonu pasażera.
//
// Feed PKP (zbiorkom) potrafi być nieświeży: pociąg „stoi" na stacji
// początkowej długie minuty po odjazdzie, a pasażer już jest 40 km dalej.
// Telefon pasażera zawsze wie, gdzie jest, więc przejazdy stacji liczone
// z jego GPS-u są miarą opóźnienia, której feed nie pobije.
//
// Czysta logika bez react-native: korzysta z niej tripMonitor, a skrypt
// check-onboard-gps.ts testuje bez urządzenia.

/** Jeden pomiar GPS telefonu (expo-location albo natywny event z serwisu). */
export interface OnboardFix {
  lat: number;
  lon: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  /** Zegar systemowy w ms (jak Location.timestamp). */
  timestamp: number;
}

export interface OnboardEstimate {
  legId: string;
  /** Opóźnienie z ostatniego przejazdu stacji albo interpolowane z osi toru (sekundy). */
  delaySec: number | null;
  /** Kiedy zmierzono opóźnienie (przejazd stacji albo pomiar między nimi), w ms. */
  measuredAtMs: number;
  fix: OnboardFix;
}

/** Górny limit wiarygodnego opóźnienia; powyżej tego traktujemy pomiar jako szum. */
const MAX_DELAY_SEC = 90 * 60;
const MAX_FIX_AGE_MS = 30_000;
/** Stacja musi być przejechana w tym oknie wokół planu (sekundy). */
const EARLY_LIMIT_SEC = 15 * 60;
const LATE_LIMIT_SEC = 90 * 60;

/** Sekundy doby pomiaru, z przesunięciem o północ jak w reszcie vehiclePosition. */
function shiftedSecOfDay(ms: number, leg: Leg): number {
  const clock = legClock(leg);
  let sec = nowSecOfDay(new Date(ms));
  if (clock?.crossesMidnight && sec < clock.from - 3600) sec += 86400;
  return sec;
}

/**
 * Plan stacji w sekundach doby: przyjazd, a dla stacji wsiadania odjazd
 * (opóźnienie odjazdu liczymy dopiero po planowym odjeździe). Null = brak rozkładu.
 */
function stationSchedSec(stops: LegStop[], leg: Leg, index: number, windowStart: number): number | null {
  const stop = stops[index];
  const clock = legClock(leg);
  if (!stop || !clock) return null;
  const raw =
    index === windowStart ? (stop.departSec ?? stop.arriveSec) : (stop.arriveSec ?? stop.departSec);
  if (raw == null) return null;
  return clock.crossesMidnight && raw < clock.from ? raw + 86400 : raw;
}

/** Plan krawędzi odcinka (odjazd/ przyjazd stacji) w sekundach doby. */
function gapEdgeSec(
  stops: LegStop[],
  leg: Leg,
  index: number,
  use: 'depart' | 'arrive',
): number | null {
  const stop = stops[index];
  const clock = legClock(leg);
  if (!stop || !clock) return null;
  const raw = use === 'depart' ? (stop.departSec ?? stop.arriveSec) : (stop.arriveSec ?? stop.departSec);
  if (raw == null) return null;
  return clock.crossesMidnight && raw < clock.from ? raw + 86400 : raw;
}

/**
 * Estymator zaliczonych stacji. Czasy przejazdów żyją przez całą nogę
 * podróży; reset następuje przy zmianie odcinka albo końcu śledzenia.
 *
 * `track` (oś toru z trainTrack.ts) pozwala liczyć opóźnienie także
 * między stacjami: bez niego zamierało na wartości z ostatniego
 * przejazdu stacji, a pociąg potrafi zgubić kwadrans na jednym odcinku.
 */
export class OnboardEstimator {
  private legId: string | null = null;
  /** stopIndex → czas pierwszego pomiaru w promieniu stacji (przyjazd). */
  private crossings = new Map<number, number>();

  reset(): void {
    this.legId = null;
    this.crossings.clear();
  }

  observe(
    leg: Leg,
    stops: LegStop[],
    fix: OnboardFix,
    nowMs: number,
    track: TrainTrack | null = null,
  ): OnboardEstimate | null {
    if (leg.id !== this.legId) {
      this.legId = leg.id;
      this.crossings.clear();
    }
    if (stops.length < 2) return null;
    if (fix.accuracy != null && fix.accuracy > 50) return null;
    const age = nowMs - fix.timestamp;
    if (age < -5_000 || age > MAX_FIX_AGE_MS) return null;
    if (fix.speed != null && fix.speed > 60) return null;
    if (!withinTrainLegWindow(leg, nowMs)) return null;

    const window = findUserSegment(stops, leg);
    const station = nearestStationIndex(stops, window, fix.lat, fix.lon, TRAIN_STATION_RADIUS_M);
    if (station && !this.crossings.has(station.index)) {
      const sched = stationSchedSec(stops, leg, station.index, window.start);
      const cross = shiftedSecOfDay(fix.timestamp, leg);
      if (sched != null) {
        // Okno wiarygodności odsiewa pomiary z autobusu obok toru: pociąg
        // nie mija stacji godzinę przed planem ani 1,5 h po nim. Stacja
        // wsiadania liczy się dopiero po planowym odjeździe - przed nim
        // opóźnienia jeszcze nie znamy.
        const from = station.index === window.start ? sched : sched - EARLY_LIMIT_SEC;
        if (cross >= from && cross <= sched + LATE_LIMIT_SEC) {
          this.crossings.set(station.index, fix.timestamp);
        }
      }
    }

    // Ostatnia zaliczona stacja to najwyższy zapisany przejazd w oknie.
    let lastCrossed = -1;
    for (const index of this.crossings.keys()) {
      if (index >= window.start && index <= window.end && index > lastCrossed) lastCrossed = index;
    }

    let delaySec: number | null = null;
    let measuredAtMs = fix.timestamp;
    if (lastCrossed >= 0) {
      const crossMs = this.crossings.get(lastCrossed)!;
      const sched = stationSchedSec(stops, leg, lastCrossed, window.start);
      const cross = shiftedSecOfDay(crossMs, leg);
      if (sched != null) {
        delaySec = Math.max(-MAX_DELAY_SEC, Math.min(MAX_DELAY_SEC, cross - sched));
        measuredAtMs = crossMs;
      }
    }

    // Między stacjami opóźnienie interpolujemy z osi toru: pomiar mówi,
    // w którym miejscu odcinka jest pociąg, plan mówi, kiedy powinien tam
    // być. Przy samej stacji (okno 350 m) interpolacja milczy: przejazd
    // mierzy opóźnienie przyjazdu, a interpolacja liczyłaby czas od
    // planowego odjazdu, więc na peronie zaniżała lub ujemniła wynik.
    // Szum cofający pomiar przed ostatnio zaliczoną stację odrzucamy,
    // pociąg nie cofa się w trasie.
    const match =
      station == null && track
        ? matchOnTrack(track, window, fix.lat, fix.lon, TRAIN_TRACK_CORRIDOR_M)
        : null;
    if (match && (lastCrossed < 0 || match.gap >= lastCrossed)) {
      const dep = gapEdgeSec(stops, leg, match.gap, 'depart');
      const arr = gapEdgeSec(stops, leg, match.gap + 1, 'arrive');
      if (dep != null && arr != null && arr > dep) {
        const cross = shiftedSecOfDay(fix.timestamp, leg);
        // Okno wiarygodności jak dla przejazdów stacji; odcinek wsiadania
        // liczy się dopiero od planowego odjazdu.
        const from = match.gap === window.start ? dep : dep - EARLY_LIMIT_SEC;
        if (cross >= from && cross <= arr + LATE_LIMIT_SEC) {
          const expected = dep + match.progress * (arr - dep);
          delaySec = Math.max(-MAX_DELAY_SEC, Math.min(MAX_DELAY_SEC, cross - expected));
          measuredAtMs = fix.timestamp;
        }
      }
    }

    return { legId: leg.id, delaySec, measuredAtMs, fix };
  }
}

/**
 * Ostatnia estymacja dla UI (mapa pokazuje pozycję zamiast nieświeżego
 * pojazdu z feedu). Publikuje tripMonitor; konsument pilnuje świeżości
 * po `fix.timestamp`.
 */
let latest: OnboardEstimate | null = null;

export function publishOnboardEstimate(estimate: OnboardEstimate | null): void {
  latest = estimate;
}

export function getOnboardEstimate(): OnboardEstimate | null {
  return latest;
}

/** Stops nogi do estymacji: pełna sekwencja kursu, awaryjnie same końce. */
export function onboardStops(leg: Leg): LegStop[] {
  return buildFallbackStops(leg);
}
