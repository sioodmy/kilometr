import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeUserDataStats,
  connectionToJourneyLogEntry,
  estimateLegDistanceM,
} from '../src/services/userStatsModel';
import { buildBackupFile, parseBackupFile } from '../src/services/backupFormat';
import type { Connection, Leg, SavedPlace, SavedRoute } from '../src/types/models';
import type { TripHistoryItem } from '../src/services/smartRanking';

const TRAM_LEG: Leg = {
  id: 'leg-tram',
  mode: 'tram',
  line: '4',
  fromStop: 'pl. Grunwaldzki',
  toStop: 'Dworzec Główny',
  departAt: '08:10',
  arriveAt: '08:22',
  stopsCount: 6,
  live: false,
  fromLat: 51.1115,
  fromLon: 17.0603,
  toLat: 51.0988,
  toLon: 17.0365,
};

const BUS_LEG: Leg = {
  id: 'leg-bus',
  mode: 'bus',
  line: 'D',
  fromStop: 'Dworzec Główny',
  toStop: 'Galeria Dominikańska',
  departAt: '08:25',
  arriveAt: '08:33',
  stopsCount: 3,
  live: false,
  fromLat: 51.0988,
  fromLon: 17.0365,
  toLat: 51.1086,
  toLon: 17.0397,
};

const RAIL_LEG: Leg = {
  id: 'leg-rail',
  mode: 'train',
  line: 'IC 61100',
  railAgency: 'IC',
  fromStop: 'Wrocław Główny',
  toStop: 'Opole Główne',
  departAt: '09:00',
  arriveAt: '09:50',
  stopsCount: 2,
  live: false,
  fromLat: 51.0988,
  fromLon: 17.0365,
  toLat: 50.6627,
  toLon: 17.9267,
};

const WALK_LEG: Leg = {
  id: 'leg-walk',
  mode: 'walk',
  fromStop: 'Start',
  toStop: 'pl. Grunwaldzki',
  departAt: '08:05',
  arriveAt: '08:10',
  stopsCount: 0,
  walkM: 420,
  live: false,
};

const SAMPLE_CONN: Connection = {
  id: 'conn-1',
  fromTitle: 'Dom',
  toTitle: 'Uczelnia Główna',
  departInMin: 5,
  departureSec: 29100,
  departAt: '08:05',
  arriveAt: '08:33',
  durationMin: 28,
  transfers: 1,
  delayMin: 0,
  live: false,
  legs: [WALK_LEG, TRAM_LEG, BUS_LEG],
};

const RAIL_CONN: Connection = {
  id: 'conn-rail-1',
  fromTitle: 'Wrocław Główny',
  toTitle: 'Opole Główne',
  departInMin: 10,
  departureSec: 32400,
  departAt: '09:00',
  arriveAt: '09:50',
  durationMin: 50,
  transfers: 0,
  delayMin: 0,
  live: false,
  legs: [RAIL_LEG],
};

test('empty state produces clean zeros and hasAnyData=false', () => {
  const stats = computeUserDataStats({
    journeyLog: [],
    savedRoutes: [],
    tripHistory: [],
    places: [],
  });
  assert.equal(stats.hasAnyData, false);
  assert.equal(stats.totalTrips, 0);
  assert.equal(stats.totalDistanceKm, 0);
  assert.equal(stats.topLines.length, 0);
  assert.equal(stats.topDestinations.length, 0);
  assert.equal(stats.rail.trips, 0);
});

test('estimateLegDistanceM uses walkM and coordinates accurately', () => {
  assert.equal(estimateLegDistanceM(WALK_LEG), 420);
  const railDist = estimateLegDistanceM(RAIL_LEG);
  assert.ok(railDist > 75_000 && railDist < 120_000, `expected rail distance ~96km, got ${railDist}`);
});

test('aggregates lines, destinations, rail and keeps wrapped privacy-safe', () => {
  const now = 1_780_000_000_000;
  const entry1 = connectionToJourneyLogEntry(SAMPLE_CONN, 'wroclaw', 'tracked', now - 10_000)!;
  const entry2 = connectionToJourneyLogEntry(
    { ...SAMPLE_CONN, id: 'conn-2' },
    'wroclaw',
    'tracked',
    now - 100_000_000,
  )!;
  const railEntry = connectionToJourneyLogEntry(RAIL_CONN, 'wroclaw', 'tracked', now - 200_000_000)!;

  const history: TripHistoryItem[] = [
    {
      id: 'h1',
      origin_title: 'Dom Prywatny 12',
      origin_lat: 51.1115,
      origin_lon: 17.0603,
      dest_id: 'd-uczelnia',
      dest_title: 'Politechnika Tajna',
      dest_address: 'Wybrzeże Wyspiańskiego 27',
      dest_lat: 51.1073,
      dest_lon: 17.062,
      duration_min: 18,
      timestamp: now - 5_000,
      uses: 9,
    },
    {
      id: 'h2',
      origin_title: 'Dom Prywatny 12',
      origin_lat: 51.1115,
      origin_lon: 17.0603,
      dest_id: 'd-dworzec',
      dest_title: 'Dworzec Główny',
      dest_address: 'Piłsudskiego 105',
      dest_lat: 51.0988,
      dest_lon: 17.0365,
      duration_min: 22,
      timestamp: now - 50_000,
      uses: 3,
    },
  ];

  const savedRoute: SavedRoute = {
    id: 'conn-1',
    savedAt: now - 10_000,
    connection: SAMPLE_CONN,
  };

  const place: SavedPlace = {
    id: 'p1',
    placeId: 'p1',
    name: 'Mój Dom',
    icon: 'home',
    address: 'Sekretna 7',
    lat: 51.11,
    lon: 17.06,
  };

  const stats = computeUserDataStats(
    {
      journeyLog: [entry1, entry2, railEntry],
      savedRoutes: [{ city: 'wroclaw', items: [savedRoute] }],
      tripHistory: [{ city: 'wroclaw', items: history }],
      places: [{ city: 'wroclaw', items: [place] }],
      railTickets: [
        {
          id: 't1',
          connectionId: 'conn-rail-1',
          addedAt: now - 200_000_000,
          trainNumber: '61100',
        },
      ],
    },
    new Date('2026-11-25T12:00:00Z'),
  );

  assert.equal(stats.hasAnyData, true);
  assert.equal(stats.totalTrips, 12);
  assert.ok(stats.totalDistanceKm > 90);
  assert.equal(stats.rail.trips, 1);
  assert.equal(stats.rail.ticketsCount, 1);
  assert.ok(stats.rail.distanceKm > 75);
  assert.equal(stats.topDestinations[0]?.title, 'Politechnika Tajna');
  assert.equal(stats.topDestinations[0]?.count, 9);
  assert.ok(stats.topLines.some((l) => l.line === '4' && l.count === 2));
  assert.equal(stats.archetype, 'rail_express');

  // Krytyczna gwarancja prywatnosci: karta Wrapped nie moze zawierac celow, miast ani linii.
  const wrappedJson = JSON.stringify(stats.wrapped);
  assert.ok(!wrappedJson.includes('Politechnika'));
  assert.ok(!wrappedJson.includes('Dworzec'));
  assert.ok(!wrappedJson.includes('Sekretna'));
  assert.ok(!wrappedJson.includes('wroclaw'));
  assert.ok(!wrappedJson.includes('IC 61100'));
  assert.ok(!wrappedJson.includes('"4"'));
  assert.equal(stats.wrapped.year, 2026);
});

test('backupFormat round-trips optional journeyLog without breaking schema 2', () => {
  const entry = connectionToJourneyLogEntry(SAMPLE_CONN, 'wroclaw', 'tracked', 1_780_000_000_000)!;
  const raw = buildBackupFile(
    {
      places: [],
      savedRoutes: [],
      tripHistory: [],
      journeyLog: [entry],
      routingSettings: null,
      notificationPrefs: null,
      locale: 'pl',
    },
    '1.0.0',
  );
  const parsed = parseBackupFile(raw);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.envelope.data.journeyLog?.length, 1);
    assert.equal(parsed.envelope.data.journeyLog?.[0]?.id, 'conn-1');
  }
});
