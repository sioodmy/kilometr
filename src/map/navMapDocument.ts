import { buildMapStyle, ROUTE_SOURCE_ID } from './mapStyle';
import { bundledMapLibreHead } from './bundledMapLibre';
import { scheme } from '../theme/tokens';

export interface NavMapDocumentOptions {
  offlineBase: string | null;
  center?: [number, number] | null;
}

const runtime = (routeSourceId: string) => `
(function () {
  var map = null;
  var sourceId = ${JSON.stringify(routeSourceId)};
  var route = {};
  var camera = {};
  var following = true;
  var northUp = false;
  var initialized = false;
  var framed = false;
  var userMarker = null;
  var vehicleMarker = null;
  var lastStatus = '';
  var tileContent = false;
  function post(message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  function status(value) {
    if (lastStatus === value) return;
    lastStatus = value;
    post({ t: 'tiles', state: value });
  }
  function state() {
    post({ t: 'tracking', following: following, northUp: northUp, bearing: map.getBearing() });
  }
  function line(path, passed) {
    return {
      type: 'Feature',
      properties: { walk: route.riding ? 0 : 1, sel: passed ? 1 : 2, color: passed ? '#899390' : route.accent },
      geometry: { type: 'LineString', coordinates: path.map(function (p) { return [p[1], p[0]]; }) },
    };
  }
  function updateRoute(msg) {
    if (route.id !== msg.id) {
      following = true;
      initialized = false;
      framed = false;
      if (map) state();
    }
    route = msg;
    var features = [];
    if (msg.traveled && msg.traveled.length > 1) features.push(line(msg.traveled, true));
    if (msg.path && msg.path.length > 1) features.push(line(msg.path, false));
    (msg.stops || []).concat(msg.stop ? [msg.stop] : []).forEach(function (p) {
      features.push({
        type: 'Feature',
        properties: { role: 'intermediate', walk: 0, sel: 2, color: msg.accent },
        geometry: { type: 'Point', coordinates: [p[1], p[0]] },
      });
    });
    if (map) {
      var source = map.getSource(sourceId);
      if (source) source.setData({ type: 'FeatureCollection', features: features });
    }
  }
  function shortestBearing(current, target) {
    return current + ((target - current + 540) % 360) - 180;
  }
  function marker(existing, position, vehicle) {
    if (!position) {
      if (existing) existing.remove();
      return null;
    }
    if (!existing) {
      var el = document.createElement('div');
      el.className = vehicle ? 'vehicle-marker' : 'user-marker';
      if (vehicle) {
        el.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 11h14M9 3v8M15 3v8M8 18l-2 3M16 18l2 3"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/></svg><span></span>';
      } else {
        el.innerHTML = '<div class="user-cone"></div><div class="user-dot"></div>';
      }
      existing = new maplibregl.Marker({ element: el, rotationAlignment: vehicle ? 'viewport' : 'map', pitchAlignment: 'viewport' });
      existing.setLngLat([position[1], position[0]]).addTo(map);
    }
    existing.setLngLat([position[1], position[0]]);
    var element = existing.getElement();
    if (vehicle) {
      element.style.background = route.accent;
      element.querySelector('span').textContent = route.label || '';
    } else {
      existing.setRotation(camera.userHeading || 0);
      element.querySelector('.user-cone').style.display = camera.userHeading == null ? 'none' : 'block';
    }
    return existing;
  }
  function overview() {
    var coordinates = (route.traveled || []).concat(route.path || [], route.stop ? [route.stop] : []);
    if (camera.user) coordinates.push(camera.user);
    if (camera.vehicle) coordinates.push(camera.vehicle);
    if (!coordinates.length) return;
    var first = [coordinates[0][1], coordinates[0][0]];
    var bounds = coordinates.reduce(function (b, p) { return b.extend([p[1], p[0]]); }, new maplibregl.LngLatBounds(first, first));
    map.fitBounds(bounds, { padding: 54, maxZoom: 16, duration: camera.reduceMotion ? 0 : 350, bearing: 0 });
    framed = true;
  }
  function follow(force) {
    if (!map || !following) return;
    var position = camera.user || camera.vehicle;
    if (!position) {
      initialized = false;
      if (!framed || force) overview();
      return;
    }
    framed = false;
    var bearing = northUp ? 0 : typeof camera.heading === 'number' ? camera.heading : map.getBearing();
    var options = {
      center: [position[1], position[0]],
      bearing: shortestBearing(map.getBearing(), bearing),
      duration: camera.reduceMotion ? 0 : force ? 350 : camera.headingOnly ? 100 : 550,
      essential: false,
    };
    if (!initialized || force) options.zoom = route.riding ? 15.5 : 17;
    if (!initialized) {
      map.jumpTo(options);
      initialized = true;
    } else map.easeTo(options);
  }
  function updateCamera(msg) {
    camera = msg;
    if (!map) return;
    userMarker = marker(userMarker, msg.user, false);
    vehicleMarker = marker(vehicleMarker, msg.vehicle, true);
    follow(false);
  }
  window.__navRoute = updateRoute;
  window.__navCamera = updateCamera;
  window.__navControl = function (action) {
    if (!map) return;
    if (action === 'overview') {
      following = false;
      overview();
    } else if (action === 'north') {
      northUp = !northUp;
      if (following) follow(false);
      else map.easeTo({
        bearing: shortestBearing(map.getBearing(), northUp ? 0 : camera.heading || 0),
        duration: camera.reduceMotion ? 0 : 250, essential: false,
      });
    } else {
      following = true;
      follow(true);
    }
    state();
  };
  function unlock(event) {
    if (!event.originalEvent) return;
    following = false;
    if (event.type === 'rotatestart') northUp = false;
    state();
  }
  if (typeof maplibregl === 'undefined') { status('error'); return; }
  try {
    map = new maplibregl.Map({
      container: 'map', style: window.__NAV__.style,
      center: window.__NAV__.center || [0, 0], zoom: 17, bearing: 0,
      interactive: true, attributionControl: false, fadeDuration: 0,
      renderWorldCopies: false, pitchWithRotate: false, maxPitch: 0,
    });
    map.on('dragstart', unlock);
    map.on('zoomstart', unlock);
    map.on('rotatestart', unlock);
    map.on('rotateend', state);
    map.on('resize', function () { follow(false); });
    map.on('style.load', function () { post({ t: 'ready' }); });
    map.on('dataloading', function (event) {
      if (event.sourceId === 'openmaptiles' && !tileContent) status('loading');
    });
    map.on('sourcedata', function (event) {
      if (event.sourceId === 'openmaptiles' && event.tile && event.tile.state === 'loaded') tileContent = true;
    });
    map.on('render', function () {
      if (tileContent && map.areTilesLoaded() && map.isSourceLoaded('openmaptiles')) status('ready');
    });
    map.on('error', function (event) {
      if (event && event.error && !tileContent) status('error');
    });
  } catch (_) { status('error'); }
})();
`;

export function buildNavMapDocument({ offlineBase, center }: NavMapDocumentOptions): string {
  const payload = JSON.stringify({
    style: buildMapStyle(offlineBase),
    center: center ?? null,
  }).replace(/</g, '\\u003c');
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
    bundledMapLibreHead(),
    `<style>
      html,body,#map{position:absolute;inset:0;width:100%;height:100%;margin:0;overflow:hidden;background:#101413}
      *{box-sizing:border-box}.maplibregl-ctrl-attrib{display:none!important}
      .user-marker{width:44px;height:44px;pointer-events:none}
      .user-dot{position:absolute;inset:12px;border:3px solid #fff;border-radius:50%;background:${scheme.primary};box-shadow:0 0 0 8px ${scheme.primary}25}
      .user-cone{position:absolute;left:5px;top:-18px;width:34px;height:42px;background:${scheme.primary}70;clip-path:polygon(0 0,100% 0,50% 100%)}
      .vehicle-marker{min-width:42px;min-height:42px;padding:7px;display:flex;align-items:center;justify-content:center;gap:4px;border:2px solid #fff;border-radius:14px;color:#101413;pointer-events:none;box-shadow:0 2px 6px #0008}
      .vehicle-marker span{font:700 15px system-ui}
    </style></head><body><div id="map"></div>`,
    `<script>window.__NAV__=${payload};</script>`,
    `<script>${runtime(ROUTE_SOURCE_ID)}</script></body></html>`,
  ].join('');
}
