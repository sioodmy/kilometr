import assert from 'node:assert/strict';
import test from 'node:test';
import { alertsForLeg, resetNationalDisruptionsCache } from '../src/services/railTripAlerts';
import { resetNationalRailUpdatesCache } from '../src/services/nationalRailUpdates';
import type { Leg } from '../src/types/models';

test('alertsForLeg preserves disruptions and alerts when offline', async () => {
  resetNationalDisruptionsCache();
  resetNationalRailUpdatesCache();
  const originalFetch = globalThis.fetch;

  const leg: Leg = {
    id: 'leg-1',
    mode: 'train',
    line: 'IC',
    trainNumber: '1620',
    departAt: '15:00',
    arriveAt: '17:00',
    fromStop: 'Wrocław Główny',
    toStop: 'Warszawa Centralna',
    intermediateStops: [],
    stopsCount: 0,
    live: false,
  };

  try {
    // 1. Online: pobranie utrudnień z R2 (polska/disruptions.json)
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes('polska/disruptions.json')) {
        return new Response(
          JSON.stringify({
            alerts: [
              {
                id: 'disruption-1620',
                headline: 'IC 1620 awaria sieci trakcyjnej',
                source_title: 'IC 1620',
                all_lines: ['IC'],
                is_emergency: true,
                is_resolved: false,
                glance: {
                  problem: 'Awaria sieci trakcyjnej dla pociągu IC 1620.',
                  solution: 'Wprowadzono komunikację zastępczą.',
                  timeframe: '15:00 - 18:00',
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ trips: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const onlineAlerts = await alertsForLeg(leg);
    assert.ok(onlineAlerts.length > 0, 'Powinno znaleźć alert dla pociągu IC 1620');
    assert.equal(onlineAlerts[0]?.id, 'disruption-1620');

    // 2. Offline: brak sieci (awaria / tunel / brak internetu w pociągu)
    globalThis.fetch = async () => {
      throw new Error('Network unreachable');
    };

    // Czyścimy cache w RAM, aby zasymulować restart aplikacji w pociągu bez zasięgu
    resetNationalDisruptionsCache();
    resetNationalRailUpdatesCache();

    const offlineAlerts = await alertsForLeg(leg);
    assert.ok(offlineAlerts.length > 0, 'Alert powinien zostać odzyskany z pamięci trwałej offline');
    assert.equal(offlineAlerts[0]?.id, 'disruption-1620');
    assert.equal(offlineAlerts[0]?.title, 'IC 1620 awaria sieci trakcyjnej');
  } finally {
    globalThis.fetch = originalFetch;
    resetNationalDisruptionsCache();
    resetNationalRailUpdatesCache();
  }
});
