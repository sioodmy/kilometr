import assert from 'node:assert/strict';
import test from 'node:test';
import { alertsForLeg, resetNationalDisruptionsCache } from '../src/services/railTripAlerts';
import { resetNationalRailUpdatesCache } from '../src/services/nationalRailUpdates';
import type { Leg } from '../src/types/models';

test('alertsForLeg fetches PKP announcements directly on device and preserves them offline', async () => {
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

  const listHtml = `
    <a href="site/o-nas/dzial-prasowy/komunikaty/utrudnienia-ic-1620.html">
      <h2>IC 1620 awaria sieci trakcyjnej w dniu 13.11.2026 roku</h2>
      <span>Aktualizacja: 2026-11-13, 15:10(2)</span>
    </a>
  `;

  const detailHtml = `
    <article class="11200">
      <div class="page-title"><h1>IC 1620 awaria sieci trakcyjnej</h1></div>
      <p>Awaria sieci trakcyjnej dla pociągu IC nr 1620 relacji Wrocław Główny - Warszawa Centralna.</p>
      <p>Wprowadzono zastępczą komunikację autobusową na odcinku Częstochowa - Piotrków Trybunalski.</p>
      <p><em>Informujemy, że mają Państwo prawo do zgłoszenia reklamacji.</em></p>
    </article>
  `;

  try {
    // 1. Online: bezpośrednie pobranie ze strony PKP Intercity na urządzeniu (bez R2 / bez AI)
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes('intercity.pl/pl/site/o-nas/dzial-prasowy/komunikaty/utrudnienia-ic-1620.html')) {
        return new Response(detailHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      if (urlStr.includes('intercity.pl/pl/site/o-nas/dzial-prasowy/komunikaty/')) {
        return new Response(listHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      return new Response(JSON.stringify({ trips: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const onlineAlerts = await alertsForLeg(leg);
    assert.ok(onlineAlerts.length > 0, 'Powinno znaleźć bezpośredni alert dla pociągu IC 1620');
    assert.equal(onlineAlerts[0]?.id, 'pkp-ic-utrudnienia-ic-1620');
    assert.equal(onlineAlerts[0]?.title, 'IC 1620 awaria sieci trakcyjnej');
    assert.match(onlineAlerts[0]?.solution ?? '', /zastępczą komunikację/);

    // 2. Offline: brak sieci w pociągu
    globalThis.fetch = async () => {
      throw new Error('Network unreachable');
    };

    resetNationalDisruptionsCache();
    resetNationalRailUpdatesCache();

    const offlineAlerts = await alertsForLeg(leg);
    assert.ok(offlineAlerts.length > 0, 'Alert powinien zostać odzyskany z pamięci trwałej offline');
    assert.equal(offlineAlerts[0]?.id, 'pkp-ic-utrudnienia-ic-1620');
    assert.equal(offlineAlerts[0]?.title, 'IC 1620 awaria sieci trakcyjnej');
  } finally {
    globalThis.fetch = originalFetch;
    resetNationalDisruptionsCache();
    resetNationalRailUpdatesCache();
  }
});
