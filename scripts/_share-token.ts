import { buildShareUrl, createSharedConnection } from '../src/sharing/connection';
import type { Connection } from '../src/types/models';

const connection: Connection = {
  id: 'test',
  fromTitle: 'Żółkiewskiego',
  toTitle: 'Dworzec Główny',
  departureSec: 86100,
  departInMin: 0,
  departAt: '23:55',
  arriveAt: '00:20',
  durationMin: 25,
  transfers: 0,
  delayMin: 0,
  live: false,
  legs: [
    {
      id: 'test-leg',
      mode: 'tram',
      line: '4',
      direction: 'Biskupin',
      fromStop: 'Żółkiewskiego',
      toStop: 'Dworzec Główny',
      fromStopId: 'a',
      toStopId: 'c',
      tripId: 'tram-4',
      departAt: '23:55',
      arriveAt: '00:20',
      stopsCount: 3,
      live: false,
    },
  ],
};

const journey = createSharedConnection(connection, 'wroclaw', new Date('2026-10-19T21:00:00Z'));
console.log(buildShareUrl(journey, 'pl'));
