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
  FOLLOW_START,
  FPS,
  S,
  SIZE,
  busClock,
  clamp01,
  lerp,
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

/** Styl aplikacji bez warstw trasy i nazw miejscowości, z budynkami 3D. */
function tuneStyle(style: StyleSpecification): StyleSpecification {
  const drop = (id: string) => /^(trasa-|przystanki-|miejsce-)/.test(id);
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

function idle(map: MapLibreMap): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.video.stalls++;
      resolve();
    }, 30_000);
    map.once('idle', () => {
      clearTimeout(timer);
      resolve();
    });
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
  const focusAt = lastStop.time - (FOLLOW_END - FOLLOW_START) * 84;
  const camera = buildCamera(map, data, format, focusAt);
  const overlay = createOverlay(canvas, data, buildShapes(data));
  const scenes = createScenes(stage, data, format);
  await Promise.all([...stage.querySelectorAll('img')].map((img) => img.decode()));

  window.seek = async (t: number) => {
    const started = performance.now();
    setNow(t * 1000);
    const cam = camera(t);
    map.jumpTo({ center: [cam.lon, cam.lat], zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing, padding: cam.pad });
    await idle(map);
    const mapped = performance.now();

    const time = busClock(t, focusAt);
    const network =
      t < S.live
        ? lerp(1, 0.26, smooth(ramp(t, 6.6, 7.6)))
        : t < S.poland
          ? lerp(0.26, 0.42, smooth(ramp(t, FOLLOW_END, FOLLOW_END + 1.4)))
          : lerp(0.42, 1, smooth(ramp(t, S.poland + 0.1, S.poland + 1.8))) * (1 - ramp(t, S.promise - 0.2, S.promise + 0.5));
    const marks = overlay.draw({
      project: projector(map, cam, h),
      zoom: cam.zoom,
      wave: waveAt(t),
      waveSpan: waveAt(t) - waveAt(t - 0.5),
      networkAlpha: network,
      journey: smooth(ramp(t, 6.9, 8.6)),
      journeyAlpha: lerp(1, 0.8, ramp(t, S.live, S.live + 0.8)) * visible(t, 6.8, S.poland + 0.5, 0.6),
      originAlpha: visible(t, 0.2, S.live + 0.3, 0.4),
      time,
      vehicleAlpha: visible(t, S.live - 0.1, S.poland + 0.4, 0.6),
      focusAlpha: visible(t, S.live - 0.1, S.poland + 0.5, 0.6),
      citiesAt: t - (S.poland + 1.0),
      citiesAlpha: visible(t, S.poland + 0.5, S.promise + 0.4, 0.4),
    });
    const next = stops.findIndex((s) => s.time > time);
    const progress = clamp01((time - stops[0].time) / (lastStop.time - stops[0].time));
    scenes.update(t, marks, next < 0 ? stops.length - 1 : next, progress);
    const drawn = performance.now();
    await nextFrame();
    window.video.ms = [mapped - started, drawn - mapped, performance.now() - drawn];
  };

  await window.seek(0);
}

window.ready = main();
