// `../i18n/locale`, nie `../i18n`: ten plik to czysta logika używana też przez
// skrypty testowe, a barrel i18n importuje `expo-localization`.
import { tr } from '../i18n/locale';
import type { Leg, LegStop, VehiclePosition } from '../types/models';
import { bearingDegrees, projectPointToPolyline } from '../gtfs/geo';
import type { CurrentLocation } from './currentLocation';

// Czysta logika „gdzie jest pojazd". Wydzielona z komponentu LegTimeline,
// bo zależy jej zarówno oś czasu na ekranie, jak i silnik powiadomień —
// serwis nie powinien importować komponentu (i nie da się go wtedy
// przetestować bez react-native).

const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function normalizeName(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/ł/g, 'l')
    .trim();
}

/** '14:02' → sekundy od północy. */
export function parseHMtoSec(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm || '');
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
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
    // ostatni match — nazwy przystanków potrafią się powtarzać na linii
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

export interface LiveStopPosition {
  /**
   * Przerwa, na której stoi pojazd: gap i oznacza "między stops[i] a
   * stops[i + 1]". Wartości spoza [0, n - 2] są dozwolone i opisują pozycję
   * przed pierwszym albo za ostatnim przystankiem listy (np. -1 = tramwaj jeszcze
   * nie dotarł do początku listy).
   */
  gap: number;
  source: 'vehicle' | 'device' | 'estimate';
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
  const times = stops.map(stopTimeSec);
  if (times.some((t) => t == null)) return null;
  const boardingDeparture = parseHMtoSec(leg.departAt);
  const scheduledBoarding = times[window.start]!;
  let offset = 0;
  if (boardingDeparture != null) {
    const diff = ((boardingDeparture - (scheduledBoarding % 86400) + 129600) % 86400) - 43200;
    if (Math.abs(diff) <= 1800) offset = diff;
  }
  let current = nowSecOfDay(new Date(now));
  if (times[0]! >= 86400 && current < 43200) current += 86400;
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
  const departure = parseHMtoSec(leg.departAt);
  const arrival = parseHMtoSec(leg.arriveAt);
  if (departure == null || arrival == null || arrival <= departure) return null;
  const current = nowSecOfDay(new Date(now));
  if (current < departure - 3600 || current > arrival + 600) return null;
  if (current < departure) return window.start - 1;
  if (current > arrival) return window.end;
  const progress = (current - departure) / (arrival - departure);
  const floatIdx = window.start + progress * (window.end - window.start);
  return Math.min(window.end, Math.max(window.start, Math.floor(floatIdx)));
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
): number | null {
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
  return projection.gap;
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
 */
export function locateLiveStopPosition(
  stops: LegStop[],
  leg: Leg,
  vehicle: VehiclePosition | null,
  location: CurrentLocation | null,
  now = Date.now(),
): LiveStopPosition | null {
  if (
    stops.length < 2 ||
    (leg.mode !== 'tram' && leg.mode !== 'bus' && leg.mode !== 'subway')
  ) {
    return null;
  }

  const window = findUserSegment(stops, leg);

  const riding = ridingDeviceGap(stops, leg, window, location, now);
  if (riding != null) return { gap: riding, source: 'device' };

  if (vehicle && now - vehicle.updatedAt >= 0 && now - vehicle.updatedAt <= 120_000) {
    const namedGap = adjacentStopGap(
      stops,
      vehicle.currentStopName,
      vehicle.nextStopName,
      vehicle.lat,
      vehicle.lon,
    );
    if (namedGap >= 0) return { gap: namedGap, source: 'vehicle' };

    const projection = projectToStops(stops, vehicle.lat, vehicle.lon);
    if (projection && projection.distanceM <= 120) {
      return { gap: projection.gap, source: 'vehicle' };
    }
  }

  const hasStopTimes = stops.length > 2 && stops.every((stop) => stopTimeSec(stop) != null);
  const estimate = hasStopTimes
    ? estimateGapFromStopTimes(stops, leg, window, now)
    : estimateGap(leg, window, now);
  if (estimate == null) return null;
  return { gap: estimate, source: 'estimate' };
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
    const curIdx = cur
      ? stops.findIndex(
          (s) => normalizeName(s.name).includes(cur) || cur.includes(normalizeName(s.name)),
        )
      : -1;
    const nxtIdx = nxt
      ? stops.findIndex(
          (s) => normalizeName(s.name).includes(nxt) || nxt.includes(normalizeName(s.name)),
        )
      : -1;
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
