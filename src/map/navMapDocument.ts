import { buildMapStyle, ROUTE_SOURCE_ID } from './mapStyle';
import { bundledMapLibreHead } from './bundledMapLibre';

export interface NavMapDocumentOptions {
  offlineBase: string | null;
  /** Startowa kamera [lon, lat]. Default: środek aktywnego miasta. */
  center?: [number, number] | null;
}

const runtime = (routeSourceId: string) => `
(function () {
  var map = null;
  var sourceId = ${JSON.stringify(routeSourceId)};
  var currentRoute = { type: 'FeatureCollection', features: [] };
  var tileContent = false;
  var lastStatus = '';
  function post(message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  function status(value) {
    if (lastStatus === value) return;
    lastStatus = value;
    post({ t: 'tiles', state: value });
  }
  function loadAssets() {
    return typeof maplibregl === 'undefined'
      ? Promise.reject(new Error('ERR_MAPLIBRE_UNAVAILABLE'))
      : Promise.resolve();
  }
  function routeData(msg) {
    var features = [];
    if (Array.isArray(msg.path) && msg.path.length > 1) {
      features.push({
        type: 'Feature',
        properties: { walk: msg.riding ? 0 : 1, sel: 2, color: msg.accent || '#BFC9C5' },
        geometry: {
          type: 'LineString',
          coordinates: msg.path.map(function (p) { return [p[1], p[0]]; }),
        },
      });
    }
    if (msg.stop) {
      features.push({
        type: 'Feature',
        properties: { role: 'intermediate', walk: 0, sel: 2, color: msg.accent || '#BFC9C5' },
        geometry: { type: 'Point', coordinates: [msg.stop[1], msg.stop[0]] },
      });
    }
    return { type: 'FeatureCollection', features: features };
  }
  function updateRoute(msg) {
    currentRoute = routeData(msg);
    if (!map) return;
    var source = map.getSource(sourceId);
    if (source) source.setData(currentRoute);
  }
  var hasInitialCamera = false;
  function shortestBearing(current, target) {
    var diff = ((target - current + 540) % 360) - 180;
    return current + diff;
  }
  function updateCamera(msg, animate) {
    if (!map) return;
    if (!msg.user) {
      hasInitialCamera = false;
      var coordinates = currentRoute.features.reduce(function (all, feature) {
        return all.concat(feature.geometry.type === 'LineString' ? feature.geometry.coordinates : [feature.geometry.coordinates]);
      }, []);
      if (coordinates.length > 1) {
        var bounds = coordinates.reduce(function (b, p) { return b.extend(p); }, new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
        map.fitBounds(bounds, { padding: 36, maxZoom: 16, duration: 0, bearing: 0 });
      } else if (coordinates.length === 1) map.jumpTo({ center: coordinates[0], zoom: 16, bearing: 0 });
      return;
    }
    var nextLon = msg.user[1];
    var nextLat = msg.user[0];
    var rawBearing = typeof msg.heading === 'number' && isFinite(msg.heading) ? msg.heading : 0;
    if (!hasInitialCamera || !animate) {
      hasInitialCamera = true;
      map.jumpTo({
        center: [nextLon, nextLat],
        bearing: rawBearing,
        zoom: msg.riding ? 15.5 : 17,
      });
      return;
    }
    var curCenter = map.getCenter();
    var jumpDeg = Math.hypot(nextLon - curCenter.lng, nextLat - curCenter.lat);
    if (jumpDeg > 0.0025) {
      map.jumpTo({
        center: [nextLon, nextLat],
        bearing: rawBearing,
        zoom: msg.riding ? 15.5 : 17,
      });
      return;
    }
    var targetBearing = shortestBearing(map.getBearing(), rawBearing);
    map.easeTo({
      center: [nextLon, nextLat],
      bearing: targetBearing,
      zoom: msg.riding ? 15.5 : 17,
      duration: 240,
      essential: false,
    });
  }
  window.__navRoute = updateRoute;
  window.__navCamera = function (msg) { updateCamera(msg, true); };
  window.__navUpdate = function (msg) {
    updateRoute(msg);
    updateCamera(msg, true);
  };
  window.addEventListener('message', function (event) {
    try {
      var msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (msg && msg.t === 'route') updateRoute(msg);
      if (msg && msg.t === 'camera') updateCamera(msg, true);
    } catch (_) {}
  });
  loadAssets().then(function () {
    map = new maplibregl.Map({
      container: 'map',
      style: window.__NAV__.style,
      center: window.__NAV__.center || [0, 0],
      zoom: 17,
      bearing: 0,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      renderWorldCopies: false,
    });
    map.on('style.load', function () {
      post({ t: 'ready' });
    });
    map.on('dataloading', function (event) {
      if (event.sourceId === 'openmaptiles') {
        if (lastStatus !== 'loading') tileContent = false;
        status('loading');
      }
    });
    map.on('sourcedata', function (event) {
      if (event.sourceId === 'openmaptiles' && event.tile && event.tile.state === 'loaded') tileContent = true;
    });
    map.on('render', function () {
      if (tileContent && map.areTilesLoaded() && map.isSourceLoaded('openmaptiles')) status('ready');
    });
    map.on('error', function (event) {
      if (event && event.error) {
        tileContent = false;
        status('error');
      }
    });
  }).catch(function () {
    status('error');
  });
})();
`;

export function buildNavMapDocument({ offlineBase, center }: NavMapDocumentOptions): string {
  const mapStyle = buildMapStyle(offlineBase);
  const payload = JSON.stringify({ style: mapStyle, center: center ?? null }).replace(
    /</g,
    '\\u003c',
  );
  return [
    '<!doctype html>',
    '<html><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
    '<meta name="color-scheme" content="dark">',
    bundledMapLibreHead(),
    '<style>html,body,#map{position:absolute;inset:0;width:100%;height:100%;margin:0;overflow:hidden;background:#101413}*{box-sizing:border-box}.maplibregl-ctrl-attrib{display:none!important}</style>',
    '</head><body>',
    '<div id="map"></div>',
    `<script>window.__NAV__=${payload};</script>`,
    `<script>${runtime(ROUTE_SOURCE_ID)}</script>`,
    '</body></html>',
  ].join('');
}
