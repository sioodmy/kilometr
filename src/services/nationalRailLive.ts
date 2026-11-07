// Live dla pociągów ogólnopolskich (dataset `polska`) ze zbiorkomu.
//
// Źródło: strumień SSE `api6/pkp/positions/{vehicle}/stream`, gdzie
// `{vehicle}` to `2:AGENCJA__numer` z pozycji (np. `2:IC__8316`).
// Event `message` niesie wszystko naraz:
// - `position`: [id, city, route, numer, [lon,lat], bearing, timestamp, tripId],
// - `stops`: [arr, dep] z opóźnieniem per postój (ms),
// - `alerts`: krotki [title, description, url, publishedAt, from, until, lang, detected].
// Event `initial` to rozkład kursu (itinerary) bez pozycji.
//
// Zbiorkom ma własne trip_id (np. `ICic_ustka-..._06.11.2026_13.38`), więc
// łącznikiem z bazą PLK jest NUMER POCIĄGU (drugi człon `shortName`) plus
// zgodność nazw stacji z trasy kursu.

import type { Leg, LegStop } from '../types/models';
import { ZBIORKOM } from './gtfsConfig';
import { getNationalActiveServices, getNationalDb } from './gtfsDatabase';
import { toPlkTripId } from './nationalRailUpdates';
import { withTimeout } from './net';

export interface NationalRailLive {
  /** trip_id (pl:...) -> opóźnienie w sekundach. */
  delays: Map<string, number>;
  /** trip_id -> bieżąca pozycja (mapa, etykieta „gdzie jest pociąg”). */
  positions: Map<string, { lat: number; lon: number; bearing?: number; updatedAt: number }>;
  /** trip_id -> id kursu zbiorkomu (do strumienia alertów). */
  zbTripIds: Map<string, string>;
  fetchedAt: number;
}

export interface ZbStopDeparture {
  tripId?: string;
  agency: string;
  line: string;
  color?: string;
  direction: string;
  trainNumber: string;
  trainName?: string;
  scheduledAt: number;
  delaySec: number;
  platform?: string;
  cancelled: boolean;
  live: boolean;
}

export interface ZbVehicleAlert {
  title: string;
  description: string;
}

/** Krotka stacji z /api6-open/pkp/stops: [id, city, name, code, [lon,lat], ...]. */
type StopTuple = [string, string, string, string, [number, number]];

const POSITIONS_TTL_MS = 25_000;

let stopsPromise: Promise<StopTuple[]> | null = null;
const positionsCache = new Map<string, { at: number; promise: Promise<NationalRailLive> }>();
const departuresCache = new Map<string, { at: number; promise: Promise<ZbStopDeparture[]> }>();
const alertsCache = new Map<string, { at: number; promise: Promise<ZbVehicleAlert[]> }>();

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Numer pociągu bez wariantów: „3830/1” -> „3830”, „65000/1” -> „65000”. */
function baseTrainNumber(value: string | undefined): string {
  const m = /(\d{1,7})/.exec(value ?? '');
  return m?.[1] ?? '';
}

/**
 * Wszystkie numery rozkładowe pociągu: „61170/1” kursuje jako 61170 i 61171
 * (zbiorkom podaje numer brygady, który bywa drugim wariantem). „3830/1”
 * -> [3830, 3831], bez ukośnika -> jeden numer.
 */
export function trainNumberVariants(
  value: string | undefined,
  fallbackLine?: string | undefined,
): string[] {
  const out = new Set<string>();
  for (const src of [value, fallbackLine]) {
    if (!src) continue;
    for (const token of src.trim().split(/\s+/)) {
      const m = /^(\d{1,7})(?:\/(\d{1,7}))?$/.exec(token);
      if (!m) continue;
      if (src === fallbackLine && m[1].length < 3) continue;
      const base = m[1];
      out.add(base);
      if (m[2]) {
        const suffix = m[2];
        const alt =
          suffix.length >= base.length
            ? suffix
            : base.slice(0, base.length - suffix.length) + suffix;
        out.add(alt);
      }
    }
  }
  return [...out];
}

async function fetchJson(url: string): Promise<unknown> {
  const timeout = withTimeout(ZBIORKOM.timeoutMs);
  try {
    const res = await fetch(url, { signal: timeout.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    timeout.dispose();
  }
}

/** Katalog stacji zbiorkomu (cache na sesję, ~3.5k krotek). */
function loadStops(): Promise<StopTuple[]> {
  if (stopsPromise) return stopsPromise;
  stopsPromise = fetchJson(`${ZBIORKOM.baseUrl}/api6-open/pkp/stops`)
    .then((raw) => {
      const list = (raw as { stops?: unknown }).stops;
      if (!Array.isArray(list)) return [];
      return list.filter(
        (s): s is StopTuple => Array.isArray(s) && s.length >= 5 && typeof s[0] === 'string',
      );
    })
    .catch(() => {
      stopsPromise = null;
      return [];
    });
  return stopsPromise;
}

/** Bbox z listy punktów (lon,lat) z zapasem ~0.25° (~25 km). */
function bboxOf(points: Array<{ lat: number; lon: number }>, padDeg = 0.25): string {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  return `${(minLon - padDeg).toFixed(3)},${(minLat - padDeg).toFixed(3)},${(maxLon + padDeg).toFixed(3)},${(maxLat + padDeg).toFixed(3)}`;
}

interface ZbPosition {
  vehicle: { id: string; agency: string };
  routeName: string;
  brigade: string;
  location: [number, number];
  timestamp: number;
  bearing?: number;
  delay: number;
  headsign: string | null;
  upcomingStops: {
    sequence: number;
    name: string;
    scheduledArrival: number;
    scheduledDeparture: number;
  }[];
}

async function fetchPositions(bbox: string, agencies: string[]): Promise<ZbPosition[]> {
  const url = `${ZBIORKOM.baseUrl}/api6-open/pkp/positions/${bbox}?agencies=${encodeURIComponent(agencies.join(','))}`;
  const raw = (await fetchJson(url)) as { positions?: unknown };
  if (!Array.isArray(raw.positions)) return [];
  return raw.positions.filter((p): p is ZbPosition => {
    if (!p || typeof p !== 'object') return false;
    const v = p as ZbPosition;
    return (
      Array.isArray(v.location) &&
      typeof v.location[0] === 'number' &&
      typeof v.location[1] === 'number' &&
      typeof v.timestamp === 'number' &&
      typeof v.delay === 'number' &&
      Array.isArray(v.upcomingStops)
    );
  });
}

interface CandidateTrip {
  tripId: string;
  trainNumber: string;
  headsign: string;
  stops: { name: string; seq: number; arrSec: number; depSec: number }[];
}

/**
 * Kursy z bazy PLK o podanych numerach pociągów, aktywne dziś i nakładające
 * się na teraz. Okno czasowe liczymy po start_sec/end_sec KURSU, nie po
 * odjeździe ze stacji: pociąg Wrocław -> Warszawa jest w drodze 5 h i w
 * połowie podróży odjazd ze stacji startowej leży już poza oknem, przez co
 * live znikał po ~3 h jazdy.
 */
async function findCandidateTrips(
  trainNumbers: string[],
  nowSec: number,
): Promise<CandidateTrip[]> {
  const db = await getNationalDb();
  const numbers = [...new Set(trainNumbers.flatMap((n) => trainNumberVariants(n)))].filter(Boolean);
  if (numbers.length === 0) return [];

  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const services = await getNationalActiveServices(now.getDay(), dateStr);
  if (services.size === 0) return [];

  const svcPlaceholders = [...services].map(() => '?').join(',');
  // Numer w bazie bywa „3830/1” (para kursów), a noga podaje sam numer
  // („3830”) albo pełną parę - dopasowujemy dokładnie albo po prefiksie.
  const numClauses = numbers
    .map(() => '(t.train_number = ? OR t.train_number LIKE ?)')
    .join(' OR ');
  const numParams = numbers.flatMap((n) => [n, `${n}/%`]);
  const rows = await db.getAllAsync<{ trip_id: string; train_number: string; headsign: string }>(
    `SELECT t.trip_id, t.train_number, t.headsign
     FROM trips t
     WHERE t.service_id IN (${svcPlaceholders})
       AND (${numClauses})
       AND t.start_sec <= ? AND t.end_sec >= ?`,
    ...services,
    ...numParams,
    nowSec + 4 * 3600,
    nowSec - 4 * 3600,
  );
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.trip_id);
  const placeholders = ids.map(() => '?').join(',');
  const seqRows = await db.getAllAsync<{
    trip_id: string;
    stop_id: string;
    seq: number;
    arr_sec: number;
    dep_sec: number;
  }>(
    `SELECT trip_id, stop_id, seq, arr_sec, dep_sec FROM stop_times WHERE trip_id IN (${placeholders}) ORDER BY trip_id, seq`,
    ...ids,
  );
  const nameRows = await db.getAllAsync<{ stop_id: string; name: string }>(
    'SELECT stop_id, name FROM stops',
  );
  const nameById = new Map(nameRows.map((s) => [s.stop_id, s.name]));
  const seqByTrip = new Map<
    string,
    { name: string; seq: number; arrSec: number; depSec: number }[]
  >();
  for (const r of seqRows) {
    let list = seqByTrip.get(r.trip_id);
    if (!list) {
      list = [];
      seqByTrip.set(r.trip_id, list);
    }
    list.push({
      name: nameById.get(r.stop_id) ?? r.stop_id,
      seq: r.seq,
      arrSec: r.arr_sec,
      depSec: r.dep_sec,
    });
  }
  return rows.map((r) => ({
    tripId: r.trip_id,
    trainNumber: r.train_number,
    headsign: r.headsign,
    stops: seqByTrip.get(r.trip_id) ?? [],
  }));
}

/** Dopasowanie pozycji do kursów: numer pociągu + najbliższa stacja w czasie. */
function matchPositions(
  positions: ZbPosition[],
  candidates: CandidateTrip[],
  inputLegs: NationalLiveLeg[],
): NationalRailLive {
  const delays = new Map<string, number>();
  const out = new Map<string, { lat: number; lon: number; bearing?: number; updatedAt: number }>();
  const zbTripIds = new Map<string, string>();
  const byNumber = new Map<string, CandidateTrip[]>();
  // Kurs indeksowany pod WSZYSTKIMI wariantami numeru („61170/1” = 61170
  // i 61171): zbiorkom podaje numer brygady, który bywa drugim wariantem.
  for (const c of candidates) {
    for (const num of trainNumberVariants(c.trainNumber)) {
      const list = byNumber.get(num) ?? [];
      list.push(c);
      byNumber.set(num, list);
    }
  }

  for (const pos of positions) {
    const key = baseTrainNumber(pos.brigade);
    const list = key ? byNumber.get(key) : undefined;
    if (!list?.length) continue;
    // Pozycja podaje tylko najbliższe 3 stacje. Bierzemy TĘ, na której pociąg
    // aktualnie stoi/jedzie (najbliższa w czasie), a nie zbiór wszystkich:
    // inaczej każdy kurs zatrzymujący się na dworcu „pasuje” do każdego
    // pociągu stojącego tam w tej chwili.
    const nextStop = pos.upcomingStops[0];
    if (!nextStop) continue;
    const nextKey = normalized(nextStop.name);
    const nextDate = new Date(nextStop.scheduledArrival);
    const nextSec = nextDate.getHours() * 3600 + nextDate.getMinutes() * 60 + nextDate.getSeconds();
    let best: { trip: CandidateTrip; diff: number } | null = null;
    for (const trip of list) {
      for (const stop of trip.stops) {
        if (normalized(stop.name) !== nextKey) continue;
        const stopSec = (((stop.arrSec || stop.depSec) % 86400) + 86400) % 86400;
        const directDiff = Math.abs(stopSec - nextSec);
        const diff = Math.min(directDiff, 86400 - directDiff);
        if (!best || diff < best.diff) best = { trip, diff };
        break;
      }
    }
    if (!best) continue;
    const delaySec = Math.round(pos.delay / 1000);
    const posEntry = {
      lat: pos.location[1],
      lon: pos.location[0],
      bearing: typeof pos.bearing === 'number' ? pos.bearing : undefined,
      updatedAt: pos.timestamp,
    };
    const zbId = `2:${pos.vehicle.agency}__${pos.vehicle.id.replace(/^_/, '')}`;

    delays.set(best.trip.tripId, delaySec);
    out.set(best.trip.tripId, posEntry);
    // Id kursu zbiorkomu do strumienia alertów (z pozycji, nie z GTFS).
    zbTripIds.set(best.trip.tripId, zbId);

    const matchedPlkId = toPlkTripId(best.trip.tripId);
    const matchedNums = new Set(trainNumberVariants(best.trip.trainNumber));
    for (const leg of inputLegs) {
      if (!leg.tripId || leg.tripId === best.trip.tripId) continue;
      const legPlkId = toPlkTripId(leg.tripId);
      const legNums = trainNumberVariants(leg.trainNumber, leg.line);
      if (
        (matchedPlkId && legPlkId === matchedPlkId) ||
        legNums.some((n) => matchedNums.has(n))
      ) {
        delays.set(leg.tripId, delaySec);
        out.set(leg.tripId, posEntry);
        zbTripIds.set(leg.tripId, zbId);
      }
    }
  }
  return { delays, positions: out, zbTripIds, fetchedAt: Date.now() };
}

export interface NationalLiveLeg {
  /** trip_id z bazy PLK (pl:...) lub miejskiej (KD:T:...), żeby dopiąć pozycję i opóźnienie do nóg w UI. */
  tripId?: string;
  mode?: Leg['mode'];
  fromStop: string;
  toStop: string;
  fromStopId?: string;
  toStopId?: string;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
  departAt?: string;
  arriveAt?: string;
  scheduledDepartureSec?: number;
  scheduledArrivalSec?: number;
  intermediateStops?: LegStop[];
  line?: string;
  trainNumber?: string;
  railAgency?: string;
}

/**
 * Live dla nóg kolejowych: bbox z ich stacji, pozycje tylko dla przewoźników
 * z tych nóg, dopasowanie po numerze i nazwach stacji. Cache 25 s na bbox,
 * więc tick trackera i ekran nie sieją zapytań.
 */
export async function fetchNationalRailLive(legs: NationalLiveLeg[]): Promise<NationalRailLive> {
  const empty: NationalRailLive = {
    delays: new Map(),
    positions: new Map(),
    zbTripIds: new Map(),
    fetchedAt: Date.now(),
  };
  const trains = legs.filter((l) => l.trainNumber || l.line);
  if (trains.length === 0) return empty;

  const points = trains.flatMap((l) =>
    l.fromLat != null && l.fromLon != null && l.toLat != null && l.toLon != null
      ? [
          { lat: l.fromLat, lon: l.fromLon },
          { lat: l.toLat, lon: l.toLon },
        ]
      : [],
  );
  if (points.length === 0) return empty;
  const bbox = bboxOf(points);
  const agencies = [...new Set(trains.map((l) => l.railAgency).filter((a): a is string => !!a))];
  const cacheKey = `${bbox}|${agencies.join(',')}`;
  const hit = positionsCache.get(cacheKey);
  if (hit && Date.now() - hit.at < POSITIONS_TTL_MS) return hit.promise;

  const promise = (async () => {
    const positions = await fetchPositions(
      bbox,
      agencies.length
        ? agencies
        : ['IC', 'PR', 'KD', 'KM', 'KW', 'KS', 'KML', 'LKA', 'SKM', 'SKMT', 'AR'],
    );
    if (positions.length === 0) return empty;
    const now = new Date();
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60;
    // Kandydaci po numerach pociągów z nóg (nie po stacjach): okno czasowe
    // liczone na cały kurs, więc live nie znika w połowie długiej trasy.
    const numbers = [
      ...new Set(
        trains.flatMap((l) => trainNumberVariants(l.trainNumber, l.line)).filter(Boolean),
      ),
    ];
    const candidates = await findCandidateTrips(numbers, nowSec);
    return matchPositions(positions, candidates, trains);
  })().catch(() => empty);

  positionsCache.set(cacheKey, { at: Date.now(), promise });
  if (positionsCache.size > 8) {
    const oldest = positionsCache.keys().next().value;
    if (oldest !== undefined) positionsCache.delete(oldest);
  }
  return promise;
}

/* ─── Tablica odjazdów stacji (peron, opóźnienie, nazwa handlowa) ─────── */

/** Stacja zbiorkomu dla nazwy stacji z bazy PLK (katalog po nazwie). */
async function zbStopIdForStation(name: string): Promise<string | null> {
  const stops = await loadStops();
  if (stops.length === 0) return null;
  const key = normalized(name);
  const exact = stops.find((s) => normalized(s[2]) === key);
  return exact?.[0] ?? null;
}

interface RawDeparture {
  trip?: {
    id?: string;
    route?: { name?: string; agency?: string; color?: string };
    headsign?: string;
    shortName?: string;
  };
  scheduledDeparture?: number;
  delay?: number;
  isRealtime?: boolean;
  isCancelled?: boolean;
  platform?: string;
}

function parseDeparture(raw: RawDeparture): ZbStopDeparture | null {
  const trip = raw.trip ?? {};
  const route = trip.route ?? {};
  if (typeof raw.scheduledDeparture !== 'number') return null;
  const shortName = (trip.shortName ?? '').trim();
  const m = /^(\S+)(?:\s+(.+))?$/.exec(shortName);
  if (!m) return null;
  return {
    tripId: trip.id,
    agency: route.agency ?? '',
    line: route.name ?? '',
    color: route.color,
    direction: trip.headsign ?? '',
    trainNumber: m[1],
    trainName: m[2] || undefined,
    scheduledAt: raw.scheduledDeparture,
    delaySec: Math.round((raw.delay ?? 0) / 1000),
    platform: raw.platform || undefined,
    cancelled: raw.isCancelled === true,
    live: raw.isRealtime === true,
  };
}

/** Odjazdy ze stacji zbiorkomu (cache 20 s, jak tablica w KD). */
export async function fetchZbStopDepartures(stationName: string): Promise<ZbStopDeparture[]> {
  const stopId = await zbStopIdForStation(stationName);
  if (!stopId) return [];
  const hit = departuresCache.get(stopId);
  if (hit && Date.now() - hit.at < 20_000) return hit.promise;
  const promise = fetchJson(
    `${ZBIORKOM.baseUrl}/api6-open/pkp/stops/${encodeURIComponent(stopId)}?limit=100`,
  )
    .then((raw) => {
      const list = (raw as { departures?: unknown }).departures;
      if (!Array.isArray(list)) return [];
      return list.flatMap((d) => {
        const parsed = parseDeparture(d as RawDeparture);
        return parsed ? [parsed] : [];
      });
    })
    .catch(() => {
      departuresCache.delete(stopId);
      return [];
    });
  departuresCache.set(stopId, { at: Date.now(), promise });
  return promise;
}

/* ─── Alerty per pociąg (strumień SSE pozycji) ────────────────────────── */

/**
 * Id pojazdu zbiorkomu dla nogi kolejowej: `2:AGENCJA__numer`. Zbiorkom
 * numeruje pojazdy brygadą, która dla pociągów „61170/1” bywa drugim
 * wariantem (61171), więc zwracamy oba kandydaty - strumień dla złego
 * numeru odpowiada POSITION_NOT_FOUND i po prostu próbujemy następnego.
 * To działa nawet gdy pozycje chwilowo nie dopasowały kursu.
 */
export function vehicleCandidatesForLeg(leg: {
  railAgency?: string;
  trainNumber?: string;
  line?: string;
}): string[] {
  const agency = (leg.railAgency ?? 'IC').trim() || 'IC';
  const numbers = trainNumberVariants(leg.trainNumber, leg.line);
  return numbers.map((n) => `2:${agency}__${n}`);
}

function parseAlerts(raw: unknown): ZbVehicleAlert[] {
  if (!Array.isArray(raw)) return [];
  const out: ZbVehicleAlert[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
    const title = entry[0].trim();
    const description = typeof entry[1] === 'string' ? entry[1].trim() : '';
    if (!title) continue;
    // Zbiorkom dokleja komunikaty operatora do KAŻDEGO kursu (przedsprzedaż,
    // cenniki, prace serwisowe w kanałach sprzedaży). Zostają realne
    // utrudnienia w ruchu: objazdy, odwołania, ograniczenia prędkości.
    const haystack = `${title} ${description}`.toLowerCase();
    if (ALERT_NOISE.some((needle) => haystack.includes(needle))) continue;
    out.push({ title, description });
  }
  return out;
}

/** Słowa odcinające alerty handlowe/operatora, nie ruchowe. */
const ALERT_NOISE = [
  'sprzedaży',
  'sprzedaz',
  'bilet',
  'cennik',
  'regulamin',
  'promocj',
  'taryf',
  'prac sieciowych',
  'prac serwisowych',
  'kanałach sprzedaży',
  'kanalach sprzedazy',
  'rezerwacji miejsc',
  'aplikacj',
  'serwis',
  'ofert',
  'rabat',
  'ulgow',
  'lojaln',
];

/**
 * Alerty konkretnego pociągu. Strumień `api6/pkp/positions/{vehicle}/stream`
 * wysyła `initial` (rozkład kursu) i `message` (pozycja + stops + alerts).
 * Czytamy do pierwszego `message` i zamykamy strumień; cache 5 min.
 *
 * `vehicle` to `2:AGENCJA__numer` (np. `2:IC__8316`) - dostajemy je z
 * dopasowania pozycji (`NationalRailLive.zbTripIds`).
 */
export async function fetchZbVehicleAlerts(vehicle: string): Promise<ZbVehicleAlert[]> {
  const hit = alertsCache.get(vehicle);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.promise;
  const promise = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ZBIORKOM.timeoutMs);
      const res = await fetch(
        `${ZBIORKOM.baseUrl}/api6/pkp/positions/${encodeURIComponent(vehicle)}/stream`,
        { headers: { Accept: 'text/event-stream' }, signal: ctrl.signal },
      );
      if (!res.ok || !res.body) return [];
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let alerts: ZbVehicleAlert[] | null = null;
      // Czytamy do pierwszego eventu `message` (pozycja + stops + alerts):
      // to jest pełny stan kursu, także gdy alertów nie ma (pusta lista).
      // Kolejne message'e to tylko odświeżenia pozycji.
      while (alerts === null && buffer.length < 200_000) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let eventEnd = buffer.indexOf('\n\n');
        while (eventEnd >= 0) {
          const block = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + 2);
          const isMessage = block.includes('event: message');
          const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
          if (isMessage && dataLine) {
            try {
              const payload = JSON.parse(dataLine.slice(5).trim()) as { alerts?: unknown };
              alerts = parseAlerts(payload.alerts);
            } catch {
              alerts = [];
            }
            break;
          }
          eventEnd = buffer.indexOf('\n\n');
        }
      }
      clearTimeout(timer);
      await reader.cancel().catch(() => {});
      return alerts ?? [];
    } catch {
      return [];
    }
  })();
  alertsCache.set(vehicle, { at: Date.now(), promise });
  return promise;
}
