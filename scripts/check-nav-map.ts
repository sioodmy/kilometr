import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { buildNavMapDocument } from '../src/map/navMapDocument';

type Message = { t: string; state?: string };
type MapEvent = { sourceId?: string; tile?: { state: string }; error?: Error };
type Element = {
  onload: () => void;
  onerror: () => void;
  remove: () => void;
  src?: string;
  href?: string;
};

async function boot(failAssets = false) {
  const messages: Message[] = [];
  const events = new Map<string, (event: MapEvent) => void>();
  const cameras: Record<string, unknown>[] = [];
  const sources: unknown[] = [];
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
      cameras.push(options);
    }
    fitBounds(_bounds: unknown, options: Record<string, unknown>) {
      cameras.push({ ...options, fitted: true });
    }
  }
  const context = {
    window: {
      ReactNativeWebView: { postMessage: (data: string) => messages.push(JSON.parse(data)) },
      addEventListener: () => undefined,
    } as Record<string, any>,
    document: {
      createElement: () => ({ remove: () => undefined }),
      head: {
        appendChild: (element: Element) =>
          queueMicrotask(() => (failAssets ? element.onerror() : element.onload())),
      },
    },
    maplibregl: {
      Map: FakeMap,
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
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
    runInNewContext(script[1], context);
  await new Promise<void>((resolve) => setImmediate(resolve));
  return {
    messages,
    cameras,
    sources,
    window: context.window,
    emit: (name: string, event: MapEvent = {}) => events.get(name)?.(event),
    loaded: () => {
      tilesLoaded = true;
      sourceLoaded = true;
    },
  };
}

async function check() {
  const map = await boot();
  map.emit('style.load');
  assert.deepEqual(map.messages, [{ t: 'ready' }]);
  map.emit('render');
  assert.equal(map.messages.length, 1, 'style readiness must not hide the tile spinner');
  map.emit('dataloading', { sourceId: 'openmaptiles' });
  assert.equal(map.messages.at(-1)?.state, 'loading');
  map.emit('sourcedata', { sourceId: 'openmaptiles', tile: { state: 'loaded' } });
  map.emit('render');
  assert.equal(map.messages.at(-1)?.state, 'loading', 'wait for the visible tiles to finish');
  map.loaded();
  map.emit('render');
  assert.equal(map.messages.at(-1)?.state, 'ready');
  map.emit('dataloading', { sourceId: 'openmaptiles' });
  map.emit('error', { error: new Error('tile unavailable') });
  assert.equal(map.messages.at(-1)?.state, 'error');
  map.emit('render');
  assert.equal(
    map.messages.at(-1)?.state,
    'error',
    'failed tiles cannot masquerade as a loaded map',
  );
  map.emit('sourcedata', { sourceId: 'openmaptiles', tile: { state: 'loaded' } });
  map.emit('render');
  assert.equal(map.messages.at(-1)?.state, 'ready', 'successful tile retry recovers the map');

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
  map.window.__navCamera({ user: [51.105, 17.005], heading: 1, riding: true });
  assert.equal(map.cameras.at(-1)?.bearing, 361, 'camera takes the short rotation across north');
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
    'PASS map bridge: tile loading, failure, recovery, GPS camera, route overview and CDN failure',
  );
}

void check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
