export type RoutePoint = [number, number];

export function encodePath(points: RoutePoint[]): string {
  let lat = 0;
  let lon = 0;
  let encoded = '';
  const append = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    while (value >= 32) {
      encoded += String.fromCharCode((32 | (value & 31)) + 63);
      value >>>= 5;
    }
    encoded += String.fromCharCode(value + 63);
  };
  for (const point of points) {
    const y = Math.round(point[0] * 1e5),
      x = Math.round(point[1] * 1e5);
    append(y - lat);
    append(x - lon);
    lat = y;
    lon = x;
  }
  return encoded;
}

export function decodePath(encoded: string): RoutePoint[] | null {
  if (!encoded || encoded.length > 24000) return null;
  const points: RoutePoint[] = [];
  let cursor = 0,
    lat = 0,
    lon = 0;
  const read = () => {
    let value = 0,
      shift = 0,
      part: number;
    do {
      if (cursor >= encoded.length || shift > 25) throw new Error('Invalid path');
      part = encoded.charCodeAt(cursor++) - 63;
      if (part < 0 || part > 63) throw new Error('Invalid path');
      value |= (part & 31) << shift;
      shift += 5;
    } while (part >= 32);
    return value & 1 ? ~(value >>> 1) : value >>> 1;
  };
  try {
    while (cursor < encoded.length) {
      lat += read();
      lon += read();
      if (Math.abs(lat) > 9e6 || Math.abs(lon) > 18e6 || points.length >= 5000) return null;
      points.push([lat / 1e5, lon / 1e5]);
    }
    return points.length >= 2 ? points : null;
  } catch {
    return null;
  }
}

/** Wycina przejazd z kierunkowej geometrii GTFS, bez łączenia końców prostą. */
export function clipPath(
  points: RoutePoint[],
  from: RoutePoint,
  to: RoutePoint,
): RoutePoint[] | null {
  const distance = (a: RoutePoint, b: RoutePoint) =>
    ((a[0] - b[0]) * 111320) ** 2 +
    ((a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180)) ** 2;
  let first = -1,
    last = -1,
    score = Infinity;
  let nearest = -1,
    bestStart = Infinity;
  for (let i = 0; i < points.length; i++) {
    if (nearest >= 0) {
      const end = distance(points[i], to);
      if (end <= 250 ** 2 && bestStart + end < score) {
        first = nearest;
        last = i;
        score = bestStart + end;
      }
    }
    const start = distance(points[i], from);
    if (start <= 250 ** 2 && start < bestStart) {
      nearest = i;
      bestStart = start;
    }
  }
  return first >= 0 && last > first ? points.slice(first, last + 1) : null;
}
