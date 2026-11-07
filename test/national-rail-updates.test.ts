import '../scripts/stub-expo.cjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Leg } from '../src/types/models';
import { fetchNationalRailUpdates } from '../src/services/nationalRailUpdates';

test('fetchNationalRailUpdates returns empty map when legs is empty or no pl: train legs', async () => {
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
    assert.equal(update?.platform, '3');
    assert.equal(update?.track, '2');
    assert.equal(update?.cancelled, false);
    assert.equal(update?.agency, 'IC');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
