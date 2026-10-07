// Klient API jakdojade.pl (reverse-engineered z main-*.js, WROCLAW).
// Użycie: node -e "import('./jakdojade-client.mjs').then(async kd => {...})"
// Creds: zmienna JD_CREDS = ścieżka do JSON {login, hash, device}. NIGDY nie commituj.
import crypto from 'node:crypto';
import fs from 'node:fs';

const CREDS_PATH = process.env.JD_CREDS || '';
if (!CREDS_PATH) {
  throw new Error('Brak JD_CREDS: ustaw ścieżkę do creds.json (format {login, hash, device}). Nie commituj sekretów.');
}
const CREDS = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = (s) => b64url(crypto.createHash('sha256').update(s, 'utf8').digest());

function normParams(params) {
  // Qn$3: posortowane klucze (po encodeURIComponent), wartości posortowane, klucze lowercase
  const entries = [];
  for (const [k, v] of params) entries.push([encodeURIComponent(k), Array.isArray(v) ? v : [v]]);
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const usp = new URLSearchParams();
  for (const [k, vals] of entries) {
    const sorted = [...vals].sort((a, b) => {
      const x = encodeURIComponent(a), y = encodeURIComponent(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    for (const v of sorted) usp.append(decodeURIComponent(k).toLowerCase(), v);
  }
  return usp.toString().replace(/:/g, '%3A').replace(/%20/g, '+').replace(/ /g, '+')
    .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/'/g, '%27').replace(/,/g, '%2C').replace(/;/g, '%3B');
}

function sign(path, ts, bodyStr, paramsStr) {
  const bodyHash = bodyStr ? sha256(bodyStr) : '';
  const paramsHash = paramsStr ? sha256(paramsStr) : '';
  const msg = [path, ts, CREDS.login, bodyHash, paramsHash].join('_');
  return b64url(crypto.createHmac('sha512', CREDS.hash).update(msg, 'utf8').digest());
}

export async function kdFetch(urlStr, { method = 'GET', body = null } = {}) {
  const u = new URL(urlStr);
  const ts = Math.floor(Date.now() / 1000).toString();
  const path = u.pathname.toLowerCase();
  const paramsStr = u.search ? normParams([...u.searchParams.entries()]) : '';
  const bodyStr = body ? JSON.stringify(body) : '';
  const headers = {
    'X-jd-param-app-platform': 'web',
    'X-jd-param-app-version': '1.0.0',
    'X-jd-param-locale': 'en',
    'Accept': 'application/json',
    'X-jd-param-user-device-id': CREDS.device,
    'X-jd-timestamp': ts,
    'X-jd-sign': sign(path, ts, bodyStr, paramsStr),
    'X-jd-param-profile-login': CREDS.login,
    'X-jd-security-version': '4',
    'X-jd-ticket-system-version': '33',
  };
  if (bodyStr) headers['Content-Type'] = 'application/json; charset=utf-8';
  const res = await fetch(urlStr, { method, headers, body: bodyStr || undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

export async function searchLocation(query) {
  const url = `https://api.jakdojade.pl/api/jd/v2/locations?suggestions_search_engine=MIXED&query=${encodeURIComponent(query)}&locale=en&no_user_points=false&city_symbol=WROCLAW`;
  const r = await kdFetch(url);
  return r;
}

// Reguła resolve harnessa: STOP_GROUP o name === query.toUpperCase(),
// inaczej pierwszy STOP_GROUP, inaczej locations[0].
export function resolveLoc(locs, query) {
  return locs.find((l) => l.locationType === 'STOP_GROUP' && l.name === query.toUpperCase())
    || locs.find((l) => l.locationType === 'STOP_GROUP')
    || locs[0];
}

export function buildRoutesBody(start, dest, dateTimeIso, { engine = 'DEFAULT' } = {}) {
  return {
    engine,
    fetchType: 'SYNC',
    routesCorrelation: 'COMPUTE_NEXT',
    userLocation: null,
    searchQuery: {
      destination: dest,
      realtimeSearchMode: 'REALTIME_ENABLED',
      routesCount: 7,
      start: start,
      timeOptions: { dateTime: dateTimeIso, queryTimeType: 'DEPARTURE' },
      userConnectionTypePreference: 'OPTIMAL',
      publicTransportOptions: {
        avoidChanges: 'DEFAULT',
        avoidVehicles: [],
        prohibitedVehicles: [],
        prohibitedOperators: [],
        avoidLineTypes: [],
        accessibilityOptions: 'NONE',
        preferredLines: [],
        avoidLines: [],
        forcedChangeTime: null,
      },
    },
    currentRoutes: [],
  };
}

export function mkLoc(name, code, lat, lon) {
  return {
    citySymbol: 'WROCLAW',
    coordinate: { y_lat: lat, x_lon: lon },
    locationType: 'STOP_GROUP',
    locationName: name,
    locationCode: code,
  };
}

export async function queryRoutes(start, dest, dateTimeIso) {
  const body = buildRoutesBody(start, dest, dateTimeIso);
  return kdFetch('https://api.jakdojade.pl/api/jd/v3/routes', { method: 'POST', body });
}

// Uproszczone parsowanie: lista {dep, arr, durationMin, changes, lines[], legs[]}
export function parseRoutes(json) {
  const out = [];
  for (const r of json?.routes || []) {
    const parts = r.routeParts || [];
    if (!parts.length) continue;
    const first = parts[0], last = parts[parts.length - 1];
    const dep = first.startDeparture?.dateTime;
    const arr = last.targetArrival?.dateTime;
    const legs = parts.map((p) => {
      if (p.routePartType === 'WALKING' || p.routePartType === 'FOOT') {
        return { kind: 'walk', dur: p.durationSeconds, dist: p.routePartDistanceMeters };
      }
      const v = p.routeVehicle?.routeVehicle;
      const line = v?.lineName ?? p.routeVehicle?.routeStops?.[0]?.lineStop?.lineStopDynamicId;
      const stops = (p.routeVehicle?.routeStops || []).map((s) => s.lineStop?.stopPoint?.stopName);
      return {
        kind: 'transit', line: v?.lineName ?? null, mode: p.routeVehicle?.routeVehicleType,
        from: stops[0], to: stops[stops.length - 1], stops: stops.length,
        dep: p.startDeparture?.dateTime, arr: p.targetArrival?.dateTime, dist: p.routePartDistanceMeters,
      };
    });
    out.push({ dep, arr, durationSec: r.durationSeconds ?? null, legs, changes: r.changesCount ?? null, raw: r });
  }
  return out;
}
