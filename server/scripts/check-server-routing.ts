import { buildLegStops } from '../src/routing/engine';
import { gtfsStore } from '../src/gtfs/store';

let passed = 0;
const failures: string[] = [];
let section = '';

function head(title: string) {
  section = title;
  console.log(`\n${title}`);
}

function check(label: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    failures.push(`[${section}] ${label}${detail ? `: ${detail}` : ''}`);
    console.log(`  FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

head('Server buildLegStops: linie okólne i pętle z powtarzającymi się przystankami');
{
  const tripLoop = 'SERVER_TRIP_LOOP';
  gtfsStore.stops.set('P0', { stop_id: 'P0', stop_code: '', stop_name: 'Pętla', stop_lat: 51.0, stop_lon: 17.0, normalized_name: 'petla' });
  gtfsStore.stops.set('S1', { stop_id: 'S1', stop_code: '', stop_name: 'Ulica A', stop_lat: 51.01, stop_lon: 17.01, normalized_name: 'ulica a' });
  gtfsStore.stops.set('S2', { stop_id: 'S2', stop_code: '', stop_name: 'Ulica B', stop_lat: 51.02, stop_lon: 17.02, normalized_name: 'ulica b' });
  gtfsStore.stopTimes.set(tripLoop, [
    { trip_id: tripLoop, stop_id: 'P0', stop_sequence: 1, arrival_time: '10:00:00', departure_time: '10:00:00', arrival_sec: 36000, departure_sec: 36000 },
    { trip_id: tripLoop, stop_id: 'S1', stop_sequence: 2, arrival_time: '10:05:00', departure_time: '10:05:00', arrival_sec: 36300, departure_sec: 36300 },
    { trip_id: tripLoop, stop_id: 'S2', stop_sequence: 3, arrival_time: '10:10:00', departure_time: '10:10:00', arrival_sec: 36600, departure_sec: 36600 },
    { trip_id: tripLoop, stop_id: 'P0', stop_sequence: 4, arrival_time: '10:15:00', departure_time: '10:15:00', arrival_sec: 36900, departure_sec: 36900 },
  ]);

  // Przypadek 1: wsiadanie w trakcie trasy (S2), wysiadanie na pętli końcowej (P0)
  const stopsS2toP0 = buildLegStops(tripLoop, 'S2', 'P0', 36600, 36900);
  check('wsiadanie na S2, wysiadanie na pętli P0: tylko [S2, P0]', stopsS2toP0.map((s) => s.stopId).join(',') === 'S2,P0', stopsS2toP0.map((s) => s.stopId).join(','));

  // Przypadek 2: przejazd całej pętli od P0 do P0
  const stopsFullLoop = buildLegStops(tripLoop, 'P0', 'P0', 36000, 36900);
  check('pełna pętla P0 do P0: 4 przystanki', stopsFullLoop.map((s) => s.stopId).join(',') === 'P0,S1,S2,P0', stopsFullLoop.map((s) => s.stopId).join(','));

  // Przypadek 3: trasa z powtórzonym przystankiem pośrednim
  const tripDoubleB = 'SERVER_TRIP_DOUBLE_B';
  gtfsStore.stops.set('SD', { stop_id: 'SD', stop_code: '', stop_name: 'Ulica D', stop_lat: 51.03, stop_lon: 17.03, normalized_name: 'ulica d' });
  gtfsStore.stopTimes.set(tripDoubleB, [
    { trip_id: tripDoubleB, stop_id: 'P0', stop_sequence: 1, arrival_time: '11:00:00', departure_time: '11:00:00', arrival_sec: 39600, departure_sec: 39600 },
    { trip_id: tripDoubleB, stop_id: 'S1', stop_sequence: 2, arrival_time: '11:05:00', departure_time: '11:05:00', arrival_sec: 39900, departure_sec: 39900 },
    { trip_id: tripDoubleB, stop_id: 'S2', stop_sequence: 3, arrival_time: '11:10:00', departure_time: '11:10:00', arrival_sec: 40200, departure_sec: 40200 },
    { trip_id: tripDoubleB, stop_id: 'S1', stop_sequence: 4, arrival_time: '11:15:00', departure_time: '11:15:00', arrival_sec: 40500, departure_sec: 40500 },
    { trip_id: tripDoubleB, stop_id: 'SD', stop_sequence: 5, arrival_time: '11:20:00', departure_time: '11:20:00', arrival_sec: 40800, departure_sec: 40800 },
  ]);

  // Pasażer wsiada na DRUGIM S1 (odjazd 40500) i jedzie do SD (40800)
  const stopsSecondS1 = buildLegStops(tripDoubleB, 'S1', 'SD', 40500, 40800);
  check('wsiadanie na drugim S1 dopasowane czasem do [S1, SD]', stopsSecondS1.map((s) => s.stopId).join(',') === 'S1,SD', stopsSecondS1.map((s) => s.stopId).join(','));

  gtfsStore.stops.delete('P0');
  gtfsStore.stops.delete('S1');
  gtfsStore.stops.delete('S2');
  gtfsStore.stops.delete('SD');
  gtfsStore.stopTimes.delete(tripLoop);
  gtfsStore.stopTimes.delete(tripDoubleB);
}

head('Server planConnections: normalizacja ujemnego czasu odjazdu');
{
  const rawDep = -900;
  const dayOffsetSec = Math.floor(rawDep / 86400) * 86400;
  let departureSec = rawDep % 86400;
  if (departureSec < 0) departureSec += 86400;

  check('dayOffsetSec to -86400', dayOffsetSec === -86400, `${dayOffsetSec}`);
  check('departureSec to 85500', departureSec === 85500, `${departureSec}`);
}

console.log(`\n${'─'.repeat(60)}`);
if (failures.length) {
  console.log(`FAIL: ${failures.length} z ${passed + failures.length}`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log(`PASS: ${passed} asercji`);
