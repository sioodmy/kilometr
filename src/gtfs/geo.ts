// Czyste funkcje geo: bez zaleznosci natywnych, dzialaja w Hermes.
// Port server/src/gtfs/geo.ts.

const EARTH_RADIUS_METERS = 6371000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Haversine: dystans w metrach miedzy dwoma punktami lat/lon. */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Tanie przyblizenie equirect dla krotkich odcinkow (geometria trasy, manewry).
 * Dla dystansow rzedu kilometrow uzyj `distanceMeters`.
 */
export function shortDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLon = (lon2 - lon1) * 111320 * Math.cos(toRadians((lat1 + lat2) / 2));
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/** Poczatkowy azymut w stopniach (0..360) z punktu 1 do 2. */
export function bearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const lambda = toRadians(lon2 - lon1);
  const y = Math.sin(lambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda);
  const theta = Math.atan2(y, x);
  return (toDegrees(theta) + 360) % 360;
}

/** Normalizacja polskich znakow: minuskuly i bez diakrytykow. */
export function normalizePolish(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .trim();
}

/** Parsuje "HH:MM:SS" lub "HH:MM" na sekundy od polnocy (obsluguje >24h w GTFS). */
export function timeStringToSeconds(timeStr: string): number {
  const parts = timeStr.trim().split(':');
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  const s = Number(parts[2]) || 0;
  return h * 3600 + m * 60 + s;
}

/** Formatuje sekundy od polnocy do "HH:MM". */
export function secondsToTimeString(totalSec: number): string {
  let sec = totalSec % 86400;
  if (sec < 0) sec += 86400;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface WarsawDateTime {
  /** Sekundy od polnocy w strefie Europe/Warsaw. */
  sec: number;
  /** 0 = niedziela, 1 = poniedzialek, ..., 6 = sobota. */
  weekday: number;
  year: number;
  /** 1..12 */
  month: number;
  /** 1..31 */
  day: number;
  /** YYYYMMDD do zapytan w bazach GTFS. */
  dateStr: string;
  /** YYYY-MM-DD w formacie ISO. */
  isoDate: string;
}

const WARSAW_TZ = 'Europe/Warsaw';
const WARSAW_PARTS_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: WARSAW_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

const WARSAW_WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Zwraca biezacy lub podany czas w strefie Europe/Warsaw.
 * Rozklad jazdy w Polsce dziala scisle wedlug czasu warszawskiego.
 */
export function warsawNow(date: Date = new Date()): WarsawDateTime {
  const parts = WARSAW_PARTS_FMT.formatToParts(date);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let weekday = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.type === 'year') year = Number(p.value);
    else if (p.type === 'month') month = Number(p.value);
    else if (p.type === 'day') day = Number(p.value);
    else if (p.type === 'hour') hour = Number(p.value) % 24;
    else if (p.type === 'minute') minute = Number(p.value);
    else if (p.type === 'second') second = Number(p.value);
    else if (p.type === 'weekday') weekday = WARSAW_WEEKDAYS[p.value] ?? 0;
  }
  const dateStr = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return {
    sec: hour * 3600 + minute * 60 + second,
    weekday,
    year,
    month,
    day,
    dateStr,
    isoDate,
  };
}

/**
 * Przesuwa date o wskazana liczbe dni w strefie Europe/Warsaw.
 */
export function shiftWarsawDate(
  base: { year: number; month: number; day: number },
  dayShift: number,
): WarsawDateTime {
  const d = new Date(Date.UTC(base.year, base.month - 1, base.day + dayShift, 12, 0, 0));
  return warsawNow(d);
}

/** Rzutuje punkt na polyline {lat, lon} do dopasowania GPS do ksztaltu kursu. */
export function projectPointToPolyline(
  lat: number,
  lon: number,
  polyline: { lat: number; lon: number }[],
): {
  distanceMeters: number;
  closestLat: number;
  closestLon: number;
  segmentIndex: number;
  fractionAlongShape: number;
  /** Azymut trafionego odcinka (0 = północ); 0 dla polyline bez długości. */
  segmentHeading: number;
} {
  if (polyline.length === 0) {
    return {
      distanceMeters: Infinity,
      closestLat: lat,
      closestLon: lon,
      segmentIndex: -1,
      fractionAlongShape: 0,
      segmentHeading: 0,
    };
  }

  if (polyline.length === 1) {
    const d = distanceMeters(lat, lon, polyline[0].lat, polyline[0].lon);
    return {
      distanceMeters: d,
      closestLat: polyline[0].lat,
      closestLon: polyline[0].lon,
      segmentIndex: 0,
      fractionAlongShape: 0,
      segmentHeading: 0,
    };
  }

  let minDistance = Infinity;
  let bestLat = polyline[0].lat;
  let bestLon = polyline[0].lon;
  let bestSegment = 0;
  let bestHeading = 0;
  let cumulativeDistanceBeforeBest = 0;
  let totalPolylineDistance = 0;

  const segmentLengths: number[] = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = distanceMeters(polyline[i].lat, polyline[i].lon, polyline[i + 1].lat, polyline[i + 1].lon);
    segmentLengths.push(d);
    totalPolylineDistance += d;
  }

  let runningDistance = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const p1 = polyline[i];
    const p2 = polyline[i + 1];

    const x = toRadians(lon - p1.lon) * Math.cos(toRadians((p1.lat + p2.lat) / 2));
    const y = toRadians(lat - p1.lat);
    const dx = toRadians(p2.lon - p1.lon) * Math.cos(toRadians((p1.lat + p2.lat) / 2));
    const dy = toRadians(p2.lat - p1.lat);

    const segLenSq = dx * dx + dy * dy;
    let t = 0;
    if (segLenSq > 0) {
      t = Math.max(0, Math.min(1, (x * dx + y * dy) / segLenSq));
    }

    const projLat = p1.lat + t * (p2.lat - p1.lat);
    const projLon = p1.lon + t * (p2.lon - p1.lon);
    const dist = distanceMeters(lat, lon, projLat, projLon);

    if (dist < minDistance) {
      minDistance = dist;
      bestLat = projLat;
      bestLon = projLon;
      bestSegment = i;
      bestHeading = bearingDegrees(p1.lat, p1.lon, p2.lat, p2.lon);
      cumulativeDistanceBeforeBest = runningDistance + t * segmentLengths[i];
    }

    runningDistance += segmentLengths[i];
  }

  const fractionAlongShape = totalPolylineDistance > 0 ? cumulativeDistanceBeforeBest / totalPolylineDistance : 0;

  return {
    distanceMeters: minDistance,
    closestLat: bestLat,
    closestLon: bestLon,
    segmentIndex: bestSegment,
    fractionAlongShape,
    segmentHeading: bestHeading,
  };
}
