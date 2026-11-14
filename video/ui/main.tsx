// Ekrany aplikacji do telefonu w wideo: prawdziwe komponenty z app/ i src/
// w react-native-web, z połączeniem policzonym z GTFS (video/.cache/data.json).
// Otwiera je scripts/render.ts: /video/ui.html?screen=trip|routes|train.
import './react-version';
import { AppRegistry } from 'react-native';
import RouteDetailsScreen from '../../app/routes/[id]';
import RoutesScreen from '../../app/routes/index';
import { RoutingService, rememberPlannedConnection } from '../../src/services/api';
import * as dataManager from '../../src/services/dataManager';
import { liveTracker } from '../../src/services/liveTracker';
import type { Connection, Leg, LegStop } from '../../src/types/models';
import type { VideoData, VideoOption, VideoRide, VideoStop, VideoWalk } from '../src/data';

declare global {
  interface Window {
    uiReady?: boolean;
  }
}

const SERVICE_DATE = '2026-10-20';
const STOP_HINT = 'Przystanek tramwajowy od strony Aldi';
const TRAIN_ALERT = 'Ograniczenie prędkości pociągu';

const hm = (sec: number) =>
  `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;

function isVideoData(x: unknown): x is VideoData {
  return typeof x === 'object' && x !== null && 'journey' in x && 'origin' in x && 'rail' in x;
}

/** Odcinek w formacie aplikacji; `from` to przystanek poprzedniego odcinka, null na starcie. */
function leg(data: VideoData, l: VideoWalk | VideoRide, from: VideoStop | null, stops?: LegStop[]): Leg {
  const times = {
    departAt: hm(l.dep),
    arriveAt: hm(l.arr),
    scheduledDepartureSec: l.dep,
    scheduledArrivalSec: l.arr,
    live: false,
    toStop: l.to.name,
    toStopId: l.to.id,
    toLat: l.to.lat,
    toLon: l.to.lon,
  };
  if (l.kind === 'walk') {
    return {
      ...times,
      id: `walk-${l.dep}`,
      mode: 'walk',
      fromStop: from?.name ?? data.origin.name,
      fromStopId: from?.id,
      fromLat: from?.lat ?? data.origin.lat,
      fromLon: from?.lon ?? data.origin.lon,
      stopsCount: 0,
      walkM: l.walkM,
    };
  }
  return {
    ...times,
    id: `${l.mode}-${l.dep}`,
    mode: l.mode,
    line: l.line,
    direction: l.direction,
    fromStop: l.from.name,
    fromStopId: l.from.id,
    fromLat: l.from.lat,
    fromLon: l.from.lon,
    stopsCount: l.stopCount,
    delayConfidence: 'scheduled',
    tripId: stops && l.trip,
    intermediateStops: stops,
  };
}

/** Połączenie jak z wyszukiwarki; przystanki pośrednie ma tylko podróż z mapy. */
function connection(data: VideoData, option: VideoOption, stops?: LegStop[]): Connection {
  const first = option[0];
  const last = option[option.length - 1];
  const rides = option.filter((l) => l.kind === 'ride');
  return {
    id: `video-${rides[0].dep}`,
    serviceDate: SERVICE_DATE,
    fromTitle: data.origin.name,
    toTitle: last.to.name,
    departInMin: Math.round((first.dep - data.depart) / 60),
    departureSec: first.dep,
    arrivalSec: last.arr,
    departAt: hm(first.dep),
    arriveAt: hm(last.arr),
    durationMin: Math.round((last.arr - first.dep) / 60),
    transfers: rides.length - 1,
    delayMin: 0,
    live: false,
    legs: option.map((l, i) => leg(data, l, i > 0 ? option[i - 1].to : null, stops)),
  };
}

/** IC 6150 Śnieżka Wrocław → Warszawa z opóźnieniem i udogodnieniami. */
function trainConnection(data: VideoData): Connection {
  const from = data.rail.stops[0];
  const to = data.rail.stops[data.rail.stops.length - 1];
  const dep = data.depart + 20 * 60;
  const arr = dep + 3 * 3600 + 25 * 60;
  const delaySec = 10 * 60;
  const mid = data.rail.stops[Math.min(3, data.rail.stops.length - 2)];
  const ride: Leg = {
    id: 'ic-ride',
    mode: 'train',
    line: data.rail.line,
    direction: to.name,
    fromStop: from.name,
    toStop: to.name,
    departAt: hm(dep + delaySec),
    arriveAt: hm(arr + delaySec),
    scheduledDepartureSec: dep,
    scheduledArrivalSec: arr,
    stopsCount: data.rail.stops.length - 1,
    live: true,
    delaySec,
    arrivalDelaySec: delaySec,
    delayConfidence: 'live',
    fromStopId: from.id,
    toStopId: to.id,
    fromLat: from.lat,
    fromLon: from.lon,
    toLat: to.lat,
    toLon: to.lon,
    railAgency: 'IC',
    trainNumber: data.rail.trainNumber,
    trainName: data.rail.trainName,
    tripId: 'pl:video-ic-6150',
    platformCode: '2',
    trackCode: '2',
    liveNextStop: mid?.name ?? 'Opole Główne',
    intermediateStops: data.rail.stops.map((s, i) => ({
      stopId: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      seq: i + 1,
      arriveSec: dep + Math.round((i / (data.rail.stops.length - 1)) * (arr - dep)),
      departSec: dep + Math.round((i / (data.rail.stops.length - 1)) * (arr - dep)),
    })),
  };
  return {
    id: 'video-train',
    serviceDate: SERVICE_DATE,
    fromTitle: from.name,
    toTitle: to.name,
    departInMin: Math.round((dep - data.depart) / 60),
    departureSec: dep + delaySec,
    arrivalSec: arr + delaySec,
    departAt: hm(dep + delaySec),
    arriveAt: hm(arr + delaySec),
    durationMin: Math.round((arr - dep) / 60),
    transfers: 0,
    delayMin: Math.round(delaySec / 60),
    live: true,
    legs: [ride],
  };
}

/** Feed live „świeży”, żeby ekrany nie pokazywały „brak danych live”. */
function mockLiveFresh() {
  liveTracker.supportsLive = () => true;
  liveTracker.getLiveState = () => 'fresh';
  liveTracker.acquire = () => {};
  liveTracker.release = () => {};
  liveTracker.refresh = async () => {};
  liveTracker.subscribe = () => () => {};
  liveTracker.getTripDelays = () => new Map();
  liveTracker.getLastOk = () => Date.now();
}

async function main() {
  const raw: unknown = await (await fetch('/video/.cache/data.json')).json();
  if (!isVideoData(raw)) throw new Error('Zły data.json, uruchom npm run video:prepare');
  mockLiveFresh();

  const j = raw.journey;
  const stops: LegStop[] = j.stops.map((s) => ({
    stopId: s.id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    seq: s.seq,
    arriveSec: s.arr,
    departSec: s.time,
  }));
  const [hero, ...later] = j.options;
  const tram = connection(raw, hero, stops);
  // Live + hint na karcie tramwaju (scena „Ze Sky Tower”).
  const tramRide = tram.legs.find((l) => l.mode !== 'walk');
  if (tramRide) {
    tramRide.live = true;
    tramRide.delaySec = 60;
    tramRide.delayConfidence = 'live';
    tramRide.stopHint = STOP_HINT;
    tramRide.liveNextStop = 'Sztabowa';
  }
  tram.live = true;
  tram.delayMin = 1;
  const list = [tram, ...later.map((o) => connection(raw, o))];
  const train = trainConnection(raw);

  RoutingService.getConnections = async () => list;
  RoutingService.getConnectionById = async (id) => {
    const found = [...list, train].find((c) => c.id === id);
    return found && { connection: found, source: 'live' };
  };
  RoutingService.getTripStops = async () => stops;
  RoutingService.isRouteSaved = async () => false;
  RoutingService.getSavedRoutes = async () => [];

  const screen = new URLSearchParams(location.search).get('screen');
  const active = screen === 'train' ? train : tram;
  rememberPlannedConnection(active);

  const setStatus: unknown = Reflect.get(dataManager, 'setDataStatusForVideo');
  if (typeof setStatus === 'function') {
    setStatus({ state: 'ready', stops: raw.stops.length / 3, trips: raw.vehicles.length, updatedAt: raw.feed.start, source: 'network' });
  }

  const to = hero[hero.length - 1].to;
  window.uiParams =
    screen === 'routes'
      ? {
          fromTitle: raw.origin.name,
          fromLat: String(raw.origin.lat),
          fromLon: String(raw.origin.lon),
          toTitle: to.name,
          toLat: String(to.lat),
          toLon: String(to.lon),
          toId: to.id,
          directOnly: '1',
        }
      : { id: active.id };

  AppRegistry.registerComponent('ui', () => (screen === 'routes' ? RoutesScreen : RouteDetailsScreen));
  AppRegistry.runApplication('ui', { rootTag: document.getElementById('root') });
  await document.fonts.ready;
  await new Promise((r) => setTimeout(r, 1600));
  if (screen === 'train') {
    // Alert jest pod kartą: lekko przewiń, żeby w kadrze były i udogodnienia, i komunikat.
    const alert = [...document.querySelectorAll<HTMLElement>('*')].find((e) => e.textContent === TRAIN_ALERT);
    alert?.scrollIntoView({ block: 'end' });
    await new Promise((r) => setTimeout(r, 300));
  }

  window.uiReady = true;
}

main().catch((e: unknown) => {
  console.error(e);
});
