import '../scripts/stub-expo.cjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Leg } from '../src/types/models';
import {
  fetchNationalRailUpdates,
  resetNationalRailUpdatesCache,
} from '../src/services/nationalRailUpdates';

test('fetchNationalRailUpdates returns empty map when legs is empty or no train legs', async () => {
  resetNationalRailUpdatesCache();
  const resultEmpty = await fetchNationalRailUpdates([]);
  assert.equal(resultEmpty.size, 0);

  const nonTrainLeg: Leg = {
    id: 'bus-1',
    mode: 'bus',
    line: '146',
    fromStop: 'Kliniki',
    toStop: 'Dworzec Główny',
    departAt: '12:00',
    arriveAt: '12:20',
    stopsCount: 5,
    live: false,
    tripId: 'wroclaw:12345',
  };
  const resultBus = await fetchNationalRailUpdates([nonTrainLeg]);
  assert.equal(resultBus.size, 0);
});

test('fetchNationalRailUpdates parses delay, platform, and handles server responses', async () => {
  resetNationalRailUpdatesCache();
  const tripId = 'pl:PLK_IC_2026_123456789';
  const leg: Leg = {
    id: 'train-1',
    mode: 'train',
    line: 'IC 6146',
    fromStop: 'Wrocław Główny',
    toStop: 'Warszawa Centralna',
    departAt: '06:26',
    arriveAt: '10:56',
    stopsCount: 8,
    live: false,
    tripId,
    trainNumber: '6146',
    scheduledDepartureSec: 23160,
  };

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/rail/delays')) {
        return new Response(
          JSON.stringify({
            trips: {
              [tripId]: {
                tripId,
                agency: 'IC',
                numbers: ['6146'],
                cancelled: false,
                lastConfirmedSeq: 1,
                stops: [
                  {
                    seq: 1,
                    arr: '2026-11-07T06:26:00',
                    dep: '2026-11-07T06:32:00',
                    platform: '3',
                    track: '2',
                    confirmed: true,
                    cancelled: false,
                  },
                ],
              },
            },
            updatedAt: '2026-11-07T05:00:00Z',
            fetchedAt: Date.now(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return originalFetch(input);
    };

    const updates = await fetchNationalRailUpdates([leg]);
    assert.equal(updates.size, 1);
    const update = updates.get(leg.tripId!);
    assert.ok(update);
    assert.equal(update?.delaySec, 360); // 06:32:00 (23520) - 23160 = 360s
    assert.equal(update?.hasRealtimeDelay, true);
    assert.equal(update?.platform, '3');
    assert.equal(update?.track, '2');
    assert.equal(update?.cancelled, false);
    assert.equal(update?.agency, 'IC');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchNationalRailUpdates matches boarding seq on heavily delayed multi-stop train (+43 min) and handles slash numbers & city-DB train legs', async () => {
  resetNationalRailUpdatesCache();
  // Pociąg IC 8308/9 opóźniony +43 min (2580 s):
  // Przystanek seq=4 ma opóźniony odjazd 15:10 (dokładnie równy rozkładowemu odjazdowi na przystanku wsiadania seq=7 = 15:10!).
  // Dawny algorytm porównywał st.dep z rozkładowym 15:10 i dopasowywał seq=4 z opóźnieniem 0 min zamiast seq=7 z +43 min.
  const icLeg: Leg = {
    id: 'ic-8308',
    mode: 'train',
    line: 'IC 8308/9',
    fromStop: 'Wrocław Główny',
    toStop: 'Kraków Główny',
    departAt: '15:10',
    arriveAt: '18:10',
    stopsCount: 4,
    live: false,
    tripId: 'pl:PLK_IC_2026_107625_LEG1',
    trainNumber: '8308/9',
    scheduledDepartureSec: 15 * 3600 + 10 * 60, // 54600 (15:10)
    scheduledArrivalSec: 18 * 3600 + 10 * 60, // 65400 (18:10)
    intermediateStops: [
      {
        stopId: 'pl:wroclaw',
        name: 'Wrocław Główny',
        seq: 7,
        arriveSec: 54300,
        departSec: 54600,
      },
      {
        stopId: 'pl:opole',
        name: 'Opole Główne',
        seq: 8,
        arriveSec: 57600,
        departSec: 57720,
      },
      {
        stopId: 'pl:krakow',
        name: 'Kraków Główny',
        seq: 10,
        arriveSec: 65400,
        departSec: 65700,
      },
    ],
  };

  // Kurs kolei regionalnej z bazy miejskiej (KD:T:2026:149061), gdzie trainNumber nie jest ustawiony, a numer pociągu siedzi w leg.line
  const kdLeg: Leg = {
    id: 'kd-69504',
    mode: 'train',
    line: '69504',
    fromStop: 'Wrocław Główny',
    toStop: 'Legnica',
    departAt: '16:00',
    arriveAt: '16:48',
    stopsCount: 6,
    live: false,
    tripId: 'KD:T:2026:149061',
    scheduledDepartureSec: 16 * 3600, // 57600
    scheduledArrivalSec: 16 * 3600 + 48 * 60, // 60480
    intermediateStops: [
      { stopId: 'kd:1', name: 'Wrocław Główny', seq: 1, arriveSec: 57600, departSec: 57600 },
      { stopId: 'kd:7', name: 'Legnica', seq: 7, arriveSec: 60480, departSec: 60480 },
    ],
  };

  let requestedUrl = '';
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          trips: {
            'pl:PLK_IC_2026_107625': {
              tripId: 'pl:PLK_IC_2026_107625',
              startDate: '2026-04-20',
              agency: 'IC',
              numbers: ['8308', '8309'],
              cancelled: false,
              lastConfirmedSeq: 6,
              stops: [
                {
                  seq: 4,
                  arr: '2026-04-20T15:08:00',
                  dep: '2026-04-20T15:10:00', // Dokładnie 15:10 na wcześniejszej stacji!
                  platform: '1',
                  track: '1',
                  confirmed: true,
                  cancelled: false,
                },
                {
                  seq: 7,
                  arr: '2026-04-20T15:48:00',
                  dep: '2026-04-20T15:53:00', // +43 min (2580 s) na właściwej stacji wsiadania seq=7
                  platform: '3',
                  track: '6',
                  confirmed: false,
                  cancelled: false,
                },
                {
                  seq: 8,
                  arr: '2026-04-20T16:43:00',
                  dep: '2026-04-20T16:45:00',
                  platform: '2',
                  track: '1',
                  confirmed: false,
                  cancelled: false,
                },
                {
                  seq: 10,
                  arr: '2026-04-20T18:50:00', // +40 min (2400 s) na stacji wysiadania seq=10
                  dep: '2026-04-20T18:55:00',
                  platform: '4',
                  track: '2',
                  confirmed: false,
                  cancelled: false,
                },
              ],
            },
            'pl:PLK_KD_2026_149061': {
              tripId: 'pl:PLK_KD_2026_149061',
              startDate: '2026-04-20',
              agency: 'KD',
              numbers: ['69504'],
              cancelled: false,
              lastConfirmedSeq: 1,
              stops: [
                {
                  seq: 1,
                  dep: '2026-04-20T16:12:00', // +12 min (720 s)
                  platform: '1',
                  track: '9',
                  confirmed: true,
                  cancelled: false,
                },
                {
                  seq: 7,
                  arr: '2026-04-20T16:58:00', // +10 min (600 s)
                  platform: '2',
                  track: '3',
                  confirmed: false,
                  cancelled: false,
                },
              ],
            },
          },
          updatedAt: '2026-04-20T15:00:00Z',
          fetchedAt: Date.now(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const updates = await fetchNationalRailUpdates([icLeg, kdLeg]);
    assert.ok(
      requestedUrl.includes('8308') && requestedUrl.includes('8309'),
      `URL powinien zawierać rozbite numery 8308 i 8309: ${requestedUrl}`,
    );
    assert.ok(
      requestedUrl.includes('69504'),
      `URL powinien zawierać numer 69504 z leg.line: ${requestedUrl}`,
    );

    const icUpdate = updates.get('pl:PLK_IC_2026_107625_LEG1');
    assert.ok(icUpdate, 'Powinien dopasować kurs IC z sufiksem _LEG1');
    assert.equal(icUpdate?.delaySec, 2580, 'Opóźnienie na stacji wsiadania seq=7 to +43 min (2580 s)');
    assert.equal(icUpdate?.arrivalDelaySec, 2400, 'Opóźnienie na stacji wysiadania seq=10 to +40 min (2400 s)');
    assert.equal(icUpdate?.platform, '3');
    assert.equal(icUpdate?.track, '6');
    assert.equal(icUpdate?.hasRealtimeDelay, true);

    const kdUpdate = updates.get('KD:T:2026:149061');
    assert.ok(kdUpdate, 'Powinien dopasować kurs KD z bazy miejskiej');
    assert.equal(kdUpdate?.delaySec, 720, 'Opóźnienie KD 69504 to +12 min (720 s)');
    assert.equal(kdUpdate?.arrivalDelaySec, 600);
    assert.equal(kdUpdate?.platform, '1');
    assert.equal(kdUpdate?.hasRealtimeDelay, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchNationalRailUpdates marks hasRealtimeDelay=false when schedule times are missing', async () => {
  resetNationalRailUpdatesCache();
  const tripId = 'pl:PLK_IC_2026_NO_SCHED';
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          trips: {
            [tripId]: {
              tripId,
              agency: 'IC',
              numbers: ['3500'],
              cancelled: false,
              lastConfirmedSeq: 1,
              stops: [
                {
                  seq: 1,
                  dep: '2026-04-20T12:15:00',
                  platform: '4',
                  confirmed: true,
                  cancelled: false,
                },
              ],
            },
          },
          updatedAt: '2026-04-20T12:00:00Z',
          fetchedAt: Date.now(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const updates = await fetchNationalRailUpdates([
      {
        tripId,
        trainNumber: '3500',
      },
    ]);
    const update = updates.get(tripId);
    assert.ok(update);
    assert.equal(update?.hasRealtimeDelay, false);
    assert.equal(update?.platform, '4');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchNationalRailUpdates preserves passenger info (platform, track, delay) when offline', async () => {
  resetNationalRailUpdatesCache();
  const originalFetch = globalThis.fetch;
  const tripId = 'pl:PLK_IC_1620_1';
  const leg = {
    tripId,
    line: 'IC',
    trainNumber: '1620',
    departAt: '14:00',
    fromStop: 'Wrocław Główny',
    intermediateStops: [
      { stopId: 'stop-1', seq: 1, name: 'Wrocław Główny', departureTime: '14:00' } as any,
      { stopId: 'stop-2', seq: 2, name: 'Opole Główne', departureTime: '14:45' } as any,
    ],
  };

  try {
    // 1. Sukces sieciowy online
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          trips: {
            [tripId]: {
              tripId,
              agency: 'IC',
              numbers: ['1620'],
              cancelled: false,
              stops: [
                {
                  seq: 1,
                  schedDep: '14:00:00',
                  dep: '14:15:00',
                  platform: '3',
                  track: '2',
                  confirmed: true,
                  cancelled: false,
                },
              ],
            },
          },
          updatedAt: '2026-04-20T14:00:00Z',
          fetchedAt: 1776684000000,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const onlineUpdates = await fetchNationalRailUpdates([leg]);
    assert.equal(onlineUpdates.get(tripId)?.platform, '3');
    assert.equal(onlineUpdates.get(tripId)?.track, '2');
    assert.equal(onlineUpdates.get(tripId)?.delaySec, 900);

    // 2. Zanik sieci (offline w trasie / tunelu)
    globalThis.fetch = async () => {
      throw new Error('Network request failed');
    };

    // Nawet po wyczyszczeniu cache w RAM (np. restart / długa podróż):
    resetNationalRailUpdatesCache();

    const offlineUpdates = await fetchNationalRailUpdates([leg]);
    const offlineItem = offlineUpdates.get(tripId);
    assert.ok(offlineItem, 'Powinno zwrócić dane z pamięci trwałej');
    assert.equal(offlineItem?.platform, '3');
    assert.equal(offlineItem?.track, '2');
    assert.equal(offlineItem?.delaySec, 900);
    assert.equal(offlineItem?.agency, 'IC');
  } finally {
    globalThis.fetch = originalFetch;
    resetNationalRailUpdatesCache();
  }
});
