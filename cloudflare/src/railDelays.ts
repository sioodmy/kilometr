/**
 * Obsługa live opóźnień pociągów ogólnopolskich z feedu PKP PLK via mkuran.pl.
 *
 * Źródło: https://mkuran.pl/gtfs/polish_trains/updates.json (CC BY 4.0 + PKP PLK terms).
 * Feed aktualizowany co ~60 s na Cloudflare.
 *
 * Worker buforuje feed w pamięci instancji (TTL 45 s) z nagłówkiem If-None-Match (ETag)
 * oraz wykorzystuje Cloudflare Cache API (caches.default, s-maxage=30) dla zapytań brzegowych,
 * minimalizując zużycie CPU i żądań w ramach Free Tier.
 * Zwraca wycięte dane wyłącznie dla odpytywanych trip_id lub numerów pociągów,
 * oszczędzając transfer (aplikacja mobilna pobiera ułamek kilobajta zamiast 22 MB).
 */

const FEED_URL = 'https://mkuran.pl/gtfs/polish_trains/updates.json';
const FEED_TTL_MS = 45_000;

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface RawStopTimeUpdate {
  stop_sequence: number;
  stop_id?: string;
  arrival?: string;
  departure?: string;
  confirmed?: boolean;
  cancelled?: boolean;
  platform?: string;
  track?: string;
}

interface RawTripUpdate {
  id: string;
  trip_id: string;
  start_date: string;
  agency_id: string;
  numbers?: string[];
  cancelled?: boolean;
  detour?: boolean;
  stop_times?: RawStopTimeUpdate[];
}

interface RawFeed {
  timestamp?: string;
  trip_updates?: RawTripUpdate[];
}

interface RailTripLive {
  tripId: string;
  agency: string;
  numbers: string[];
  cancelled: boolean;
  detour: boolean;
  delaySec: number;
  lastConfirmedSeq?: number;
  stops: Array<{
    seq: number;
    arr?: string;
    dep?: string;
    platform?: string;
    track?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }>;
}

interface CachedFeed {
  fetchedAt: number;
  etag: string;
  timestamp: string;
  byTripId: Map<string, RawTripUpdate>;
  byNumber: Map<string, RawTripUpdate[]>;
}

let cached: CachedFeed | null = null;
let inflight: Promise<CachedFeed> | null = null;

async function loadFeed(): Promise<CachedFeed> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < FEED_TTL_MS) {
    return cached;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'KilometrWorker/1.0 (contact: dev@kilometr.app)',
      };
      if (cached?.etag) {
        headers['If-None-Match'] = cached.etag;
      }

      const res = await fetch(FEED_URL, {
        headers,
        ...({
          cf: {
            cacheTtl: 45,
            cacheEverything: true,
          },
        } as RequestInit),
      });

      if (res.status === 304 && cached) {
        cached.fetchedAt = Date.now();
        return cached;
      }

      if (!res.ok) {
        throw new Error(`Feed fetch failed: HTTP ${res.status}`);
      }

      const etag = res.headers.get('etag') ?? '';
      const raw = (await res.json()) as RawFeed;
      const byTripId = new Map<string, RawTripUpdate>();
      const byNumber = new Map<string, RawTripUpdate[]>();

      for (const u of raw.trip_updates ?? []) {
        if (!u.trip_id) continue;
        const normId = u.trip_id.trim();
        byTripId.set(normId, u);
        // Indeksujemy też z prefiksem pl: i bez prefiksu PLK_
        byTripId.set(`pl:${normId}`, u);
        if (normId.startsWith('PLK_')) {
          byTripId.set(normId.slice(4), u);
        }

        for (const num of u.numbers ?? []) {
          const list = byNumber.get(num) ?? [];
          list.push(u);
          byNumber.set(num, list);
        }
      }

      cached = {
        fetchedAt: Date.now(),
        etag,
        timestamp: raw.timestamp ?? new Date().toISOString(),
        byTripId,
        byNumber,
      };
      return cached;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

function summarizeTripUpdate(tripId: string, u: RawTripUpdate): RailTripLive {
  let lastConfirmedSeq: number | undefined;
  const stops = (u.stop_times ?? []).map((st) => {
    if (st.confirmed) {
      lastConfirmedSeq = st.stop_sequence;
    }
    return {
      seq: st.stop_sequence,
      arr: st.arrival,
      dep: st.departure,
      platform: st.platform || undefined,
      track: st.track || undefined,
      confirmed: st.confirmed === true,
      cancelled: st.cancelled === true,
    };
  });

  return {
    tripId,
    agency: u.agency_id,
    numbers: u.numbers ?? [],
    cancelled: u.cancelled === true,
    detour: u.detour === true,
    delaySec: 0,
    lastConfirmedSeq,
    stops,
  };
}

export async function handleRailDelays(req: Request, ctx?: ExecutionContext): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, If-Match, If-None-Match, Content-Type',
      },
    });
  }

  // Edge Cache API: jeśli odpowiedź jest już w cache Cloudflare, zwróć natychmiast (0 ms CPU Workera).
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null;
  if (cache && req.method === 'GET') {
    try {
      const match = await cache.match(req);
      if (match) return match;
    } catch {
      // Ignoruj błędy match w niestandardowych środowiskach
    }
  }

  const url = new URL(req.url);
  const tripsParam = url.searchParams.get('trips');
  const numbersParam = url.searchParams.get('numbers');

  if (!tripsParam && !numbersParam) {
    return new Response(
      JSON.stringify({
        error: 'missing-param',
        hint: 'Podaj parametr ?trips=pl:PLK_... lub ?numbers=77226',
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }

  try {
    const feed = await loadFeed();
    const result: Record<string, RailTripLive> = {};

    if (tripsParam) {
      const requestedIds = tripsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const reqId of requestedIds) {
        const u =
          feed.byTripId.get(reqId) ||
          feed.byTripId.get(reqId.replace(/^pl:/, '')) ||
          feed.byTripId.get(`pl:${reqId}`);
        if (u) {
          result[reqId] = summarizeTripUpdate(reqId, u);
        }
      }
    }

    if (numbersParam) {
      const requestedNumbers = numbersParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const num of requestedNumbers) {
        const matches = feed.byNumber.get(num) ?? [];
        for (const u of matches) {
          const tripKey = `pl:${u.trip_id}`;
          if (!result[tripKey]) {
            result[tripKey] = summarizeTripUpdate(tripKey, u);
          }
        }
      }
    }

    const response = new Response(
      JSON.stringify({
        updatedAt: feed.timestamp,
        fetchedAt: feed.fetchedAt,
        trips: result,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          // s-maxage=30 mówi krawędzi Cloudflare, by trzymała odpowiedź w cache CDN przez 30 s.
          'Cache-Control': 'public, max-age=20, s-maxage=30, stale-while-revalidate=60',
        },
      },
    );

    if (cache && ctx && req.method === 'GET') {
      try {
        ctx.waitUntil(cache.put(req, response.clone()));
      } catch {
        // Ignoruj błędy cache.put
      }
    }

    return response;
  } catch (err) {
    console.error('Rail delays feed error:', err);
    return new Response(
      JSON.stringify({
        error: 'feed-unavailable',
      }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      },
    );
  }
}
