// Geometria rozkładu dla strony wideo: punkt na trasie po metrach,
// pozycja kursu w danej sekundzie i kierunek jazdy.

import type { VideoData } from './data';

export type LonLat = [number, number];

const MX = 111_320 * Math.cos((51.1 * Math.PI) / 180);
const MY = 110_540;

export interface Shape {
  pts: number[];
  cum: Float64Array;
}

export function buildShapes(data: VideoData): Shape[] {
  return data.shapes.map((pts) => {
    const n = pts.length / 2;
    const cum = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      cum[i] = cum[i - 1] + Math.hypot((pts[2 * i] - pts[2 * i - 2]) * MX, (pts[2 * i + 1] - pts[2 * i - 1]) * MY);
    }
    return { pts, cum };
  });
}

function bracket(values: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = values.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function pointAt(shape: Shape, d: number): LonLat {
  const { pts, cum } = shape;
  const n = cum.length;
  if (d <= 0) return [pts[0], pts[1]];
  if (d >= cum[n - 1]) return [pts[2 * n - 2], pts[2 * n - 1]];
  const i = bracket(cum, d);
  const k = (d - cum[i]) / (cum[i + 1] - cum[i] || 1);
  return [pts[2 * i] + (pts[2 * i + 2] - pts[2 * i]) * k, pts[2 * i + 1] + (pts[2 * i + 3] - pts[2 * i + 1]) * k];
}

/** Metry od początku trasy w sekundzie rozkładu `time`; null poza kursem. */
export function distanceAt(v: { t: number[]; d: number[] }, time: number): number | null {
  const { t, d } = v;
  if (time < t[0] || time > t[t.length - 1]) return null;
  const i = bracket(t, time);
  if (i >= t.length - 1) return d[d.length - 1];
  return d[i] + ((d[i + 1] - d[i]) * (time - t[i])) / (t[i + 1] - t[i] || 1);
}

/** Kierunek z `a` do `b` w stopniach od północy, zgodnie z ruchem wskazówek. */
export function heading(a: LonLat, b: LonLat): number {
  return (Math.atan2((b[0] - a[0]) * MX, (b[1] - a[1]) * MY) * 180) / Math.PI;
}

export function metersBetween(a: LonLat, b: LonLat): number {
  return Math.hypot((a[0] - b[0]) * MX, (a[1] - b[1]) * MY);
}
