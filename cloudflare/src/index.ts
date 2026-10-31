/**
 * kilometr-timetable - Worker serwujący gotowe rozkłady (Cloudflare free tier).
 *
 * Per-miasto:
 * - GET /{miasto}/manifest.json           → manifest buildu z R2
 * - GET /{miasto}/disruptions.json        → ustrukturyzowane alerty i utrudnienia z R2 (cache 120s)
 * - GET /{miasto}/stop-hints.json         → mikrowskazówki lokalizacyjne przystanków z R2
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
const stopHintsKeyFor = (city: string): string => `${city}/stop-hints.json`;
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

    // Ścieżki per-miasto: /{miasto}/manifest.json, /{miasto}/disruptions.json, /{miasto}/stop-hints.json, /{miasto}/db/..., /maps/{miasto}-tiles.ktp
    const cityMatch = CITY_PATH_RE.exec(url.pathname);
    if (cityMatch) {
      const [, city, rest] = cityMatch;
      if (rest === '/manifest.json') {
        return serveManifest(env, manifestKeyFor(city));
      }
      if (rest === '/disruptions.json') {
        return serveDisruptions(env, disruptionsKeyFor(city));
      }
      if (rest === '/stop-hints.json') {
        return serveObject(env, stopHintsKeyFor(city), 'application/json; charset=utf-8', 'stop-hints');
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
    // Brak alertów = pusta lista w formacie feedu, a nie 404.
    // Telefon traktuje to jako brak utrudnień w mieście i nie loguje błędu.
    return json({ alerts: [], generatedAt: new Date().toISOString() }, 200, 120);
  }
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (obj.etag) headers.set('ETag', obj.etag);
  // 120 s cache w przeglądarce / CDN - alerty odświeżamy co 20 minut,
  // więc krótszy cache jest świeży, ale nie obciąża R2.
  headers.set('Cache-Control', 'public, max-age=120');
  return new Response(obj.body, { headers });
}

async function serveDb(req: Request, env: Env, key: string): Promise<Response> {
  // Range requesty (pobieranie we fragmentach): telefon może wznawiać.
  const rangeHeader = req.headers.get('Range');
  const range = parseRange(rangeHeader);

  const obj = await env.TIMETABLE_BUCKET.get(key, { range: range ?? undefined });
  if (!obj) {
    return json(
      { error: 'not-built-yet', hint: 'Baza SQLite jeszcze nie istnieje w R2. Odpal timetable.yml.' },
      404,
    );
  }

  const headers = new Headers();
  // Celowo octet-stream + brak Content-Encoding: gzip - plik NA DYSKU to .db.gz,
  // telefon sam go dekompresuje po pobraniu. Gdyby Worker dał Content-Encoding:
  // gzip, przeglądarka/fetch rozpakowałaby go po cichu w locie, niszcząc logikę
  // dekompresji po stronie klienta.
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Accept-Ranges', 'bytes');
  if (obj.etag) headers.set('ETag', obj.etag);
  headers.set('Cache-Control', 'public, max-age=3600');

  if (range && 'offset' in range) {
    const end = range.length !== undefined ? range.offset + range.length - 1 : obj.size - 1;
    headers.set('Content-Range', `bytes ${range.offset}-${end}/${obj.size}`);
    headers.set('Content-Length', String(end - range.offset + 1));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

function parseRange(h: string | null): { offset: number; length?: number } | null {
  if (!h) return null;
  const m = /^bytes=(\d+)-(\d+)?$/.exec(h.trim());
  if (!m) return null;
  const start = parseInt(m[1], 10);
  if (Number.isNaN(start)) return null;
  if (m[2] !== undefined) {
    const end = parseInt(m[2], 10);
    if (!Number.isNaN(end) && end >= start) return { offset: start, length: end - start + 1 };
  }
  return { offset: start };
}

async function proxyPdp(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  endpoint: 'operations' | 'schedules',
): Promise<Response> {
  const key = env.PDP_API_KEY;
  if (!key) {
    return json({ error: 'pdp-not-configured', hint: 'Klucz PDP_API_KEY nie jest ustawiony w Workerze.' }, 503);
  }

  const inUrl = new URL(req.url);
  const outUrl = new URL(`${PDP_BASE}/${endpoint}${inUrl.search}`);

  // Cache API Cloudflare - redukuje ruch do PDP (limit rate'u).
  const cacheKey = new Request(outUrl.toString(), { headers: req.headers });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const res = await fetch(outUrl.toString(), {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'User-Agent': 'kilometr-timetable-worker/1.0',
    },
  });

  const body = await res.arrayBuffer();
  const ttl = endpoint === 'operations' ? 120 : 3600;
  const headers = new Headers();
  headers.set('Content-Type', res.headers.get('Content-Type') ?? 'application/json; charset=utf-8');
  headers.set('Cache-Control', `public, max-age=${ttl}`);

  const out = new Response(body, { status: res.status, headers });
  if (res.ok) ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}
