// Geometria przebiegu trasy do narysowania na mapie.
//
// RAPTOR zna tylko przystanki kursu, a mapa potrzebuje realnego przebiegu
// po ulicach. Dlatego:
//  1. budujemy model trasy natychmiast (prostymi odcinkami między przystankami),
//     żeby ekran nie czekał na sieć,
//  2. w tle dokładamy geometrię z OSRM (dokładny przebieg przez wszystkie
//     przystanki w jednym zapytaniu na nogę) i podmieniamy nogi w locie,
//  3. wynik trzymamy w cache, więc drugie otwarcie mapy jest natychmiastowe
//     i działa offline.
//
// Bez OSRM zostaje prosta wersja — wolniej, ale zawsze pokazuje trasę.

import { OSRM_BASE_URL } from '../config';
import { kvGet, kvSet } from './storage';
import { getLineColors } from '../components/LineBadge';
import { timeStringToSeconds } from '../gtfs/geo';
import type { Connection, Leg } from '../types/models';
import type { MapLeg, MapRoute, MapStop, MapStopRole } from '../map/types';

const CACHE_KEY = 'kilometr.map_geometry.v1';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 60;
/** OSRM demo jest wolne przy dużej liczbie waypointów — dzielimy nogi na porcje. */
const WAYPOINTS_PER_REQUEST = 20;
const REQUEST_TIMEOUT_MS = 8000;

type Coord = [number, number];

interface CacheEntry {
  k: string;
  ts: number;
  c: Coord[];
}

// ─── Model trasy ─────────────────────────────────────────────────────────────

function legStops(leg: Leg): MapStop[] {
  const stops: MapStop[] = [];
  const push = (lat?: number, lon?: number, extra?: Partial<MapStop>) => {
    if (lat == null || lon == null) return;
    stops.push({
      id: `${leg.id}#${stops.length}`,
      legId: leg.id,
      lat,
      lon,
      name: '',
      seq: stops.length,
      role: 'intermediate' as MapStopRole,
      ...extra,
    });
  };

  if (leg.mode === 'walk') {
    push(leg.fromLat, leg.fromLon, { name: leg.fromStop, role: 'walk' });
    push(leg.toLat, leg.toLon, { name: leg.toStop, role: 'walk' });
    return stops;
  }

  const boarded = leg.intermediateStops?.[0];
  const alighted = leg.intermediateStops?.[leg.intermediateStops.length - 1];
  // Bez sekwencji z GTFS zostajemy na końcach nogi (działa też dla kursów
  // spoza wycinka, gdzie intermediateStops bywa puste).
  push(leg.fromLat, leg.fromLon, {
    name: leg.fromStop,
    role: 'board',
    arriveSec: boarded?.arriveSec,
  });
  for (const s of leg.intermediateStops ?? []) {
    if (s.lat == null || s.lon == null) continue;
    // Duplikaty (oba końce bywają wypisane podwójnie) zostają jeden raz.
    if (s.lat === leg.fromLat && s.lon === leg.fromLon) continue;
    if (s.lat === leg.toLat && s.lon === leg.toLon) continue;
    stops.push({
      id: `${leg.id}#${stops.length}`,
      legId: leg.id,
      lat: s.lat,
      lon: s.lon,
      name: s.name,
      seq: s.seq,
      role: 'intermediate',
      arriveSec: s.arriveSec,
      departSec: s.departSec,
    });
  }
  push(leg.toLat, leg.toLon, {
    name: leg.toStop,
    role: 'alight',
    arriveSec: alighted?.arriveSec ?? timeStringToSeconds(leg.arriveAt),
  });
  return stops;
}

function legToMapLeg(leg: Leg): MapLeg {
  const { bg } = getLineColors(leg.line, leg.mode);
  const stops = legStops(leg);
  return {
    id: leg.id,
    mode: leg.mode,
    line: leg.line,
    direction: leg.direction,
    color: leg.mode === 'walk' ? '#BFC9C5' : bg,
    fromStop: leg.fromStop,
    toStop: leg.toStop,
    departAt: leg.departAt,
    arriveAt: leg.arriveAt,
    stopsCount: leg.stopsCount,
    walkM: leg.walkM,
    live: leg.live,
    tripId: leg.tripId,
    platformCode: leg.platformCode,
    stops,
    approx: true,
  };
}

/** Wspólna lista punktów nogi — to ona idzie do OSRM jako waypointy. */
export function legWaypoints(leg: MapLeg): Coord[] {
  return leg.stops.map((s) => [s.lat, s.lon] as Coord);
}

export function buildMapRoute(connection: Connection): MapRoute {
  const legs = connection.legs.map(legToMapLeg);
  const geometry = legs.some((l) => l.approx) ? 'approx' : 'osrm';
  return {
    id: connection.id,
    fromTitle: connection.fromTitle,
    toTitle: connection.toTitle,
    departAt: connection.departAt,
    arriveAt: connection.arriveAt,
    durationMin: connection.durationMin,
    legs,
    geometry,
  };
}

// ─── Geometria z OSRM ────────────────────────────────────────────────────────

function waypointKey(coords: Coord[]): string {
  // 5 m ≈ 4–5 miejsc po przecinku — tyle wystarczy, żeby klucz był stabilny.
  return coords.map(([lat, lon]) => `${lat.toFixed(4)},${lon.toFixed(4)}`).join(';');
}

let cacheLoaded: Promise<Map<string, Coord[]>> | null = null;

async function readCache(): Promise<Map<string, Coord[]>> {
  if (!cacheLoaded) {
    cacheLoaded = (async () => {
      const out = new Map<string, Coord[]>();
      try {
        const raw = await kvGet(CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as CacheEntry[];
          const now = Date.now();
          for (const e of Array.isArray(parsed) ? parsed : []) {
            if (e && typeof e.k === 'string' && Array.isArray(e.c) && now - e.ts < CACHE_TTL_MS) {
              out.set(e.k, e.c as Coord[]);
            }
          }
        }
      } catch (err) {
        console.warn('[routeGeometry] cache read failed:', err);
      }
      return out;
    })();
  }
  return cacheLoaded;
}

async function writeCache(key: string, coords: Coord[]): Promise<void> {
  const cache = await readCache();
  cache.set(key, coords);
  if (cache.size > CACHE_MAX_ENTRIES) {
    // Mapa w Mapie gwarantuje kolejność wstawiania, więc to proste LRU.
    for (const k of Array.from(cache.keys()).slice(0, cache.size - CACHE_MAX_ENTRIES)) {
      cache.delete(k);
    }
  }
  const entries: CacheEntry[] = Array.from(cache.entries()).map(([k, c]) => ({
    k,
    c,
    ts: Date.now(),
  }));
  await kvSet(CACHE_KEY, JSON.stringify(entries));
}

async function fetchChunk(points: Coord[], signal?: AbortSignal): Promise<Coord[] | null> {
  if (points.length < 2) return null;
  const coordsParam = points.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const url = `${OSRM_BASE_URL}/route/v1/driving/${coordsParam}?overview=full&geometries=geojson`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  // Anulowanie z ekranu ma przerwać także żądanie w locie, nie tylko pętlę.
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      code?: string;
      routes?: { geometry?: { coordinates?: [number, number][] } }[];
    };
    if (body.code !== 'Ok') return null;
    const line = body.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(line) || line.length < 2) return null;
    return line.map(([lon, lat]) => [lat, lon] as Coord);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Geometria jednej nogi: waypointy po przystankach, jedno zapytanie (albo kilka
 * po 20 waypointów) i sklejone w jeden ciąg. Zwraca null, gdy sieć zawodzi —
 * wtedy noga zostaje prosta, a mapa i tak pokazuje trasę.
 */
export async function fetchLegGeometry(leg: MapLeg, signal?: AbortSignal): Promise<Coord[] | null> {
  const points = legWaypoints(leg).filter(
    (p, i, arr) => i === 0 || p[0] !== arr[i - 1][0] || p[1] !== arr[i - 1][1],
  );
  if (points.length < 2) return null;

  const key = waypointKey(points);
  const cache = await readCache();
  const hit = cache.get(key);
  if (hit) return hit;

  const chunks: Coord[] = [];
  for (let i = 0; i < points.length - 1; i += WAYPOINTS_PER_REQUEST - 1) {
    if (signal?.aborted) return null;
    const slice = points.slice(i, i + WAYPOINTS_PER_REQUEST);
    const part = await fetchChunk(slice, signal);
    if (!part) return null;
    // Sklej bez powtórzenia punktu granicznego.
    chunks.push(...(chunks.length > 0 ? part.slice(1) : part));
  }
  if (chunks.length < 2) return null;
  if (signal?.aborted) return null;
  void writeCache(key, chunks);
  return chunks;
}

/** Prosty odcinek przez przystanki — natychmiastowa wersja trasy. */
export function straightGeometry(leg: MapLeg): Coord[] {
  return legWaypoints(leg);
}

/**
 * Uzupełnia geometrię nóg po kolei (OSRM demo nie lubi równoległych pytań).
 * Każda gotowa noga trafia do `onLeg`, więc mapa dociąga je w tle.
 *
 * `signal` pozwala przerwać całą pętlę — ekran nie powinien ciągnąć zapytań do
 * publicznego serwera po zamknięciu.
 */
export async function resolveGeometry(
  route: MapRoute,
  onLeg: (legId: string, coords: Coord[]) => void,
  signal?: AbortSignal,
): Promise<void> {
  for (const leg of route.legs) {
    if (signal?.aborted) return;
    if (leg.mode === 'walk') continue;
    if (leg.stops.length < 2) continue;
    const coords = await fetchLegGeometry(leg, signal).catch(() => null);
    if (signal?.aborted) return;
    if (coords && coords.length > 1) onLeg(leg.id, coords);
    // Pauza między zapytaniami — demo-serwer ma limit ~1 req/s.
    await new Promise((r) => setTimeout(r, 350));
  }
}

/** Najbliższy punkt na noge + kurs w nim — do strzałki pojazdu live. */
export function projectOnGeometry(
  coords: Coord[],
  lat: number,
  lon: number,
): { lat: number; lon: number; heading: number } | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) return { lat: coords[0][0], lon: coords[0][1], heading: 0 };

  const toRad = (d: number) => (d * Math.PI) / 180;
  let best = Infinity;
  let bestLat = coords[0][0];
  let bestLon = coords[0][1];
  let bestHeading = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lat1, lon1] = coords[i];
    const [lat2, lon2] = coords[i + 1];
    const midLat = toRad((lat1 + lat2) / 2);
    const kx = Math.cos(midLat);
    const x = toRad(lon - lon1) * kx;
    const y = toRad(lat - lat1);
    const dx = toRad(lon2 - lon1) * kx;
    const dy = toRad(lat2 - lat1);
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, (x * dx + y * dy) / lenSq)) : 0;
    const pLat = lat1 + t * (lat2 - lat1);
    const pLon = lon1 + t * (lon2 - lon1);
    const dLat = toRad(pLat - lat);
    const dLon = toRad(pLon - lon) * kx;
    const d = dLat * dLat + dLon * dLon;
    if (d < best) {
      best = d;
      bestLat = pLat;
      bestLon = pLon;
      const phi1 = toRad(lat1);
      const phi2 = toRad(lat2);
      const dLambda = toRad(lon2 - lon1);
      const y2 = Math.sin(dLambda) * Math.cos(phi2);
      const x2 = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
      bestHeading = (Math.atan2(y2, x2) * 180) / Math.PI;
    }
  }
  return { lat: bestLat, lon: bestLon, heading: (bestHeading + 360) % 360 };
}
