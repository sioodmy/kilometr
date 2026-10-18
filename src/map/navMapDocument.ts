import { buildMapStyle, ROUTE_SOURCE_ID } from './mapStyle';
import type { Coord } from '../services/routeGeometry';

const MAPLIBRE_VERSION = '4.7.1';
const CDN_ASSETS = [
  `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist`,
  `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist`,
];

export interface NavMapDocumentOptions {
  offlineBase: string | null;
}

const runtime = (routeSourceId: string) => `
(function () {
  var map = null;
  var sourceId = ${JSON.stringify(routeSourceId)};
  var assets = window.__NAV__.assets;
  var index = 0;
  var currentRoute = { type: 'FeatureCollection', features: [] };
  function loadAssets() {
    if (index >= assets.length) return Promise.reject(new Error('map assets unavailable'));
    var base = assets[index++];
    return new Promise(function (resolve, reject) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = base + '/maplibre-gl.css';
      css.onload = resolve;
      css.onerror = reject;
      document.head.appendChild(css);
    }).then(function () {
      return new Promise(function (resolve, reject) {
        var js = document.createElement('script');
        js.src = base + '/maplibre-gl.js';
        js.onload = resolve;
        js.onerror = reject;
        document.head.appendChild(js);
      });
    }).catch(loadAssets);
  }
  function routeData(msg) {
    var features = [];
    if (Array.isArray(msg.path) && msg.path.length > 1) {
      features.push({
        type: 'Feature',
        properties: { walk: 1, sel: 2, color: msg.accent || '#BFC9C5' },
        geometry: {
          type: 'LineString',
          coordinates: msg.path.map(function (p) { return [p[1], p[0]]; }),
        },
      });
    }
    if (msg.stop) {
      features.push({
        type: 'Feature',
        properties: { role: 'intermediate', walk: 0, sel: 2 },
        geometry: { type: 'Point', coordinates: [msg.stop[1], msg.stop[0]] },
      });
    }
    return { type: 'FeatureCollection', features: features };
  }
  function updateRoute(msg) {
    currentRoute = routeData(msg);
    var source = map.getSource(sourceId);
    if (source) source.setData(currentRoute);
  }
  function updateCamera(msg, animate) {
    if (!map || !msg.user) return;
    var bearing = typeof msg.heading === 'number' && isFinite(msg.heading) ? msg.heading : 0;
    map.easeTo({
      center: [msg.user[1], msg.user[0]],
      bearing: bearing,
      zoom: 17,
      duration: animate ? 220 : 0,
      essential: true,
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
      center: [17.0385, 51.1079],
      zoom: 17,
      bearing: 0,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      renderWorldCopies: false,
    });
    map.on('load', function () {
      updateRoute({ path: [], stop: null, accent: '#BFC9C5' });
      window.ReactNativeWebView.postMessage(JSON.stringify({ t: 'ready' }));
    });
    map.on('error', function (event) {
      if (event && event.error) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ t: 'error' }));
      }
    });
  }).catch(function () {
    window.ReactNativeWebView.postMessage(JSON.stringify({ t: 'error' }));
  });
})();
`;

export function buildNavMapDocument({ offlineBase }: NavMapDocumentOptions): string {
  const mapStyle = buildMapStyle(offlineBase);
  const assets = offlineBase ? [`${offlineBase}/assets`] : CDN_ASSETS;
  const payload = JSON.stringify({ assets, style: mapStyle }).replace(/</g, '\\u003c');
  return [
    '<!doctype html>',
    '<html><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
    '<meta name="color-scheme" content="dark">',
    '<style>html,body,#map{position:absolute;inset:0;width:100%;height:100%;margin:0;overflow:hidden;background:#101413}*{box-sizing:border-box}.maplibregl-ctrl-attrib{display:none!important}</style>',
    '</head><body>',
    '<div id="map"></div>',
    `<script>window.__NAV__=${payload};</script>`,
    `<script>${runtime(ROUTE_SOURCE_ID)}</script>`,
    '</body></html>',
  ].join('');
}
