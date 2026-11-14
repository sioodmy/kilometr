// Warstwa canvas nad mapą: fala zasięgu po liniach, trasa podróży,
// pojazdy z rozkładu i punkty miast. Rysowana od zera w każdej klatce.

import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Cam } from './camera';
import type { VideoData } from './data';
import { clamp01, lerp } from './timeline';
import { distanceAt, metersBetween, pointAt, smoothPath, type LonLat, type Shape } from './transit';

type XY = [number, number];
type Project = (lon: number, lat: number) => XY | null;

const TRAM = [92, 219, 190] as const;
const BUS = [165, 204, 232] as const;
const FRONT = [226, 255, 247] as const;
const rgba = (c: readonly number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Rzut na ekran; punkty za kamerą (przy dużym pochyleniu) zwraca jako null. */
export function projector(map: MapLibreMap, cam: Cam, height: number): Project {
  const rad = Math.PI / 180;
  const kx = 111_320 * Math.cos(cam.lat * rad);
  const ky = 110_540;
  const mpp = (40_075_016.686 * Math.cos(cam.lat * rad)) / (512 * 2 ** cam.zoom);
  const limit = cam.pitch > 20 ? 1.5 * height * mpp * Math.sin(cam.pitch * rad) * 0.95 : Infinity;
  const sinB = Math.sin(cam.bearing * rad);
  const cosB = Math.cos(cam.bearing * rad);
  return (lon, lat) => {
    if ((lon - cam.lon) * kx * sinB + (lat - cam.lat) * ky * cosB < -limit) return null;
    const p = map.project([lon, lat]);
    return [p.x, p.y];
  };
}

export interface Frame {
  project: Project;
  zoom: number;
  /** Fala: sekundy od wyjścia, które już „przeszukano”. */
  wave: number;
  /** Ile sekund fali mieści się w ostatnich 0,5 s wideo (czoło fali, błyski przystanków). */
  waveSpan: number;
  networkAlpha: number;
  journey: number;
  journeyAlpha: number;
  originAlpha: number;
  /** Skala znacznika Sky Tower (1 przy bliskim zoomie, →0 przy oddaleniu). */
  originScale: number;
  time: number;
  vehicleAlpha: number;
  /** Wyróżnienie śledzonego tramwaju (bez niego nie ma też plakietki linii). */
  focusAlpha: number;
  /** Postęp pociągu IC (0…1) i widoczność trasy kolejowej. */
  rail: number;
  railAlpha: number;
  citiesAt: number;
  citiesAlpha: number;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Brak canvas 2D');
  return ctx;
}

export function createOverlay(canvas: HTMLCanvasElement, data: VideoData, shapes: Shape[]) {
  const ctx = context2d(canvas);

  const walk: LonLat[] = [
    [data.journey.walk[0], data.journey.walk[1]],
    [data.journey.walk[2], data.journey.walk[3]],
  ];
  const ride: LonLat[] = [];
  for (let i = 0; i < data.journey.ride.length; i += 2) ride.push([data.journey.ride[i], data.journey.ride[i + 1]]);
  const walkLen = metersBetween(walk[0], walk[1]);
  const rideCum = [0];
  for (let i = 1; i < ride.length; i++) rideCum.push(rideCum[i - 1] + metersBetween(ride[i - 1], ride[i]));
  const rideLen = rideCum[rideCum.length - 1];
  const totalLen = walkLen + rideLen;
  const railRaw: LonLat[] = [];
  for (let i = 0; i < data.rail.ride.length; i += 2) railRaw.push([data.rail.ride[i], data.rail.ride[i + 1]]);
  const rail = smoothPath(railRaw, 5, 280);
  const railCum = [0];
  for (let i = 1; i < rail.length; i++) railCum.push(railCum[i - 1] + metersBetween(rail[i - 1], rail[i]));
  const railLen = railCum[railCum.length - 1];
  const railStopAt = data.rail.stops.map((s) => {
    let best = 0;
    let bestD = Infinity;
    rail.forEach((p, i) => {
      const d = metersBetween(p, [s.lon, s.lat]);
      if (d < bestD) {
        bestD = d;
        best = railCum[i];
      }
    });
    return best;
  });
  const stopAt = data.journey.stops.map((s) => {
    let best = 0;
    let bestD = Infinity;
    ride.forEach((p, i) => {
      const d = metersBetween(p, [s.lon, s.lat]);
      if (d < bestD) {
        bestD = d;
        best = rideCum[i];
      }
    });
    return best;
  });

  const width = () => canvas.width;
  const height = () => canvas.height;

  function line(path: Path2D, pts: (XY | null)[]) {
    let open = false;
    for (const p of pts) {
      if (!p) {
        open = false;
        continue;
      }
      if (open) path.lineTo(p[0], p[1]);
      else path.moveTo(p[0], p[1]);
      open = true;
    }
  }

  function partial(pts: LonLat[], cum: number[], upTo: number): LonLat[] {
    const out: LonLat[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] <= upTo) {
        out.push(pts[i]);
        continue;
      }
      const k = (upTo - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      out.push([lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)]);
      break;
    }
    return out;
  }

  // Min. reach per linia: pomijamy całe warianty jeszcze przed czołem fali.
  const lineMinReach = data.lines.map((l) => {
    let min = Infinity;
    for (const r of l.reach) if (r >= 0 && r < min) min = r;
    return min;
  });

  function drawWave(f: Frame) {
    if (f.networkAlpha < 0.01) return;
    const core = lerp(1.3, 3.4, clamp01((f.zoom - 11) / 5));
    const frontSpan = Math.min(80, f.waveSpan);
    const showFront = f.wave < 3500 && frontSpan > 1;
    const paths = (['bus', 'tram'] as const).map((mode) => {
      const lit = new Path2D();
      const front = new Path2D();
      for (let li = 0; li < data.lines.length; li++) {
        const l = data.lines[li];
        if (l.mode !== mode || lineMinReach[li] > f.wave) continue;
        const pts = data.shapes[l.shape];
        const reach = l.reach;
        let prev = f.project(pts[0], pts[1]);
        for (let i = 0; i < reach.length - 1; i++) {
          const ra = reach[i];
          const rb = reach[i + 1];
          if (ra < 0 || rb < 0 || Math.min(ra, rb) > f.wave) {
            prev = f.project(pts[2 * i + 2], pts[2 * i + 3]);
            continue;
          }
          const next = f.project(pts[2 * i + 2], pts[2 * i + 3]);
          if (!prev || !next) {
            prev = next;
            continue;
          }
          // Pomiń odcinki poniżej ~1 px (dużo mikrosegmentów przy oddaleniu).
          const dx = next[0] - prev[0];
          const dy = next[1] - prev[1];
          if (dx * dx + dy * dy < 1) {
            prev = next;
            continue;
          }
          const [from, to] = ra <= rb ? [prev, next] : [next, prev];
          const lo = Math.min(ra, rb);
          const hi = Math.max(ra, rb);
          const k = hi <= f.wave ? 1 : (f.wave - lo) / (hi - lo || 1);
          const x = lerp(from[0], to[0], k);
          const y = lerp(from[1], to[1], k);
          lit.moveTo(from[0], from[1]);
          lit.lineTo(x, y);
          if (showFront && hi > f.wave - frontSpan) {
            const k0 = clamp01((f.wave - frontSpan - lo) / (hi - lo || 1));
            front.moveTo(lerp(from[0], to[0], k0), lerp(from[1], to[1], k0));
            front.lineTo(x, y);
          }
          prev = next;
        }
      }
      return { lit, front, color: mode === 'tram' ? TRAM : BUS };
    });
    // Poświata + rdzeń w 2 przebiegach na tryb (wcześniej 4).
    ctx.globalCompositeOperation = 'lighter';
    for (const p of paths) {
      ctx.strokeStyle = rgba(p.color, 0.11 * f.networkAlpha);
      ctx.lineWidth = core * 4.2;
      ctx.stroke(p.lit);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const p of paths) {
      ctx.strokeStyle = rgba(p.color, 0.85 * f.networkAlpha);
      ctx.lineWidth = core;
      ctx.stroke(p.lit);
    }
    if (showFront) {
      ctx.globalCompositeOperation = 'lighter';
      for (const p of paths) {
        ctx.strokeStyle = rgba(FRONT, 0.55 * f.networkAlpha);
        ctx.lineWidth = core * 2.2;
        ctx.stroke(p.front);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawStops(f: Frame) {
    if (f.networkAlpha < 0.01) return;
    const dots = new Path2D();
    const flash = new Path2D();
    const r = lerp(1.2, 2.6, clamp01((f.zoom - 11) / 5));
    const flashOn = f.wave < 3500;
    for (let i = 0; i < data.stops.length; i += 3) {
      const reach = data.stops[i + 2];
      if (reach < 0 || reach > f.wave) continue;
      const p = f.project(data.stops[i], data.stops[i + 1]);
      if (!p) continue;
      dots.moveTo(p[0] + r, p[1]);
      dots.arc(p[0], p[1], r, 0, Math.PI * 2);
      if (flashOn) {
        const age = (f.wave - reach) / (f.waveSpan || 1);
        if (age < 1) {
          const rr = r + 12 * age;
          flash.moveTo(p[0] + rr, p[1]);
          flash.arc(p[0], p[1], rr, 0, Math.PI * 2);
        }
      }
    }
    if (flashOn) {
      ctx.strokeStyle = rgba(FRONT, 0.35 * f.networkAlpha);
      ctx.lineWidth = 1.5;
      ctx.stroke(flash);
    }
    ctx.fillStyle = `rgba(236,242,240,${0.75 * f.networkAlpha})`;
    ctx.fill(dots);
  }

  function drawJourney(f: Frame) {
    const done = f.journey * totalLen;
    const a = f.journeyAlpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (done > 0) {
      const w = partial(walk, [0, walkLen], Math.min(done, walkLen)).map(([lon, lat]) => f.project(lon, lat));
      const walkPath = new Path2D();
      line(walkPath, w);
      ctx.setLineDash([1, 11]);
      ctx.strokeStyle = `rgba(236,242,240,${0.95 * a})`;
      ctx.lineWidth = 5;
      ctx.stroke(walkPath);
      ctx.setLineDash([]);
    }
    if (done > walkLen) {
      const upTo = done - walkLen;
      const r = partial(ride, rideCum, upTo).map(([lon, lat]) => f.project(lon, lat));
      const ridePath = new Path2D();
      line(ridePath, r);
      ctx.strokeStyle = `rgba(8,12,11,${0.9 * a})`;
      ctx.lineWidth = 13;
      ctx.stroke(ridePath);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = hexA(data.journey.color, 0.28 * a);
      ctx.lineWidth = 26;
      ctx.stroke(ridePath);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = hexA(data.journey.color, a);
      ctx.lineWidth = 7;
      ctx.stroke(ridePath);
      data.journey.stops.forEach((s, i) => {
        if (stopAt[i] > upTo + 1) return;
        const p = f.project(s.lon, s.lat);
        if (!p) return;
        const last = i === data.journey.stops.length - 1;
        ctx.beginPath();
        ctx.arc(p[0], p[1], last ? 10 : 5.5, 0, Math.PI * 2);
        ctx.fillStyle = last ? hexA(data.journey.color, a) : `rgba(16,20,19,${a})`;
        ctx.fill();
        ctx.lineWidth = last ? 4 : 3;
        ctx.strokeStyle = last ? `rgba(244,248,246,${a})` : hexA(data.journey.color, a);
        ctx.stroke();
      });
    }
  }

  function drawOrigin(f: Frame) {
    const p = f.project(data.origin.lon, data.origin.lat);
    if (!p) return;
    const s = f.originScale;
    const a = f.originAlpha * clamp01(s * 1.15);
    if (a < 0.02 || s < 0.04) return;
    // Znacznik maleje z zoomem: bez stałej „kropki” przy oddaleniu.
    const r = lerp(1.2, 15, s);
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(16,20,19,${a})`;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, 6 * s);
    ctx.strokeStyle = rgba(TRAM, a);
    ctx.stroke();
  }

  function drawVehicles(f: Frame) {
    const r = lerp(2.4, 5.2, clamp01((f.zoom - 11) / 5));
    const trails = { tram: new Path2D(), bus: new Path2D() };
    const dots = { tram: new Path2D(), bus: new Path2D() };
    for (const v of data.vehicles) {
      if (v.focus) continue;
      const d = distanceAt(v, f.time);
      if (d === null) continue;
      const shape = shapes[v.shape];
      const head = pointAt(shape, d);
      const p = f.project(head[0], head[1]);
      if (!p || p[0] < -50 || p[1] < -50 || p[0] > width() + 50 || p[1] > height() + 50) continue;
      const tail: (XY | null)[] = [];
      for (let k = 6; k >= 0; k--) {
        const q = pointAt(shape, Math.max(0, d - k * 35));
        tail.push(f.project(q[0], q[1]));
      }
      line(trails[v.mode], tail);
      dots[v.mode].moveTo(p[0] + r, p[1]);
      dots[v.mode].arc(p[0], p[1], r, 0, Math.PI * 2);
    }
    for (const mode of ['bus', 'tram'] as const) {
      const color = mode === 'tram' ? TRAM : BUS;
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(color, 0.35 * f.vehicleAlpha);
      ctx.lineWidth = r * 1.1;
      ctx.stroke(trails[mode]);
      ctx.fillStyle = rgba(color, f.vehicleAlpha);
      ctx.fill(dots[mode]);
      ctx.strokeStyle = `rgba(8,12,11,${0.8 * f.vehicleAlpha})`;
      ctx.lineWidth = 1.5;
      ctx.stroke(dots[mode]);
    }
  }

  /** Trasa IC: rysuje się wraz z postępem pociągu, z plakietką na czołle. */
  function drawRail(f: Frame): XY | null {
    const a = f.railAlpha;
    if (a <= 0 || f.rail <= 0) return null;
    const upTo = railLen * f.rail;
    const drawn = partial(rail, railCum, upTo).map(([lon, lat]) => f.project(lon, lat));
    const path = new Path2D();
    line(path, drawn);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(8,12,11,${0.9 * a})`;
    ctx.lineWidth = 14;
    ctx.stroke(path);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexA(data.rail.color, 0.3 * a);
    ctx.lineWidth = 28;
    ctx.stroke(path);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = hexA(data.rail.color, a);
    ctx.lineWidth = 7;
    ctx.stroke(path);
    data.rail.stops.forEach((s, i) => {
      const at = railStopAt[i] ?? 0;
      if (at > upTo + 1) return;
      const p = f.project(s.lon, s.lat);
      if (!p) return;
      const last = i === data.rail.stops.length - 1;
      ctx.beginPath();
      ctx.arc(p[0], p[1], last ? 10 : 5, 0, Math.PI * 2);
      ctx.fillStyle = last ? hexA(data.rail.color, a) : `rgba(16,20,19,${a})`;
      ctx.fill();
      ctx.lineWidth = last ? 4 : 2.5;
      ctx.strokeStyle = last ? `rgba(244,248,246,${a})` : hexA(data.rail.color, a);
      ctx.stroke();
    });
    const head = drawn[drawn.length - 1];
    if (!head) return null;
    const r = lerp(6, 12, clamp01((f.zoom - 6) / 4));
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.arc(head[0], head[1], r * 2.4, 0, Math.PI * 2);
    ctx.fillStyle = hexA(data.rail.color, 0.25 * a);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.arc(head[0], head[1], r, 0, Math.PI * 2);
    ctx.fillStyle = hexA(data.rail.color, a);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(244,248,246,${a})`;
    ctx.stroke();
    return head;
  }

  /** Pozycja śledzonego tramwaju na ekranie (dla plakietki linii). */
  function focusPoint(f: Frame): XY | null {
    const v = data.vehicles.find((x) => x.focus);
    if (!v) return null;
    const d = distanceAt(v, f.time);
    if (d === null) return null;
    const p = pointAt(shapes[v.shape], d);
    const xy = f.project(p[0], p[1]);
    if (!xy) return null;
    const r = lerp(5, 11, clamp01((f.zoom - 11) / 5));
    const a = f.focusAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.arc(xy[0], xy[1], r * 2.6, 0, Math.PI * 2);
    ctx.fillStyle = hexA(data.journey.color, 0.22 * a);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.arc(xy[0], xy[1], r, 0, Math.PI * 2);
    ctx.fillStyle = hexA(data.journey.color, a);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(244,248,246,${a})`;
    ctx.stroke();
    return xy;
  }

  function drawCities(f: Frame): XY[] {
    const out: XY[] = [];
    const origin = data.cities[0];
    const far = Math.max(...data.cities.map((c) => metersBetween([c.lon, c.lat], [origin.lon, origin.lat])));
    data.cities.forEach((c) => {
      const p = f.project(c.lon, c.lat);
      out.push(p ?? [-999, -999]);
      if (!p) return;
      const delay = (metersBetween([c.lon, c.lat], [origin.lon, origin.lat]) / far) * 1.6;
      const k = clamp01((f.citiesAt - delay) / 0.35);
      if (k <= 0) return;
      const a = k * f.citiesAlpha;
      const ring = clamp01((f.citiesAt - delay) / 0.9);
      if (ring < 1) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 6 + 22 * ring, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(TRAM, 0.5 * (1 - ring) * f.citiesAlpha);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(p[0], p[1], 6, 0, Math.PI * 2);
      ctx.fillStyle = rgba(TRAM, a);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `rgba(8,12,11,${a})`;
      ctx.stroke();
    });
    return out;
  }

  return {
    draw(f: Frame) {
      ctx.clearRect(0, 0, width(), height());
      if (f.networkAlpha > 0) {
        drawWave(f);
        drawStops(f);
      }
      if (f.journeyAlpha > 0 && f.journey > 0) drawJourney(f);
      if (f.originAlpha > 0) drawOrigin(f);
      let focus: XY | null = null;
      if (f.vehicleAlpha > 0) drawVehicles(f);
      if (f.focusAlpha > 0) focus = focusPoint(f);
      const railFocus = drawRail(f);
      const origin = f.project(data.origin.lon, data.origin.lat);
      const destination = data.journey.stops[data.journey.stops.length - 1];
      const cities = f.citiesAlpha > 0 ? drawCities(f) : [];
      const warsaw =
        f.railAlpha > 0.15
          ? f.project(data.rail.warsaw.lon, data.rail.warsaw.lat)
          : null;
      if (warsaw && f.railAlpha > 0.2) {
        const a = f.railAlpha;
        ctx.beginPath();
        ctx.arc(warsaw[0], warsaw[1], 9, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(244,248,246,${a})`;
        ctx.fill();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = hexA(data.rail.color, a);
        ctx.stroke();
      }
      return {
        focus: railFocus ?? focus,
        origin,
        originScale: f.originScale,
        destination: f.project(destination.lon, destination.lat),
        cities,
        warsaw,
        railLabel: f.railAlpha > 0.2,
      };
    },
  };
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
