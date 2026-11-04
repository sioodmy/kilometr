import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRequiredGtfsFiles } from '../src/gtfs/csv';

const STOPS = 'stop_id,stop_name,stop_lat,stop_lon\nS1,Przystanek,51.1,17.0\n';
const TRIPS = 'route_id,service_id,trip_id\nR1,WK,T1\n';
const STOP_TIMES =
  'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
  'T1,10:00:00,10:00:00,S1,1\n' +
  'T1,10:01:00,10:01:00,S2,2\n';

test('stops.txt z samym nagłówkiem nie daje przystanków', async () => {
  const parsed = await parseRequiredGtfsFiles({
    stops: 'stop_id,stop_name,stop_lat,stop_lon\n',
    trips: TRIPS,
    stopTimes: STOP_TIMES,
  });
  assert.equal(parsed.stops.length, 0);
  assert.equal(parsed.trips.length, 1);
  assert.equal(parsed.stopTimesRows, 2);
});

test('przerwany stop_times pomija ucięty wiersz bez stop_id i stop_sequence', async () => {
  const parsed = await parseRequiredGtfsFiles({
    stops: STOPS,
    trips: TRIPS,
    stopTimes: `${STOP_TIMES}T1,10:02:00,10:02:00,S3`,
  });
  assert.equal(parsed.stops.length, 1);
  assert.equal(parsed.trips.length, 1);
  assert.equal(parsed.stopTimesRows, 2);
});

test('pusty plik wymaganego rodzaju daje zero rekordów', async () => {
  const parsed = await parseRequiredGtfsFiles({
    stops: STOPS,
    trips: TRIPS,
    stopTimes: null,
  });
  assert.equal(parsed.stopTimesRows, 0);
});
