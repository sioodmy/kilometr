// Ekrany aplikacji do telefonu w wideo: prawdziwe komponenty z app/ i src/
// w react-native-web, z połączeniem policzonym z GTFS (video/.cache/data.json).
// Otwiera je scripts/render.ts: /video/ui.html?screen=trip albo screen=routes.
import './react-version';
import { AppRegistry } from 'react-native';
import RouteDetailsScreen from '../../app/routes/[id]';
import RoutesScreen from '../../app/routes/index';
import { pl } from '../../src/i18n/pl';
import { RoutingService, rememberPlannedConnection } from '../../src/services/api';
import * as dataManager from '../../src/services/dataManager';
import type { Connection, Leg, LegStop } from '../../src/types/models';
import type { VideoData, VideoOption, VideoRide, VideoStop, VideoWalk } from '../src/data';

declare global {
  interface Window {
    uiReady?: boolean;
  }
}

const SERVICE_DATE = '2026-10-20';

const hm = (sec: number) =>
  `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;

function isVideoData(x: unknown): x is VideoData {
  return typeof x === 'object' && x !== null && 'journey' in x && 'origin' in x;
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

async function main() {
  const raw: unknown = await (await fetch('/video/.cache/data.json')).json();
  if (!isVideoData(raw)) throw new Error('Zły data.json, uruchom npm run video:prepare');
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
  const main = connection(raw, hero, stops);
  const list = [main, ...later.map((o) => connection(raw, o))];

  RoutingService.getConnections = async () => list;
  RoutingService.getConnectionById = async (id) => {
    const found = list.find((c) => c.id === id);
    return found && { connection: found, source: 'live' };
  };
  RoutingService.getTripStops = async () => stops;
  RoutingService.isRouteSaved = async () => false;
  RoutingService.getSavedRoutes = async () => [];
  rememberPlannedConnection(main);
  // Eksport dokleja render.ts przy bundlowaniu (w aplikacji go nie ma).
  const setStatus: unknown = Reflect.get(dataManager, 'setDataStatusForVideo');
  if (typeof setStatus === 'function') {
    setStatus({ state: 'ready', stops: raw.stops.length / 3, trips: raw.vehicles.length, updatedAt: raw.feed.start, source: 'network' });
  }

  const to = hero[hero.length - 1].to;
  const screen = new URLSearchParams(location.search).get('screen');
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
          // prepare.ts liczy tylko połączenia bez przesiadek, więc ekran ma ten filtr włączony.
          directOnly: '1',
        }
      : { id: main.id };

  AppRegistry.registerComponent('ui', () => (screen === 'routes' ? RoutesScreen : RouteDetailsScreen));
  AppRegistry.runApplication('ui', { rootTag: document.getElementById('root') });
  await document.fonts.ready;
  await new Promise((r) => setTimeout(r, 1500));
  const ride = hero.find((l) => l.kind === 'ride');
  if (screen !== 'routes' && ride) {
    // Rozwinięte przystanki wypełniają ekran i spychają w dół mapę, której web nie rysuje.
    const label = pl.leg.expandA11y(ride.line, ride.direction, false);
    [...document.querySelectorAll<HTMLElement>('[aria-label]')].find((e) => e.getAttribute('aria-label')?.startsWith(label))?.click();
    await new Promise((r) => setTimeout(r, 800));
  }
  window.uiReady = true;
}

main().catch((e: unknown) => {
  console.error(e);
});
