import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGtfsStore, type DayIndex } from '../src/services/routing/store';
import {
  buildLiveMapDisruptions,
  isDisruptionActiveForMap,
  resolveDisruptionMapLabel,
} from '../src/services/liveMapDisruptions';
import type { DisruptionAlert, MpkNewsItem } from '../src/services/mpkNews';

function makeStore(): { store: LocalGtfsStore; dayIndex: DayIndex } {
  const store = new LocalGtfsStore();
  store.isLoaded = true;
  store.stops.set('s1', {
    stop_id: 's1',
    stop_name: 'Galeria Dominikańska',
    stop_lat: 51.1082,
    stop_lon: 17.0394,
    stop_code: '101',
    normalized_name: 'galeria dominikanska',
  });
  store.stops.set('s2', {
    stop_id: 's2',
    stop_name: 'Plac Zgody',
    stop_lat: 51.1059,
    stop_lon: 17.0512,
    stop_code: '102',
    normalized_name: 'plac zgody',
  });
  store.stops.set('s3', {
    stop_id: 's3',
    stop_name: 'Krakowska',
    stop_lat: 51.0962,
    stop_lon: 17.0623,
    stop_code: '103',
    normalized_name: 'krakowska',
  });
  store.stops.set('s4', {
    stop_id: 's4',
    stop_name: 'Księże Małe',
    stop_lat: 51.0841,
    stop_lon: 17.0875,
    stop_code: '104',
    normalized_name: 'ksieze male',
  });
  store.routes.set('r3', {
    route_id: 'r3',
    route_short_name: '3',
    route_long_name: 'Księże Małe',
    route_type: 0,
  });

  const dayIndex: DayIndex = {
    stopRoutes: new Map(),
    routeStops: new Map([['r3', ['s1', 's2', 's3', 's4']]]),
    routeTrips: new Map(),
    patterns: new Map([
      [
        'p1',
        {
          patternId: 'p1',
          routeId: 'r3',
          stopSequence: ['s1', 's2', 's3', 's4'],
          trips: [],
          departures: [],
          tripIndices: [],
        },
      ],
    ]),
  };
  return { store, dayIndex };
}

function makeItem(alert: Partial<DisruptionAlert>, id = 'a1'): MpkNewsItem {
  const fullAlert: DisruptionAlert = {
    id,
    source_title: 'Komunikat',
    link: 'https://example.com/' + id,
    published_at: '2026-11-15T08:00:00Z',
    is_transit_alert: true,
    headline: 'Krakowska: wykolejenie tramwaju linii 3',
    disruption_type: 'accident',
    is_emergency: true,
    is_resolved: false,
    severity: 'blocking',
    map_label: null,
    glance: {
      problem: 'Wykolejenie tramwaju przy ul. Krakowskiej blokuje przejazd.',
      solution: 'Kursuje autobus za-tramwaj 703.',
      timeframe: 'Od 08:10',
    },
    corridor: {
      label: 'ul. Krakowska',
      from_stop: 'Galeria Dominikańska',
      to_stop: 'Księże Małe',
    },
    valid_from: '2026-11-15T08:00:00Z',
    valid_to: '2026-11-15T18:00:00Z',
    all_lines: ['3'],
    line_changes: [],
    impacted_lines: [],
    stops: [],
    ...alert,
  };
  return {
    id,
    title: fullAlert.headline,
    link: fullAlert.link,
    description: fullAlert.glance.problem,
    imageUrl: null,
    urgent: fullAlert.is_emergency,
    pubDate: Date.parse('2026-11-15T08:00:00Z'),
    dateLabel: '15.11',
    source: 'mpk',
    lines: fullAlert.all_lines,
    disruption: fullAlert,
  };
}

test('pomija utrudnienia rozwiązane, nieoperacyjne, przyszłe oraz wygasłe', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  assert.equal(isDisruptionActiveForMap(makeItem({ is_resolved: true }).disruption, now), false);
  assert.equal(isDisruptionActiveForMap(makeItem({ is_transit_alert: false }).disruption, now), false);
  assert.equal(
    isDisruptionActiveForMap(makeItem({ valid_to: '2026-11-15T10:00:00Z' }).disruption, now),
    false,
  );
  assert.equal(
    isDisruptionActiveForMap(makeItem({ valid_from: '2026-11-16T08:00:00Z' }).disruption, now),
    false,
  );
  assert.equal(isDisruptionActiveForMap(makeItem({}).disruption, now), true);
});

test('resolveDisruptionMapLabel preferuje map_label z LLM i ma zwięzły fallback po słowach kluczowych', () => {
  assert.equal(
    resolveDisruptionMapLabel(makeItem({ map_label: 'Wykolejenie' }).disruption!),
    'wykolejenie',
  );
  assert.equal(
    resolveDisruptionMapLabel(makeItem({ map_label: null }).disruption!),
    'wykolejenie',
  );
  assert.equal(
    resolveDisruptionMapLabel(
      makeItem({
        map_label: null,
        headline: 'Remont torowiska na pl. Bema',
        disruption_type: 'planned_works',
        glance: { problem: 'Prace torowe przez weekend.', solution: null, timeframe: 'Sob-Nd' },
      }).disruption!,
    ),
    'remont',
  );
});

test('buduje korytarz z lokalnego DayIndex oraz kotwicę na środku odcinka', () => {
  const { store, dayIndex } = makeStore();
  const now = Date.parse('2026-11-15T12:00:00Z');
  const markers = buildLiveMapDisruptions(
    [makeItem({ map_label: 'wykolejenie' })],
    store,
    dayIndex,
    now,
  );
  assert.equal(markers.length, 1);
  assert.equal(markers[0].shortLabel, 'wykolejenie');
  assert.equal(markers[0].corridorCoords.length, 4);
  assert.equal(markers[0].affectedStops.length, 4);
  assert.ok(markers[0].lat > 51.0841 && markers[0].lat < 51.1082);
  assert.ok(markers[0].lon > 17.0394 && markers[0].lon < 17.0875);
});

test('używa server stop_coords jako fallback gdy brak lokalnego GTFS', () => {
  const emptyStore = new LocalGtfsStore();
  const now = Date.parse('2026-11-15T12:00:00Z');
  const item = makeItem({
    map_label: 'wypadek',
    corridor: {
      label: 'ul. Krakowska',
      from_stop: 'Plac Zgody',
      to_stop: 'Krakowska',
      stops: ['Plac Zgody', 'Krakowska'],
    },
    stop_coords: {
      'Plac Zgody': { stop_id: 's2', lat: 51.1059, lon: 17.0512 },
      Krakowska: { stop_id: 's3', lat: 51.0962, lon: 17.0623 },
    },
  });
  const markers = buildLiveMapDisruptions([item], emptyStore, null, now);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].corridorCoords.length, 2);
  assert.equal(markers[0].shortLabel, 'wypadek');
});

test('wykrywa tryb tramwajowy korytarza i dobiera najblizsze slupki bez zygzakow', () => {
  const { store, dayIndex } = makeStore();
  // Dodajemy daleki słupek o tej samej nazwie przed bliższym, żeby zweryfikować dobór bez zygzaka.
  const altStore = new LocalGtfsStore();
  altStore.isLoaded = true;
  altStore.stops.set('s1_far', {
    stop_id: 's1_far',
    stop_name: 'Galeria Dominikańska',
    stop_lat: 51.113,
    stop_lon: 17.032,
    stop_code: '199',
    normalized_name: 'galeria dominikanska',
  });
  for (const [k, v] of store.stops) altStore.stops.set(k, v);
  for (const [k, v] of store.routes) altStore.routes.set(k, v);

  const now = Date.parse('2026-11-15T12:00:00Z');
  const item = makeItem({
    corridor: {
      label: 'ul. Krakowska',
      from_stop: 'Galeria Dominikańska',
      to_stop: 'Plac Zgody',
      stops: ['Galeria Dominikańska', 'Plac Zgody'],
    },
  });
  const markers = buildLiveMapDisruptions([item], altStore, dayIndex, now);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].mode, 'tram');
  assert.deepEqual(markers[0].corridorCoords[0], [17.0394, 51.1082]);
});
