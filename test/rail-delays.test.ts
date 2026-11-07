import '../scripts/stub-expo.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRailDelays } from '../cloudflare/src/railDelays';

test('rail delays endpoint validates query parameters', async () => {
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
