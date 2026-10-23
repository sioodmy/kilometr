import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { frecency, rankWithFrecency } from '../src/services/searchFrecency';
import { addRecentSuggestion, loadRecent, saveSuggestions } from '../src/services/offlineCache';
import { SearchService } from '../src/services/searchService';
import { kvSet } from '../src/services/storage';
import { setActiveCityId } from '../src/services/cityStore';
import type { Suggestion } from '../src/types/models';

const now = Date.now();
const day = 86400000;
const place: Suggestion = {
  id: 'test-rynek',
  title: 'Rynek',
  address: '',
  kind: 'stop',
  lat: 51.11,
  lon: 17.03,
};
const other: Suggestion = { ...place, id: 'test-rynek-2', title: 'Rynek 2', lat: 51.112 };

async function main() {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('overpass')) return new Response(JSON.stringify({ elements: [] }));
    networkCalls++;
    return new Response('[]');
  };
  try {
    assert.equal(
      frecency({ ...place, searchUsage: { score: 8, lastUsedAt: now - 14 * day } }, now),
      4,
    );
    assert.equal(frecency({ ...place, searchUsage: { score: NaN, lastUsedAt: now } }, now), 0);
    const frequent = { ...other, searchUsage: { score: 8, lastUsedAt: now } };
    assert.equal(rankWithFrecency([place, other], [frequent], 'rynek', now)[0].id, place.id);
    const peers = [
      { ...place, title: 'Rynek zachodni' },
      { ...other, title: 'Rynek wschodni' },
    ];
    assert.equal(
      rankWithFrecency(peers, [{ ...peers[1], searchUsage: frequent.searchUsage }], 'rynek', now)[0]
        .id,
      other.id,
    );
    const old = { ...peers[1], searchUsage: { score: 8, lastUsedAt: now - 140 * day } };
    const fresh = { ...peers[0], searchUsage: { score: 1, lastUsedAt: now } };
    assert.equal(rankWithFrecency(peers, [old, fresh], 'rynek', now)[0].id, place.id);

    await kvSet('kilometr.cache.recent.v1', JSON.stringify({ savedAt: now, data: [place] }));
    assert.equal((await loadRecent())[0].searchUsage?.score, 1);
    await Promise.all(Array.from({ length: 8 }, () => addRecentSuggestion(place)));
    const history = await loadRecent();
    assert.equal(history.length, 1);
    assert.ok(frecency(history[0]) > 8.99);
    await addRecentSuggestion({ ...place, id: 'new-id' });
    assert.equal((await loadRecent()).length, 1);
    await addRecentSuggestion({ ...place, id: '__gps' });
    assert.equal((await loadRecent()).length, 1);

    await saveSuggestions('rynek', peers);
    let firstPartial = -1;
    const started = performance.now();
    const initial = await SearchService.search(
      'rynek',
      { lat: 51.11, lon: 17.03 },
      'speed',
      (items) => {
        if (items.length && firstPartial < 0) firstPartial = performance.now() - started;
      },
    );
    assert.ok(initial.length);
    assert.ok(
      firstPartial >= 0 && firstPartial < 280,
      `Wyniki z dysku przed debounce sieci: ${firstPartial} ms`,
    );
    const networkBeforeCache = networkCalls;
    const timings: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await SearchService.search('RYNEK', { lat: 51.1101, lon: 17.0301 }, 'speed');
      timings.push(performance.now() - start);
    }
    assert.equal(networkCalls, networkBeforeCache);
    const moved = await SearchService.search('rynek', { lat: 51.1102, lon: 17.0302 }, 'speed');
    assert.notEqual(initial[0].distanceM, moved[0].distanceM);

    const plazas = peers.map((item, index) => ({
      ...item,
      id: `plac-${index}`,
      title: `Plac ${index === 0 ? 'północny' : 'południowy'}`,
    }));
    await saveSuggestions('plac', plazas);
    const coldPlazas = await SearchService.search('plac', undefined, 'learn');
    assert.equal(coldPlazas[0].id, plazas[0].id);
    await Promise.all(Array.from({ length: 4 }, () => SearchService.recordRecent(plazas[1])));
    const callsBeforeRerank = networkCalls;
    const learned = await SearchService.search('plac', undefined, 'learn');
    assert.equal(learned[0].id, plazas[1].id);
    assert.equal(networkCalls, callsBeforeRerank);

    const aborted = SearchService.search('braktrafienia11', undefined, 'cancel');
    const rejected = assert.rejects(aborted, { name: 'SearchAbortedError' });
    await SearchService.search('', undefined, 'cancel');
    await rejected;
    const pending = SearchService.search('braktrafienia12', undefined, 'close');
    const closed = assert.rejects(pending, { name: 'SearchAbortedError' });
    SearchService.cancel('close');
    await closed;
    await saveSuggestions('przerwanie13', [place]);
    let partialSeen: (() => void) | undefined;
    const partialReady = new Promise<void>((resolve) => {
      partialSeen = resolve;
    });
    const delayed = SearchService.search('przerwanie13', undefined, 'timer', () => partialSeen?.());
    const cancelledTimer = assert.rejects(delayed, { name: 'SearchAbortedError' });
    await partialReady;
    await new Promise((resolve) => setImmediate(resolve));
    const beforeCancel = networkCalls;
    SearchService.cancel('timer');
    await cancelledTimer;
    assert.equal(networkCalls, beforeCancel);
    await Promise.all([
      SearchService.search('rynek', undefined, 'independent-a'),
      SearchService.search('rynek', undefined, 'independent-b'),
    ]);

    const beforeSwitch = await loadRecent();
    const write = addRecentSuggestion(other);
    await setActiveCityId('krakow');
    await write;
    assert.deepEqual(await loadRecent(), []);
    assert.deepEqual(await SearchService.search('rynek', undefined, 'city'), []);
    await addRecentSuggestion({ ...other, id: 'krakow-choice', lat: 50.06, lon: 19.94 });
    await setActiveCityId('wroclaw');
    assert.equal((await loadRecent()).length, beforeSwitch.length + 1);
    assert.ok(!(await loadRecent()).some((item) => item.id === 'krakow-choice'));

    timings.sort((a, b) => a - b);
    console.log(
      `PASS: frecency, wygaszanie, dokładne trafienia, migracja, równoległe zapisy, cache, GPS, anulowanie, niezależne pola, miasta.`,
    );
    console.log(
      `Node/WASM, dane testowe: pierwsze wyniki ${firstPartial.toFixed(2)} ms; cache p50 ${timings[50].toFixed(2)} ms, p95 ${timings[95].toFixed(2)} ms (100 zapytań).`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
