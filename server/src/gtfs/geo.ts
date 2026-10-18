const EARTH_RADIUS_METERS = 6371000;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Haversine formula to compute distance in meters between two lat/lon coordinates */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/** Initial compass bearing in degrees (0..360) from point 1 to point 2 */
export function bearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const lambda = toRadians(lon2 - lon1);
  const y = Math.sin(lambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda);
  const theta = Math.atan2(y, x);
  return (toDegrees(theta) + 360) % 360;
}

/** Normalize Polish text by stripping diacritics and converting to lowercase */
export function normalizePolish(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .trim();
}

/** Parse "HH:MM:SS" or "HH:MM" into seconds from midnight (handles >24h GTFS times) */
export function timeStringToSeconds(timeStr: string): number {
  const parts = timeStr.trim().split(':');
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  const s = Number(parts[2]) || 0;
  return h * 3600 + m * 60 + s;
}

/** Format seconds from midnight into "HH:MM" */
export function secondsToTimeString(totalSec: number): string {
  let sec = totalSec % 86400;
  if (sec < 0) sec += 86400;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface WarsawClock {
  /** sekundy od północy w strefie Europe/Warsaw */
  sec: number;
  /** 0 = niedziela ... 6 = sobota */
  weekday: number;
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

// Rozkład GTFS jest w czasie Wrocławia, a serwer bywa w UTC. Liczymy dobę
// i dzień tygodnia jawnie w Europe/Warsaw, żeby nie zależeć od TZ procesu.
const WARSAW_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});
const WARSAW_WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function warsawNow(date: Date = new Date()): WarsawClock {
  const parts = WARSAW_FMT.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const hour = Number(get('hour')) % 24;
  return {
    sec: hour * 3600 + Number(get('minute')) * 60 + Number(get('second')),
    weekday: WARSAW_WEEKDAYS[get('weekday')] ?? 0,
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  };
}

/** YYYYMMDD z obiektu daty opartego na UTC (patrz Date.UTC + offset dni). */
export function utcDateStr(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** Project a point onto a polyline of {lat, lon} coordinates */
export function projectPointToPolyline(
  lat: number,
  lon: number,
  polyline: { lat: number; lon: number }[]
): {
  distanceMeters: number;
  closestLat: number;
  closestLon: number;
  segmentIndex: number;
  fractionAlongShape: number;
} {
  if (polyline.length === 0) {
    return {
      distanceMeters: Infinity,
      closestLat: lat,
      closestLon: lon,
      segmentIndex: -1,
      fractionAlongShape: 0,
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
    };
  }

  let minDistance = Infinity;
  let bestLat = polyline[0].lat;
  let bestLon = polyline[0].lon;
  let bestSegment = 0;
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
  };
}
