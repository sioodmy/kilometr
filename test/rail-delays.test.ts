import '../scripts/stub-expo.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRailDelays, resetRailDelaysCache } from '../cloudflare/src/railDelays';

test('rail delays endpoint validates query parameters', async () => {
  resetRailDelaysCache();
  // OPTIONS method -> 204 CORS
  const reqOptions = new Request('http://localhost/api/rail/delays', { method: 'OPTIONS' });
  const resOptions = await handleRailDelays(reqOptions);
  assert.equal(resOptions.status, 204);

  // Brak parametrów -> 400
  const reqNoParams = new Request('http://localhost/api/rail/delays');
  const resNoParams = await handleRailDelays(reqNoParams);
  assert.equal(resNoParams.status, 400);

  // Mock fetch feed for predictable offline testing
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          timestamp: '2026-11-07T06:00:00Z',
          trip_updates: [
            {
              id: '1',
              trip_id: 'PLK_IC_2026_TEST',
              start_date: '2026-11-07',
              agency_id: 'IC',
              numbers: ['1234'],
              cancelled: false,
              stop_times: [
                {
                  stop_sequence: 1,
                  departure: '06:00:00',
                  confirmed: true,
                  platform: '2',
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    // Odpytanie o istniejący kurs -> 200 z danymi
    const reqExist = new Request('http://localhost/api/rail/delays?trips=pl:PLK_IC_2026_TEST');
    const resExist = await handleRailDelays(reqExist);
    assert.equal(resExist.status, 200);
    const dataExist = await resExist.json();
    assert.ok(dataExist.trips['pl:PLK_IC_2026_TEST']);
    assert.equal(dataExist.trips['pl:PLK_IC_2026_TEST'].agency, 'IC');

    // Odpytanie o numer pociągu -> 200
    const reqNum = new Request('http://localhost/api/rail/delays?numbers=1234');
    const resNum = await handleRailDelays(reqNum);
    assert.equal(resNum.status, 200);
    const dataNum = await resNum.json();
    assert.ok(dataNum.trips['pl:PLK_IC_2026_TEST']);

    // Odpytanie o nieistniejący kurs -> 200 z pustym obiektem
    const reqEmpty = new Request('http://localhost/api/rail/delays?trips=pl:NON_EXISTENT_TRIP');
    const resEmpty = await handleRailDelays(reqEmpty);
    assert.equal(resEmpty.status, 200);
    const dataEmpty = await resEmpty.json();
    assert.deepEqual(dataEmpty.trips, {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rail delays prefers active today start_date over finished yesterday start_date and supports _LEG1 / city-DB tripIds', async () => {
  resetRailDelaysCache();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          timestamp: '2026-04-20T15:00:00Z',
          trip_updates: [
            {
              // Dzisiejszy aktywny kurs (opóźniony +43 min, część przystanków jeszcze niepotwierdzona)
              id: 'today-active',
              trip_id: 'PLK_IC_2026_107625',
              start_date: '2026-04-20',
              agency_id: 'IC',
              numbers: ['8308', '8309'],
              cancelled: false,
              stop_times: [
                {
                  stop_sequence: 1,
                  departure: '2026-04-20T12:15:00',
                  confirmed: true,
                  platform: '4',
                },
                {
                  stop_sequence: 2,
                  arrival: '2026-04-20T15:53:00',
                  departure: '2026-04-20T15:55:00',
                  confirmed: false,
                  platform: '3',
                },
              ],
            },
            {
              // Wczorajszy zakończony kurs o tym samym trip_id występujący w feedzie PO dzisiejszym
              id: 'yesterday-finished',
              trip_id: 'PLK_IC_2026_107625',
              start_date: '2026-04-19',
              agency_id: 'IC',
              numbers: ['8308', '8309'],
              cancelled: false,
              stop_times: [
                {
                  stop_sequence: 1,
                  departure: '2026-04-19T11:32:00',
                  confirmed: true,
                  platform: '4',
                },
                {
                  stop_sequence: 2,
                  arrival: '2026-04-19T15:10:00',
                  departure: '2026-04-19T15:12:00',
                  confirmed: true,
                  platform: '3',
                },
              ],
            },
            {
              // Kurs KD w formacie PLK_KD_2026_...
              id: 'kd-active',
              trip_id: 'PLK_KD_2026_149061',
              start_date: '2026-04-20',
              agency_id: 'KD',
              numbers: ['69504'],
              cancelled: false,
              stop_times: [
                {
                  stop_sequence: 1,
                  departure: '2026-04-20T16:25:00',
                  confirmed: false,
                  platform: '1',
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    // 1. Zapytanie po tripId z sufiksem _LEG1 oraz ID z bazy miejskiej KD:T:2026:...
    const req = new Request(
      'http://localhost/api/rail/delays?trips=pl:PLK_IC_2026_107625_LEG1,KD:T:2026:149061',
    );
    const res = await handleRailDelays(req);
    assert.equal(res.status, 200);
    const data = await res.json();

    const icTrip = data.trips['pl:PLK_IC_2026_107625_LEG1'];
    assert.ok(icTrip, 'Powinien zwrócić kurs pod kluczem z sufiksem _LEG1');
    assert.equal(icTrip.startDate, '2026-04-20', 'Wczorajszy kurs nie może nadpisać dzisiejszego');
    assert.equal(icTrip.stops[1].dep, '2026-04-20T15:55:00');

    const kdTrip = data.trips['KD:T:2026:149061'];
    assert.ok(kdTrip, 'Powinien zmapować KD:T:2026:149061 na PLK_KD_2026_149061');
    assert.equal(kdTrip.agency, 'KD');
    assert.equal(kdTrip.stops[0].dep, '2026-04-20T16:25:00');

    // 2. Zapytanie po numerze pociągu powinno zwrócić aktywny dzisiejszy kurs jako pierwszy
    const reqByNum = new Request('http://localhost/api/rail/delays?numbers=8308');
    const resByNum = await handleRailDelays(reqByNum);
    const dataByNum = await resByNum.json();
    assert.equal(dataByNum.trips['pl:PLK_IC_2026_107625']?.startDate, '2026-04-20');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
