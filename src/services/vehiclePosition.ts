import type { Leg, LegStop, VehiclePosition } from '../types/models';

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

/** Gdzie jest pojazd: GPS (current/next stop lub coords) albo estymacja czasowa. */
export function locateVehicle(
  stops: LegStop[],
  leg: Leg,
  vehicle: VehiclePosition | null,
  now: Date = new Date(),
): VehicleGap {
  const n = stops.length;
  if (n < 2) return { gap: -1, isLive: false, label: 'Brak danych o trasie' };

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
        label: `Pojazd: ${stops[curIdx].name} → ${stops[nxtIdx].name} • live`,
      };
    }
    if (nxtIdx > 0) {
      return {
        gap: Math.min(n - 2, Math.max(0, nxtIdx - 1)),
        isLive: true,
        label: `Pojazd: przed ${stops[nxtIdx].name} • live`,
      };
    }
    if (curIdx >= 0) {
      return {
        gap: Math.min(n - 2, curIdx),
        isLive: true,
        label: `Pojazd: ${stops[curIdx].name} • live`,
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
        return { gap, isLive: true, label: `Pojazd: okolice ${stops[best].name} • live` };
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
      label: `Pozycja szacowana: ${stops[0].name} → ${stops[n - 1].name}`,
    };
  }
  const t = nowSecOfDay(now);
  if (t < depSec) {
    return { gap: -1, isLive: false, label: `Przed odjazdem (${leg.departAt}) • pozycja szacowana` };
  }
  if (t > arrSec) {
    return { gap: -2, isLive: false, label: 'Kurs zakończony • pozycja szacowana' };
  }
  const progress = (t - depSec) / (arrSec - depSec);
  const floatIdx = progress * (n - 1);
  const gap = Math.min(n - 2, Math.max(0, Math.floor(floatIdx)));
  return {
    gap,
    isLive: false,
    label: `Pojazd (szac.): ${stops[gap].name} → ${stops[gap + 1].name}`,
  };
}
