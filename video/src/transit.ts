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

/** Najkrótsza zmiana kąta (−180…180). */
export function headingDelta(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/**
 * Wygładza polilinię (średnia sąsiadów + Chaikin + min. krok).
 * Kamera na torach PLK bez tego szarpie na rozjazdach i łukach.
 */
export function smoothPath(pts: LonLat[], passes = 4, minStepM = 220): LonLat[] {
  if (pts.length < 3) return pts.slice();
  let cur = pts.slice();
  for (let p = 0; p < passes; p++) {
    // 1) Laplacian: każdy punkt bliżej sąsiadów
    const soft: LonLat[] = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      soft.push([
        cur[i - 1][0] * 0.25 + cur[i][0] * 0.5 + cur[i + 1][0] * 0.25,
        cur[i - 1][1] * 0.25 + cur[i][1] * 0.5 + cur[i + 1][1] * 0.25,
      ]);
    }
    soft.push(cur[cur.length - 1]);
    // 2) Chaikin: łagodzi rogi
    const next: LonLat[] = [soft[0]];
    for (let i = 0; i < soft.length - 1; i++) {
      const a = soft[i];
      const b = soft[i + 1];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(soft[soft.length - 1]);
    cur = next;
  }
  const out: LonLat[] = [cur[0]];
  for (let i = 1; i < cur.length - 1; i++) {
    if (metersBetween(out[out.length - 1], cur[i]) >= minStepM) out.push(cur[i]);
  }
  out.push(cur[cur.length - 1]);
  return out;
}
