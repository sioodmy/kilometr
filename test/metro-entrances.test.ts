import test from 'node:test';
import assert from 'node:assert/strict';
import { STOP_HINTS_WARSZAWA } from '../src/data/stopHintsWarszawa';
import {
  extractMetroStationId,
  findOptimalMetroEntrance,
  findReachableMetroStationsByEntrance,
  isWarsawMetroStopId,
  warmupMetroEntrances,
} from '../src/services/metroEntrances';
import { snapMetroEntranceLegs } from '../src/services/routing/engine';
import type { Leg } from '../src/services/routing/types';

test('extractMetroStationId handles platform, entrance, and prefixed IDs', () => {
  assert.equal(extractMetroStationId('1003M:P2'), '1003M');
  assert.equal(extractMetroStationId('stop-1003M:P1'), '1003M');
  assert.equal(extractMetroStationId('1411M:E2w'), '1411M');
  assert.equal(extractMetroStationId('7014M'), '7014M');
  assert.equal(extractMetroStationId('302702'), null);
  assert.equal(isWarsawMetroStopId('7013M:P1'), true);
  assert.equal(isWarsawMetroStopId('pl:5100028'), false);
});

test('findOptimalMetroEntrance chooses the closest entrance on the approach side of Dworzec Wilenski', () => {
  // Południowo-wschodni narożnik (od ul. Białostockiej / Targowej)
  const se = findOptimalMetroEntrance('1003M:P2', 52.2535, 21.0358, STOP_HINTS_WARSZAWA);
  assert.ok(se);
  assert.ok(['11', '12', '13'].includes(se.entrance.num), `Oczekiwano wejścia SE, dostano ${se.entrance.num}`);
  assert.ok(se.entrance.hint.includes('ul. Targowej') || se.entrance.hint.includes('ul. Białostockiej'));

  // Północno-zachodni narożnik (od al. Solidarności / przystanku 08)
  const nw = findOptimalMetroEntrance('1003M:P2', 52.2557, 21.0332, STOP_HINTS_WARSZAWA);
  assert.ok(nw);
  assert.notEqual(nw.entrance.id, se.entrance.id);
});

test('findReachableMetroStationsByEntrance locates stations via entrances within radius', () => {
  const hits = findReachableMetroStationsByEntrance(52.2305, 21.0108, 350, STOP_HINTS_WARSZAWA);
  assert.ok(hits.some((h) => h.stationId === '7013M'));
});

test('snapMetroEntranceLegs snaps access, egress, and surface transfers while keeping M1<->M2 underground', async () => {
  await warmupMetroEntrances();

  // 1. Access walk -> M2 -> walk to destination
  const accessEgress: Leg[] = [
    {
      id: 'l1',
      mode: 'walk',
      fromStop: 'Start',
      toStop: 'Dworzec Wileński',
      fromStopId: 'origin',
      toStopId: '1003M:P2',
      fromLat: 52.2533,
      fromLon: 21.0361,
      toLat: 52.2546,
      toLon: 21.0348,
      departAt: '10:00',
      arriveAt: '10:03',
      stopsCount: 0,
      walkM: 180,
      live: false,
    },
    {
      id: 'l2',
      mode: 'subway',
      line: 'M2',
      fromStop: 'Dworzec Wileński',
      toStop: 'Świętokrzyska',
      fromStopId: '1003M:P2',
      toStopId: '7014M:P2',
      fromLat: 52.2546,
      fromLon: 21.0348,
      toLat: 52.2355,
      toLon: 21.0085,
      departAt: '10:03',
      arriveAt: '10:11',
      stopsCount: 4,
      live: false,
    },
    {
      id: 'l3',
      mode: 'walk',
      fromStop: 'Świętokrzyska',
      toStop: 'Cel',
      fromStopId: '7014M:P2',
      toStopId: 'destination',
      fromLat: 52.2355,
      fromLon: 21.0085,
      toLat: 52.2361,
      toLon: 21.0056,
      departAt: '10:11',
      arriveAt: '10:14',
      stopsCount: 0,
      walkM: 220,
      live: false,
    },
  ];

  snapMetroEntranceLegs(accessEgress, {
    fromLat: 52.2533,
    fromLon: 21.0361,
    toLat: 52.2361,
    toLon: 21.0056,
  });

  assert.ok(accessEgress[0].toEntrance);
  assert.equal(accessEgress[0].toEntrance?.id, accessEgress[1].fromEntrance?.id);
  assert.notEqual(accessEgress[0].toLat, 52.2546);
  assert.ok((accessEgress[0].walkM ?? 0) > 0);

  assert.ok(accessEgress[2].fromEntrance);
  assert.equal(accessEgress[2].fromEntrance?.id, accessEgress[1].toEntrance?.id);
  assert.notEqual(accessEgress[2].fromLat, 52.2355);

  // 2. Inter-line M2 <-> M1 transfer at Świętokrzyska stays underground
  const undergroundTransfer: Leg[] = [
    {
      id: 'm2',
      mode: 'subway',
      line: 'M2',
      fromStop: 'Rondo ONZ',
      toStop: 'Świętokrzyska',
      fromStopId: '5001M:P1',
      toStopId: '7014M:P2',
      departAt: '10:00',
      arriveAt: '10:02',
      stopsCount: 1,
      live: false,
    },
    {
      id: 'xfer',
      mode: 'walk',
      fromStop: 'Świętokrzyska',
      toStop: 'Świętokrzyska',
      fromStopId: '7014M:P2',
      toStopId: '7014M:P1',
      fromLat: 52.2354,
      fromLon: 21.0085,
      toLat: 52.2351,
      toLon: 21.0083,
      departAt: '10:02',
      arriveAt: '10:04',
      stopsCount: 0,
      walkM: 50,
      live: false,
    },
    {
      id: 'm1',
      mode: 'subway',
      line: 'M1',
      fromStop: 'Świętokrzyska',
      toStop: 'Centrum',
      fromStopId: '7014M:P1',
      toStopId: '7013M:P1',
      departAt: '10:05',
      arriveAt: '10:07',
      stopsCount: 1,
      live: false,
    },
  ];

  snapMetroEntranceLegs(undergroundTransfer, {
    fromLat: 52.233,
    fromLon: 20.998,
    toLat: 52.2305,
    toLon: 21.0108,
  });

  assert.equal(undergroundTransfer[1].fromEntrance, undefined);
  assert.equal(undergroundTransfer[1].toEntrance, undefined);
  assert.equal(undergroundTransfer[0].toEntrance, undefined);
  assert.equal(undergroundTransfer[2].fromEntrance, undefined);
});
