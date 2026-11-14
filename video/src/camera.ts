// Jedno ujęcie kamery przez całe wideo: klatki kluczowe, przelot do widoku
// Polski (krzywa jak w MapLibre flyTo) i śledzenie tramwaju 9.

import { LngLat, type LngLatBoundsLike, type Map as MapLibreMap } from 'maplibre-gl';
import type { VideoData } from './data';
import { DURATION, FOLLOW_END, FOLLOW_START, LIVE_FROM, busClock, easeInOut, lerp, ramp, waveAt, type Format } from './timeline';
import { buildShapes, distanceAt, heading, metersBetween, pointAt, type LonLat } from './transit';

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

  const withPad = (c: Cam, p: Pad): Cam => ({ ...c, pad: p });
  const cityCam = withPad(fit(reached, cityPad, 8, 42, -0.35), pad({}));
  // W pionie trasa leży w poprzek kadru, nad telefonem.
  const routeCam = withPad(h ? fit(route, routePad, 18, 48, -0.05) : fit(route, routePad, -40, 40, 0.75), pad({}));
  const polandCam = withPad(fit(cities, polandPad, 0, 0, 0), pad({}));

  const keys: Key[] = [
    { t: 0, cam: at(origin, h ? 15.7 : 15.5, 22, -28, textPad) },
    { t: 1.3, cam: at(origin, h ? 15.1 : 14.9, 30, -22, textPad) },
    { t: 6.3, cam: cityCam },
    { t: 8.2, cam: routeCam },
    { t: 12.4, cam: { ...routeCam, zoom: routeCam.zoom + 0.15, bearing: routeCam.bearing + 8 } },
    { t: LIVE_FROM, cam: { ...routeCam, zoom: routeCam.zoom + 0.3, bearing: routeCam.bearing + 14 } },
    // Po śledzeniu tramwaju krótko całe miasto, potem lot nad Polskę.
    { t: 23.8, cam: cityCam },
    { t: 26, cam: polandCam, fly: true },
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

  // Przy fali kamera oddala się tak, żeby 90% osiągniętych przystanków mieściło się w kadrze.
  const reachDist: [number, number][] = [];
  for (let i = 0; i < data.stops.length; i += 3) {
    const reach = data.stops[i + 2];
    if (reach >= 0) reachDist.push([reach, metersBetween(origin, [data.stops[i], data.stops[i + 1]])]);
  }
  const worldMeters = (40075016.686 * Math.cos((data.origin.lat * Math.PI) / 180)) / 512;
  const radiusPx = h ? 430 : 440;
  const waveZoom = (wave: number) => {
    const d = reachDist.filter(([r]) => r <= wave).map(([, m]) => m);
    d.sort((a, b) => a - b);
    const r = Math.max(250, d[Math.floor(d.length * 0.9)] ?? 0);
    return Math.log2((worldMeters * radiusPx) / r);
  };
  const softMin = (a: number, b: number, k = 0.2) => -k * Math.log(Math.exp(-a / k) + Math.exp(-b / k));

  const blendIn = FOLLOW_START;
  const blendOut = FOLLOW_END + 1.3;
  return (t: number): Cam => {
    if (t < 6.3) {
      const c = keyed(t);
      return { ...c, zoom: Math.max(cityCam.zoom, softMin(c.zoom, waveZoom(waveAt(t + 0.3)))) };
    }
    if (t < LIVE_FROM) return keyed(t);
    if (t < blendIn) return mix(keyed(t), follow(t), easeInOut(ramp(t, LIVE_FROM, blendIn)));
    if (t < FOLLOW_END) return follow(t);
    if (t < blendOut) return mix(follow(Math.min(t, FOLLOW_END + 0.6)), keyed(t), easeInOut(ramp(t, FOLLOW_END, blendOut)));
    return keyed(t);
  };
}
