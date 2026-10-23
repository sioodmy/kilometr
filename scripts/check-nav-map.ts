import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { buildNavMapDocument } from '../src/map/navMapDocument';
import { bundledMapLibreHead, mapDocumentSource } from '../src/map/bundledMapLibre';
import { MAPLIBRE_WORKER } from '../src/map/maplibreAssets.generated';

async function checkWorkerCompatibility() {
  assert.doesNotThrow(
    () => new Function(MAPLIBRE_WORKER),
    'bundled worker is valid classic JavaScript',
  );
  const bootstrap = Array.from(
    bundledMapLibreHead().matchAll(/<script data-maplibre>([\s\S]*?)<\/script>/g),
  ).at(-1)?.[1];
  assert(bootstrap);
  let workerUrl = '';
  runInNewContext(bootstrap, {
    Blob,
    URL: { createObjectURL: () => 'blob:null/test-worker' },
    maplibregl: {
      setWorkerUrl: (url: string) => {
        workerUrl = url;
      },
    },
  });
  const factory = buildSync({
    stdin: {
      contents: `import {workerFactory} from './node_modules/maplibre-gl/src/util/web_worker.ts';
        import {config} from './node_modules/maplibre-gl/src/util/config.ts';
        export function create(url) { config.WORKER_URL = url; return workerFactory(); }`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'iife',
    globalName: 'WorkerFactoryTest',
    write: false,
    logLevel: 'silent',
  }).outputFiles[0].text;
  const workers: { type?: string }[] = [];
  const context = {
    location: { href: 'about:blank', origin: 'null' },
    URL,
    Worker: class {
      constructor(_url: string, options?: { type: string }) {
        workers.push(options ?? {});
      }
    },
    WorkerFactoryTest: { create: (_url: string): Promise<unknown> => Promise.resolve() },
  };
  runInNewContext(factory, context);
  await context.WorkerFactoryTest.create(workerUrl);
  assert.equal(workers.length, 1);
  assert.equal(
    workers[0].type,
    undefined,
    'opaque WebView uses a classic worker instead of a silently failing module worker',
  );
  assert.equal(new URL(mapDocumentSource('', null).baseUrl).origin, 'https://kilometr.app');
  assert.equal(mapDocumentSource('', 'http://127.0.0.1:1234').baseUrl, 'http://127.0.0.1:1234/');
}

type Message = { t: string; state?: string; following?: boolean; northUp?: boolean };
type MapEvent = {
  sourceId?: string;
  tile?: { state: string };
  error?: Error;
  originalEvent?: object;
};
interface CameraUpdate {
  user: [number, number] | null;
  vehicle?: [number, number] | null;
  heading: number | null;
  userHeading?: number | null;
  riding?: boolean;
  reduceMotion?: boolean;
}
interface MapBridge {
  ReactNativeWebView: { postMessage: (data: string) => void };
  addEventListener: () => void;
  __navRoute: (route: {
    id?: string;
    path: number[][];
    stop: number[];
    accent: string;
    riding: boolean;
  }) => void;
  __navCamera: (camera: CameraUpdate) => void;
  __navControl: (action: 'follow' | 'north' | 'overview') => void;
}
async function boot(failAssets = false) {
  const messages: Message[] = [];
  const events = new Map<string, (event: MapEvent) => void>();
  const cameras: Record<string, unknown>[] = [];
  const sources: unknown[] = [];
  const markers: { position: number[]; removed: boolean; rotation: number }[] = [];
  let tilesLoaded = false;
  let sourceLoaded = false;
  let bearing = 0;
  let center = { lng: 17, lat: 51.1 };
  class FakeMap {
    on(name: string, fn: (event: MapEvent) => void) {
      events.set(name, fn);
    }
    getSource() {
      return { setData: (data: unknown) => sources.push(data) };
    }
    areTilesLoaded() {
      return tilesLoaded;
    }
    isSourceLoaded() {
      return sourceLoaded;
    }
    getBearing() {
      return bearing;
    }
    getCenter() {
      return center;
    }
    jumpTo(options: { center: [number, number]; bearing: number }) {
      center = { lng: options.center[0], lat: options.center[1] };
      bearing = options.bearing;
      cameras.push(options);
    }
    easeTo(options: Record<string, unknown>) {
      if (Array.isArray(options.center))
        center = { lng: options.center[0], lat: options.center[1] };
      if (typeof options.bearing === 'number') bearing = options.bearing;
      cameras.push(options);
    }
    fitBounds(_bounds: unknown, options: Record<string, unknown>) {
      cameras.push({ ...options, fitted: true });
    }
  }
  class FakeMarker {
    value = { position: [] as number[], removed: false, rotation: 0 };
    constructor() {
      markers.push(this.value);
    }
    setLngLat(position: number[]) {
      this.value.position = position;
      return this;
    }
    addTo() {
      return this;
    }
    remove() {
      this.value.removed = true;
    }
    setRotation(value: number) {
      this.value.rotation = value;
    }
    getElement() {
      return { style: {}, querySelector: () => ({ style: {}, textContent: '' }) };
    }
  }
  const bridge: MapBridge = {
    ReactNativeWebView: {
      postMessage: (data: string) => {
        messages.push(JSON.parse(data));
      },
    },
    addEventListener: () => undefined,
    __navRoute: () => undefined,
    __navCamera: () => undefined,
    __navControl: () => undefined,
  };
  const context = {
    window: bridge,
    document: { createElement: () => ({ className: '', innerHTML: '' }) },
    maplibregl: failAssets
      ? undefined
      : {
          Map: FakeMap,
          Marker: FakeMarker,
          LngLatBounds: class {
            extend() {
              return this;
            }
          },
        },
    setTimeout: () => 1,
    clearTimeout: () => undefined,
  };
  const html = buildNavMapDocument({ offlineBase: null, center: [17, 51.1] });
  assert(html.includes('<script data-maplibre>'), 'silnik mapy jest w dokumencie');
  assert(!html.includes('cdn.jsdelivr.net/npm/maplibre-gl@'), 'mapa nie pobiera kodu z CDN');
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
    runInNewContext(script[1], context);
  await new Promise<void>((resolve) => setImmediate(resolve));
  return {
    messages,
    cameras,
    sources,
    markers,
    window: context.window,
    emit: (name: string, event: MapEvent = {}) => events.get(name)?.(event),
    loaded: () => {
      tilesLoaded = true;
      sourceLoaded = true;
    },
  };
}

async function check() {
  await checkWorkerCompatibility();
  const map = await boot();
  map.emit('style.load');
  assert.deepEqual(map.messages, [{ t: 'ready' }]);
  map.emit('render');
  assert.equal(map.messages.length, 1, 'style readiness must not hide the tile spinner');
  map.emit('dataloading', { sourceId: 'openmaptiles' });
  assert.equal(map.messages.at(-1)?.state, 'loading');
  map.emit('error', { error: new Error('tile unavailable') });
  assert.equal(map.messages.at(-1)?.state, 'error');
  map.emit('dataloading', { sourceId: 'openmaptiles' });
  map.emit('sourcedata', { sourceId: 'openmaptiles', tile: { state: 'loaded' } });
  map.emit('render');
  assert.equal(map.messages.at(-1)?.state, 'loading', 'wait for the visible tiles to finish');
  map.loaded();
  map.emit('render');
  assert.equal(map.messages.at(-1)?.state, 'ready');
  map.emit('dataloading', { sourceId: 'openmaptiles' });
  map.emit('render');
  assert.equal(
    map.messages.at(-1)?.state,
    'ready',
    'panning does not cover a working map with a spinner',
  );

  map.window.__navRoute({
    path: [
      [51.1, 17],
      [51.11, 17.01],
    ],
    stop: [51.11, 17.01],
    accent: '#fff',
    riding: true,
  });
  const route = map.sources.at(-1) as {
    features: { properties: { walk: number }; geometry: { coordinates: number[][] } }[];
  };
  assert.equal(route.features[0].properties.walk, 0, 'riding uses the solid transit line');
  assert.deepEqual(Array.from(route.features[0].geometry.coordinates[0]), [17, 51.1]);
  map.window.__navCamera({ user: [51.105, 17.005], heading: 359, riding: true });
  assert.deepEqual(Array.from(map.cameras.at(-1)?.center as number[]), [17.005, 51.105]);
  assert.equal(map.cameras.at(-1)?.zoom, 15.5);
  const initialBearing = Number(map.cameras.at(-1)?.bearing);
  map.window.__navCamera({ user: [51.105, 17.005], heading: 1, riding: true });
  assert.equal(
    Number(map.cameras.at(-1)?.bearing) - initialBearing,
    2,
    'camera takes the short rotation across north',
  );
  assert.deepEqual(
    Array.from(map.markers[0].position),
    [17.005, 51.105],
    'marker is attached to its map coordinate',
  );
  map.emit('dragstart', { originalEvent: {} });
  assert.equal(map.messages.at(-1)?.following, false, 'dragging unlocks the camera');
  const beforeFree = map.cameras.length;
  map.window.__navCamera({ user: [51.106, 17.006], heading: 45 });
  assert.equal(
    map.cameras.length,
    beforeFree,
    'GPS and compass cannot steal the camera while browsing',
  );
  assert.deepEqual(
    Array.from(map.markers[0].position),
    [17.006, 51.106],
    'position keeps updating while unlocked',
  );
  map.window.__navControl('follow');
  assert.equal(map.messages.at(-1)?.following, true);
  assert.equal(map.cameras.at(-1)?.bearing, 45, 'recenter restores the current compass heading');
  map.window.__navControl('north');
  assert.equal(map.cameras.at(-1)?.bearing, 0, 'north-up mode keeps north at the top');
  map.window.__navCamera({ user: [51.106, 17.006], heading: 100 });
  assert.equal(map.cameras.at(-1)?.bearing, 0, 'sensor updates respect north-up mode');
  map.window.__navControl('north');
  map.window.__navCamera({ user: [51.106, 17.006], heading: 120, reduceMotion: true });
  assert.equal(map.cameras.at(-1)?.duration, 0, 'reduced motion disables camera animation');
  map.window.__navControl('overview');
  assert.equal(map.messages.at(-1)?.following, false);
  assert.equal(map.cameras.at(-1)?.fitted, true);
  map.window.__navControl('north');
  assert.equal(map.messages.at(-1)?.following, false, 'north-up keeps an explored map unlocked');
  assert.equal(
    map.cameras.at(-1)?.center,
    undefined,
    'orientation control does not recenter while exploring',
  );
  map.window.__navControl('follow');
  map.window.__navCamera({ user: null, heading: null, riding: true });
  assert.equal(
    map.cameras.at(-1)?.fitted,
    true,
    'missing GPS frames the route without inventing a position',
  );
  assert.equal(
    route.features.length,
    2,
    'the map contains the route and stop, without a synthetic vehicle',
  );
  const offline = await boot(true);
  assert.equal(offline.messages.at(-1)?.state, 'error', 'asset failures reach the native retry UI');
  console.log(
    'PASS map bridge: tile loading, failure, recovery, GPS camera, route overview and bundled engine failure',
  );
}

void check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
