import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LocalGtfsStore, type DayIndex } from '../src/services/routing/store';
import { getRaptorNet, packRaptorNet } from '../src/services/routing/network';
import { getTransferNativeCopy } from '../src/services/notifications/transferCopy';
import { setLocaleInternal } from '../src/i18n/locale';
import type { Connection, Leg } from '../src/types/models';
import type { GtfsTrip } from '../src/gtfs/types';

const dir = resolve(process.argv[2] ?? '/tmp/kilometr-transfer-fixture');
mkdirSync(dir, { recursive: true });
const baseMs = new Date().setHours(0, 0, 0, 0);
const offset = process.argv.includes('--now')
  ? Math.floor((Date.now() - baseMs) / 60000) * 60 - 9 * 60
  : 14 * 3600;
const clock = (sec: number) =>
  `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;
const store = new LocalGtfsStore();
const names = ['Początek', 'Po drodze', 'Stara przesiadka', 'Nowa przesiadka', 'Cel'];
const ids = ['A', 'B', 'C', 'D', 'E'];
for (const [i, id] of ids.entries())
  store.stops.set(id, {
    stop_id: id,
    stop_code: `${100 + i}`,
    stop_name: names[i],
    stop_lat: 51,
    stop_lon: 17 + (i < 4 ? i * 0.005 : 0.04),
  });
store.footpaths.set('C', [{ to_stop_id: 'D', distance_m: 350, duration_sec: 300 }]);
store.footpaths.set('D', [{ to_stop_id: 'C', distance_m: 350, duration_sec: 300 }]);
const index: DayIndex = {
  stopRoutes: new Map(),
  routeStops: new Map(),
  routeTrips: new Map(),
  patterns: new Map(),
};
function add(line: string, stops: string[], departures: number[][]) {
  store.routes.set(line, {
    route_id: line,
    route_short_name: line,
    route_long_name: '',
    route_type: 0,
  });
  const trips: GtfsTrip[] = departures.map((times, i) => {
    const trip: GtfsTrip = {
      trip_id: `${line}-${i}`,
      route_id: line,
      service_id: 'test',
      trip_headsign: 'Cel',
      direction_id: 0,
      shape_id: '',
    };
    store.trips.set(trip.trip_id, trip);
    store.stopTimes.set(
      trip.trip_id,
      stops.map((stop_id, s) => ({
        trip_id: trip.trip_id,
        stop_id,
        arrival_sec: offset + times[s] * 60,
        departure_sec: offset + times[s] * 60,
        stop_sequence: s,
      })),
    );
    return trip;
  });
  index.patterns.set(line, { routeId: line, stopSequence: stops, trips });
}
add('4', ['A', 'B', 'C', 'D'], [[0, 4, 8, 12]]);
add(
  '10',
  ['C', 'E'],
  [
    [10, 25],
    [25, 40],
  ],
);
add('12', ['D', 'E'], [[22, 32]]);
const net = getRaptorNet(store, index);
const networkPath = resolve(dir, 'network.bin');
writeFileSync(networkPath, packRaptorNet(net));
function leg(line: string, from: string, to: string, depart: number, arrive: number): Leg {
  const a = store.stops.get(from)!;
  const b = store.stops.get(to)!;
  return {
    id: `leg-${line}`,
    mode: 'tram',
    line,
    tripId: `${line}-0`,
    routeId: line,
    direction: 'Cel',
    fromStop: a.stop_name,
    toStop: b.stop_name,
    fromStopId: from,
    toStopId: to,
    fromLat: a.stop_lat,
    fromLon: a.stop_lon,
    toLat: b.stop_lat,
    toLon: b.stop_lon,
    departAt: clock(offset + depart * 60),
    arriveAt: clock(offset + arrive * 60),
    stopsCount: 2,
    live: false,
  };
}
const connection: Connection = {
  id: 'transfer-fixture',
  fromTitle: names[0],
  toTitle: names[4],
  departureSec: offset,
  departAt: clock(offset),
  arriveAt: clock(offset + 25 * 60),
  departInMin: 0,
  durationMin: 25,
  transfers: 1,
  delayMin: 0,
  live: false,
  legs: [leg('4', 'A', 'C', 0, 8), leg('10', 'C', 'E', 10, 25)],
};
for (const locale of ['pl', 'en', 'de', 'uk'] as const) {
  setLocaleInternal(locale, locale);
  const copy = getTransferNativeCopy();
  if (!copy.changedBody.includes('{nextLine}') || !copy.changedBody.includes('{stop}'))
    throw new Error(locale);
}
setLocaleInternal('pl', 'pl');
writeFileSync(
  resolve(dir, 'context.json'),
  JSON.stringify({
    version: 1,
    tripId: connection.id,
    baseMs,
    offset,
    validUntilMs: baseMs + (offset + 10800) * 1000,
    networkPath,
    connection,
    timeline: [{ departMs: baseMs + offset * 1000, arriveMs: baseMs + (offset + 480) * 1000 }],
    stops: net.base.stopIds.map((id) => {
      const s = store.stops.get(id)!;
      return { id, name: s.stop_name, lat: s.stop_lat, lon: s.stop_lon, code: s.stop_code };
    }),
    patterns: net.patterns.map((p) => ({
      routeId: p.routeId,
      line: p.routeId,
      mode: p.kind,
      trips: p.tripIds,
      directions: p.tripIds.map(() => 'Cel'),
    })),
    destinations: [{ stopIndex: net.base.stopIndex.get('E'), walkSec: 0, walkM: 0 }],
    destination: { name: 'Cel', lat: 51, lon: 17.04 },
    options: {
      maxTransfers: 2,
      minTransferSec: 90,
      trainMinTransferSec: 300,
      maxWalkM: 800,
      walkSpeedMps: 1.34,
      allowedModes: {
        tram: true,
        bus: true,
        train: true,
        cable: true,
        subway: true,
        trolleybus: true,
      },
      cost: { walkReluctance: 1.8, transferPenaltySec: 600 },
    },
    copy: getTransferNativeCopy(),
    alertsEnabled: true,
    delays: [],
    liveUrl: 'https://zbiorkom.live/api6-open/wroclaw/positions/16.7,50.95,17.25,51.25',
  }),
);
console.log(`Transfer fixture: ${dir}`);
