// Klient zbiorkom.live Open Data API (bez klucza):
// - miasto `pkp`: pozycje i opóźnienia pociągów regionalnych (agencja `KD`
//   dla Wrocławia, `KML` dla Krakowa, `KS` dla GZM, `KM` i `WKD` dla Warszawy,
//   `KW` i `PR` dla Poznania, `SKMT` dla Trójmiasta, `LKA` dla Łodzi),
// - miasto `wroclaw` / `krakow` / `gzm` / `warsaw` / `poznan` / `tricity`
//   / `lodz` / `szczecin` / `opole`: awaryjne (Wrocław) albo podstawowe (reszta)
//   pozycje autobusów, tramwajów, trolejbusów i metra, gdy bezpośredni
//   feed nie odpowiada.
//
// Endpointy: GET /api6-open/{city}/positions/{bbox}[?agencies=..].
// Odpowiedź: { positions: [...] }, czasy w ms (epoch), współrzędne [lon, lat].

import {
  BinaryReader,
  BinaryWriter,
  CMD_MATCH_ZB_KD,
  invokeRustSync,
} from '../../modules/kilometr-raptor';
import { ZBIORKOM } from './gtfsConfig';
import { normalizeName } from './vehiclePosition';
import { gtfsStore, type DayIndex } from './routing/store';
import type { RawVehicleRow } from './liveTracker';

export interface ZbUpcomingStop {
  name: string;
  /** sekunda doby ze scheduledDeparture (awaryjnie scheduledArrival) */
  schedSec: number;
}

export interface ZbKdVehicle {
  id: string;
  /** numer pociągu (brygada) — u nas to route_short_name kursu KD */
  trainNumber: string;
  /** oznaczenie linii z API (D1, D30...), tylko informacyjnie */
  line: string;
  lat: number;
  lon: number;
  /** opóźnienie z API [s] */
  delaySec: number;
  updatedAt: number;
  currentStopName?: string;
  nextStopName?: string;
  stops: ZbUpcomingStop[];
}

interface ZbPositionJson {
  vehicle?: { id?: string; type?: string; agency?: string };
  routeName?: string;
  brigade?: string;
  location?: [number, number];
  timestamp?: number;
  delay?: number;
  headsign?: string;
  upcomingStops?: { name?: string; scheduledArrival?: number; scheduledDeparture?: number }[];
}

async function fetchPositions(city: string, agencies?: string, bbox?: string): Promise<ZbPositionJson[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ZBIORKOM.timeoutMs);
  try {
    const box = bbox ?? ZBIORKOM.wroclawBbox;
    const url =
      `${ZBIORKOM.baseUrl}/api6-open/${city}/positions/${box}` +
      (agencies ? `?agencies=${encodeURIComponent(agencies)}` : '');
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const parsed: unknown = await res.json();
    if (!parsed || typeof parsed !== 'object') return null;
    const arr = (parsed as { positions?: unknown }).positions;
    return Array.isArray(arr) ? (arr as ZbPositionJson[]) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pozycje MPK (wrocławskie autobusy i tramwaje) jako wiersze dla matchera
 * liveTrackera. Ten sam format co bus_position, więc dopasowanie do kursów,
 * rozwiązywanie konfliktów i RAPTOR działają bez zmian.
 */
export async function fetchZbWroclawRows(): Promise<RawVehicleRow[] | null> {
  const positions = await fetchPositions('wroclaw');
  if (positions === null) return null;
  return toRawRows(positions);
}

/** Pozycje KMK Kraków (ZTP) jako wiersze dla matchera. Podstawowy feed live. */
export async function fetchZbKrakowRows(): Promise<RawVehicleRow[] | null> {
  const { getCity } = await import('../cities');
  const krk = getCity('krakow');
  const positions = await fetchPositions(krk.zbiorkomSlug, undefined, krk.zbiorkomBbox);
  if (positions === null) return null;
  return toRawRows(positions);
}

/** Pozycje ZTM GZM jako wiersze dla matchera. Podstawowy feed live. */
export async function fetchZbGzmRows(): Promise<RawVehicleRow[] | null> {
  const { getCity } = await import('../cities');
  const gzm = getCity('gzm');
  const positions = await fetchPositions(gzm.zbiorkomSlug, undefined, gzm.zbiorkomBbox);
  if (positions === null) return null;
  return toRawRows(positions);
}

/**
 * Pozycje WTP (autobusy, tramwaje, metro M1/M2) jako wiersze dla matchera.
 * Podstawowy feed live Warszawy: zbiorkom agreguje pod miastem także gminy
 * ościenne (GPA, Ząbki, Pruszków, Otwock), a te mają własne numery linii,
 * które kolidują z WTP (Otwock jeździ nawet jako "M1"). Filtr
 * `agencies=default` zostawia wyłącznie Warszawski Transport Publiczny.
 * SKA nie pojawia się w tym feedzie, więc zostaje bez live.
 */
export async function fetchZbWarsawRows(): Promise<RawVehicleRow[] | null> {
  const { getCity } = await import('../cities');
  const waw = getCity('warszawa');
  const positions = await fetchPositions(waw.zbiorkomSlug, 'default', waw.zbiorkomBbox);
  if (positions === null) return null;
  return toRawRows(positions);
}

/**
 * Pozycje ZTM Poznań jako wiersze dla matchera. Podstawowy feed live.
 * Filtr `agencies=default,PKSPOZNAN` (za issue #241): agencja `default`
 * to ZTM Poznań, a `PKSPOZNAN` wozi zarówno linie ZTM pod swoją brygadą,
 * jak i własne linie podmiejskie. Reszta agencji jest celowo wykluczona:
 * `SRODAWLKP` (autobusy miejskie Środy Wlkp.) numeruje linie 1–11, czyli
 * dokładnie jak poznańskie tramwaje: pojazdy nigdy nie dopasują się do
 * kursów (30 km od trasy), ale wisiałyby na mapie i w widoku linii jako
 * widma tramwajów. `KOMBUS` jeździ liniami 580–599, których nie ma
 * w GTFS ZTM, więc też byłyby samymi kropkami bez rozkładu.
 */
export async function fetchZbPoznanRows(): Promise<RawVehicleRow[] | null> {
  const { getCity } = await import('../cities');
  const pozn = getCity('poznan');
  const positions = await fetchPositions(pozn.zbiorkomSlug, 'default,PKSPOZNAN', pozn.zbiorkomBbox);
  if (positions === null) return null;
  return toRawRows(positions);
}

/**
 * Pozycje ZTM Gdańsk i ZKM Gdynia jako wiersze dla matchera. Podstawowy
 * feed live Trójmiasta: zbiorkom agreguje je pod miastem `tricity`, Gdańsk
 * pod agencją `default`, Gdynia pod `GDYNIA`. Bez filtra agencji, obie
 * sieci są chciane (trolejbusy 21-33 jadą jako bus, jak Tychy w GZM).
 */
export async function fetchZbTricityRows(): Promise<RawVehicleRow[] | null> {
  const { getCity } = await import('../cities');
  const tri = getCity('trojmiasto');
  const positions = await fetchPositions(tri.zbiorkomSlug, undefined, tri.zbiorkomBbox);
  if (positions === null) return null;
  return toRawRows(positions);
}

/**
 * Pozycje ZDiT Łódź jako wiersze dla matchera. Podstawowy feed live.
 * Filtr `agencies=default` (jak Warszawa): agencje `PABIANICE`, `ZGIERZ`,
 * `STRYKOW` i `ALEKSANDROW` mają własne rozkłady podmiejskie (numery 1–10
 * oraz A3 i T-7), których nie ma w GTFS ZDiT. Ich niskie numery kolidują
 * z łódzkimi tramwajami, więc pojazdy wisiałyby na mapie i w widoku linii
 * jako widma. Dojazd do Pabianic i Zgierza kryją tramwaje 41/43 z agencji
 * `default`, więc aglomeracja nie traci live.
 */
export async function fetchZbLodzRows(): Promise<RawVehicleRow[] | null> {
  const { getCity } = await import('../cities');
  const lodz = getCity('lodz');
  const positions = await fetchPositions(lodz.zbiorkomSlug, 'default', lodz.zbiorkomBbox);
  if (positions === null) return null;
  return toRawRows(positions);
}

/**
 * Pozycje ZDiTM Szczecin jako wiersze dla matchera. Podstawowy feed live.
 * Bez filtra agencji: całe miasto jedzie pod jedną agencją `default`
 * (tramwaje 1–12 z route_type 0 w GTFS, autobusy 51+ i pospieszne A–C).
 */
export async function fetchZbSzczecinRows(): Promise<RawVehicleRow[] | null> {
  const { getCity } = await import('../cities');
  const szcz = getCity('szczecin');
  const positions = await fetchPositions(szcz.zbiorkomSlug, undefined, szcz.zbiorkomBbox);
  if (positions === null) return null;
  return toRawRows(positions);
}

/**
 * Pozycje MZK Opole jako wiersze dla matchera. Podstawowy feed live.
 * Bez filtra agencji: całe miasto jedzie pod jedną agencją `default`
 * (same autobusy, route_type 3 w GTFS: dzienne 1-30, nocne N1-N2,
 * szkolne SZ1-SZ20 i specjalne S1-S2).
 */
export async function fetchZbOpoleRows(): Promise<RawVehicleRow[] | null> {
  const { getCity } = await import('../cities');
  const opo = getCity('opole');
  const positions = await fetchPositions(opo.zbiorkomSlug, undefined, opo.zbiorkomBbox);
  if (positions === null) return null;
  return toRawRows(positions);
}

function toRawRows(positions: ZbPositionJson[]): RawVehicleRow[] {
  const rows: RawVehicleRow[] = [];
  for (const p of positions) {
    const line = (p.routeName || '').trim();
    const loc = p.location;
    const id = (p.vehicle?.id || '').trim();
    if (!line || !id || !loc || loc.length < 2) continue;
    const lat = loc[1];
    const lon = loc[0];
    if (!lat || !lon) continue;
    rows.push({ name: line, type: p.vehicle?.type === '0' ? 'tram' : 'bus', x: lat, y: lon, k: id });
  }
  return rows;
}

/** Epoch ms → sekunda doby (ta sama konwencja co reszta trackera). */
function toSecOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

export async function fetchZbKd(): Promise<ZbKdVehicle[] | null> {
  return fetchZbRail('KD');
}

/** Pociągi Kolei Małopolskich (SKA) z zbiorkom.live. Ten sam kształt co KD. */
export async function fetchZbKml(): Promise<ZbKdVehicle[] | null> {
  const { getCity } = await import('../cities');
  return fetchZbRail('KML', getCity('krakow').zbiorkomBbox);
}

/** Pociągi Kolei Śląskich, IC i POLREGIO z jednego zapytania (bbox GZM).
 *  Trzy osobne zapytania na poll to zbędny ruch: API przyjmuje listę
 *  agencji, a pojazdy rozdzielamy po `vehicle.agency`. */
export async function fetchZbGzmRails(): Promise<{ agency: string; vehicles: ZbKdVehicle[] }[] | null> {
  const { getCity } = await import('../cities');
  const positions = await fetchPositions('pkp', 'KS,IC,PR', getCity('gzm').zbiorkomBbox);
  if (positions === null) return null;
  const out: { agency: string; vehicles: ZbKdVehicle[] }[] = [];
  for (const agency of ['KS', 'IC', 'PR']) {
    const vehicles = toRailVehicles(positions.filter((p) => (p.vehicle?.agency || '') === agency));
    if (vehicles.length > 0) out.push({ agency, vehicles });
  }
  return out;
}

/**
 * Pociągi KM i WKD z jednego zapytania (bbox Warszawy). SKA nie ma feedu
 * live (sprawdzone: nie ma jej ani w mieście `warsaw`, ani pod agencją
 * SKM w `pkp`), więc zostaje na rozkładzie jak kolej w innych miastach.
 */
export async function fetchZbWarsawRails(): Promise<{ agency: string; vehicles: ZbKdVehicle[] }[] | null> {
  const { getCity } = await import('../cities');
  const positions = await fetchPositions('pkp', 'KM,WKD', getCity('warszawa').zbiorkomBbox);
  if (positions === null) return null;
  const out: { agency: string; vehicles: ZbKdVehicle[] }[] = [];
  for (const agency of ['KM', 'WKD']) {
    const vehicles = toRailVehicles(positions.filter((p) => (p.vehicle?.agency || '') === agency));
    if (vehicles.length > 0) out.push({ agency, vehicles });
  }
  return out;
}

/**
 * Pociągi Kolei Wielkopolskich i POLREGIO z jednego zapytania (bbox
 * Poznania). Statyczny GTFS mamy tylko dla KW (linie PKM1–PKM5): pojazdy
 * PR bez dopasowania w bazie matcher odrzuca po numerze, więc feed jest
 * przyszłościowy bez zmiany kodu.
 */
export async function fetchZbPoznanRails(): Promise<{ agency: string; vehicles: ZbKdVehicle[] }[] | null> {
  const { getCity } = await import('../cities');
  const positions = await fetchPositions('pkp', 'KW,PR', getCity('poznan').zbiorkomBbox);
  if (positions === null) return null;
  const out: { agency: string; vehicles: ZbKdVehicle[] }[] = [];
  for (const agency of ['KW', 'PR']) {
    const vehicles = toRailVehicles(positions.filter((p) => (p.vehicle?.agency || '') === agency));
    if (vehicles.length > 0) out.push({ agency, vehicles });
  }
  return out;
}

/**
 * Pociągi SKM Trójmiasto z jednego zapytania (bbox Trójmiasta, agencja
 * SKMT). Statyczny GTFS mamy z mirroru feedu SKM, numer pociągu siedzi
 * w trip_short_name, więc matcher spina po numerze jak KW/KM.
 */
export async function fetchZbSkmtRails(): Promise<{ agency: string; vehicles: ZbKdVehicle[] }[] | null> {
  const { getCity } = await import('../cities');
  const positions = await fetchPositions('pkp', 'SKMT', getCity('trojmiasto').zbiorkomBbox);
  if (positions === null) return null;
  const out: { agency: string; vehicles: ZbKdVehicle[] }[] = [];
  for (const agency of ['SKMT']) {
    const vehicles = toRailVehicles(positions.filter((p) => (p.vehicle?.agency || '') === agency));
    if (vehicles.length > 0) out.push({ agency, vehicles });
  }
  return out;
}

/**
 * Pociągi Łódzkiej Kolei Aglomeracyjnej z jednego zapytania (bbox Łodzi).
 * Brygada z live to numer pociągu (w GTFS ŁKA trip_short_name przed "/"),
 * więc matcher dopina kursy po numerze jak przy KW. Pojazd spoza lokalnego
 * rozkładu (świeższy eksport) matcher odrzuca po numerze bez błędu.
 */
export async function fetchZbLodzRails(): Promise<{ agency: string; vehicles: ZbKdVehicle[] }[] | null> {
  const { getCity } = await import('../cities');
  const positions = await fetchPositions('pkp', 'LKA', getCity('lodz').zbiorkomBbox);
  if (positions === null) return null;
  const vehicles = toRailVehicles(positions.filter((p) => (p.vehicle?.agency || '') === 'LKA'));
  return vehicles.length > 0 ? [{ agency: 'LKA', vehicles }] : [];
}

async function fetchZbRail(agency: string, bbox?: string): Promise<ZbKdVehicle[] | null> {
  const positions = await fetchPositions('pkp', agency, bbox);
  if (positions === null) return null;
  return toRailVehicles(positions);
}

function toRailVehicles(positions: ZbPositionJson[]): ZbKdVehicle[] {
  const out: ZbKdVehicle[] = [];
  for (const p of positions) {
    const trainNumber = (p.brigade || '').trim();
    const loc = p.location;
    if (!trainNumber || !loc || loc.length < 2) continue;
    const lat = loc[1];
    const lon = loc[0];
    if (!lat || !lon) continue;
    const stops: ZbUpcomingStop[] = [];
    for (const s of p.upcomingStops || []) {
      const name = (s.name || '').trim();
      const ms = s.scheduledDeparture ?? s.scheduledArrival;
      if (!name || ms == null) continue;
      stops.push({ name, schedSec: toSecOfDay(ms) });
    }
    out.push({
      id: (p.vehicle?.id || trainNumber).trim(),
      trainNumber: trainNumber.toUpperCase(),
      line: (p.routeName || '').trim().toUpperCase(),
      lat,
      lon,
      delaySec: Math.round((p.delay ?? 0) / 1000),
      updatedAt: p.timestamp ?? Date.now(),
      currentStopName: stops[0]?.name,
      nextStopName: stops[1]?.name,
      stops,
    });
  }
  return out;
}

export interface ZbKdMatch {
  tripId: string;
}

/**
 * Dopasowanie pociągu KD do lokalnego kursu. Identyfikatory tripów zbiorkom
 * i naszych (PDP) są różne, więc spinamy po numerze pociągu (brygada =
 * nasz route_short_name) + weryfikacja nazwami i czasami najbliższych
 * postojów. Bez weryfikacji czasowej sam numer to za mało: ten sam skład
 * potrafi jechać rano i wieczorem.
 */
function matchZbKdRust(veh: ZbKdVehicle, dayIndex: DayIndex, routeIds: string[]): ZbKdMatch | null | undefined {
  const tripIds: string[] = [];
  let candCount = 0;
  const body = new BinaryWriter(256);
  for (const pattern of dayIndex.patterns.values()) {
    if (!routeIds.includes(pattern.routeId)) continue;
    const trips = pattern.trips as { trip_id: string }[] | undefined;
    if (!trips) continue;
    for (const trip of trips) {
      const times = gtfsStore.stopTimes.get(trip.trip_id) as
        | { stop_id: string; departure_sec: number; arrival_sec: number }[]
        | undefined;
      if (!times || times.length === 0) continue;
      const packed: { name: string; sec: number }[] = [];
      for (const t of times) {
        const stop = gtfsStore.stops.get(t.stop_id);
        const name = stop?.stop_name || '';
        const sec = t.departure_sec ?? t.arrival_sec;
        if (!name || sec == null) continue;
        packed.push({ name, sec });
      }
      tripIds.push(trip.trip_id);
      body.u32(candCount).u16(packed.length);
      for (const s of packed) body.str(s.name).i32(s.sec | 0);
      candCount++;
    }
  }
  const head = new BinaryWriter(64 + veh.stops.length * 32);
  head.u16(veh.stops.length);
  for (const zb of veh.stops) head.str(zb.name).i32(zb.schedSec | 0);
  head.u32(candCount);
  const headBytes = head.finish();
  const bodyBytes = body.finish();
  const payload = new Uint8Array(headBytes.byteLength + bodyBytes.byteLength);
  payload.set(headBytes, 0);
  payload.set(bodyBytes, headBytes.byteLength);
  const res = invokeRustSync(CMD_MATCH_ZB_KD, payload);
  if (!res || res.byteLength < 5) return undefined;
  const r = new BinaryReader(res);
  if (r.u8Val() === 0) return null;
  const idx = r.u32();
  const tripId = tripIds[idx];
  return tripId ? { tripId } : null;
}

export function matchZbKd(veh: ZbKdVehicle, dayIndex: DayIndex): ZbKdMatch | null {
  if (veh.stops.length === 0) return null;
  let routeIds: string[] = [];
  try {
    routeIds = gtfsStore.getRouteIdsByShortName(veh.trainNumber);
  } catch {
    return null;
  }
  if (routeIds.length === 0) return null;

  const rust = matchZbKdRust(veh, dayIndex, routeIds);
  if (rust !== undefined) return rust;

  let bestTripId: string | null = null;
  let bestScore = -Infinity;

  for (const [, pattern] of dayIndex.patterns.entries()) {
    if (!routeIds.includes(pattern.routeId)) continue;
    const trips = pattern.trips as { trip_id: string }[];
    if (!trips || trips.length === 0) continue;
    for (const trip of trips) {
      const times = gtfsStore.stopTimes.get(trip.trip_id) as
        | { stop_id: string; departure_sec: number; arrival_sec: number }[]
        | undefined;
      if (!times || times.length === 0) continue;
      let matched = 0;
      let totalDiff = 0;
      for (const zb of veh.stops) {
        const want = normalizeName(zb.name);
        if (!want) continue;
        for (const t of times) {
          const stop = gtfsStore.stops.get(t.stop_id);
          const local = normalizeName(stop?.stop_name || '');
          if (!local || (!local.includes(want) && !want.includes(local))) continue;
          const localSec = t.departure_sec ?? t.arrival_sec;
          if (localSec == null) continue;
          const diff = Math.abs(localSec - zb.schedSec);
          if (diff > 600) continue;
          matched++;
          totalDiff += diff;
          break;
        }
      }
      if (matched === 0) continue;
      const score = matched * 1000 - totalDiff;
      if (score > bestScore) {
        bestScore = score;
        bestTripId = trip.trip_id;
      }
    }
  }
  return bestTripId ? { tripId: bestTripId } : null;
}
