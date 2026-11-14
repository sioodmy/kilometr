import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { gtfsStore } from '../src/services/routing/store';
import { groundDisruption } from '../src/services/disruptionGrounding';
import type { DisruptionAlert } from '../src/services/mpkNews';

// Grounding dopasowuje tekst z LLM do route_id/stop_id lokalnej bazy GTFS.
// Test wypełnia sklep ręcznie (bez bazy), więc jest deterministyczny.

function seedStore() {
  gtfsStore.isLoaded = true;
  gtfsStore.stops.clear();
  gtfsStore.routes.clear();

  const mkStop = (id: string, name: string) => ({
    stop_id: id,
    stop_code: '',
    stop_name: name,
    stop_lat: 51.1,
    stop_lon: 17.0,
    normalized_name: '',
  });
  gtfsStore.stops.set('s1', mkStop('s1', 'Księże Małe'));
  gtfsStore.stops.set('s2', mkStop('s2', 'Galeria Dominikańska'));
  gtfsStore.stops.set('s3', mkStop('s3', 'Plac Bema'));

  gtfsStore.routes.set('r3', {
    route_id: 'r3',
    route_short_name: '3',
    route_long_name: '',
    route_type: 0,
  });
  gtfsStore.routes.set('r5', {
    route_id: 'r5',
    route_short_name: '5',
    route_long_name: '',
    route_type: 0,
  });
}

function alert(overrides: Partial<DisruptionAlert>): DisruptionAlert {
  return {
    id: 'a1',
    source_title: 'T',
    link: 'https://example.com',
    published_at: null,
    is_transit_alert: true,
    headline: 'H',
    disruption_type: 'planned_works',
    is_emergency: false,
    is_resolved: false,
    severity: 'minor',
    glance: { problem: 'P', solution: null, timeframe: '' },
    valid_from: '2026-11-12T00:00:00Z',
    valid_to: null,
    all_lines: [],
    impacted_lines: [],
    stops: [],
    ...overrides,
  };
}

before(() => seedStore());

test('dopasowuje linie do route_id (case-insensitive)', async () => {
  const g = await groundDisruption(alert({ all_lines: ['3', '5'] }));
  assert.deepEqual([...g.routeIds].sort(), ['r3', 'r5']);
});

test('dopasowuje przystanki w mianowniku do stop_id', async () => {
  const g = await groundDisruption(
    alert({ stops: [{ name: 'Księże Małe', action: 'omitted', lines: ['3'], details: '' }] }),
  );
  assert.deepEqual(g.stopIds, ['s1']);
  assert.equal(g.stops[0]?.name, 'Księże Małe');
});

test('zbiera przystanki z omitted_stops i temporary_stops', async () => {
  const g = await groundDisruption(
    alert({
      impacted_lines: [
        {
          line: '3',
          direction: 'both',
          impact_type: 'detour',
          omitted_stops: ['Galeria Dominikańska'],
          temporary_stops: ['Plac Bema'],
          replacement_line: null,
          details: '',
        },
      ],
    }),
  );
  assert.deepEqual([...g.stopIds].sort(), ['s2', 's3']);
});

test('deduplikuje linie i przystanki, pomija nieznane', async () => {
  const g = await groundDisruption(
    alert({
      all_lines: ['3', '3', '999'],
      stops: [{ name: 'Księże Małe', action: 'omitted', lines: [], details: '' }],
      impacted_lines: [
        {
          line: '3',
          direction: null,
          impact_type: 'detour',
          omitted_stops: ['Księże Małe', 'Nieistniejący Przystanek'],
          temporary_stops: [],
          replacement_line: null,
          details: '',
        },
      ],
    }),
  );
  assert.deepEqual(g.routeIds, ['r3']);
  assert.deepEqual(g.stopIds, ['s1']);
});

test('pusty grounding, gdy linia i przystanek spoza GTFS', async () => {
  const g = await groundDisruption(alert({ all_lines: ['999'] }));
  assert.equal(g.routeIds.length, 0);
  assert.equal(g.stopIds.length, 0);
});

test('zbiera linie i przystanki z line_changes i temporary_lines', async () => {
  const g = await groundDisruption(
    alert({
      line_changes: [
        {
          line: '5',
          direction: null,
          change: 'detour',
          via: ['Galeria Dominikańska', 'Plac Bema'],
          omitted_stops: [],
          temporary_stops: [],
          replacement_line: null,
          hours: [],
          details: '',
        },
        {
          line: '3',
          direction: 'both',
          change: 'cancelled',
          via: null,
          omitted_stops: [],
          temporary_stops: [],
          replacement_line: null,
          hours: [{ from: '11:45', to: '13:00' }],
          details: '',
        },
      ],
      temporary_lines: [
        {
          line: 'C1',
          via: ['Księże Małe', 'Galeria Dominikańska'],
          frequency_min: 10,
          days: [],
          hours: [],
          serves: [],
          details: '',
        },
      ],
    }),
  );
  assert.deepEqual([...g.routeIds].sort(), ['r3', 'r5']);
  assert.deepEqual([...g.stopIds].sort(), ['s1', 's2', 's3']);
});

test('zbiera przystanki z corridor oraz from_stop, to_stop i transfer_stops', async () => {
  const g = await groundDisruption(
    alert({
      corridor: {
        label: 'ul. Krakowska',
        from_stop: 'Galeria Dominikańska',
        to_stop: 'Księże Małe',
      },
      line_changes: [
        {
          line: '3',
          direction: 'Księże Małe',
          change: 'shortened',
          from_stop: 'Galeria Dominikańska',
          to_stop: null,
          via: null,
          omitted_stops: [],
          temporary_stops: [],
          transfer_stops: ['Plac Bema'],
          replacement_line: '703',
          hours: [],
          details: '',
        },
      ],
    }),
  );
  assert.deepEqual([...g.stopIds].sort(), ['s1', 's2', 's3']);
});

