// Jedno ujęcie kamery przez całe wideo: klatki kluczowe, przelot do widoku
// Polski (krzywa jak w MapLibre flyTo) i śledzenie tramwaju 9.

import { LngLat, type LngLatBoundsLike, type Map as MapLibreMap } from 'maplibre-gl';
import type { VideoData } from './data';
import {
  DURATION,
  FOLLOW_END,
  FOLLOW_HOLD,
  FOLLOW_START,
  LIVE_FROM,
  S,
  busClock,
  clamp01,
  easeInOut,
  lerp,
  railProgress,
  ramp,
  smooth,
  waveAt,
  type Format,
} from './timeline';
import {
  buildShapes,
  distanceAt,
  heading,
  headingDelta,
  metersBetween,
  pointAt,
  smoothPath,
  type LonLat,
} from './transit';

export interface Pad {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Cam {
  lon: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
  pad: Pad;
}

interface Key {
  t: number;
  cam: Cam;
  fly?: boolean;
}

const pad = (p: Partial<Pad>): Pad => ({ top: 0, bottom: 0, left: 0, right: 0, ...p });

const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const lonOf = (x: number) => x * 360 - 180;
const latOf = (y: number) => (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;

function mixPad(a: Pad, b: Pad, k: number): Pad {
  return {
    top: lerp(a.top, b.top, k),
    bottom: lerp(a.bottom, b.bottom, k),
    left: lerp(a.left, b.left, k),
    right: lerp(a.right, b.right, k),
  };
}

function mixAngle(a: number, b: number, k: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * k;
}

export function mix(a: Cam, b: Cam, k: number): Cam {
  return {
    lon: lerp(a.lon, b.lon, k),
    lat: lerp(a.lat, b.lat, k),
    zoom: lerp(a.zoom, b.zoom, k),
    pitch: lerp(a.pitch, b.pitch, k),
    bearing: mixAngle(a.bearing, b.bearing, k),
    pad: mixPad(a.pad, b.pad, k),
  };
}

/** Przelot van Wijka (ta sama krzywa co MapLibre flyTo, rho 1.42). */
function fly(a: Cam, b: Cam, k: number, viewport: number): Cam {
  const base = mix(a, b, k);
  const scale = 512 * 2 ** a.zoom;
  const ax = mercX(a.lon) * scale;
  const ay = mercY(a.lat) * scale;
  const bx = mercX(b.lon) * scale;
  const by = mercY(b.lat) * scale;
  const u1 = Math.hypot(bx - ax, by - ay);
  if (u1 < 1) return base;
  const rho = 1.42;
  const rho2 = rho * rho;
  const w0 = viewport;
  const w1 = w0 / 2 ** (b.zoom - a.zoom);
  const r = (end: boolean) => {
    const w = end ? w1 : w0;
    const q = (w1 * w1 - w0 * w0 + (end ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * w * rho2 * u1);
    return Math.log(Math.sqrt(q * q + 1) - q);
  };
  const r0 = r(false);
  const s = (k * (r(true) - r0)) / rho;
  const w = Math.cosh(r0) / Math.cosh(r0 + rho * s);
  const u = (w0 * ((Math.cosh(r0) * Math.tanh(r0 + rho * s) - Math.sinh(r0)) / rho2)) / u1;
  return {
    ...base,
    lon: lonOf((ax + (bx - ax) * u) / scale),
    lat: latOf((ay + (by - ay) * u) / scale),
    zoom: a.zoom + Math.log2(1 / w),
  };
}

function bounds(points: LonLat[]): LngLatBoundsLike {
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const [lon, lat] of points) {
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return [w, s, e, n];
}

function pairs(flat: number[]): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

/** Klatka kamery w czasie `t`; `focusAt` to sekunda rozkładu na początku śledzenia. */
export function buildCamera(map: MapLibreMap, data: VideoData, format: Format, focusAt: number) {
  const h = format === 'h';
  const viewport = 1920;
  const fit = (points: LonLat[], p: Pad, bearing: number, pitch: number, zoomShift: number): Cam => {
    const c = map.cameraForBounds(bounds(points), { padding: p, bearing });
    if (!c?.center || c.zoom === undefined) throw new Error('cameraForBounds bez wyniku');
    const { lng, lat } = LngLat.convert(c.center);
    return { lon: lng, lat, zoom: c.zoom + zoomShift, pitch, bearing, pad: pad({}) };
  };
  const at = (lonLat: LonLat, zoom: number, pitch: number, bearing: number, p: Pad): Cam => ({
    lon: lonLat[0],
    lat: lonLat[1],
    zoom,
    pitch,
    bearing,
    pad: p,
  });

  const origin: LonLat = [data.origin.lon, data.origin.lat];
  const reached: LonLat[] = [];
  for (let i = 0; i < data.stops.length; i += 3) {
    if (data.stops[i + 2] >= 0 && data.stops[i + 2] <= 40 * 60) reached.push([data.stops[i], data.stops[i + 1]]);
  }
  const route = [...pairs(data.journey.walk), ...pairs(data.journey.ride)];
  const cities = data.cities.map((c): LonLat => [c.lon, c.lat]);

  const textPad = h ? pad({ left: 760 }) : pad({ top: 760 });
  const routePad = h
    ? pad({ top: 400, left: 110, right: 860, bottom: 110 })
    : pad({ top: 560, bottom: 1020, left: 130, right: 130 });
  const cityPad = h ? pad({ left: 820, top: 70, bottom: 70, right: 70 }) : pad({ top: 760, bottom: 150, left: 50, right: 50 });
  const polandPad = h ? pad({ left: 860, top: 90, bottom: 90, right: 230 }) : pad({ top: 760, bottom: 260, left: 60, right: 200 });
  // 16:9: więcej paddingu z prawej (telefon), mniej z lewej, żeby trasa IC nie chowała się pod mockiem.
  const trainPad = h
    ? pad({ left: 380, top: 140, bottom: 80, right: 560 })
    : pad({ top: 720, bottom: 900, left: 60, right: 60 });

  const withPad = (c: Cam, p: Pad): Cam => ({ ...c, pad: p });
  const cityCam = withPad(fit(reached, cityPad, 8, 42, -0.35), pad({}));
  // W pionie trasa leży w poprzek kadru, nad telefonem.
  const routeCam = withPad(h ? fit(route, routePad, 18, 48, -0.05) : fit(route, routePad, -40, 40, 0.75), pad({}));
  const polandCam = withPad(fit(cities, polandPad, 0, 0, 0), pad({}));
  const railPts = pairs(data.rail.ride);
  const railStart = railPts[0];

  // Zoom fali: promień rośnie monotonnie (max), krzywa zoomu wygładzona z góry.
  // Bez tego 90. percentyl skakał przy każdym nowym przystanku i MapLibre
  // przeładowywał kafelki → lagi rysowania i kamery w pierwszych sekundach.
  const reachDist: [number, number][] = [];
  for (let i = 0; i < data.stops.length; i += 3) {
    const reach = data.stops[i + 2];
    if (reach >= 0) reachDist.push([reach, metersBetween(origin, [data.stops[i], data.stops[i + 1]])]);
  }
  reachDist.sort((a, b) => a[0] - b[0]);
  const worldMeters = (40075016.686 * Math.cos((data.origin.lat * Math.PI) / 180)) / 512;
  const radiusPx = h ? 430 : 440;
  const radiusRaw = (wave: number) => {
    let max = 250;
    for (const [r, m] of reachDist) {
      if (r > wave) break;
      if (m > max) max = m;
    }
    return max;
  };
  const WAVE_Z_N = 160;
  const rawZ: number[] = [];
  for (let i = 0; i < WAVE_Z_N; i++) {
    const t = (i / (WAVE_Z_N - 1)) * S.route;
    const r = radiusRaw(waveAt(t));
    rawZ.push(Math.max(cityCam.zoom, Math.log2((worldMeters * radiusPx) / r)));
  }
  // Średnia ruchoma + cap Δzoom między sąsiadami (max ~0.04/próbkę ≈ płynny zoom-out).
  const smoothZ: number[] = rawZ.slice();
  for (let pass = 0; pass < 2; pass++) {
    const next = smoothZ.slice();
    for (let i = 0; i < WAVE_Z_N; i++) {
      let sum = 0;
      let n = 0;
      for (let j = Math.max(0, i - 6); j <= Math.min(WAVE_Z_N - 1, i + 6); j++) {
        sum += smoothZ[j];
        n++;
      }
      next[i] = sum / n;
    }
    for (let i = 0; i < WAVE_Z_N; i++) smoothZ[i] = next[i];
  }
  for (let i = 1; i < WAVE_Z_N; i++) {
    const maxDrop = 0.045;
    if (smoothZ[i] < smoothZ[i - 1] - maxDrop) smoothZ[i] = smoothZ[i - 1] - maxDrop;
    if (smoothZ[i] > smoothZ[i - 1] + maxDrop) smoothZ[i] = smoothZ[i - 1] + maxDrop;
  }
  const waveZoomAt = (t: number) => {
    const u = ramp(t, 0, S.route) * (WAVE_Z_N - 1);
    const i = Math.min(WAVE_Z_N - 2, Math.floor(u));
    return lerp(smoothZ[i], smoothZ[i + 1], u - i);
  };

  const waveCam = (t: number): Cam => {
    const pitch = lerp(26, 38, smooth(ramp(t, 0, S.route)));
    const bearing = lerp(-26, 6, smooth(ramp(t, 0, S.route)));
    return at(origin, waveZoomAt(t), pitch, bearing, textPad);
  };

  // Fala → trasa: bez postoju na cityCam (hard stop). Blend zaczyna się
  // jeszcze w trakcie oddalania, więc kamera cały czas jedzie.
  const toRouteAt = S.route + 1.55;
  const fromWaveAt = S.route - 1.05;
  const keys: Key[] = [
    { t: toRouteAt, cam: routeCam },
    { t: LIVE_FROM, cam: { ...routeCam, zoom: routeCam.zoom + 0.25, bearing: routeCam.bearing + 12 } },
    { t: S.train, cam: at(railStart, h ? 9.4 : 9.0, 42, 55, trainPad) },
    { t: S.poland, cam: polandCam, fly: true },
    { t: DURATION, cam: { ...polandCam, zoom: polandCam.zoom + 0.18 } },
  ];

  const keyed = (t: number): Cam => {
    if (t <= keys[0].t) return keys[0].cam;
    for (let i = 1; i < keys.length; i++) {
      const b = keys[i];
      if (t > b.t) continue;
      const a = keys[i - 1];
      const k = easeInOut(ramp(t, a.t, b.t));
      return b.fly ? fly(a.cam, b.cam, k, viewport) : mix(a.cam, b.cam, k);
    }
    return keys[keys.length - 1].cam;
  };

  const waveIntoRoute = (t: number): Cam => {
    const k = easeInOut(ramp(t, fromWaveAt, toRouteAt));
    if (k <= 0) return waveCam(t);
    // Do S.route fala dalej żyje (zoom-out); potem zamrażamy jej koniec i dojeżdżamy do trasy.
    return mix(waveCam(Math.min(t, S.route)), routeCam, k);
  };

  const shapes = buildShapes(data);
  const focus = data.vehicles.find((v) => v.focus);
  if (!focus) throw new Error('Brak kursu do śledzenia');
  const shape = shapes[focus.shape];
  const followPad = h ? pad({ left: 700, top: 120 }) : pad({ top: 820 });
  const follow = (t: number): Cam => {
    const time = busClock(t, focusAt);
    const ds = [-25, 0, 25].map((dt) => distanceAt(focus, time + dt) ?? 0);
    const d = ds.reduce((a, b) => a + b, 0) / ds.length;
    let x = 0;
    let y = 0;
    for (const off of [-240, -120, 0, 120, 240]) {
      const deg = (heading(pointAt(shape, d + off - 90), pointAt(shape, d + off + 90)) * Math.PI) / 180;
      x += Math.sin(deg);
      y += Math.cos(deg);
    }
    const [lon, lat] = pointAt(shape, d);
    return { lon, lat, zoom: h ? 15.9 : 15.7, pitch: 62, bearing: (Math.atan2(x, y) * 180) / Math.PI, pad: followPad };
  };

  // Tor wygładzony: ostre łuki PLK nie szarpią bearingiem kamery.
  const railSmooth = smoothPath(railPts, 5, 280);
  const railCum = [0];
  for (let i = 1; i < railSmooth.length; i++) {
    railCum.push(railCum[i - 1] + metersBetween(railSmooth[i - 1], railSmooth[i]));
  }
  const railLen = railCum[railCum.length - 1];
  const railPoint = (dist: number): LonLat => {
    let i = 0;
    while (i < railCum.length - 2 && railCum[i + 1] < dist) i++;
    const span = railCum[i + 1] - railCum[i];
    const k = span > 0 ? (dist - railCum[i]) / span : 0;
    const a = railSmooth[i];
    const b = railSmooth[i + 1];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  // Bearing wstępnie wyliczony i wygładzony (seek jest losowy, bez stanu).
  const BEAR_N = 320;
  const rawBear: number[] = [];
  for (let i = 0; i < BEAR_N; i++) {
    const d = (i / (BEAR_N - 1)) * railLen;
    const behind = railPoint(Math.max(0, d - 6_000));
    const ahead = railPoint(Math.min(railLen, d + 28_000));
    rawBear.push(heading(behind, ahead));
  }
  const unwrapped = [rawBear[0]];
  for (let i = 1; i < BEAR_N; i++) unwrapped.push(unwrapped[i - 1] + headingDelta(unwrapped[i - 1], rawBear[i]));
  const smoothBear = unwrapped.slice();
  for (let pass = 0; pass < 3; pass++) {
    const next = smoothBear.slice();
    for (let i = 0; i < BEAR_N; i++) {
      let sum = 0;
      let n = 0;
      for (let j = Math.max(0, i - 10); j <= Math.min(BEAR_N - 1, i + 10); j++) {
        sum += smoothBear[j];
        n++;
      }
      next[i] = sum / n;
    }
    for (let i = 0; i < BEAR_N; i++) smoothBear[i] = next[i];
  }
  const bearAt = (d: number) => {
    const u = clamp01(d / (railLen || 1)) * (BEAR_N - 1);
    const i = Math.min(BEAR_N - 2, Math.floor(u));
    return lerp(smoothBear[i], smoothBear[i + 1], u - i);
  };
  const railFollow = (t: number): Cam => {
    const d = railLen * railProgress(t);
    const [lon, lat] = railPoint(d);
    return { lon, lat, zoom: h ? 8.6 : 8.2, pitch: 48, bearing: bearAt(d), pad: trainPad };
  };

  const blendIn = FOLLOW_START;
  const holdEnd = FOLLOW_END + FOLLOW_HOLD;
  const blendOut = holdEnd + 0.35;
  return (t: number): Cam => {
    if (t < toRouteAt) return waveIntoRoute(t);
    if (t < LIVE_FROM) return keyed(t);
    if (t < blendIn) return mix(keyed(t), follow(t), easeInOut(ramp(t, LIVE_FROM, blendIn)));
    if (t < FOLLOW_END) return follow(t);
    // Pauza na Katedrze, potem zejście do sceny pociągu.
    if (t < holdEnd) return follow(FOLLOW_END);
    if (t < blendOut) return mix(follow(FOLLOW_END), keyed(t), easeInOut(ramp(t, holdEnd, blendOut)));
    if (t < S.train + 0.35) return keyed(t);
    if (t < S.poland - 0.35) return railFollow(t);
    if (t < S.poland) return mix(railFollow(t), keyed(t), easeInOut(ramp(t, S.poland - 0.35, S.poland)));
    return keyed(t);
  };
}
