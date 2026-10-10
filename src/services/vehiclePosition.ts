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
  /** Przerwa między stops[gap] a stops[gap + 1]. */
  gap: number;
  source: 'vehicle' | 'device';
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

function adjacentStopGap(stops: LegStop[], currentName?: string, nextName?: string): number {
  if (!currentName || !nextName) return -1;
  const current = normalizeName(currentName);
  const next = normalizeName(nextName);
  for (let i = 0; i < stops.length - 1; i++) {
    if (normalizeName(stops[i].name) === current && normalizeName(stops[i + 1].name) === next) {
      return i;
    }
  }
  return -1;
}

/**
 * Pozycja do rozwijanej osi przystanków. API wygrywa, gdy pojazd jest świeży
 * i przypisany do tego kursu. GPS telefonu koryguje brak feedu tylko wtedy,
 * gdy fix jest dokładny, świeży, wskazuje jazdę i leży na odcinku tej nogi.
 */
export function locateLiveStopPosition(
  stops: LegStop[],
  leg: Leg,
  vehicle: VehiclePosition | null,
  location: CurrentLocation | null,
  now = Date.now(),
): LiveStopPosition | null {
  if (stops.length < 2 || (leg.mode !== 'tram' && leg.mode !== 'bus')) return null;

  if (vehicle && now - vehicle.updatedAt >= 0 && now - vehicle.updatedAt <= 120_000) {
    const namedGap = adjacentStopGap(stops, vehicle.currentStopName, vehicle.nextStopName);
    if (namedGap >= 0) return { gap: namedGap, source: 'vehicle' };

    const projection = projectToStops(stops, vehicle.lat, vehicle.lon);
    if (projection && projection.distanceM <= 120) {
      return { gap: projection.gap, source: 'vehicle' };
    }
  }

  if (!location || location.accuracy == null || location.accuracy > 25) return null;
  if (now - location.timestamp < 0 || now - location.timestamp > 15_000) return null;
  if (location.speed == null || location.speed < 2.2 || location.speed > 25) return null;

  const { start, end } = findUserSegment(stops, leg);
  if (end <= start) return null;
  const departure = parseHMtoSec(leg.departAt);
  const arrival = parseHMtoSec(leg.arriveAt);
  if (departure == null || arrival == null || arrival <= departure) return null;
  const current = nowSecOfDay(new Date(now));
  if (current < departure - 180 || current > arrival + 180) return null;

  const projection = projectToStops(stops, location.lat, location.lon, start, end);
  if (!projection || projection.distanceM > Math.max(18, location.accuracy + 5)) return null;
  if (location.heading != null && location.speed >= 3.5) {
    const from = stops[projection.gap];
    const to = stops[projection.gap + 1];
    if (from.lat != null && from.lon != null && to.lat != null && to.lon != null) {
      const routeHeading = bearingDegrees(from.lat, from.lon, to.lat, to.lon);
      const headingDifference = Math.abs(((location.heading - routeHeading + 540) % 360) - 180);
      if (headingDifference > 65) return null;
    }
  }
  return { gap: projection.gap, source: 'device' };
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
