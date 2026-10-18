import assert from 'node:assert/strict';
import { connectionCacheKey, findCachedConnection, loadCachedConnections, rehydrateConnections } from '../src/services/offlineCache';
import { getRecentRouteLines, rememberLinesFromConnectionCache } from '../src/services/recentRouteLines';
import { kvSet } from '../src/services/storage';
import type { Connection, RouteQuery } from '../src/types/models';

const query: RouteQuery = {
  fromTitle: 'Start', fromLat: 51.1079, fromLon: 17.0385,
  toTitle: 'Cel', toId: 'cel', toLat: 51.12, toLon: 17.04,
};

async function main() {
  const originalNow = Date.now;
  const now = new Date(2026, 9, 18, 0, 10).getTime();
  const savedAt = new Date(2026, 9, 17, 23, 50).getTime();
  Date.now = () => now;
  try {
    const constraints: Partial<RouteQuery>[] = [
      { departureTimeSec: 0 }, { arriveBySec: 3600 }, { minTransferSec: 300 },
      { walkSpeedMps: 0.8 }, { trainsEnabled: false }, { cableEnabled: false },
      { trainMinTransferSec: 600 }, { anchorStopLat: 51.11 }, { anchorStopLon: 17.05 },
      ...(['walk', 'tram', 'bus', 'train', 'cable', 'trolleybus', 'subway'] as const)
        .map((mode) => ({ allowedTransferModes: { [mode]: false } })),
    ];
    for (const constraint of constraints) {
      assert.notEqual(connectionCacheKey(query), connectionCacheKey({ ...query, ...constraint }), JSON.stringify(constraint));
    }
    assert.equal(
      connectionCacheKey({ ...query, allowedTransferModes: { bus: false, train: true } }),
      connectionCacheKey({ ...query, allowedTransferModes: { train: true, bus: false } }),
    );

    const connection = {
      id: 'yesterday', departureSec: 23 * 3600 + 55 * 60, departInMin: 5,
      live: true, legs: [{ mode: 'tram', line: '17' }],
    } as Connection;
    await kvSet('kilometr.cache.connections.v1', JSON.stringify({
      broken: { savedAt, data: null },
      [connectionCacheKey(query)]: { savedAt, data: [connection] },
      [connectionCacheKey({ ...query, fromLat: 50.0647, fromLon: 19.945 })]: {
        savedAt, data: [{ ...connection, id: 'krakow', legs: [{ mode: 'tram', line: '99' }] }],
      },
    }));
    assert.equal((await findCachedConnection('yesterday'))?.departInMin, -15);
    assert.equal((await findCachedConnection('yesterday'))?.live, false);
    assert.equal(await findCachedConnection('missing'), null);
    assert.equal(await loadCachedConnections({ ...query, trainsEnabled: false }), null);
    assert.equal(rehydrateConnections([{ ...connection, departureSec: 0 }], now)[0].departInMin, -10);

    await rememberLinesFromConnectionCache();
    assert.deepEqual(await getRecentRouteLines(), ['17']);
    Date.now = () => now + 7 * 3600 * 1000;
    assert.equal(await findCachedConnection('yesterday'), null);
    console.log('PASS: cache constraints, midnight departures, expiry, malformed entries, city line filter');
  } finally {
    Date.now = originalNow;
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
