/**
 * kilometr-timetable - Worker serwujący gotowe rozkłady (Cloudflare free tier).
 *
 * Per-miasto:
 * - GET /{miasto}/manifest.json           → manifest buildu z R2
 * - GET /{miasto}/disruptions.json        → ustrukturyzowane alerty i utrudnienia z R2 (cache 120s)
 * - GET /{miasto}/db/kilometr-gtfs.db.gz  → skompresowany prebuilt SQLite z R2 (Range, ETag)
 * - GET /maps/{miasto}-tiles.ktp          → pakiet kafli offline z R2
 * Miasta: wroclaw, krakow, gzm, warszawa, poznan, trojmiasto, lodz,
 * szczecin, kielce, olsztyn, bialystok, opole, rzeszow, lublin, radom (allowlista CITIES niżej).
 *
 * - GET /api/kd/departures     → PDP /operations (sekret po stronie serwera,
 *                                 cache 120 s - aplikacja tego NA RAZIE nie woła)
 * - GET /api/kd/schedule       → PDP /schedules (cache 1 h, jw.)
 * - GET /health
 *
 * UWAGA: klucz PDP_API_KEY jest sekretem Workera (`wrangler secret put`),
 * nigdy nie trafia do repo ani do aplikacji mobilnej.
 */

export interface Env {
  TIMETABLE_BUCKET: R2Bucket;
  /** Sekret Workera. Lokalnie: `wrangler dev --var PDP_API_KEY:...` albo .dev.vars (gitignore). */
  PDP_API_KEY?: string;
}

/** Miasta z buildami w R2. Nowe miasto = dopisz slug + workflow z --city. */
const CITIES = ['wroclaw', 'krakow', 'gzm', 'warszawa', 'poznan', 'trojmiasto', 'lodz', 'szczecin', 'kielce', 'olsztyn', 'bialystok', 'opole', 'rzeszow', 'lublin', 'radom'] as const;

/** Regex ścieżek per-miasto budowany z CITIES, żeby nowe miasto nie wymagało edycji routingu. */
const CITY_PATH_RE = new RegExp(`^/(${CITIES.join('|')})(/.*)$`);

const PDP_BASE = 'https://pdp-api.plk-sa.pl';

const dbKeyFor = (city: string): string => `${city}/db/kilometr-gtfs.db.gz`;
const manifestKeyFor = (city: string): string => `${city}/manifest.json`;
const disruptionsKeyFor = (city: string): string => `${city}/disruptions.json`;
/**
 * Snapshot adresów OSM (cache buildu timetable.yml): świeży zasila build bez
 * Overpassa, stary jest awaryjnym zapasem. Nigdy nie trafia do telefonu.
 */
const addressesKeyFor = (city: string): string => `${city}/addresses.json.gz`;
/**
 * Pakiet kafelków mapy offline. Buduje go workflow map-tiles.yml (--city),
 * a telefon pobiera raz i trzyma lokalnie (osobny plik na miasto).
 */
const mapPackKeyFor = (city: string): string => `maps/${city}-tiles.ktp`;

function json(data: unknown, status = 200, cacheSeconds = 0): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
  if (cacheSeconds > 0) headers['Cache-Control'] = `public, max-age=${cacheSeconds}`;
  return new Response(JSON.stringify(data), { status, headers });
}

/**
 * Strumieniuje obiekt z R2 z ETag i cache. Wspólne dla pakietu mapy i innych
 * dużych plików: telefon pobiera całość, ale ETag pozwala sprawdzić, czy nie
 * ma już tej samej wersji.
 */
async function serveObject(
  env: Env,
  key: string,
  contentType: string,
  workflowName: string,
): Promise<Response> {
  const obj = await env.TIMETABLE_BUCKET.get(key);
  if (!obj) {
    return json(
      {
        error: 'not-built-yet',
        hint: `Build jeszcze nie wystartował. Odpal workflow ${workflowName} (workflow_dispatch).`,
      },
      404,
    );
  }
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(obj.size));
  if (obj.etag) headers.set('ETag', obj.etag);
  headers.set('Cache-Control', 'public, max-age=300');
  return new Response(obj.body, { headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // HEAD działa jak GET (Runtime sam ucina body) - klient sprawdza rozmiar/ETag.
    if (req.method !== 'GET' && req.method !== 'HEAD') return json({ error: 'method-not-allowed' }, 405);

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'kilometr-timetable', ts: new Date().toISOString(), cities: [...CITIES] });
    }

    // Ścieżki per-miasto: /{miasto}/manifest.json, /{miasto}/disruptions.json, /{miasto}/db/..., /maps/{miasto}-tiles.ktp
    const cityMatch = CITY_PATH_RE.exec(url.pathname);
    if (cityMatch) {
      const [, city, rest] = cityMatch;
      if (rest === '/manifest.json') {
        return serveManifest(env, manifestKeyFor(city));
      }
      if (rest === '/disruptions.json') {
        return serveDisruptions(env, disruptionsKeyFor(city));
      }
      if (rest === '/db/kilometr-gtfs.db.gz') {
        return serveDb(req, env, dbKeyFor(city));
      }
      if (rest === '/addresses.json.gz') {
        return serveObject(env, addressesKeyFor(city), 'application/gzip', 'timetable.yml');
      }
    }
    const mapMatch = /^\/maps\/([a-z]+)-tiles\.ktp$/.exec(url.pathname);
    if (mapMatch && (CITIES as readonly string[]).includes(mapMatch[1])) {
      return serveObject(env, mapPackKeyFor(mapMatch[1]), 'application/octet-stream', 'map-tiles.yml');
    }

    if (url.pathname === '/api/kd/departures' || url.pathname === '/api/kd/schedule') {
      return proxyPdp(req, env, ctx, url.pathname === '/api/kd/departures' ? 'operations' : 'schedules');
    }

    return json({ error: 'not-found' }, 404);
  },
};

async function serveManifest(env: Env, key: string): Promise<Response> {
  const obj = await env.TIMETABLE_BUCKET.get(key);
  if (!obj) {
    return json(
      { error: 'not-built-yet', hint: 'Build jeszcze nie wystartował. Odpal workflow timetable.yml (workflow_dispatch).' },
      404,
    );
  }
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (obj.etag) headers.set('ETag', obj.etag);
  // 60 s cache w przeglądarce / CDN, żeby nie dusić R2 przy wielu sprawdzeniach.
  headers.set('Cache-Control', 'public, max-age=60');
  return new Response(obj.body, { headers });
}

async function serveDisruptions(env: Env, key: string): Promise<Response> {
  const obj = await env.TIMETABLE_BUCKET.get(key);
  if (!obj) {
    return json({ alerts: [], generated_at: new Date().toISOString() }, 200, 60);
  }
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (obj.etag) headers.set('ETag', obj.etag);
  // 120 s cache na krawędzi CDN
  headers.set('Cache-Control', 'public, max-age=120');
  return new Response(obj.body, { headers });
}

/**
 * Serwuje bazę SQLite (skompresowaną gzipem) z obsługą Range requests
 * (potrzebne do wznawiania downloadu w aplikacji przez expo-file-system).
 */
async function serveDb(req: Request, env: Env, key: string): Promise<Response> {
  const range = req.headers.get('Range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const head = await env.TIMETABLE_BUCKET.head(key);
    if (!head) {
      return json(
        { error: 'not-built-yet', hint: 'Build jeszcze nie wystartował. Odpal workflow timetable.yml (workflow_dispatch).' },
        404,
      );
    }
    const total = head.size;
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    if (start > end || start >= total) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` },
      });
    }

    const obj = await env.TIMETABLE_BUCKET.get(key, { range: { offset: start, length: end - start + 1 } });
    if (!obj) return json({ error: 'r2-read-failed' }, 500);

    const headers = new Headers();
    headers.set('Content-Type', 'application/gzip');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
    headers.set('Content-Length', String(end - start + 1));
    if (head.etag) headers.set('ETag', head.etag);
    headers.set('Cache-Control', 'public, max-age=300');
    return new Response(obj.body, { status: 206, headers });
  }

  return serveObject(env, key, 'application/gzip', 'timetable.yml');
}

/**
 * Proksy do PDP API (PLK) z walidacją i cache po stronie Workera.
 * Dzięki temu aplikacja nie dostaje klucza do PDP ani nie uderza bezpośrednio
 * w API PLK (ochrona limitu zapytań).
 */
async function proxyPdp(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  endpoint: 'operations' | 'schedules',
): Promise<Response> {
  if (!env.PDP_API_KEY) {
    return json({ error: 'pdp-disabled', hint: 'Brak PDP_API_KEY w secretach Workera.' }, 503);
  }

  const url = new URL(req.url);
  const cacheKey = new Request(url.toString(), req);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const targetUrl = new URL(`/api/v1/${endpoint}${url.search}`, PDP_BASE);
  const upstreamRes = await fetch(targetUrl.toString(), {
    headers: {
      'X-API-KEY': env.PDP_API_KEY,
      Accept: 'application/json',
    },
  });

  if (!upstreamRes.ok) {
    return json(
      { error: 'upstream-error', status: upstreamRes.status },
      upstreamRes.status === 404 ? 404 : 502,
    );
  }

  const data = await upstreamRes.json();
  const ttl = endpoint === 'operations' ? 120 : 3600;
  const res = json(data, 200, ttl);
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
