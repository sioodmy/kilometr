/**
 * kilometr-timetable — Worker serwujący gotowe rozkłady (Cloudflare free tier).
 *
 * - GET /manifest.json         → manifest buildu z R2 (wersja, statystyki)
 * - GET /db/kilometr-gtfs.db   → prebuilt SQLite z R2 (Range, ETag, cache 5 min)
 * - GET /api/kd/departures     → PDP /operations (sekret po stronie serwera,
 *                                 cache 120 s — aplikacja tego NA RAZIE nie woła)
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

const PDP_BASE = 'https://pdp-api.plk-sa.pl';
const DB_KEY = 'db/kilometr-gtfs.db';
const MANIFEST_KEY = 'manifest.json';
/**
 * Pakiet kafelków mapy offline (Wrocław). Buduje go workflow map-tiles.yml,
 * a telefon pobiera raz i trzyma lokalnie.
 */
const MAP_PACK_KEY = 'maps/wroclaw-tiles.ktp';

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
        hint: `Build jeszcze nie wystartował — odpal workflow ${workflowName} (workflow_dispatch).`,
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

    // HEAD działa jak GET (Runtime sam ucina body) — klient sprawdza rozmiar/ETag.
    if (req.method !== 'GET' && req.method !== 'HEAD') return json({ error: 'method-not-allowed' }, 405);

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'kilometr-timetable', ts: new Date().toISOString() });
    }

    if (url.pathname === '/manifest.json') {
      const obj = await env.TIMETABLE_BUCKET.get(MANIFEST_KEY);
      if (!obj) {
        return json(
          { error: 'not-built-yet', hint: 'Build jeszcze nie wystartował — odpal workflow timetable.yml (workflow_dispatch).' },
          404,
        );
      }
      const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
      headers.set('Cache-Control', 'public, max-age=300');
      if (obj.etag) headers.set('ETag', obj.etag);
      return new Response(obj.body, { headers });
    }

    if (url.pathname === '/db/kilometr-gtfs.db') {
      // Uwaga: HEAD działa tak samo (Runtime sam ucina body).
      const range = req.headers.get('Range');
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        const head = await env.TIMETABLE_BUCKET.head(DB_KEY);
        if (!head) {
          return json(
            { error: 'not-built-yet', hint: 'Build jeszcze nie wystartował — odpal workflow timetable.yml (workflow_dispatch).' },
            404,
          );
        }
        if (m) {
          const size = head.size;
          let start = m[1] === '' ? size - Number(m[2] || 0) : Number(m[1]);
          let end = m[2] === '' ? size - 1 : Number(m[2]);
          if (Number.isNaN(start)) start = 0;
          if (Number.isNaN(end)) end = size - 1;
          start = Math.max(0, start);
          end = Math.min(size - 1, end);
          if (start <= end) {
            const obj = await env.TIMETABLE_BUCKET.get(DB_KEY, {
              range: { offset: start, length: end - start + 1 },
            });
            if (obj) {
              const headers = new Headers();
              headers.set('Content-Type', 'application/x-sqlite3');
              headers.set('Accept-Ranges', 'bytes');
              headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
              headers.set('Content-Length', String(end - start + 1));
              if (head.etag) headers.set('ETag', head.etag);
              headers.set('Cache-Control', 'public, max-age=300');
              return new Response(obj.body, { status: 206, headers });
            }
          }
        }
      }
      const obj = await env.TIMETABLE_BUCKET.get(DB_KEY);
      if (!obj) {
        return json(
          { error: 'not-built-yet', hint: 'Build jeszcze nie wystartował — odpal workflow timetable.yml (workflow_dispatch).' },
          404,
        );
      }
      const headers = new Headers();
      headers.set('Content-Type', 'application/x-sqlite3');
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Content-Length', String(obj.size));
      if (obj.etag) headers.set('ETag', obj.etag);
      headers.set('Cache-Control', 'public, max-age=300');
      return new Response(obj.body, { headers });
    }

    if (url.pathname === '/api/kd/departures' || url.pathname === '/api/kd/schedule') {
      return proxyPdp(req, env, ctx, url.pathname === '/api/kd/departures' ? 'operations' : 'schedules');
    }

    if (url.pathname === '/maps/wroclaw-tiles.ktp') {
      return serveObject(env, MAP_PACK_KEY, 'application/octet-stream', 'map-tiles.yml');
    }

    return json({ error: 'not-found' }, 404);
  },
};

/**
 * Gotowość pod przyszłe opóźnienia KD — passthrough do PDP z cache,
 * żeby wielu użytkowników dzieliło jeden request (limity Basic!).
 * Aplikacja mobilna tego NA RAZIE nie woła → koszt PDP = 0.
 */
async function proxyPdp(req: Request, env: Env, ctx: ExecutionContext, kind: 'operations' | 'schedules'): Promise<Response> {
  if (!env.PDP_API_KEY) {
    return json({ error: 'kd-not-configured', hint: 'Brak sekretu PDP_API_KEY w Workerze (wrangler secret put).' }, 503);
  }
  const url = new URL(req.url);
  const stations = (url.searchParams.get('stations') ?? '').trim();
  if (!/^[0-9, ]{1,200}$/.test(stations) || !/\d/.test(stations)) {
    return json({ error: 'bad-stations', hint: 'Podaj stations=jako ID po przecinku, np. ?stations=33506,33512.' }, 400);
  }
  // Deduplikacja + sortowanie normalizuje klucz cache: ta sama lista w innej
  // kolejności trafia w ten sam wpis, zamiast omijać cache i palić limit PDP.
  const idList = Array.from(new Set(stations.split(',').map((s) => s.trim()).filter(Boolean)));
  if (idList.length === 0 || idList.length > 30) {
    return json({ error: 'bad-stations', hint: 'Podaj od 1 do 30 unikalnych ID stacji.' }, 400);
  }
  const ids = idList.join(',');

  const upstream = new URL(PDP_BASE + (kind === 'operations' ? '/api/v1/operations/shortened' : '/api/v1/schedules/shortened'));
  upstream.searchParams.set('stations', ids);
  if (kind === 'operations') {
    upstream.searchParams.set('withPlanned', url.searchParams.get('withPlanned') === 'false' ? 'false' : 'true');
    const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 1000, 1), 5000);
    upstream.searchParams.set('pageSize', String(pageSize));
  } else {
    const df = url.searchParams.get('dateFrom');
    const dt = url.searchParams.get('dateTo');
    if (df && /^\d{4}-\d{2}-\d{2}$/.test(df)) upstream.searchParams.set('dateFrom', df);
    if (dt && /^\d{4}-\d{2}-\d{2}$/.test(dt)) upstream.searchParams.set('dateTo', dt);
    upstream.searchParams.set('carriersInclude', url.searchParams.get('carriersInclude') || 'KD');
    upstream.searchParams.set('dictionaries', 'false');
  }

  const cache = caches.default;
  const cacheKey = new Request(upstream.toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      headers: { 'X-API-Key': env.PDP_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    return json({ error: 'pdp-unreachable', detail: String(err) }, 502);
  }
  if (!res.ok) {
    return json({ error: 'pdp-error', status: res.status }, res.status === 429 ? 429 : 502);
  }
  const body = await res.text();
  const ttl = kind === 'operations' ? 120 : 3600;
  const out = new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${ttl}` },
  });
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}
