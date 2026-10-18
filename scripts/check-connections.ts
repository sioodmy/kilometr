import assert from 'node:assert/strict';
import { deduplicateConnections, mergeConnections, stableConnectionId } from '../src/services/routing/connectionIdentity';
import type { Connection } from '../src/types/models';

const tram: Connection = {
  id: 'conn-1-36000', fromTitle: 'Start', toTitle: 'Cel',
  departureSec: 36000, departAt: '10:00', arriveAt: '10:20',
  durationMin: 20, departInMin: 5, transfers: 0, live: false, delayMin: 0,
  legs: [{
    id: 'leg-1', mode: 'tram', line: '4', tripId: 'trip-a', routeId: 'route-a',
    fromStop: 'A', toStop: 'B', fromStopId: 'A1', toStopId: 'B1',
    departAt: '10:02', arriveAt: '10:18', stopsCount: 6, live: false,
  }],
};
const duplicate: Connection = {
  ...tram, id: 'conn-7-36030', departureSec: 36030,
  legs: tram.legs.map((leg) => ({ ...leg, id: 'leg-7', tripId: 'trip-b', routeId: 'route-b' })),
};
const next: Connection = {
  ...tram, id: 'next', departureSec: 36600,
  legs: tram.legs.map((leg) => ({ ...leg, departAt: '10:12', arriveAt: '10:28' })),
};
assert.equal(deduplicateConnections([tram, duplicate]).length, 1);
assert.equal(stableConnectionId(tram), stableConnectionId(duplicate));
assert.equal(deduplicateConnections([tram, next]).length, 2);
assert.equal(deduplicateConnections([tram, { ...tram, departureSec: tram.departureSec + 86400 }]).length, 2);
assert.equal(deduplicateConnections([tram, { ...tram, toTitle: 'Inny cel' }]).length, 2);
assert.equal(deduplicateConnections([tram, {
  ...tram, legs: tram.legs.map((leg) => ({ ...leg, fromStopId: 'A2' })),
}]).length, 2);
const transfer: Connection = {
  ...tram, transfers: 1,
  legs: [...tram.legs, { ...tram.legs[0], id: 'leg-2', line: '7', fromStopId: 'B1', toStopId: 'C1' }],
};
assert.equal(deduplicateConnections([tram, transfer]).length, 2);
assert.deepEqual(mergeConnections([tram], [duplicate, next, { ...next, id: 'next-copy' }]), {
  list: [tram, next], added: 1,
});
assert.equal(mergeConnections([tram], [duplicate]).added, 0);
assert.equal(stableConnectionId({ ...tram, id: 'new-index' }), stableConnectionId(tram));
console.log('PASS: duplikaty kursów, stabilne ID, przystanki, przesiadki, dni i paginacja');
