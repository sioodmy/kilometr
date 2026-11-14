// Strona launch video. Nie gra sama: renderer (scripts/render.ts) woła
// window.seek(t) dla każdej klatki i robi zrzut ekranu po wyrenderowaniu.
// Podgląd ręczny: /video/index.html?format=h (albo v) i seek(12) w konsoli.

import { Map as MapLibreMap, setNow, type LayerSpecification, type StyleSpecification } from 'maplibre-gl';
import { buildCamera } from './camera';
import type { VideoData } from './data';
import { createOverlay, projector } from './overlay';
import { createScenes } from './scenes';
import {
  DURATION,
  FOLLOW_END,
  FOLLOW_HOLD,
  FOLLOW_RATE,
  FOLLOW_START,
  FPS,
  S,
  SIZE,
  busClock,
  clamp01,
  lerp,
  railProgress,
  ramp,
  smooth,
  visible,
  waveAt,
  type Format,
} from './timeline';
import { buildShapes } from './transit';

declare global {
  interface Window {
    seek: (t: number) => Promise<void>;
    ready: Promise<void>;
    video: { duration: number; fps: number; width: number; height: number; stalls: number; ms: number[] };
  }
}

const format: Format = new URLSearchParams(location.search).get('format') === 'v' ? 'v' : 'h';
const { w, h } = SIZE[format];
document.body.className = format;
window.video = { duration: DURATION, fps: FPS, width: w, height: h, stalls: 0, ms: [] };

function isVideoData(x: unknown): x is VideoData {
  return typeof x === 'object' && x !== null && 'lines' in x && 'journey' in x && 'vehicles' in x;
}

function isStyle(x: unknown): x is StyleSpecification {
  return typeof x === 'object' && x !== null && 'version' in x && x.version === 8 && 'layers' in x && Array.isArray(x.layers);
}

/** Styl aplikacji bez trasy, nazw ulic/rzek/miejsc i POI, z budynkami 3D. */
function tuneStyle(style: StyleSpecification): StyleSpecification {
  const drop = (id: string) =>
    /^(trasa-|przystanki-|miejsce-|nazwa-ulicy|nazwa-rzeki|poi-)/.test(id);
  const layers: LayerSpecification[] = style.layers.filter((l) => !drop(l.id));
  layers.splice(layers.findIndex((l) => l.id === 'budynki') + 1, 0, {
    id: 'budynki-3d',
    type: 'fill-extrusion',
    source: 'openmaptiles',
    'source-layer': 'building',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': '#1E2523',
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.92],
    },
  });
  const sources = Object.fromEntries(Object.entries(style.sources).filter(([id]) => id === 'openmaptiles'));
  return { ...style, sources, layers, transition: { duration: 0, delay: 0 } };
}

function idle(map: MapLibreMap, maxMs = 30_000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (stall: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (stall) window.video.stalls++;
      resolve();
    };
    const timer = setTimeout(() => finish(true), maxMs);
    map.once('idle', () => finish(false));
    map.triggerRepaint();
  });
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

async function main() {
  const raw: unknown = await (await fetch('/video/.cache/data.json')).json();
  if (!isVideoData(raw) || !isStyle(raw.style)) throw new Error('Zły data.json, uruchom npm run video:prepare');
  const data = raw;

  await Promise.all([
    document.fonts.load('700 80px "Roboto Video"', 'ąęłńóśźżĄĘŁŃÓŚŹŻ'),
    document.fonts.load('400 32px "Roboto Video"', 'ąęłńóśźż'),
    document.fonts.load('500 26px "Roboto Video"', 'ąęłńóśźż'),
  ]);

  const stage = document.getElementById('stage');
  const canvas = document.getElementById('overlay');
  if (!stage || !(canvas instanceof HTMLCanvasElement)) throw new Error('Brak sceny');
  canvas.width = w;
  canvas.height = h;

  const map = new MapLibreMap({
    container: 'map',
    style: tuneStyle(raw.style),
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    pixelRatio: 1,
    maxPitch: 70,
    maxTileCacheSize: 600,
    canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true },
    center: [data.origin.lon, data.origin.lat],
    zoom: 14,
  });
  await new Promise<void>((resolve) => map.once('load', () => resolve()));

  const stops = data.journey.stops;
  const lastStop = stops[stops.length - 1];
  const focusAt = lastStop.time - (FOLLOW_END - FOLLOW_START) * FOLLOW_RATE;
  const camera = buildCamera(map, data, format, focusAt);
  const overlay = createOverlay(canvas, data, buildShapes(data));
  const scenes = createScenes(stage, data, format);
  await Promise.all([...stage.querySelectorAll('img')].map((img) => img.decode()));

  // Po notyfikacji Live Update gasimy siatkę MPK i trasę tramwaju (nie śmieci w IC/Polsce).
  const clearAt = FOLLOW_END;
  const clearBy = FOLLOW_END + FOLLOW_HOLD;

  window.seek = async (t: number) => {
    const started = performance.now();
    setNow(t * 1000);
    const cam = camera(t);
    map.jumpTo({ center: [cam.lon, cam.lat], zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing, padding: cam.pad });
    // Fala: ograniczony idle (wygładzony zoom + cache z rozgrzewki).
    // Reszta scen: dłuższy idle pod jakość kafelków.
    await idle(map, t < S.route + 0.5 ? 220 : 8_000);
    const mapped = performance.now();

    const time = busClock(t, focusAt);
    const netBase =
      t < S.route + 0.2
        ? 1
        : t < clearAt
          ? lerp(1, 0.22, smooth(ramp(t, S.route + 0.2, S.route + 1.0)))
          : 0;
    const network = netBase * (1 - smooth(ramp(t, clearAt, clearBy)));
    const journeyAlpha =
      lerp(1, 0.75, ramp(t, S.live, S.live + 0.6)) *
      visible(t, S.route + 0.3, clearAt, 0.35) *
      (1 - smooth(ramp(t, clearAt, clearBy)));
    const marks = overlay.draw({
      project: projector(map, cam, h),
      zoom: cam.zoom,
      wave: waveAt(t),
      waveSpan: waveAt(t) - waveAt(t - 0.35),
      networkAlpha: network,
      journey: smooth(ramp(t, S.route + 0.4, S.route + 1.6)),
      journeyAlpha,
      originAlpha: visible(t, 0.15, S.live + 0.2, 0.35) * (1 - smooth(ramp(t, clearAt, clearBy))),
      // Przy z16+ pełny znacznik; poniżej z12 znika (oddalenie fali).
      originScale: clamp01((cam.zoom - 12.2) / 3.6),
      time,
      vehicleAlpha: visible(t, S.live - 0.1, clearAt, 0.45) * (1 - smooth(ramp(t, clearAt, clearBy))),
      focusAlpha: visible(t, S.live - 0.1, clearAt, 0.45) * (1 - smooth(ramp(t, clearAt, clearBy))),
      rail: railProgress(t),
      railAlpha: visible(t, S.train + 0.15, S.poland + 0.5, 0.45),
      citiesAt: t - (S.poland + 0.7),
      citiesAlpha: visible(t, S.poland + 0.35, S.promise + 0.3, 0.35),
    });
    const next = stops.findIndex((s) => s.time > time);
    const progress = clamp01((time - stops[0].time) / (lastStop.time - stops[0].time));
    scenes.update(t, marks, next < 0 ? stops.length - 1 : next, progress);
    const drawn = performance.now();
    await nextFrame();
    window.video.ms = [mapped - started, drawn - mapped, performance.now() - drawn];
  };

  // Rozgrzewka kafelków na zakresie zoomu fali (seek jest losowy, cache zostaje).
  for (let t = 0; t <= S.route; t += 0.2) {
    const cam = camera(t);
    map.jumpTo({ center: [cam.lon, cam.lat], zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing, padding: cam.pad });
    await idle(map, 600);
  }
  await window.seek(0);
}

window.ready = main();
