// Planer podróży między miastami: noga miejska (magazyn aktywnego miasta)
// + noga kolejowa (magazyn ogólnopolski `polska`), sklejone po czasie na
// stacji bramowej. Bazy NIE są scalane w jeden graf: każdy RAPTOR liczy
// na własnej sieci, a join pilnuje buforu na peron (trainMinTransferSec).
//
// Kierunki:
// - forward: origin w mieście, cel = stacja kolejowa → miasto → kolej.
// - reverse: origin = stacja/punkt poza miastem, cel w mieście → kolej → miasto.
// - rail-only: stacja → stacja (oba końce poza miastem aktywnym).
//
// Plan jest celowo dwufazowy zamiast jednego scalonego zapytania: pomiar
// pokazał, że scalanie sieci robi tę samą robotę w jednym przebiegu, ale
// dokłada wspólne ID, footpathy miasto-stacja i dedupe agencji. Join po
// czasie jest prostszy i pozwala trzymać bazę kolejową opcjonalną.

import { planConnections, SAME_POINT_M, type PlanOptions } from './engine';
import { gtfsStore, polskaStore } from './store';
import { getCity } from '../../cities';
import { getActiveCityIdSync } from '../cityStore';
import { isOutsideServiceArea } from '../serviceArea';
import { findNearestNationalStations, getNationalDb } from '../gtfsDatabase';
import {
  distanceMeters,
  normalizePolish,
  secondsToTimeString,
  timeStringToSeconds,
  warsawNow,
} from '../../gtfs/geo';
import type { Connection, Leg, LegMode } from './types';
import { sharedTimeMs } from '../../sharing/progress';
import { deduplicateConnections, stableConnectionId } from './connectionIdentity';

/** Stacja kolejowa w magazynie ogólnopolskim. */
interface RailStation {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
}

export interface IntercityPlanResult {
  connections: Connection[];
  /** Stacja docelowa (komunikaty UI: "dojedź do X"). */
  destinationStation?: RailStation;
  /** Stacja startowa, gdy początek poza miastem. */
  originStation?: RailStation;
}

/** Bufor na peron po przyjeździe nogą miejską (default z ustawień: 5 min). */
const PLATFORM_BUFFER_SEC = 300;
/** Jak daleko w przód szukać pociągów (kolej jeździ rzadziej niż tramwaje). */
const RAIL_HORIZON_SEC = 6 * 3600;
/** Ile pociągów poza zasięgiem nogi miejskiej dostaje doliczony dojazd. */
const MAX_FOLLOW_UPS = 2;
/** Ile połączeń kolejowych w trybie reverse dostaje nogę miejską. */
const MAX_REVERSE_CITY_LEGS = 3;
/** Maksymalna długość spaceru do stacji, żeby dokleić go jako nogę. */
const MAX_WALK_TO_STATION_SEC = 30 * 60;
/** Sąsiednie stacje liczone jako cel nogi kolejowej (Śródmieście obok Centralnej). */
const DESTINATION_CLUSTER_M = 600;
/** Typowy czas nogi miejskiej przy planowaniu "bądź na" w trybie reverse. */
const REVERSE_ARRIVAL_CITY_MARGIN_SEC = 15 * 60;

const WALK_DETOUR_FACTOR = 1.15;

/* ─── Indeks stacji (nazwa → stacja) ─────────────────────────────────────────── */

let stationIndexCache: Map<string, RailStation> | null = null;

function stationIndex(): Map<string, RailStation> {
  if (stationIndexCache && stationIndexCache.size === polskaStore.stops.size)
    return stationIndexCache;
  const map = new Map<string, RailStation>();
  for (const s of polskaStore.stops.values()) {
    map.set(normalizePolish(s.stop_name ?? ''), {
      stopId: s.stop_id,
      name: s.stop_name ?? s.stop_id,
      lat: s.stop_lat,
      lon: s.stop_lon,
    });
  }
  stationIndexCache = map.size > 0 ? map : null;
  return map;
}

function stationByName(name: string): RailStation | undefined {
  return stationIndex().get(normalizePolish(name));
}

function stationById(stopId: string): RailStation | undefined {
  const s = polskaStore.stops.get(stopId);
  if (!s) return undefined;
  return { stopId: s.stop_id, name: s.stop_name ?? s.stop_id, lat: s.stop_lat, lon: s.stop_lon };
}

/** Stacje bramowe aktywnego miasta (cities.ts railGateways → magazyn polska). */
function gatewayStations(): RailStation[] {
  let gateways: string[] = [];
  try {
    gateways = getCity(getActiveCityIdSync()).railGateways;
  } catch {
    return [];
  }
  const out: RailStation[] = [];
  for (const name of gateways) {
    const st = stationByName(name);
    if (st) out.push(st);
  }
  return out;
}

/* ─── Metadane pociągów (kolumny kolejowe buildu polska) ───────────────── */

interface RailTripMeta {
  trainNumber: string;
  trainName: string;
  category: string;
  agency: string;
}

const railTripMetaCache = new Map<string, RailTripMeta>();
interface RailStopLocation {
  platform: string;
  track: string;
}

const railPlatformCache = new Map<string, RailStopLocation>();

async function railTripMeta(tripId: string): Promise<RailTripMeta> {
  const hit = railTripMetaCache.get(tripId);
  if (hit) return hit;
  const meta: RailTripMeta = { trainNumber: '', trainName: '', category: '', agency: '' };
  try {
    const db = await getNationalDb();
    const row = await db.getFirstAsync<{
      train_number: string;
      train_name: string;
      category: string;
      agency: string;
    }>('SELECT train_number, train_name, category, agency FROM trips WHERE trip_id = ?', tripId);
    if (row) {
      meta.trainNumber = row.train_number ?? '';
      meta.trainName = row.train_name ?? '';
      meta.category = row.category ?? '';
      meta.agency = row.agency ?? '';
    }
  } catch {
    // baza niedostępna - noga zostaje z linią z routes
  }
  railTripMetaCache.set(tripId, meta);
  if (railTripMetaCache.size > 2000) {
    const oldest = railTripMetaCache.keys().next().value;
    if (oldest !== undefined) railTripMetaCache.delete(oldest);
  }
  return meta;
}

async function railPlatform(tripId: string, stopId: string): Promise<RailStopLocation> {
  const key = `${tripId}:${stopId}`;
  const hit = railPlatformCache.get(key);
  if (hit !== undefined) return hit;
  let loc: RailStopLocation = { platform: '', track: '' };
  try {
    const db = await getNationalDb();
    try {
      const row = await db.getFirstAsync<{ platform: string; track?: string }>(
        'SELECT platform, track FROM stop_times WHERE trip_id = ? AND stop_id = ?',
        tripId,
        stopId,
      );
      loc = { platform: row?.platform ?? '', track: row?.track ?? '' };
    } catch {
      const row = await db.getFirstAsync<{ platform: string }>(
        'SELECT platform FROM stop_times WHERE trip_id = ? AND stop_id = ?',
        tripId,
        stopId,
      );
      loc = { platform: row?.platform ?? '', track: '' };
    }
  } catch {
    // best-effort: peron i tor nie sa krytyczne dla routingu
  }
  railPlatformCache.set(key, loc);
  if (railPlatformCache.size > 4000) {
    const oldest = railPlatformCache.keys().next().value;
    if (oldest !== undefined) railPlatformCache.delete(oldest);
  }
  return loc;
}

/** Wzbogaca nogi kolejowe o numer/nazwę pociągu, przewoźnika i peron. */
async function enrichRailLegs(legs: Leg[]): Promise<void> {
  const jobs: Array<Promise<void>> = [];
  for (const leg of legs) {
    if (leg.mode !== 'train' || !leg.tripId?.startsWith('pl:')) continue;
    jobs.push(
      (async () => {
        const meta = await railTripMeta(leg.tripId!);
        leg.trainNumber = meta.trainNumber || undefined;
        leg.trainName = meta.trainName || undefined;
        leg.railAgency = meta.agency || undefined;
        // Kategoria z feedu bywa złożona („EC/EIC”, „K22/K22 BUS”): do
        // badge'a bierzemy pierwszy człon, który nie jest autobusem zastępczym.
        const category = (meta.category || '')
          .split('/')
          .map((part) => part.trim())
          .find((part) => part && !/BUS/i.test(part));
        if (category) {
          leg.line = meta.trainNumber ? `${category} ${meta.trainNumber}` : category;
        }
        const { platform, track } = await railPlatform(leg.tripId!, leg.fromStopId ?? '');
        if (platform) leg.platformCode = platform;
        if (track) leg.trackCode = track;
      })(),
    );
  }
  await Promise.all(jobs);
}

/* ─── Pomocnicze ───────────────────────────────────────────────────────────── */

function firstTransitLeg(connection: Connection): Leg | undefined {
  return connection.legs.find((l) => l.mode !== 'walk');
}

function lastTransitLeg(connection: Connection): Leg | undefined {
  for (let i = connection.legs.length - 1; i >= 0; i--) {
    if (connection.legs[i].mode !== 'walk') return connection.legs[i];
  }
  return undefined;
}

function interchangeLabel(legs: Leg[], transfers: number): string | undefined {
  if (transfers <= 0) return undefined;
  const via = Array.from(
    new Set(
      legs
        .filter((l) => l.mode !== 'walk')
        .slice(0, -1)
        .map((l) => l.toStop),
    ),
  );
  if (via.length === 0) return undefined;
  return via.length === 1 ? `Przesiadka: ${via[0]}` : `Przesiadki: ${via.join(' • ')}`;
}

/** Skleja nogę miejską z pociągiem (forward). Ostatni spacer nogi miejskiej
 * (dojście do punktu stacji) dostaje przepisany koniec na stację kolejową,
 * żeby timeline pokazał przesiadkę z buforem zamiast "celu podróży". */
function isZeroWalkConnection(conn: Connection | null | undefined): boolean {
  if (!conn) return true;
  const transitLegs = conn.legs.filter((l) => l.mode !== 'walk');
  if (transitLegs.length > 0) return false;
  const totalWalkM = conn.legs.reduce((sum, l) => sum + (l.walkM ?? 0), 0);
  return totalWalkM <= SAME_POINT_M;
}

function cleanIntercityConnection(conn: Connection): Connection {
  if (conn.legs.length <= 1) return conn;
  const legs = conn.legs.filter(
    (leg) =>
      !(
        leg.mode === 'walk' &&
        (leg.walkM ?? 0) <= 0 &&
        (leg.departAt === leg.arriveAt || leg.fromStop === leg.toStop)
      ),
  );
  if (legs.length === conn.legs.length) return conn;
  const first = legs[0];
  const last = legs[legs.length - 1];
  let departureSec = conn.departureSec;
  let arrivalSec = conn.arrivalSec ?? (conn.departureSec + conn.durationMin * 60);
  if (first) {
    const rawDep = timeStringToSeconds(first.departAt);
    const dayOffset = Math.floor(departureSec / 86400) * 86400;
    departureSec = dayOffset + rawDep;
  }
  if (last) {
    const rawArr = timeStringToSeconds(last.arriveAt);
    const dayOffset = Math.floor(departureSec / 86400) * 86400;
    arrivalSec = dayOffset + rawArr;
    if (arrivalSec < departureSec) {
      arrivalSec += 86400;
    }
  }
  return {
    ...conn,
    legs,
    departureSec,
    departAt: first ? first.departAt : conn.departAt,
    arrivalSec,
    arriveAt: last ? last.arriveAt : conn.arriveAt,
    durationMin: Math.max(1, Math.round((arrivalSec - departureSec) / 60)),
    interchange: interchangeLabel(legs, conn.transfers),
  };
}

function combineForward(
  city: Connection | null,
  rail: Connection,
  options: PlanOptions,
  gateway?: RailStation,
): Connection {
  const effectiveCity = isZeroWalkConnection(city) ? null : city;
  const legs: Leg[] = [];
  if (effectiveCity) {
    for (const leg of effectiveCity.legs) legs.push({ ...leg });
    for (let i = legs.length - 1; i >= 0; i--) {
      const leg = legs[i];
      if (leg.mode !== 'walk') break;
      if (leg.toStopId === 'destination' && gateway) {
        leg.toStopId = gateway.stopId;
        leg.toStop = gateway.name;
        leg.toLat = gateway.lat;
        leg.toLon = gateway.lon;
        break;
      }
    }
  }
  legs.push(...rail.legs.map((l) => ({ ...l })));

  const departureSec = effectiveCity ? effectiveCity.departureSec : rail.departureSec;
  let arrivalSec = rail.arrivalSec ?? (rail.departureSec + rail.durationMin * 60);
  if (arrivalSec < departureSec) {
    arrivalSec += 86400;
  }
  const transfers = effectiveCity ? effectiveCity.transfers + 1 + rail.transfers : rail.transfers;

  return {
    id: '',
    fromTitle: effectiveCity
      ? options.fromTitle
      : (firstTransitLeg(rail)?.fromStop ?? options.fromTitle),
    toTitle: rail.toTitle,
    departInMin: effectiveCity ? effectiveCity.departInMin : 0,
    departureSec,
    arrivalSec,
    departAt: secondsToTimeString(departureSec),
    arriveAt: secondsToTimeString(arrivalSec),
    durationMin: Math.max(1, Math.round((arrivalSec - departureSec) / 60)),
    transfers,
    delayMin: Math.max(effectiveCity?.delayMin ?? 0, rail.delayMin),
    live: (effectiveCity?.live ?? false) || rail.live,
    legs,
    interchange: interchangeLabel(legs, transfers),
  };
}

/** Skleja pociąg z nogą miejską (reverse: kolej → miasto). */
function combineReverse(rail: Connection, city: Connection, options: PlanOptions): Connection {
  if (isZeroWalkConnection(city)) {
    const legs: Leg[] = rail.legs.map((l) => ({ ...l }));
    const departureSec = rail.departureSec;
    const arrivalSec = rail.arrivalSec ?? rail.departureSec + rail.durationMin * 60;
    const transfers = rail.transfers;

    return {
      id: '',
      fromTitle: options.fromTitle,
      toTitle: rail.toTitle,
      departInMin: 0,
      departureSec,
      arrivalSec,
      departAt: secondsToTimeString(departureSec),
      arriveAt: secondsToTimeString(arrivalSec),
      durationMin: Math.max(1, Math.round((arrivalSec - departureSec) / 60)),
      transfers,
      delayMin: rail.delayMin,
      live: rail.live,
      legs,
      interchange: interchangeLabel(legs, transfers),
    };
  }

  const legs: Leg[] = rail.legs.map((l) => ({ ...l }));
  const cityLegs = city.legs.map((l) => ({ ...l }));
  // Pierwszy spacer nogi miejskiej zaczyna się "od punktu" (stacji):
  // przepinamy start na stację kolejową, żeby timeline się złączył.
  const first = cityLegs[0];
  const alight = lastTransitLeg(rail);
  if (first && first.mode === 'walk' && first.fromStopId === 'origin' && alight) {
    first.fromStopId = alight.toStopId;
    first.fromStop = alight.toStop;
    first.fromLat = alight.toLat;
    first.fromLon = alight.toLon;
  }
  legs.push(...cityLegs);

  const departureSec = rail.departureSec;
  let arrivalSec = city.arrivalSec ?? (city.departureSec + city.durationMin * 60);
  if (arrivalSec < departureSec) {
    arrivalSec += 86400;
  }
  const transfers = rail.transfers + 1 + city.transfers;

  return {
    id: '',
    fromTitle: options.fromTitle,
    toTitle: options.toTitle,
    departInMin: 0,
    departureSec,
    arrivalSec,
    departAt: secondsToTimeString(departureSec),
    arriveAt: secondsToTimeString(arrivalSec),
    durationMin: Math.max(1, Math.round((arrivalSec - departureSec) / 60)),
    transfers,
    delayMin: Math.max(rail.delayMin, city.delayMin),
    live: rail.live || city.live,
    legs,
    interchange: interchangeLabel(legs, transfers),
  };
}

/** Spacer z punktu startu do stacji jako noga przed pociągiem. */
function walkLegToStation(
  options: PlanOptions,
  station: RailStation,
  arriveSec: number,
  walkSec: number,
): Leg {
  const distM = Math.round(
    distanceMeters(options.fromLat, options.fromLon, station.lat, station.lon),
  );
  const departSec = arriveSec - walkSec;
  return {
    id: 'ic-walk-start',
    mode: 'walk' as LegMode,
    fromStop: options.fromTitle,
    toStop: station.name,
    fromStopId: 'origin',
    toStopId: station.stopId,
    fromLat: options.fromLat,
    fromLon: options.fromLon,
    toLat: station.lat,
    toLon: station.lon,
    departAt: secondsToTimeString(departSec),
    arriveAt: secondsToTimeString(arriveSec),
    stopsCount: 0,
    walkM: distM,
    live: false,
  };
}

/** Wspólne opcje zapytania kolejowego (magazyn polska, szeroki horyzont). */
function railQueryOptions(
  options: PlanOptions,
  origins: string[],
  destinations: string[],
  from: RailStation,
  to: RailStation,
): PlanOptions {
  return {
    ...options,
    fromTitle: from.name,
    fromLat: from.lat,
    fromLon: from.lon,
    toTitle: to.name,
    toLat: to.lat,
    toLon: to.lon,
    toId: undefined,
    anchorStopId: undefined,
    anchorStopLat: undefined,
    anchorStopLon: undefined,
    originStopIds: origins,
    destinationStopIds: destinations,
    modes: 'all' as const,
    searchAheadSec: RAIL_HORIZON_SEC,
    onProgress: undefined,
  };
}

/* ─── Planer ─────────────────────────────────────────────────────────────────── */

/**
 * Planuje podróż między miastami. Wymaga pobranej bazy `polska`; bez niej
 * zwraca pustkę, a UI proponuje pobranie rozkładu kolejowego.
 */
export async function planIntercity(options: PlanOptions): Promise<IntercityPlanResult> {
  await polskaStore.load();
  if (polskaStore.stops.size === 0) return { connections: [] };

  const originInsideCity = !isOutsideServiceArea(options.fromLat, options.fromLon);
  const destInsideCity = !isOutsideServiceArea(options.toLat, options.toLon);
  if (originInsideCity && destInsideCity) return { connections: [] };

  // Cel: stacja z toId (stop-pl:…) albo najbliższa stacja do punktu docelowego.
  let destination: RailStation | undefined;
  if (options.toId?.startsWith('stop-pl:')) {
    destination = stationById(options.toId.slice('stop-'.length));
  }
  if (!destination && !destInsideCity) {
    const near = await findNearestNationalStations(options.toLat, options.toLon, 30000, 1);
    destination = near[0]
      ? { stopId: near[0].stop_id, name: near[0].name, lat: near[0].lat, lon: near[0].lon }
      : undefined;
  }
  if (!destination) return { connections: [] };

  const gateways = gatewayStations();
  const bufferSec = Math.max(120, Math.round(options.trainMinTransferSec ?? PLATFORM_BUFFER_SEC));

  // Stacje docelowe nogi kolejowej: stacja + sąsiednie (Centralna + Śródmieście).
  const destCluster = polskaStore
    .findNearestStops(destination.lat, destination.lon, DESTINATION_CLUSTER_M, 5)
    .map((n) => n.stop.stop_id);
  const destinationStopIds = destCluster.length > 0 ? destCluster : [destination.stopId];

  if (originInsideCity) {
    if (gateways.length === 0) return { connections: [], destinationStation: destination };
    return planForward(options, gateways, destination, destinationStopIds, bufferSec);
  }

  // Start poza miastem: stacja z fromId (stop-pl:…) albo najbliższa stacja kolejowa.
  let originStation: RailStation | undefined;
  if (options.fromId?.startsWith('stop-pl:')) {
    originStation = stationById(options.fromId.slice('stop-'.length));
  }
  if (!originStation) {
    const nearOrigin = await findNearestNationalStations(
      options.fromLat,
      options.fromLon,
      30000,
      1,
    );
    originStation = nearOrigin[0]
      ? {
          stopId: nearOrigin[0].stop_id,
          name: nearOrigin[0].name,
          lat: nearOrigin[0].lat,
          lon: nearOrigin[0].lon,
        }
      : undefined;
  }
  if (!originStation) return { connections: [], destinationStation: destination };

  if (destInsideCity) {
    if (gateways.length === 0) return { connections: [], destinationStation: destination };
    return planReverse(options, originStation, gateways, bufferSec);
  }

  return planRailOnly(options, originStation, destination, destinationStopIds);
}

/* ─── Forward: miasto → kolej ───────────────────────────────────────────────── */

async function planForward(
  options: PlanOptions,
  gateways: RailStation[],
  destination: RailStation,
  destinationStopIds: string[],
  bufferSec: number,
): Promise<IntercityPlanResult> {
  const arrivalMode = options.arriveBySec !== undefined && Number.isFinite(options.arriveBySec);
  const railOptions = railQueryOptions(
    options,
    gateways.map((g) => g.stopId),
    destinationStopIds,
    gateways[0],
    destination,
  );
  const railPromise = planConnections(railOptions, polskaStore);

  const combined: Connection[] = [];
  const finalizeConn = async (city: Connection, rail: Connection, gateway?: RailStation) => {
    const conn = combineForward(city, rail, options, gateway);
    await enrichRailLegs(conn.legs);
    conn.id = stableConnectionId(conn);
    combined.push(cleanIntercityConnection(conn));
  };

  if (arrivalMode) {
    // "Bądź na": pociągi przyjeżdżające przed terminem, do każdego dolicz
    // nogę miejską "bądź na stacji o odjazd - bufor" (jak najpóźniej z domu).
    const rail = await railPromise;
    for (const railConn of rail.slice(0, MAX_REVERSE_CITY_LEGS + 2)) {
      const firstTrain = firstTransitLeg(railConn);
      const gateway = gateways.find((g) => g.stopId === firstTrain?.fromStopId);
      if (!firstTrain || !gateway) continue;
      const cityOptions: PlanOptions = {
        ...options,
        toTitle: gateway.name,
        toLat: gateway.lat,
        toLon: gateway.lon,
        toId: undefined,
        departureTimeSec: undefined,
        arriveBySec: railConn.departureSec - bufferSec,
        searchAheadSec: undefined,
        onProgress: undefined,
      };
      const city = await planConnections(cityOptions, gtfsStore);
      const best = city
        .filter((c) => (c.arrivalSec ?? Infinity) <= railConn.departureSec - bufferSec)
        .sort((a, b) => b.departureSec - a.departureSec)[0];
      if (best) {
        await finalizeConn(best, railConn, gateway);
      }
    }
  } else {
    // Odjazd: noga miejska na bramę (cel = punkt stacji, arrivalSec zawiera
    // dojście piesze), potem join z pociągami po czasie + bufor na peron.
    const cityByGateway = new Map<string, Connection[]>();
    const cityMinArrival = new Map<string, number>();
    const cityMaxArrival = new Map<string, number>();

    for (const gateway of gateways) {
      const cityOptions: PlanOptions = {
        ...options,
        toTitle: gateway.name,
        toLat: gateway.lat,
        toLon: gateway.lon,
        toId: undefined,
        searchAheadSec: undefined,
        onProgress: undefined,
      };
      const conns = await planConnections(cityOptions, gtfsStore);
      if (conns.length > 0) {
        cityByGateway.set(gateway.stopId, conns);
        let minArr = Infinity;
        let maxArr = -Infinity;
        for (const c of conns) {
          const arr = c.arrivalSec ?? Infinity;
          if (arr < minArr) minArr = arr;
          if (arr > maxArr) maxArr = arr;
        }
        cityMinArrival.set(gateway.stopId, minArr);
        cityMaxArrival.set(gateway.stopId, maxArr);
      }
    }

    const rail = await railPromise;
    let followUps = 0;
    const now = new Date();
    const currentSec = warsawNow(now).sec;
    const minDep = options.departureTimeSec ?? currentSec;

    for (const railConn of rail) {
      const firstTrain = firstTransitLeg(railConn);
      if (!firstTrain) continue;
      const gatewayId = firstTrain.fromStopId ?? '';
      const gateway = gateways.find((g) => g.stopId === gatewayId);
      if (!gateway) continue;
      const boardSec = railConn.departureSec;
      const latestFeasibleArrival = boardSec - bufferSec;

      const conns = cityByGateway.get(gatewayId);
      const minArr = cityMinArrival.get(gatewayId);

      // Pociąg odjeżdża zanim najszybszy dojazd miejski w ogóle dotrze
      // na stację - nieosiągalny, pomijamy bez zbędnego zapytania.
      if (minArr !== undefined && latestFeasibleArrival < minArr) {
        continue;
      }

      // Najlepsza noga miejska: najpóźniejszy wyjazd, który łapie pociąg.
      let best: Connection | null = null;
      for (const c of conns ?? []) {
        const arrive = c.arrivalSec ?? Infinity;
        if (arrive <= latestFeasibleArrival && (!best || c.departureSec > best.departureSec)) {
          best = c;
        }
      }
      if (best) {
        await finalizeConn(best, railConn, gateway);
        continue;
      }

      // Pociąg poza zasięgiem dotychczasowej nogi miejskiej: dolicz dojazd "bądź na stacji".
      // Odpytujemy tylko gdy pociąg odjeżdża później niż wyliczone dojazdy (np. za >3 h).
      const maxArr = cityMaxArrival.get(gatewayId);
      const isAheadOfHorizon = maxArr === undefined || latestFeasibleArrival > maxArr;
      if (!isAheadOfHorizon) continue;

      if (followUps >= MAX_FOLLOW_UPS) continue;
      followUps++;
      const followOptions: PlanOptions = {
        ...options,
        toTitle: gateway.name,
        toLat: gateway.lat,
        toLon: gateway.lon,
        toId: undefined,
        departureTimeSec: undefined,
        arriveBySec: latestFeasibleArrival,
        searchAheadSec: undefined,
        onProgress: undefined,
      };
      const follow = await planConnections(followOptions, gtfsStore);
      const late = follow
        .filter((c) => (c.arrivalSec ?? Infinity) <= latestFeasibleArrival && c.departureSec >= minDep)
        .sort((a, b) => b.departureSec - a.departureSec)[0];
      if (late) {
        await finalizeConn(late, railConn, gateway);
      }
    }
  }

  return { connections: pickBest(combined), destinationStation: destination };
}

/* ─── Reverse: kolej → miasto ───────────────────────────────────────────────── */

async function planReverse(
  options: PlanOptions,
  originStation: RailStation,
  gateways: RailStation[],
  bufferSec: number,
): Promise<IntercityPlanResult> {
  const arrivalMode = options.arriveBySec !== undefined && Number.isFinite(options.arriveBySec);
  const deadline = arrivalMode ? (options.arriveBySec as number) : undefined;
  const railOptions = railQueryOptions(
    arrivalMode
      ? { ...options, arriveBySec: Math.max(0, (deadline ?? 0) - REVERSE_ARRIVAL_CITY_MARGIN_SEC) }
      : options,
    [originStation.stopId],
    gateways.map((g) => g.stopId),
    originStation,
    gateways[0],
  );
  const rail = await planConnections(railOptions, polskaStore);

  const combined: Connection[] = [];
  let cityLegs = 0;
  for (const railConn of rail) {
    if (cityLegs >= MAX_REVERSE_CITY_LEGS) break;
    const arriveStationId = lastTransitLeg(railConn)?.toStopId;
    const gateway = gateways.find((g) => g.stopId === arriveStationId);
    if (!gateway) continue;
    const railArrive = railConn.arrivalSec ?? 0;
    const cityDepart = railArrive + bufferSec;

    const cityOptions: PlanOptions = {
      ...options,
      fromTitle: gateway.name,
      fromLat: gateway.lat,
      fromLon: gateway.lon,
      departureTimeSec: arrivalMode ? undefined : cityDepart,
      arriveBySec: arrivalMode ? deadline : undefined,
      anchorStopId: undefined,
      anchorStopLat: undefined,
      anchorStopLon: undefined,
      searchAheadSec: undefined,
      onProgress: undefined,
    };
    const city = await planConnections(cityOptions, gtfsStore);
    // Noga miejska musi zaczynać się po przyjeździe pociągu (+ bufor).
    const best = city
      .filter(
        (c) =>
          c.departureSec >= cityDepart &&
          (!arrivalMode || (c.arrivalSec ?? Infinity) <= (deadline ?? Infinity)),
      )
      .sort((a, b) =>
        arrivalMode ? b.departureSec - a.departureSec : (a.arrivalSec ?? 0) - (b.arrivalSec ?? 0),
      )[0];
    if (!best) continue;
    cityLegs++;

    const conn = combineReverse(railConn, best, options);
    await enrichRailLegs(conn.legs);
    conn.id = stableConnectionId(conn);
    combined.push(cleanIntercityConnection(conn));
  }

  return { connections: pickBest(combined), originStation };
}

/* ─── Rail-only: stacja → stacja ───────────────────────────────────────────── */

async function planRailOnly(
  options: PlanOptions,
  originStation: RailStation,
  destination: RailStation,
  destinationStopIds: string[],
): Promise<IntercityPlanResult> {
  const railOptions = railQueryOptions(
    options,
    [originStation.stopId],
    destinationStopIds,
    originStation,
    destination,
  );
  const rail = await railConnections(railOptions);

  const combined: Connection[] = [];
  const walkDistM = Math.round(
    distanceMeters(options.fromLat, options.fromLon, originStation.lat, originStation.lon),
  );
  const walkSec = Math.round((walkDistM * WALK_DETOUR_FACTOR) / (options.walkSpeedMps ?? 1.34));
  const isAtOriginStation =
    walkDistM <= SAME_POINT_M ||
    options.fromId === originStation.stopId ||
    options.fromId === 'stop-pl:' + originStation.stopId ||
    normalizePolish(options.fromTitle) === normalizePolish(originStation.name);
  const walkToStation =
    !isAtOriginStation &&
    walkDistM > SAME_POINT_M &&
    walkSec > 0 &&
    walkSec <= MAX_WALK_TO_STATION_SEC;

  for (const railConn of rail) {
    if (!firstTransitLeg(railConn)) continue;
    const conn = combineForward(null, railConn, options, originStation);
    if (walkToStation) {
      conn.legs.unshift(walkLegToStation(options, originStation, railConn.departureSec, walkSec));
      conn.departureSec = railConn.departureSec - walkSec;
      conn.departAt = secondsToTimeString(conn.departureSec);
      conn.durationMin = Math.max(1, Math.round(((conn.arrivalSec ?? 0) - conn.departureSec) / 60));
      conn.interchange = interchangeLabel(conn.legs, conn.transfers);
    }
    await enrichRailLegs(conn.legs);
    conn.id = stableConnectionId(conn);
    combined.push(cleanIntercityConnection(conn));
  }

  return { connections: pickBest(combined), destinationStation: destination, originStation };
}

function railConnections(options: PlanOptions): Promise<Connection[]> {
  return planConnections(options, polskaStore);
}

/* ─── Następny pociąg (tryb konduktora) ─────────────────────────────────────── */

export interface NextTrain {
  label: string;
  departAtMs: number;
  trainName?: string;
}

/**
 * Kolejne pociągi z tej samej stacji (najlepiej do tej samej stacji
 * docelowej), po spóźnieniu na połączenie międzyregionalne. Zwraca
 * podpowiedź dla arkusza ochrony przesiadki: „poinformuj konduktora,
 * następny pociąg odjeżdża o …”.
 */
export async function nextNationalTrains(
  fromStopId: string,
  toStopId: string | undefined,
  afterMs: number,
  limit = 3,
): Promise<NextTrain[]> {
  try {
    const gtfs = await import('../gtfsDatabase');
    const db = await gtfs.getNationalDb();
    const afterWarsaw = warsawNow(new Date(afterMs));
    const services = await gtfs.getNationalActiveServices(afterWarsaw.weekday, afterWarsaw.dateStr);
    if (services.size === 0) return [];
    const placeholders = [...services].map(() => '?').join(',');
    const rows = await db.getAllAsync<{
      dep_sec: number;
      train_number: string;
      train_name: string;
      category: string;
    }>(
      `SELECT st.dep_sec, t.train_number, t.train_name, t.category
       FROM stop_times st JOIN trips t ON t.trip_id = st.trip_id
       WHERE st.stop_id = ?
         AND t.service_id IN (${placeholders})
         ${toStopId ? 'AND EXISTS (SELECT 1 FROM stop_times d WHERE d.trip_id = st.trip_id AND d.stop_id = ? AND d.seq > st.seq)' : ''}
       ORDER BY st.dep_sec
       LIMIT 60`,
      ...(toStopId ? [fromStopId, ...services, toStopId] : [fromStopId, ...services]),
    );
    const out: NextTrain[] = [];
    for (const row of rows) {
      // Czas GTFS liczy się od doby serwisowej; odjazdy po północy
      // (24:xx+) mają dep_sec > 86400 i należą do „jutra” zegara.
      const departAtMs = sharedTimeMs(afterWarsaw.isoDate, row.dep_sec);
      if (departAtMs <= afterMs) continue;
      out.push({
        label: row.train_number
          ? `${row.category || 'IC'} ${row.train_number}`
          : row.category || '',
        departAtMs,
        trainName: row.train_name || undefined,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

/* ─── Wybór najlepszych wariantów ───────────────────────────────────────────── */

function pickBest(combined: Connection[]): Connection[] {
  const seen = new Set<string>();
  const out: Connection[] = [];
  const sorted = [...combined].sort((a, b) => {
    const d = (a.arrivalSec ?? 0) - (b.arrivalSec ?? 0);
    if (Math.abs(d) > 60) return d;
    if (a.transfers !== b.transfers) return a.transfers - b.transfers;
    return b.departureSec - a.departureSec;
  });
  for (const conn of sorted) {
    if (seen.has(conn.id)) continue;
    seen.add(conn.id);
    out.push(conn);
    if (out.length >= 8) break;
  }
  return deduplicateConnections(out);
}
