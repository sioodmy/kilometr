// `../i18n/locale`, nie `../i18n`: ten plik to czysta logika używana też przez
// skrypty testowe, a barrel i18n importuje `expo-localization`.
import { tr } from '../i18n/locale';
import type { Leg, LegStop, VehiclePosition } from '../types/models';
import { bearingDegrees, distanceMeters, projectPointToPolyline } from '../gtfs/geo';
import type { CurrentLocation } from './currentLocation';
import { isFareBoundary } from '../gtfs/fareBoundary';

// Czysta logika „gdzie jest pojazd”. Wydzielona z komponentu LegTimeline,
// bo zależy jej zarówno oś czasu na ekranie, jak i silnik powiadomień –
// serwis nie powinien importować komponentu (i nie da się go wtedy
// przetestować bez react-native).

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const STOP_PROXIMITY_METERS = 65;
/** Promień, w którym uznajemy telefon za stojący przy stacji kolejowej. */
export const TRAIN_STATION_RADIUS_M = 350;

export function normalizeName(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/ł/g, 'l')
    .trim();
}

/** '14:02' → sekundy od północy. */
function parseHMtoSec(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm || '');
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

interface LegClock {
  from: number;
  to: number;
  crossesMidnight: boolean;
}

/** Okno nogi w sekundach; koniec po północy dostaje +86400. */
export function legClock(leg: Leg): LegClock | null {
  const from = parseHMtoSec(leg.departAt);
  const to = parseHMtoSec(leg.arriveAt);
  if (from == null || to == null) return null;
  const crossesMidnight = to <= from;
  return { from, to: crossesMidnight ? to + 86400 : to, crossesMidnight };
}

export function nowSecOfDay(d: Date = new Date()): number {
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/**
 * Awaryjna lista gdy backend nie zwrócił sekwencji i nie da się jej dociągnąć.
 * Uczciwa: tylko znane końce odcinka (zero wymyślonych przystanków po drodze).
 */
export function buildFallbackStops(leg: Leg): LegStop[] {
  if (leg.intermediateStops && leg.intermediateStops.length >= 2) {
    return leg.intermediateStops;
  }
  const depSec = parseHMtoSec(leg.departAt);
  const arrSec = parseHMtoSec(leg.arriveAt);
  const mk = (first: boolean): LegStop => ({
    stopId: first
      ? leg.fromStopId || `fallback-${leg.id}-from`
      : leg.toStopId || `fallback-${leg.id}-to`,
    name: first ? leg.fromStop : leg.toStop,
    lat: first ? leg.fromLat : leg.toLat,
    lon: first ? leg.fromLon : leg.toLon,
    seq: first ? 1 : 2,
    arriveSec: first ? (depSec ?? undefined) : (arrSec ?? undefined),
    departSec: first ? (depSec ?? undefined) : (arrSec ?? undefined),
  });
  return [mk(true), mk(false)];
}

/** Nasz odcinek (wsiadanie→wysiadanie) jako indeksy w pełnej liście kursu. */
export function findUserSegment(stops: LegStop[], leg: Leg): { start: number; end: number } {
  if (stops.length === 0) return { start: 0, end: 0 };
  let start = -1;
  let end = -1;
  if (leg.fromStopId) start = stops.findIndex((s) => s.stopId === leg.fromStopId);
  if (leg.toStopId) end = stops.findIndex((s) => s.stopId === leg.toStopId);
  if (start < 0) {
    const n = normalizeName(leg.fromStop);
    start = stops.findIndex((s) => normalizeName(s.name) === n);
  }
  if (end < 0) {
    const n = normalizeName(leg.toStop);
    // ostatni match - nazwy przystanków potrafią się powtarzać na linii
    for (let i = stops.length - 1; i >= 0; i--) {
      if (normalizeName(stops[i].name) === n) {
        end = i;
        break;
      }
    }
  }
  // Fallback: syntetyczna lista = w całości nasz odcinek
  if (start < 0) start = 0;
  if (end < 0) end = stops.length - 1;
  if (end < start) end = start;
  return { start, end };
}

export interface VehicleGap {
  /** indeks przerwy między stops[gap] a stops[gap+1]; -1 = przed odjazdem, -2 = po przyjeździe */
  gap: number;
  isLive: boolean;
  label: string;
}

type MarkerPlacement = 'at_stop' | 'between';

interface StopTimelineMarker {
  index: number;
  placement: MarkerPlacement;
}

export interface LiveStopPosition {
  /**
   * Przerwa, na której stoi pojazd: gap i oznacza "między stops[i] a
   * stops[i + 1]". Wartości spoza [0, n - 2] są dozwolone i opisują pozycję
   * przed pierwszym albo za ostatnim przystankiem listy (np. -1 = tramwaj jeszcze
   * nie dotarł do początku listy).
   */
  gap: number;
  source: 'vehicle' | 'device' | 'estimate';
  /**
   * Indeks przystanku w tablicy stops, na którym pojazd aktualnie stoi (lub null jeśli jest w trasie).
   */
  atStopIndex: number | null;
  /**
   * Najwyższy indeks przystanku w tablicy stops, który został już zaliczony (przejechany dalej).
   * Przystanek index jest zaliczony wtedy i tylko wtedy, gdy index <= passedStopIndex.
   * Gdy pojazd stoi na przystanku i, passedStopIndex to i - 1 (przystanek i NIE jest jeszcze zaliczony).
   * Wartość -1 oznacza, że żaden przystanek nie został jeszcze zaliczony.
   */
  passedStopIndex: number;
  /**
   * Pozycja markera pojazdu w osi czasu:
   * - index: indeks przystanku
   * - placement: 'at_stop' (wycentrowany na kropce przystanku) lub 'between' (na linii poniżej przystanku)
   * - null jeśli pojazd jest poza widocznym wycinkiem
   */
  marker: StopTimelineMarker | null;
}

interface StopProjection {
  gap: number;
  distanceM: number;
}

function projectToStops(
  stops: LegStop[],
  lat: number,
  lon: number,
  start = 0,
  end = stops.length - 1,
): StopProjection | null {
  let best: StopProjection | null = null;
  for (let i = Math.max(0, start); i < Math.min(stops.length - 1, end); i++) {
    const from = stops[i];
    const to = stops[i + 1];
    if (from.lat == null || from.lon == null || to.lat == null || to.lon == null) continue;
    const projection = projectPointToPolyline(
      lat,
      lon,
      [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
    );
    if (!best || projection.distanceMeters < best.distanceM) {
      best = {
        gap: i,
        distanceM: projection.distanceMeters,
      };
    }
  }
  return best;
}

/**
 * Para „bieżący → następny” z matchera. Na liniach z pętlą ta sama para nazw
 * potrafi wystąpić dwa razy, więc przy kilku kandydatach wygrywa ten bliższy
 * współrzędnym pojazdu.
 */
function adjacentStopGap(
  stops: LegStop[],
  currentName: string | undefined,
  nextName: string | undefined,
  lat: number,
  lon: number,
): number {
  if (!currentName || !nextName) return -1;
  const current = normalizeName(currentName);
  const next = normalizeName(nextName);
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < stops.length - 1; i++) {
    if (normalizeName(stops[i].name) !== current || normalizeName(stops[i + 1].name) !== next) continue;
    const projection = projectToStops(stops, lat, lon, i, i + 1);
    const distance = projection?.distanceM ?? Number.MAX_VALUE;
    if (best < 0 || distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/** Czas odjazdu z przystanku według rozkładu (GTFS potrafi przekraczać 24:00). */
function stopTimeSec(stop: LegStop): number | undefined {
  return stop.departSec ?? stop.arriveSec;
}

/**
 * Szacunek z rozkładu całego kursu: pojazd jest za ostatnim przystankiem,
 * którego odjazd już minął. Przesunięcie o różnicę między efektywnym odjazdem
 * nogi (z opóźnieniem) a rozkładowym odjazdem z przystanku wsiadania.
 */
function estimateGapFromStopTimes(stops: LegStop[], leg: Leg, window: LegWindow, now: number): number | null {
  const raw = stops.map(stopTimeSec);
  if (raw.some((t) => t == null)) return null;
  const clock = legClock(leg);
  const shiftFrom = clock?.crossesMidnight ? clock.from : null;
  const times = raw.map((t) => (shiftFrom != null && t! < shiftFrom ? t! + 86400 : t!));
  const boardingDeparture = parseHMtoSec(leg.departAt);
  const scheduledBoarding = times[window.start]!;
  let offset = 0;
  if (boardingDeparture != null) {
    const diff = ((boardingDeparture - (scheduledBoarding % 86400) + 129600) % 86400) - 43200;
    if (Math.abs(diff) <= 1800) offset = diff;
  }
  let current = nowSecOfDay(new Date(now));
  if (shiftFrom != null ? current < shiftFrom - 3600 : times[0]! >= 86400 && current < 43200) {
    current += 86400;
  }
  const first = times[0]! + offset;
  const boarding = scheduledBoarding + offset;
  const last = times[times.length - 1]! + offset;
  if (current < boarding - 3600 || current > last + 600) return null;
  if (current < first) return -1;
  let gap = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i]! + offset <= current) gap = i;
  }
  return gap;
}

interface LegWindow {
  start: number;
  end: number;
}

/**
 * Ostatni fallback: postęp kursu policzony z samego rozkładu. Świadomie
 * niekorzystamy z czasów przystanków z bazy (albo ich braku), bo dla
 * szacunku wystarczy liniowy postęp pomiędzy odjazdem a przyjazdem.
 *
 * Poza oknem +/- około godziny wokół odjazdu nie zwracamy nic: przystanek
 * odjeżdżający za trzy godziny nie ma „pozycji pojazdu" i nie zasługuje na
 * ikonę, która sugerowałaby, że tramwaj już jest w drodze.
 */
function estimateGap(leg: Leg, window: LegWindow, now: number): number | null {
  const clock = legClock(leg);
  if (!clock) return null;
  let current = nowSecOfDay(new Date(now));
  if (clock.crossesMidnight && current < clock.from - 3600) current += 86400;
  if (current < clock.from - 3600 || current > clock.to + 600) return null;
  if (current < clock.from) return window.start - 1;
  if (current > clock.to) return window.end;
  const progress = (current - clock.from) / (clock.to - clock.from);
  const floatIdx = window.start + progress * (window.end - window.start);
  return Math.min(window.end, Math.max(window.start, Math.floor(floatIdx)));
}

/**
 * Najbliższa stacja naszego odcinka w zadanym promieniu. Pociągi dopasowujemy
 * po stacjach, nie po liniach między nimi: między stacjami są kilometry toru,
 * a prosta między słupkami nie ma z przebiegiem toru nic wspólnego.
 */
export function nearestStationIndex(
  stops: LegStop[],
  window: { start: number; end: number },
  lat: number,
  lon: number,
  maxDistanceM: number,
): { index: number; distanceM: number } | null {
  let best: { index: number; distanceM: number } | null = null;
  for (let i = window.start; i <= window.end; i++) {
    const stop = stops[i];
    if (!stop || stop.lat == null || stop.lon == null) continue;
    const d = distanceMeters(lat, lon, stop.lat, stop.lon);
    if (d <= maxDistanceM && (!best || d < best.distanceM)) best = { index: i, distanceM: d };
  }
  return best;
}

/**
 * Czy telefon pasażera już jedzie tym pojazdem: pomiar dokładny i świeży,
 * prędkość jazdy, pozycja w korytarzu naszego odcinka i kierunek zgodny
 * z trasą. Okno czasu ma zapas na opóźnienie, żeby pasażer w spóźnionym
 * tramwaju nie wypadał z własnej nogi.
 */
function ridingDeviceGap(
  stops: LegStop[],
  leg: Leg,
  window: LegWindow,
  location: CurrentLocation | null,
  now: number,
): DeviceRide | null {
  if (leg.mode === 'train') return ridingTrainGap(stops, leg, window, location, now);
  if (!location || location.accuracy == null || location.accuracy > 25) return null;
  if (window.end <= window.start) return null;
  const age = now - location.timestamp;
  if (age < 0 || age > 15_000) return null;
  if (location.speed == null || location.speed < 2.2 || location.speed > 25) return null;

  const departure = parseHMtoSec(leg.departAt);
  const arrival = parseHMtoSec(leg.arriveAt);
  const current = nowSecOfDay(new Date(now));
  const withinLeg =
    departure != null && arrival != null && arrival > departure
      ? current >= departure - 180 && current <= arrival + 600
      : true;
  if (!withinLeg) return null;

  const projection = projectToStops(stops, location.lat, location.lon, window.start, window.end);
  if (!projection) return null;
  // Prosta między słupkami ucieka od torowiska na łukach ulicy, więc dawny
  // próg 18 m odrzucał niemal każdy pomiar w jadącym tramwaju. Korytarz jak
  // dla współrzędnych pojazdu z API.
  if (projection.distanceM > 120) return null;
  if (!headingMatchesRoute(stops, projection.gap, location.heading, location.speed)) return null;
  return { gap: projection.gap, atStopIndex: null };
}

/**
 * Pociąg z GPS telefonu: dopasowanie tylko przy stacjach, gdzie pomiar jest
 * jednoznaczny. Między stacjami nie zwracamy nic - pozycję prowadzi szacunek
 * z rozkładu, a monotoniczny ranking nie pozwoli mu cofnąć się przed stację,
 * którą pasażer już zaliczył. Okno nogi ma luz na opóźnienie: pociąg
 * spóźniony o kwadrans wciąż jest naszą nogą.
 */
function ridingTrainGap(
  stops: LegStop[],
  leg: Leg,
  window: LegWindow,
  location: CurrentLocation | null,
  now: number,
): DeviceRide | null {
  if (!location || location.accuracy == null || location.accuracy > 50) return null;
  const age = now - location.timestamp;
  if (age < 0 || age > 30_000) return null;
  if (location.speed != null && location.speed > 60) return null;
  if (!withinTrainLegWindow(leg, now)) return null;

  const station = nearestStationIndex(
    stops,
    window,
    location.lat,
    location.lon,
    TRAIN_STATION_RADIUS_M,
  );
  if (!station) return null;
  return { gap: Math.min(window.end - 1, Math.max(window.start, station.index - 1)), atStopIndex: station.index };
}

/** Okno nogi z luzem: 5 min przed odjazdem i 45 min po planowanym przyjeździe. */
export function withinTrainLegWindow(leg: Leg, now: number): boolean {
  const clock = legClock(leg);
  if (!clock) return false;
  let current = nowSecOfDay(new Date(now));
  if (clock.crossesMidnight && current < clock.from - 3600) current += 86400;
  return current >= clock.from - 300 && current <= clock.to + 2700;
}

interface DeviceRide {
  gap: number;
  /** Pociąg stoi przy stacji o tym indeksie (dopasowanie po promieniu stacji). */
  atStopIndex: number | null;
}

interface RawVehicleState {
  stopIndex: number;
  phase: 'at_stop' | 'departed';
  source: 'vehicle' | 'device' | 'estimate';
}

function computeRawVehiclePosition(
  stops: LegStop[],
  leg: Leg,
  window: LegWindow,
  vehicle: VehiclePosition | null,
  location: CurrentLocation | null,
  now: number,
): RawVehicleState | null {
  // 1. GPS telefonu pasażera jadącego pojazdem
  const riding = ridingDeviceGap(stops, leg, window, location, now);
  if (riding != null && location != null) {
    if (riding.atStopIndex != null) {
      return { stopIndex: riding.atStopIndex, phase: 'at_stop', source: 'device' };
    }
    const fromStop = stops[riding.gap];
    const toStop = stops[riding.gap + 1];
    if (
      fromStop?.lat != null &&
      fromStop?.lon != null &&
      distanceMeters(location.lat, location.lon, fromStop.lat, fromStop.lon) <= STOP_PROXIMITY_METERS
    ) {
      return { stopIndex: riding.gap, phase: 'at_stop', source: 'device' };
    }
    if (
      toStop?.lat != null &&
      toStop?.lon != null &&
      distanceMeters(location.lat, location.lon, toStop.lat, toStop.lon) <= STOP_PROXIMITY_METERS
    ) {
      return { stopIndex: riding.gap + 1, phase: 'at_stop', source: 'device' };
    }
    return { stopIndex: riding.gap, phase: 'departed', source: 'device' };
  }

  // 2. Pozycja pojazdu z API (MPK / zbiorkom)
  if (vehicle && now - vehicle.updatedAt >= 0 && now - vehicle.updatedAt <= 120_000) {
    const namedGap = adjacentStopGap(
      stops,
      vehicle.currentStopName,
      vehicle.nextStopName,
      vehicle.lat,
      vehicle.lon,
    );
    const hasCoords = vehicle.lat != null && vehicle.lon != null;

    if (namedGap >= 0) {
      if (hasCoords) {
        const fromStop = stops[namedGap];
        const toStop = stops[namedGap + 1];
        if (
          fromStop?.lat != null &&
          fromStop?.lon != null &&
          distanceMeters(vehicle.lat, vehicle.lon, fromStop.lat, fromStop.lon) <= STOP_PROXIMITY_METERS
        ) {
          return { stopIndex: namedGap, phase: 'at_stop', source: 'vehicle' };
        }
        if (
          toStop?.lat != null &&
          toStop?.lon != null &&
          distanceMeters(vehicle.lat, vehicle.lon, toStop.lat, toStop.lon) <= STOP_PROXIMITY_METERS
        ) {
          return { stopIndex: namedGap + 1, phase: 'at_stop', source: 'vehicle' };
        }
      }
      return { stopIndex: namedGap, phase: 'departed', source: 'vehicle' };
    }

    if (hasCoords) {
      let nearestIdx = -1;
      let minDistance = Infinity;
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i];
        if (s.lat == null || s.lon == null || isFareBoundary(s.name)) continue;
        const d = distanceMeters(vehicle.lat, vehicle.lon, s.lat, s.lon);
        if (d < minDistance) {
          minDistance = d;
          nearestIdx = i;
        }
      }
      if (nearestIdx >= 0 && minDistance <= STOP_PROXIMITY_METERS) {
        return { stopIndex: nearestIdx, phase: 'at_stop', source: 'vehicle' };
      }

      const projection = projectToStops(stops, vehicle.lat, vehicle.lon);
      if (projection && projection.distanceM <= 120) {
        const fromStop = stops[projection.gap];
        const toStop = stops[projection.gap + 1];
        if (
          fromStop?.lat != null &&
          fromStop?.lon != null &&
          distanceMeters(vehicle.lat, vehicle.lon, fromStop.lat, fromStop.lon) <= STOP_PROXIMITY_METERS
        ) {
          return { stopIndex: projection.gap, phase: 'at_stop', source: 'vehicle' };
        }
        if (
          toStop?.lat != null &&
          toStop?.lon != null &&
          distanceMeters(vehicle.lat, vehicle.lon, toStop.lat, toStop.lon) <= STOP_PROXIMITY_METERS
        ) {
          return { stopIndex: projection.gap + 1, phase: 'at_stop', source: 'vehicle' };
        }
        return { stopIndex: projection.gap, phase: 'departed', source: 'vehicle' };
      }
    }

    if (vehicle.currentStopName) {
      const curNorm = normalizeName(vehicle.currentStopName);
      const curIdx = stops.findIndex((s) => !isFareBoundary(s.name) && normalizeName(s.name) === curNorm);
      if (curIdx >= 0) {
        const isNext = vehicle.nextStopName && normalizeName(vehicle.nextStopName) !== curNorm;
        return {
          stopIndex: curIdx,
          phase: isNext ? 'departed' : 'at_stop',
          source: 'vehicle',
        };
      }
    }
  }

  // 3. Szacunek z rozkładu jazdy
  const hasStopTimes = stops.length > 2 && stops.every((stop) => stopTimeSec(stop) != null);
  const estimate = hasStopTimes
    ? estimateGapFromStopTimes(stops, leg, window, now)
    : estimateGap(leg, window, now);
  if (estimate == null) return null;

  if (estimate < 0) {
    return { stopIndex: -1, phase: 'at_stop', source: 'estimate' };
  }
  if (estimate >= stops.length - 1) {
    return { stopIndex: stops.length - 1, phase: 'at_stop', source: 'estimate' };
  }

  return { stopIndex: estimate, phase: 'departed', source: 'estimate' };
}

/**
 * Konwertuje pozycję na całkowity monotonny ranking postępu wzdłuż trasy:
 * - 2 * i     = pojazd stoi na przystanku i (przystanek i NIE jest jeszcze zaliczony)
 * - 2 * i + 1 = pojazd odjechał z przystanku i w stronę i + 1 (przystanek i JEST zaliczony)
 */
export function positionToRank(position: LiveStopPosition | null): number {
  if (!position) return -1;
  if (position.atStopIndex != null) {
    return position.atStopIndex * 2;
  }
  if (position.passedStopIndex >= 0) {
    return position.passedStopIndex * 2 + 1;
  }
  return -1;
}

/**
 * Rekonstruuje pełną pozycję LiveStopPosition na podstawie monotonnego rankingu.
 */
function rankToLivePosition(
  rank: number,
  stops: LegStop[],
  leg: Leg,
  source: 'vehicle' | 'device' | 'estimate' = 'vehicle',
): LiveStopPosition {
  const window = findUserSegment(stops, leg);
  if (rank < 0) {
    return {
      gap: -1,
      source,
      atStopIndex: null,
      passedStopIndex: -1,
      marker: null,
    };
  }
  const stopIndex = Math.floor(rank / 2);
  const isDeparted = rank % 2 === 1;
  const atStopIndex = isDeparted ? null : stopIndex;
  const passedStopIndex = isDeparted ? stopIndex : stopIndex - 1;

  let marker: StopTimelineMarker | null = null;
  if (isDeparted) {
    if (stopIndex >= window.start && stopIndex < window.end) {
      marker = { index: stopIndex, placement: 'between' };
    }
  } else {
    if (stopIndex >= window.start && stopIndex <= window.end) {
      marker = { index: stopIndex, placement: 'at_stop' };
    }
  }

  return {
    gap: stopIndex,
    source,
    atStopIndex,
    passedStopIndex,
    marker,
  };
}

/**
 * Pozycja do rozwijanej osi przystanków. Kolejność źródeł:
 *
 * 1. GPS telefonu pasażera, który już jedzie tym pojazdem: z wnętrza
 *    tramwaju nie da się znać jego pozycji lepiej, więc pasażer wygrywa
 *    z feedem (pomyłka matchera albo nieświeży odczyt pokazywały inną
 *    pozycję niż ta, w której pasażer faktycznie jedzie).
 * 2. API (MPK, awaryjnie zbiorkom.live), gdy pojazd jest świeży
 *    i przypisany do tego kursu.
 * 3. Szacunek z rozkładu.
 *
 * Opcjonalny parametr `prevRank`:
 * Gdy przekazany, wymusza ścisłą monotoniczność wzdłuż trasy (nigdy nie cofa
 * postępu, nie odznacza zaliczonych przystanków, ani nie powoduje znikania markera
 * przy chwilowym szumie GPS lub opuszczeniu pojedynczego zapytania API).
 * `prevSource` mówi, skąd wziął się poprzedni ranking: świeży pomiar live
 * zawsze prostuje szacunek zegarowy. Po pauzie w tle estymata potrafi
 * wystrzelić na koniec trasy i zablokować powrót markera na zawsze.
 */
export function locateLiveStopPosition(
  stops: LegStop[],
  leg: Leg,
  vehicle: VehiclePosition | null,
  location: CurrentLocation | null,
  now = Date.now(),
  prevRank?: number,
  prevSource?: LiveStopPosition['source'],
): LiveStopPosition | null {
  if (
    stops.length < 2 ||
    (leg.mode !== 'tram' && leg.mode !== 'bus' && leg.mode !== 'subway' && leg.mode !== 'train')
  ) {
    return null;
  }

  const window = findUserSegment(stops, leg);
  const raw = computeRawVehiclePosition(stops, leg, window, vehicle, location, now);

  let rawRank = -1;
  if (raw != null && raw.stopIndex >= 0) {
    rawRank = 2 * raw.stopIndex + (raw.phase === 'departed' ? 1 : 0);
  }

  // Wymuszenie monotoniczności, jeśli podano poprzedni ranking.
  // Świeży pomiar live prostuje szacunek zegarowy: po wznowieniu z tła
  // estymata leci na koniec trasy, a pojazd stoi w połowie. Bez tego
  // wyjątku marker już nigdy nie wracał na właściwe miejsce.
  if (prevRank != null && prevRank >= 0) {
    if (raw == null || rawRank < prevRank) {
      const liveFixesEstimate =
        raw != null && raw.source !== 'estimate' && prevSource === 'estimate';
      if (!liveFixesEstimate) {
        return rankToLivePosition(prevRank, stops, leg, raw?.source ?? prevSource ?? 'vehicle');
      }
    }
  }

  if (raw == null) return null;

  if (raw.stopIndex < 0) {
    return {
      gap: -1,
      source: raw.source,
      atStopIndex: null,
      passedStopIndex: -1,
      marker: null,
    };
  }

  const atStopIndex = raw.phase === 'at_stop' ? raw.stopIndex : null;
  // Przystanek jest zaliczony tylko jeśli pojazd z niego odjechał w trasę
  const passedStopIndex = raw.phase === 'departed' ? raw.stopIndex : raw.stopIndex - 1;

  let marker: StopTimelineMarker | null = null;
  if (raw.phase === 'at_stop') {
    if (raw.stopIndex >= window.start && raw.stopIndex <= window.end) {
      marker = { index: raw.stopIndex, placement: 'at_stop' };
    }
  } else {
    if (raw.stopIndex >= window.start && raw.stopIndex < window.end) {
      marker = { index: raw.stopIndex, placement: 'between' };
    }
  }

  return {
    gap: raw.stopIndex,
    source: raw.source,
    atStopIndex,
    passedStopIndex,
    marker,
  };
}

/** Kierunek jazdy musi zgadzać się z odcinkiem, o ile GPS w ogóle go podaje. */
function headingMatchesRoute(
  stops: LegStop[],
  gap: number,
  heading: number | null,
  speed: number | null,
): boolean {
  if (heading == null || speed == null || speed < 3.5) return true;
  const from = stops[gap];
  const to = stops[gap + 1];
  if (from.lat == null || from.lon == null || to.lat == null || to.lon == null) return true;
  const routeHeading = bearingDegrees(from.lat, from.lon, to.lat, to.lon);
  const difference = Math.abs(((heading - routeHeading + 540) % 360) - 180);
  return difference <= 65;
}

/** Gdzie jest pojazd: GPS (current/next stop lub coords) albo estymacja czasowa. */
export function locateVehicle(
  stops: LegStop[],
  leg: Leg,
  vehicle: VehiclePosition | null,
  now: Date = new Date(),
): VehicleGap {
  // Teksty idą do powiadomienia na ekranie blokady, więc muszą być z i18n.
  // Inaczej użytkownik w EN/DE/UK dostawał polską treść.
  const s = tr().vehiclePos;
  const n = stops.length;
  if (n < 2) return { gap: -1, isLive: false, label: s.noRoute };

  if (vehicle) {
    const cur = vehicle.currentStopName ? normalizeName(vehicle.currentStopName) : '';
    const nxt = vehicle.nextStopName ? normalizeName(vehicle.nextStopName) : '';
    // Najpierw dokładna nazwa, dopiero potem prefiks: "Dworzec" jest
    // prefiksem "Dworzec Główny" i findIndex bez preferencji trafiał
    // w przystanek, który pojazd minął kilka minut temu.
    const matchIndex = (name: string): number => {
      if (!name) return -1;
      const exact = stops.findIndex((s) => normalizeName(s.name) === name);
      if (exact >= 0) return exact;
      return stops.findIndex(
        (s) => normalizeName(s.name).includes(name) || name.includes(normalizeName(s.name)),
      );
    };
    const curIdx = matchIndex(cur);
    const nxtIdx = matchIndex(nxt);
    if (curIdx >= 0 && nxtIdx === curIdx + 1) {
      return {
        gap: curIdx,
        isLive: true,
        label: s.liveBetween(stops[curIdx].name, stops[nxtIdx].name),
      };
    }
    if (nxtIdx > 0) {
      return {
        gap: Math.min(n - 2, Math.max(0, nxtIdx - 1)),
        isLive: true,
        label: s.liveBefore(stops[nxtIdx].name),
      };
    }
    if (curIdx >= 0) {
      return {
        gap: Math.min(n - 2, curIdx),
        isLive: true,
        label: s.liveAt(stops[curIdx].name),
      };
    }
    // GPS coords: najbliższy przystanek, pojazd jedzie "do przodu" trasy
    if (vehicle.lat != null && vehicle.lon != null) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const s = stops[i];
        if (s.lat == null || s.lon == null) continue;
        const d = (s.lat - vehicle.lat) ** 2 + (s.lon - vehicle.lon) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (bestD < Infinity) {
        const gap = Math.min(n - 2, Math.max(0, best >= n - 1 ? n - 2 : best));
        return { gap, isLive: true, label: s.liveNear(stops[best].name) };
      }
    }
  }

  // Estymacja czasowa: postęp kursu względem "teraz"
  const depSec = parseHMtoSec(leg.departAt);
  const arrSec = parseHMtoSec(leg.arriveAt);
  if (depSec == null || arrSec == null || arrSec <= depSec) {
    return {
      gap: 0,
      isLive: false,
      label: s.estRoute(stops[0].name, stops[n - 1].name),
    };
  }
  const t = nowSecOfDay(now);
  if (t < depSec) {
    return { gap: -1, isLive: false, label: s.estBefore(leg.departAt) };
  }
  if (t > arrSec) {
    return { gap: -2, isLive: false, label: s.estDone };
  }
  const progress = (t - depSec) / (arrSec - depSec);
  const floatIdx = progress * (n - 1);
  const gap = Math.min(n - 2, Math.max(0, Math.floor(floatIdx)));
  return {
    gap,
    isLive: false,
    label: s.estBetween(stops[gap].name, stops[gap + 1].name),
  };
}

/**
 * Zwraca przystanek na trasie (stops), w pobliżu którego aktualnie znajduje się pojazd.
 * Wykorzystuje współrzędne GPS z feedu live (do 3 km od trasy) albo nazwy bieżącego/następnego przystanku.
 */
export function findNearestStopOnRoute(
  stops: LegStop[],
  vehicle: VehiclePosition | null,
): LegStop | null {
  if (!stops || stops.length === 0 || !vehicle) return null;

  // 1. Współrzędne GPS z pojazdu: szukamy najbliższego fizycznego przystanku na trasie
  if (vehicle.lat != null && vehicle.lon != null) {
    let best: LegStop | null = null;
    let minD = Infinity;

    for (const stop of stops) {
      if (stop.lat == null || stop.lon == null) continue;
      if (isFareBoundary(stop.name)) continue;
      const dLat = (stop.lat - vehicle.lat) * 111_139;
      const dLon = (stop.lon - vehicle.lon) * 111_139 * Math.cos((vehicle.lat * Math.PI) / 180);
      const dist = Math.hypot(dLat, dLon);
      if (dist < minD) {
        minD = dist;
        best = stop;
      }
    }

    if (best && minD <= 3000) {
      return best;
    }
  }

  // 2. Nazwa bieżącego lub następnego przystanku z API
  if (vehicle.currentStopName) {
    const curNorm = normalizeName(vehicle.currentStopName);
    const found = stops.find(
      (s) =>
        !isFareBoundary(s.name) &&
        (normalizeName(s.name) === curNorm ||
          normalizeName(s.name).includes(curNorm) ||
          curNorm.includes(normalizeName(s.name))),
    );
    if (found) return found;
  }

  if (vehicle.nextStopName) {
    const nextNorm = normalizeName(vehicle.nextStopName);
    const found = stops.find(
      (s) =>
        !isFareBoundary(s.name) &&
        (normalizeName(s.name) === nextNorm ||
          normalizeName(s.name).includes(nextNorm) ||
          nextNorm.includes(normalizeName(s.name))),
    );
    if (found) return found;
  }

  return null;
}
