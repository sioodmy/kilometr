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
import { shortDistanceMeters, timeStringToSeconds } from '../gtfs/geo';
import { putCacheRecord, selectEvictions, type GeometryCacheRecord } from './geometryEviction';
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
  return {
    id: leg.id,
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
    trackCode: leg.trackCode,
    stops,
    approx: !leg.geometry,
  };
}

/** Wspólna lista punktów nogi - to ona idzie do OSRM jako waypointy. */
function legWaypoints(leg: MapLeg): Coord[] {
  return leg.stops.map((s) => [s.lat, s.lon] as Coord);
}

export function buildMapRoute(connection: Connection): MapRoute {
  const hasMultipleLegs = connection.legs.length > 1;
  const filteredLegs = hasMultipleLegs
    ? connection.legs.filter(
        (leg) =>
          !(
            leg.mode === 'walk' &&
            (leg.walkM ?? 0) <= 0 &&
            (leg.departAt === leg.arriveAt || leg.fromStop === leg.toStop)
          ),
      )
    : connection.legs;
  const effectiveLegs = filteredLegs.length > 0 ? filteredLegs : connection.legs;
  const legs = effectiveLegs.map(legToMapLeg);
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

let cacheLoaded: Promise<Map<string, GeometryCacheRecord>> | null = null;
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

async function readCache(): Promise<Map<string, GeometryCacheRecord>> {
  if (!cacheLoaded) {
    cacheLoaded = (async () => {
      const out = new Map<string, GeometryCacheRecord>();
      try {
        const raw = await kvGet(CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as CacheEntry[];
          const now = Date.now();
          for (const e of Array.isArray(parsed) ? parsed : []) {
            if (e && typeof e.k === 'string' && Array.isArray(e.c) && now - e.ts < CACHE_TTL_MS) {
              out.set(e.k, { c: e.c as Coord[], ts: e.ts });
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
  putCacheRecord(cache, key, coords, Date.now());
  if (cache.size > CACHE_MAX_ENTRIES) {
    const pins = await readPins();
    for (const k of selectEvictions(Array.from(cache.keys()), pins, CACHE_MAX_ENTRIES)) {
      cache.delete(k);
    }
  }
  const entries: CacheEntry[] = Array.from(cache, ([k, v]) => ({
    k,
    c: v.c,
    ts: v.ts,
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
export async function warmRouteGeometry(route: MapRoute, signal?: AbortSignal): Promise<number> {
  let warmed = 0;
  for (const leg of route.legs) {
    if (signal?.aborted) break;
    if (leg.stops.length < 2 || isApproxOnlyLeg(leg)) continue;
    // Shape'y PLK nie przechodzą przez cache kv (są w bazie), więc nie ma
    // czego przypinać - pinowałby się klucz, którego cache nigdy nie zobaczy.
    if (leg.mode === 'train' && leg.tripId?.startsWith('pl:')) {
      const result = await fetchLegGeometry(leg, signal).catch(() => null);
      if (result && result.coords.length > 1) warmed++;
      continue;
    }
    const result = await fetchLegGeometry(leg, signal).catch(() => null);
    if (!result || result.coords.length < 2) continue;
    const profile = legProfile(leg);
    const key = `${profile}:${waypointKey(legWaypoints(leg))}`;
    // fetchLegGeometry już zapisała, ale LRU mógł ją w międzyczasie wywalić;
    // przypięcie gwarantuje, że zostanie.
    await pinKey(key);
    warmed++;
    // Ta sama pauza co przy normalnym dociąganiu: publiczny serwer ma limit.
    // Cache trafiony z dysku nie rusza sieci, więc nie ma czego ograniczać.
    if (!result.fromCache) await new Promise((r) => setTimeout(r, 250));
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

/**
 * Odległość w metrach między dwoma punktami geograficznymi.
 * Krótkie odcinki: jedno equirect w `src/gtfs/geo.ts` (`shortDistanceMeters`).
 */
export function distanceM(p1: Coord, p2: Coord): number {
  return shortDistanceMeters(p1[0], p1[1], p2[0], p2[1]);
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
async function fetchLegGeometry(
  leg: MapLeg,
  signal?: AbortSignal,
): Promise<{ coords: Coord[]; fromCache: boolean } | null> {
  if (isApproxOnlyLeg(leg)) return null;
  // Pociągi ogólnopolskie i regionalne mają geometrię torów w bazie `polska` (shapes PLK):
  // router po kafelkach obejmuje tylko pakiet miasta, a OSRM nie jeździ po
  // torach. Zwracamy wycinek shape'u bezpośrednio w osi właściwego toru.
  if (leg.mode === 'train') {
    const coords = await nationalRailShape(leg, signal);
    if (coords && coords.length > 1) return { coords, fromCache: true };
    if (leg.tripId?.startsWith('pl:')) return null;
  }
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
  if (hit) return { coords: hit.c, fromCache: true };

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
  return { coords: chunks, fromCache: false };
}

/** Prosty odcinek przez przystanki, natychmiastowa wersja trasy. */
export function straightGeometry(leg: MapLeg): Coord[] {
  if (leg.geometry) return leg.geometry;
  return legWaypoints(leg);
}

// ─── Geometria torów z bazy ogólnopolskiej (shapes PLK) ─────────────────────

/** Cache shape'ów w pamięci: unpack raz, tnie każde otwarcie mapy od nowa. */
const shapeCache = new Map<string, Coord[] | null>();
const SHAPE_CACHE_MAX = 24;

async function loadShape(shapeId: string): Promise<Coord[] | null> {
  if (shapeCache.has(shapeId)) return shapeCache.get(shapeId) ?? null;
  try {
    const { getNationalDb } = await import('./gtfsDatabase');
    const db = await getNationalDb();
    const row = await db.getFirstAsync<{ pts: Uint8Array | ArrayBuffer }>(
      'SELECT pts FROM shapes WHERE shape_id = ?',
      shapeId,
    );
    const raw = row?.pts;
    if (!raw || (raw instanceof Uint8Array ? raw.byteLength : raw.byteLength) < 16) {
      shapeCache.set(shapeId, null);
      return null;
    }
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = Math.floor(bytes.byteLength / 8);
    const coords: Coord[] = new Array(n);
    for (let i = 0; i < n; i++) {
      coords[i] = [view.getFloat32(i * 8, true), view.getFloat32(i * 8 + 4, true)];
    }
    shapeCache.set(shapeId, coords);
    if (shapeCache.size > SHAPE_CACHE_MAX) {
      const oldest = shapeCache.keys().next().value;
      if (oldest !== undefined && oldest !== shapeId) shapeCache.delete(oldest);
    }
    return coords;
  } catch {
    shapeCache.set(shapeId, null);
    return null;
  }
}

/** Uproszczenie Douglas-Peuckerem (iteracyjnie, tolerancja w metrach). */
function simplifyPolyline(pts: Coord[], toleranceM: number): Coord[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  const tolSq = toleranceM * toleranceM;
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;
    const a = pts[start];
    const b = pts[end];
    let maxD = -1;
    let maxI = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(pts[i], a, b);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD * maxD > tolSq && maxI > 0) {
      keep[maxI] = 1;
      stack.push([start, maxI], [maxI, end]);
    }
  }
  const out: Coord[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/**
 * Wycinek torów dla nogi kolejowej z bazy `polska`: shape kursu cięty
 * między stacją wsiadania a wysiadania bezpośrednio w osi toru.
 * Nie doklejamy sztucznie współrzędnych budynku stacji (żeby linia nie
 * uciekała z torów w budynek dworca) i stosujemy minimalną tolerancję (2 m),
 * dzięki czemu geometria zachowuje łuki, rozjazdy i właściwy tor.
 */
async function nationalRailShape(leg: MapLeg, signal?: AbortSignal): Promise<Coord[] | null> {
  const stops = leg.stops;
  if (!stops || stops.length < 2) return null;
  const board = stops[0];
  const alight = stops[stops.length - 1];
  if (!board || !alight) return null;

  try {
    const { getNationalDb } = await import('./gtfsDatabase');
    const db = await getNationalDb();

    let shapeId: string | null = null;

    // 1. Sprawdź tripId z nogi (jeśli jest).
    if (leg.tripId) {
      const cleanTripId = leg.tripId.replace(/^pl:/, '');
      const trip = await db.getFirstAsync<{ shape: string }>(
        'SELECT shape FROM trips WHERE trip_id = ? OR trip_id = ? LIMIT 1',
        leg.tripId,
        'pl:' + cleanTripId,
      );
      if (trip?.shape) {
        shapeId = trip.shape.replace(/^pl:/, '');
      }
    }

    // 2. Jeśli brak shapeId, a mamy numer pociągu w leg.line:
    if (!shapeId && leg.line) {
      const numMatch = leg.line.match(/\b(\d{3,6}(?:\/\d+)?)\b/);
      if (numMatch) {
        const trip = await db.getFirstAsync<{ shape: string }>(
          'SELECT shape FROM trips WHERE (train_number = ? OR train_number LIKE ?) AND shape != "" LIMIT 1',
          numMatch[1],
          numMatch[1] + '/%',
        );
        if (trip?.shape) {
          shapeId = trip.shape.replace(/^pl:/, '');
        }
      }
    }

    // 3. Jeśli nadal brak shapeId, znajdź kurs łączący stację początkową i końcową:
    if (!shapeId) {
      let boardStopRow = await db.getFirstAsync<{ stop_id: string }>(
        'SELECT stop_id FROM stops WHERE name = ? LIMIT 1',
        board.name,
      );
      if (!boardStopRow) {
        boardStopRow = await db.getFirstAsync<{ stop_id: string }>(
          'SELECT stop_id FROM stops WHERE abs(lat - ?) < 0.02 AND abs(lon - ?) < 0.03 ORDER BY ((lat - ?)*(lat - ?) + (lon - ?)*(lon - ?)*0.36) LIMIT 1',
          board.lat,
          board.lon,
          board.lat,
          board.lon,
        );
      }

      let alightStopRow = await db.getFirstAsync<{ stop_id: string }>(
        'SELECT stop_id FROM stops WHERE name = ? LIMIT 1',
        alight.name,
      );
      if (!alightStopRow) {
        alightStopRow = await db.getFirstAsync<{ stop_id: string }>(
          'SELECT stop_id FROM stops WHERE abs(lat - ?) < 0.02 AND abs(lon - ?) < 0.03 ORDER BY ((lat - ?)*(lat - ?) + (lon - ?)*(lon - ?)*0.36) LIMIT 1',
          alight.lat,
          alight.lon,
          alight.lat,
          alight.lon,
        );
      }

      if (boardStopRow && alightStopRow) {
        const trip = await db.getFirstAsync<{ shape: string }>(
          `SELECT t.shape
           FROM stop_times st1
           JOIN stop_times st2 ON st1.trip_id = st2.trip_id
           JOIN trips t ON t.trip_id = st1.trip_id
           WHERE st1.stop_id = ? AND st2.stop_id = ? AND st1.seq < st2.seq AND t.shape != ''
           LIMIT 1`,
          boardStopRow.stop_id,
          alightStopRow.stop_id,
        );
        if (trip?.shape) {
          shapeId = trip.shape.replace(/^pl:/, '');
        }
      }
    }

    if (!shapeId) return null;
    if (signal?.aborted) return null;

    const shape = await loadShape(shapeId);
    if (!shape || shape.length < 2) return null;

    // Najbliższy punkt shape'u do stacji wsiadania.
    let boardIdx = -1;
    let boardDist = Infinity;
    for (let i = 0; i < shape.length; i++) {
      const d = distanceM(shape[i], [board.lat, board.lon]);
      if (d < boardDist) {
        boardDist = d;
        boardIdx = i;
      }
    }
    if (boardIdx < 0 || boardDist > 2500) return null;

    // Sekwencja stacji pośrednich, by odnaleźć właściwy punkt końcowy za nimi.
    let searchStart = boardIdx;
    if (stops.length > 2) {
      for (let s = 1; s < stops.length - 1; s++) {
        const st = stops[s];
        let midIdx = -1;
        let midDist = Infinity;
        for (let i = searchStart; i < shape.length; i++) {
          const d = distanceM(shape[i], [st.lat, st.lon]);
          if (d < midDist) {
            midDist = d;
            midIdx = i;
          }
        }
        if (midIdx >= searchStart && midDist < 2500) {
          searchStart = midIdx;
        }
      }
    }

    // Najbliższy punkt shape'u do stacji wysiadania (za stacjami pośrednimi/wsiadaniem).
    let alightIdx = -1;
    let alightDist = Infinity;
    for (let i = searchStart + 1; i < shape.length; i++) {
      const d = distanceM(shape[i], [alight.lat, alight.lon]);
      if (d < alightDist) {
        alightDist = d;
        alightIdx = i;
      }
    }
    if (alightIdx < 0 || alightIdx <= boardIdx || alightDist > 2500) return null;

    const slice = shape.slice(boardIdx, alightIdx + 1);
    if (slice.length < 2) return null;

    // Usuwamy ewentualne sąsiadujące duplikaty.
    const clean: Coord[] = [];
    for (const p of slice) {
      if (
        clean.length === 0 ||
        clean[clean.length - 1][0] !== p[0] ||
        clean[clean.length - 1][1] !== p[1]
      ) {
        clean.push(p);
      }
    }
    if (clean.length < 2) return null;

    // Tolerancja 2 m zachowuje dokładny przebieg toru i rozjazdów,
    // eliminując jedynie zbędne punkty współliniowe na prostych odcinkach.
    return simplifyPolyline(clean, 2);
  } catch {
    return null;
  }
}

/**
 * Oś toru nogi kolejowej do dopasowania GPS (trainTrack.ts): geometria
 * z nogi (podróż współdzielona) albo wycinek shape'u PLK z bazy ogólnopolskiej.
 */
export async function loadTrainTrackShape(leg: Leg, signal?: AbortSignal): Promise<Coord[] | null> {
  if (leg.mode !== 'train') return null;
  if (leg.geometry && leg.geometry.length > 1) return leg.geometry;
  const mapLeg = legToMapLeg(leg);
  if (mapLeg.stops.length < 2) return null;
  return nationalRailShape(mapLeg, signal);
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
    if (leg.geometry) {
      onLeg(leg.id, leg.geometry);
      continue;
    }
    if (leg.stops.length < 2 || isApproxOnlyLeg(leg)) continue;
    const result = await fetchLegGeometry(leg, signal).catch(() => null);
    if (signal?.aborted) return;
    if (result && result.coords.length > 1) onLeg(leg.id, result.coords);
    // Pauza chroni publiczny OSRM; lokalne shape'y PLK jej nie potrzebują.
    if (leg.mode !== 'walk' && leg.mode !== 'train') {
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
export function projectRoutePoint(coords: Coord[], lat: number, lon: number): Projection | null {
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
      const x2 =
        Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
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
