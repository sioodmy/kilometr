import { navigationTarget } from '../src/services/navigationTarget';
import { nextGuidance, type LegSpan } from '../src/services/turnManeuver';
import type { Coord } from '../src/services/routeGeometry';
import type { MapLeg } from '../src/map/types';
import type { Connection, Leg } from '../src/types/models';

function leg(id: string, mode: Leg['mode'], from: string, to: string, departAt: string, arriveAt: string): Leg {
  return {
    id,
    mode,
    fromStop: from,
    toStop: to,
    departAt,
    arriveAt,
    stopsCount: 0,
    live: false,
  };
}

function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL ${name}`);
  console.log(`PASS ${name}`);
}

const first = leg('bus-1', 'bus', 'Start', 'Transfer', '14:00', '14:40');
const second = leg('tram-2', 'tram', 'Transfer', 'End', '15:00', '15:25');
const connection = { legs: [first, second] } as Connection;
const departure = new Date(2026, 0, 1, 14, 0).getTime();

check(
  'points to first stop before departure',
  navigationTarget(connection, [first, second], departure, departure - 10 * 60000, null)?.leg.id === 'bus-1',
);
check(
  'keeps first stop during the boarding grace period',
  navigationTarget(connection, [first, second], departure, departure + 4 * 60000, null)?.leg.id === 'bus-1',
);
check(
  'switches to transfer stop after departure',
  navigationTarget(connection, [first, second], departure, departure + 8 * 60000, null)?.leg.id === 'tram-2',
);
check(
  'switches to transfer stop while riding',
  navigationTarget(connection, [first, second], departure, departure + 10 * 60000, 7)?.leg.id === 'tram-2',
);
check(
  'last leg points to its arrival stop while riding',
  navigationTarget(connection, [first, second], departure, departure + 70 * 60000, 7)?.end === true,
);

const overnightStart = new Date(2026, 0, 1, 23, 55).getTime();
const nightLeg = leg('night-1', 'train', 'Start', 'Transfer', '23:55', '00:25');
const morningLeg = leg('morning-2', 'bus', 'Transfer', 'End', '00:35', '01:00');
const overnight = { legs: [nightLeg, morningLeg] } as Connection;
check(
  'keeps the transfer time order across midnight',
  navigationTarget(
    overnight,
    [nightLeg, morningLeg],
    overnightStart,
    new Date(2026, 0, 2, 0, 10).getTime(),
    7,
  )?.leg.id === 'morning-2',
);

const walk = leg('walk-only', 'walk', 'Origin', 'Destination', '14:00', '14:20');
check(
  'walk-only connections target the destination',
  navigationTarget({ legs: [walk] }, [], departure, departure, null)?.end === true,
);

const footLeg: MapLeg = {
  id: 'widget-walk',
  mode: 'walk',
  color: '#777777',
  fromStop: 'GPS',
  toStop: 'Transfer',
  departAt: '',
  arriveAt: '',
  stopsCount: 0,
  live: false,
  approx: false,
  stops: [],
};
const footPath: Coord[] = [
  [51.1, 17.0],
  [51.101, 17.0],
  [51.101, 17.001],
  [51.102, 17.001],
];
const footSpans: LegSpan[] = [{ leg: footLeg, start: 0, end: footPath.length - 1 }];
for (const user of [footPath[0], [51.1005, 17] as Coord, footPath[2], footPath[3]]) {
  const instruction = nextGuidance(footPath, footSpans, user);
  check(
    'walking directions never instruct boarding or alighting',
    instruction != null && instruction.maneuver.kind !== 'board' && instruction.maneuver.kind !== 'alight',
  );
}
