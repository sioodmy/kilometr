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
// Spacer idzie tym samym kanałem co kurs, ale po profilu pieszym: bez niego
// noga piesza dostawałaby dwa punkty i rysowała się w linii prostej przez
// budynki. Bez routera zostaje wersja prosta, wolna, ale zawsze pokazuje trasę.
//
// Kolej korzysta z torów w kafelkach mapy. Pozostałe nogi szynowe
// zostają przy geometrii przybliżonej, bez routera samochodowego.
// W przypadku autobusów router samochodowy OSRM bywa wyprowadzany w pole
// przez zakazy wjazdu dla aut (buspasy, strefy piesze, bramki autobusowe,
// np. I Obwodnica w Krakowie). Odcinki z nienaturalnymi objazdami są
// automatycznie wykrywane i zastępowane czystą prostą między przystankami.

import { OSRM_BASE_URL } from '../config';
import { routeFootLocal, routeRailLocal } from './footRouter';
import { kvGet, kvSet } from './storage';
import { getLineColors, mapLineColor } from './lineIdentity';
import { timeStringToSeconds } from '../gtfs/geo';
import { selectEvictions } from './geometryEviction';
import type { Connection, Leg } from '../types/models';
import type { MapLeg, MapRoute, MapStop, MapStopRole } from '../map/types';
import { isFareBoundary } from '../gtfs/fareBoundary';

const CACHE_KEY = 'kilometr.map_geometry.v3';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 60;
const PINS_KEY = 'kilometr.map_geometry.pins.v3';
/** Ile tras trzymamy przypiętych. Powyżej tego najstarsze wypadają. */
const PINS_MAX = 40;
/** OSRM demo jest wolne przy dużej liczbie waypointów, dzielimy nogi na porcje. */
const WAYPOINTS_PER_REQUEST = 20;
const REQUEST_TIMEOUT_MS = 8000;

/** Rozdziela cache dróg, chodników i torów. */
type RouteProfile = 'driving' | 'foot' | 'rail';

/** Tryby bez obsługi geometrii nie mogą trafić do routera samochodowego. */
function isApproxOnlyLeg(leg: MapLeg): boolean {
  return leg.mode === 'tram' || leg.mode === 'cable' || leg.mode === 'subway';
}

function legProfile(leg: MapLeg): RouteProfile {
  if (leg.mode === 'train') return 'rail';
  return leg.mode === 'walk' ? 'foot' : 'driving';
}

export type Coord = [number, number];

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
  // Sekwencje końców służą do odróżnienia "to jest board/alight" od
  // "linia pętlowa wraca na ten sam przystanek w połowie trasy".
  const boardSeq = typeof boarded?.seq === 'number' ? boarded.seq : null;
  const alightSeq = typeof alighted?.seq === 'number' ? alighted.seq : null;
  push(leg.fromLat, leg.fromLon, {
    name: leg.fromStop,
    role: 'board',
    arriveSec: boarded?.arriveSec,
  });
  for (const s of leg.intermediateStops ?? []) {
    if (isFareBoundary(s.name)) continue;
    if (s.lat == null || s.lon == null) continue;
    // Z seq: końcówki kursu wycinamy po seq, stops linii pętlowe zostają.
    // Bez seq (starsze cache z backupu): twardy dedupe współrzędnymi jak kiedyś.
    if (boardSeq != null && s.seq === boardSeq) continue;
    if (alightSeq != null && s.seq === alightSeq) continue;
    if (boardSeq == null && s.lat === leg.fromLat && s.lon === leg.fromLon) continue;
    if (alightSeq == null && s.lat === leg.toLat && s.lon === leg.toLon) continue;
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
  return { id: leg.id,
    geometry: leg.geometry,
    mode: leg.mode,
    line: leg.line,
    direction: leg.direction,
    color: leg.mode === 'walk' ? '#BFC9C5' : mapLineColor(bg),
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
    approx: !leg.geometry,
  };
}

/** Wspólna lista punktów nogi - to ona idzie do OSRM jako waypointy. */
function legWaypoints(leg: MapLeg): Coord[] {
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
  // 5 m ≈ 4–5 miejsc po przecinku - tyle wystarczy, żeby klucz był stabilny.
  return coords.map(([lat, lon]) => `${lat.toFixed(4)},${lon.toFixed(4)}`).join(';');
}

let cacheLoaded: Promise<Map<string, Coord[]>> | null = null;
let pinnedKeys: Set<string> | null = null;

/**
 * Klucze przypięte: geometria tras, które użytkownik faktycznie otworzył albo
 * wyszukał. LRU jej nie wywala, więc ostatnie trasy działają offline nawet po
 * przewertowaniu kilkudziesięciu innych. Bez tego limit 60 wpisów wyrzucał
 * trasę, do której ktoś wraca codziennie, na rzecz jednorazowych.
 */
async function readPins(): Promise<Set<string>> {
  if (pinnedKeys) return pinnedKeys;
  const out = new Set<string>();
  try {
    const raw = await kvGet(PINS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) for (const k of parsed) if (typeof k === 'string') out.add(k);
    }
  } catch (err) {
    console.warn('[routeGeometry] pins read failed:', err);
  }
  pinnedKeys = out;
  return out;
}

async function pinKey(key: string): Promise<void> {
  const pins = await readPins();
  if (pins.has(key)) return;
  pins.add(key);
  // Sufit na przypięte: gdyby rósł bez końca, cache przestałby się mieścić.
  const arr = Array.from(pins);
  if (arr.length > PINS_MAX) {
    for (const k of arr.slice(0, arr.length - PINS_MAX)) pins.delete(k);
  }
  try {
    await kvSet(PINS_KEY, JSON.stringify(Array.from(pins)));
  } catch {
    // best-effort
  }
}

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

/**
 * Które klucze wypadają przy przekroczeniu limitu. Wydzielone do
 * geometryEviction.ts, bo tam da się to przetestować bez react-native.
 */
async function writeCache(key: string, coords: Coord[]): Promise<void> {
  const cache = await readCache();
  cache.set(key, coords);
  if (cache.size > CACHE_MAX_ENTRIES) {
    const pins = await readPins();
    for (const k of selectEvictions(Array.from(cache.keys()), pins, CACHE_MAX_ENTRIES)) {
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

/**
 * Przypina geometrię trasy, którą użytkownik ma już na ekranie, żeby nie
 * wypadła z cache. Nie pobiera nic z sieci: zakłada, że geometria już tam
 * jest (ekran mapy dociągnął ją wcześniej).
 */
export async function pinRouteGeometry(route: MapRoute): Promise<void> {
  for (const leg of route.legs) {
    if (leg.stops.length < 2 || isApproxOnlyLeg(leg)) continue;
    const key = `${legProfile(leg)}:${waypointKey(legWaypoints(leg))}`;
    await pinKey(key);
  }
}

/**
 * Rozgrzewa geometrię całej trasy i przypina ją, żeby została offline.
 * Używamy tego dla tras z ostatnich wyszukiwań oraz dla otwieranej trasy.
 * Zwraca liczbę nóg, których geometrię udało się pobrać.
 */
export async function warmRouteGeometry(
  route: MapRoute,
  signal?: AbortSignal,
): Promise<number> {
  let warmed = 0;
  for (const leg of route.legs) {
    if (signal?.aborted) break;
    if (leg.stops.length < 2 || isApproxOnlyLeg(leg)) continue;
    const coords = await fetchLegGeometry(leg, signal).catch(() => null);
    if (!coords || coords.length < 2) continue;
    const profile = legProfile(leg);
    const key = `${profile}:${waypointKey(legWaypoints(leg))}`;
    // fetchLegGeometry już zapisała, ale LRU mógł ją w międzyczasie wywalić;
    // przypięcie gwarantuje, że zostanie.
    await pinKey(key);
    warmed++;
    // Ta sama pauza co przy normalnym dociąganiu: publiczny serwer ma limit.
    const wasCached = (await readCache()).has(key);
    if (!wasCached) await new Promise((r) => setTimeout(r, 250));
  }
  return warmed;
}

/** Oblicza azymut geograficzny (bearing w stopniach 0..359) z p1 do p2. */
export function calcBearing(p1: Coord, p2: Coord): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(p2[1] - p1[1]);
  const lat1 = toRad(p1[0]);
  const lat2 = toRad(p2[0]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.round((toDeg(Math.atan2(y, x)) + 360) % 360);
}

/**
 * Wyznacza parametr bearings dla OSRM na podstawie kierunku korytarza transportowego.
 * Pozwala uniknąć przyciągania do ślepych zaułków, parkingów i prostopadłych alejek.
 */
export function computeBearingsParam(points: Coord[]): string | null {
  if (points.length < 2) return null;
  const angleDiff = (a: number, b: number) => {
    const diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
  };

  return points
    .map((p, i) => {
      if (i === 0) {
        return `${calcBearing(points[0], points[1])},60`;
      }
      if (i === points.length - 1) {
        return `${calcBearing(points[i - 1], points[i])},60`;
      }
      const bIn = calcBearing(points[i - 1], points[i]);
      const bOut = calcBearing(points[i], points[i + 1]);
      if (angleDiff(bIn, bOut) <= 60) {
        return `${bOut},60`;
      }
      return '';
    })
    .join(';');
}

/**
 * Usuwa z geometrii tzw. anteny (wypustki / nawrotki), gdzie router zjechał
 * w ślepą uliczkę/zatoczkę, zawrócił i wrócił tą samą drogą.
 */
export function removeSpurs(pts: Coord[]): Coord[] {
  const res = [...pts];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < res.length - 1; i++) {
      let back = i - 1;
      let fwd = i + 1;
      let matched = 0;
      while (back >= 0 && fwd < res.length && distanceM(res[back], res[fwd]) < 25) {
        matched++;
        back--;
        fwd++;
      }
      if (matched > 0) {
        res.splice(back + 1, fwd - 1 - (back + 1));
        changed = true;
        break;
      }
    }
  }
  return res;
}

/** Odległość w metrach między dwoma punktami geograficznymi. */
export function distanceM(p1: Coord, p2: Coord): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = (p2[0] - p1[0]) * 111320;
  const dLon = (p2[1] - p1[1]) * 111320 * Math.cos(toRad((p1[0] + p2[0]) / 2));
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Odległość punktu P od odcinka AB w metrach (rzut z domknięciem do końców).
 */
export function distanceToSegment(p: Coord, a: Coord, b: Coord): number {
  const [lat, lon] = p;
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const toRad = (d: number) => (d * Math.PI) / 180;
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
  return distanceM(p, [pLat, pLon]);
}

/**
 * Domyka geometrię odcinka do dokładnych współrzędnych przystanków krańcowych (p1 i p2)
 * oraz eliminuje powtórzenia sąsiadujących punktów.
 */
export function sanitizeLegCoords(coords: Coord[], p1: Coord, p2: Coord): Coord[] {
  if (coords.length < 2) return [p1, p2];
  const cleaned: Coord[] = [p1];
  for (const c of coords) {
    const last = cleaned[cleaned.length - 1];
    if (last[0] !== c[0] || last[1] !== c[1]) {
      cleaned.push(c);
    }
  }
  const last = cleaned[cleaned.length - 1];
  if (last[0] !== p2[0] || last[1] !== p2[1]) {
    cleaned.push(p2);
  }
  return cleaned.length >= 2 ? cleaned : [p1, p2];
}

/**
 * Sprawdza, czy odcinek wyznaczony przez OSRM dla profilu samochodowego
 * nie jest objazdem spowodowanym ograniczeniami ruchu (np. buspas, deptak,
 * zakaz wjazdu dla aut, ulica jednokierunkowa).
 */
export function isOsrmLegDetour(
  p1: Coord,
  p2: Coord,
  osrmDistM: number,
  stepCoords: Coord[],
  hasUturn: boolean = false,
): boolean {
  if (stepCoords.length < 2) return true;
  if (hasUturn) return true;
  const crowDist = distanceM(p1, p2);
  const maxAllowedDist = Math.max(crowDist * 1.85 + 200, 350);
  if (osrmDistM > maxAllowedDist) return true;

  const maxAllowedOffset = Math.max(crowDist * 0.75, 400);
  for (const pt of stepCoords) {
    if (distanceToSegment(pt, p1, p2) > maxAllowedOffset) {
      return true;
    }
  }
  return false;
}

async function fetchChunk(
  points: Coord[],
  profile: RouteProfile,
  signal?: AbortSignal,
): Promise<Coord[] | null> {
  if (points.length < 2) return null;
  if (profile === 'foot') {
    return routeFootLocal(points, signal);
  }
  if (profile === 'rail') {
    return routeRailLocal(points, signal);
  }
  const coordsParam = points.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const bearingsParam = profile === 'driving' ? computeBearingsParam(points) : null;
  const baseUrl = `${OSRM_BASE_URL}/route/v1/${profile}/${coordsParam}?overview=false&steps=true&geometries=geojson`;
  const url = bearingsParam ? `${baseUrl}&bearings=${bearingsParam}` : baseUrl;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  // Anulowanie z ekranu ma przerwać także żądanie w locie, nie tylko pętlę.
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    let res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok && bearingsParam) {
      // W razie gdyby OSRM nie dopasował drogi w zadanym kącie, ponów bez bearings
      res = await fetch(baseUrl, { signal: ctrl.signal });
    }
    if (!res.ok) return null;
    const body = (await res.json()) as {
      code?: string;
      routes?: {
        legs?: {
          distance?: number;
          steps?: {
            maneuver?: { modifier?: string };
            geometry?: { coordinates?: [number, number][] };
          }[];
        }[];
      }[];
    };
    if (body.code !== 'Ok' || !body.routes?.[0]?.legs) return null;
    const legs = body.routes[0].legs;
    if (legs.length !== points.length - 1) return null;

    const out: Coord[] = [];
    for (let i = 0; i < legs.length; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const stepCoords: Coord[] = [];
      let hasUturn = false;

      for (const step of legs[i].steps ?? []) {
        if (step.maneuver?.modifier === 'uturn') {
          hasUturn = true;
        }
        for (const [lon, lat] of step.geometry?.coordinates ?? []) {
          stepCoords.push([lat, lon]);
        }
      }

      const unspurred = removeSpurs(stepCoords);
      const detour = isOsrmLegDetour(
        p1,
        p2,
        legs[i].distance ?? 0,
        unspurred,
        hasUturn && unspurred.length === stepCoords.length,
      );
      const legPoints = detour ? [p1, p2] : sanitizeLegCoords(unspurred, p1, p2);

      if (out.length === 0) {
        out.push(...legPoints);
      } else {
        // Sklej bez powtórzenia punktu granicznego
        out.push(...legPoints.slice(1));
      }
    }

    const finalOut = removeSpurs(out);
    return finalOut.length >= 2 ? finalOut : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Dobiera router do trybu transportu. Brak pełnego przebiegu zostawia
 * geometrię przybliżoną, bez zapisywania niekompletnego wyniku w cache.
 */
async function fetchLegGeometry(leg: MapLeg, signal?: AbortSignal): Promise<Coord[] | null> {
  if (isApproxOnlyLeg(leg)) return null;
  const points = legWaypoints(leg).filter(
    (p, i, arr) => i === 0 || p[0] !== arr[i - 1][0] || p[1] !== arr[i - 1][1],
  );
  if (points.length < 2) return null;

  const profile = legProfile(leg);
  // Profil wchodzi do klucza: te same dwa punkty pieszo i autem to dwie
  // różne trasy, więc jedna nie może podmienić drugiej w cache.
  const key = `${profile}:${waypointKey(points)}`;
  const cache = await readCache();
  const hit = cache.get(key);
  if (hit) return hit;

  const chunks: Coord[] = [];
  const chunkSize = profile === 'rail' ? points.length : WAYPOINTS_PER_REQUEST;
  for (let i = 0; i < points.length - 1; i += chunkSize - 1) {
    if (signal?.aborted) return null;
    const slice = points.slice(i, i + chunkSize);
    const part = await fetchChunk(slice, profile, signal);
    if (!part) return null;
    // Sklej bez powtórzenia punktu granicznego.
    chunks.push(...(chunks.length > 0 ? part.slice(1) : part));
  }
  if (chunks.length < 2) return null;
  if (signal?.aborted) return null;
  void writeCache(key, chunks);
  return chunks;
}

/** Prosty odcinek przez przystanki, natychmiastowa wersja trasy. */
export function straightGeometry(leg: MapLeg): Coord[] {
  if (leg.geometry) return leg.geometry;
  return legWaypoints(leg);
}

/**
 * Uzupełnia geometrię nóg po kolei. Nogi piesze liczy lokalnie w Rust,
 * kolejowe liczy po torach, a autobusowe dociąga z OSRM.
 */
export async function resolveGeometry(
  route: MapRoute,
  onLeg: (legId: string, coords: Coord[]) => void,
  signal?: AbortSignal,
): Promise<void> {
  for (const leg of route.legs) {
    if (signal?.aborted) return;
    if (leg.geometry) { onLeg(leg.id, leg.geometry); continue; }
    if (leg.stops.length < 2 || isApproxOnlyLeg(leg)) continue;
    const coords = await fetchLegGeometry(leg, signal).catch(() => null);
    if (signal?.aborted) return;
    if (coords && coords.length > 1) onLeg(leg.id, coords);
    if (leg.mode !== 'walk') {
      await new Promise((r) => setTimeout(r, 350));
    }
  }
}

/** Skumulowane odległości wzdłuż linii; długość = coords.length + 1. */
function cumulativeDistances(coords: Coord[]): number[] {
  const out = [0];
  for (let i = 0; i < coords.length - 1; i++) {
    out.push(out[i] + distanceM(coords[i], coords[i + 1]));
  }
  return out;
}

export interface Projection {
  /** Najbliższy punkt na linii. */
  lat: number;
  lon: number;
  /** Kurs (azymut) odcinka, na którym leży ten punkt. */
  heading: number;
  /** Odległość od początku linii wzdłuż niej [m]. */
  alongM: number;
  /** 0..1 wzdłuż linii. */
  progress: number;
  /** Dystans od linii [m]. */
  offsetM: number;
  /** Długość całej linii [m]. */
  totalM: number;
}

/**
 * Rzut punktu na linię trasy wraz z postępem (0..1) i dystansem od niej.
 * To jedyne miejsce, w którym liczymy „gdzie wzdłuż trasy coś jest”-
 * strzałka pojazdu, kursor joysticka i dopasowanie live korzystają z tego
 * samego rachunku, więc nic się nie rozjeżdża.
 */
export function projectRoutePoint(
  coords: Coord[],
  lat: number,
  lon: number,
): Projection | null {
  if (!coords || coords.length === 0) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;
  if (coords.length === 1) {
    return {
      lat: coords[0][0],
      lon: coords[0][1],
      heading: 0,
      alongM: 0,
      progress: 0,
      offsetM: distanceM(coords[0], [lat, lon]),
      totalM: 0,
    };
  }

  const cum = cumulativeDistances(coords);
  let best = Infinity;
  let bestLat = coords[0][0];
  let bestLon = coords[0][1];
  let bestHeading = 0;
  let bestAlong = 0;

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
      bestAlong = cum[i] + t * (cum[i + 1] - cum[i]);
      const phi1 = toRad(lat1);
      const phi2 = toRad(lat2);
      const dLambda = toRad(lon2 - lon1);
      const y2 = Math.sin(dLambda) * Math.cos(phi2);
      const x2 = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
      bestHeading = (Math.atan2(y2, x2) * 180) / Math.PI;
    }
  }
  const total = cum[cum.length - 1];
  return {
    lat: bestLat,
    lon: bestLon,
    heading: (bestHeading + 360) % 360,
    alongM: bestAlong,
    progress: total > 0 ? Math.max(0, Math.min(1, bestAlong / total)) : 0,
    offsetM: distanceM([bestLat, bestLon], [lat, lon]),
    totalM: total,
  };
}
