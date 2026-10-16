import { navigationTarget } from '../src/services/navigationTarget';
import {
  matchOnPath,
  nextGuidance,
  nextGuidanceAfter,
  slicePathFromProjection,
  type LegSpan,
} from '../src/services/turnManeuver';
import {
  createLocationFilterState,
  filterLocationFix,
} from '../src/services/locationFilter';
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

// Pierwszy zakręt na końcu pierwszego odcinka (footPath[1]) nie jest pomijany.
const startGuidance = nextGuidance(footPath, footSpans, footPath[0]);
check(
  'first turn at end of current segment is reported',
  startGuidance?.maneuver.kind === 'right' && startGuidance.maneuver.distanceM > 90,
);

// Zakręt pozostaje widoczny również 13 m przed skrzyżowaniem (nie znika 25 m przed rogiem).
const nearCornerGuidance = nextGuidance(footPath, footSpans, [51.10088, 17.0]);
check(
  'turn instruction stays active within 25 m of the corner',
  nearCornerGuidance?.maneuver.kind === 'right' &&
    nearCornerGuidance.maneuver.distanceM > 10 &&
    nearCornerGuidance.maneuver.distanceM < 20,
);

// nextGuidanceAfter zwraca KOLEJNY manewr (lewo na footPath[2]), a nie duplikat bieżącego.
const afterStart = nextGuidanceAfter(footPath, footSpans, footPath[0]);
check(
  'nextGuidanceAfter returns the subsequent turn after the active one',
  afterStart?.maneuver.kind === 'left' &&
    afterStart.maneuver.distanceM > (startGuidance?.maneuver.distanceM ?? 0) + 50,
);

// Testy stabilizacji lokalizacji (Kalman + anty-multipath + strefa martwa).
const filter = createLocationFilterState();
const f0 = filterLocationFix(filter, {
  lat: 51.1079,
  lon: 17.0385,
  accuracy: 8,
  speed: 1.2,
  heading: 90,
  timestamp: 1000,
});
check('first fix initializes location filter', f0 != null && Math.abs(f0.lat - 51.1079) < 1e-6);

// Pojedynczy skok o ~65 m w 1 s (odbicie od budynku) musi zostać odrzucony.
const fSpike = filterLocationFix(filter, {
  lat: 51.1085,
  lon: 17.0385,
  accuracy: 10,
  speed: 1.3,
  heading: 90,
  timestamp: 2000,
});
check(
  'single multipath GPS jump is rejected',
  fSpike != null && Math.abs(fSpike.lat - 51.1079) < 1e-5,
);

// Nagły spadek dokładności (np. stacja bazowa 80 m) jest ignorowany przy świeżym fixie GPS.
const fCoarse = filterLocationFix(filter, {
  lat: 51.109,
  lon: 17.04,
  accuracy: 80,
  speed: 0,
  heading: null,
  timestamp: 3000,
});
check(
  'coarse accuracy regression is ignored',
  fCoarse != null && Math.abs(fCoarse.lat - 51.1079) < 1e-5,
);

// W postoju (speed < 0.65 m/s) drobny szum +/-3 m jest silnie tłumiony, a heading z GPS wygaszany.
const fStationary = filterLocationFix(filter, {
  lat: 51.10793,
  lon: 17.03853,
  accuracy: 9,
  speed: 0.2,
  heading: 245,
  timestamp: 4000,
});
check(
  'stationary jitter is heavily damped',
  fStationary != null && Math.abs(fStationary.lat - 51.1079) < 0.00001,
);

// Przejście ze zgrubnego odczytu sieciowego (accuracy 60 m) na dokładny GPS (accuracy 10 m)
// oddalony o ~110 m natychmiast przestawia filtr na prawdziwą pozycję GPS.
const coarseSeedFilter = createLocationFilterState();
filterLocationFix(coarseSeedFilter, {
  lat: 51.1,
  lon: 17.0,
  accuracy: 60,
  speed: null,
  heading: null,
  timestamp: 1000,
});
const fPreciseReset = filterLocationFix(coarseSeedFilter, {
  lat: 51.101,
  lon: 17.0,
  accuracy: 10,
  speed: 1.2,
  heading: 0,
  timestamp: 5000,
});
check(
  'accurate GPS fix immediately replaces coarse network seed',
  fPreciseReset != null && Math.abs(fPreciseReset.lat - 51.101) < 1e-6,
);

// Marsz pieszego z speed: null (częste na Androidzie) wychodzi ze strefy martwej
// i wylicza kierunek ruchu (course-over-ground) bez magnetometru.
const walkNullSpeedFilter = createLocationFilterState();
filterLocationFix(walkNullSpeedFilter, {
  lat: 51.1,
  lon: 17.0,
  accuracy: 8,
  speed: null,
  heading: null,
  timestamp: 1000,
});
const fWalkStep = filterLocationFix(walkNullSpeedFilter, {
  lat: 51.10012,
  lon: 17.0,
  accuracy: 8,
  speed: null,
  heading: null,
  timestamp: 8000,
});
check(
  'walking with null speed tracks movement and derives heading',
  fWalkStep != null &&
    fWalkStep.lat > 51.10005 &&
    fWalkStep.heading != null &&
    (fWalkStep.heading < 15 || fWalkStep.heading > 345),
);

// Testy map-matchingu (monotoniczny postęp i przycięcie trasy przed użytkownikiem).
const m1 = matchOnPath(footPath, [51.1005, 17.00004], 0, 10, 0);
check('map matching snaps user onto the route segment', m1 != null && Math.abs(m1.snappedPoint[1] - 17.0) < 1e-6);

// Drobne cofnięcie GPS o ~5 m nie cofa licznika alongM.
const m2 = matchOnPath(footPath, [51.10045, 17.00003], m1!.alongM, 10, 0);
check(
  'monotonic clamp prevents backward distance bounce on GPS jitter',
  m2 != null && m2.alongM >= m1!.alongM,
);

const sliced = slicePathFromProjection(footPath, m2!);
check(
  'sliced path starts at snapped user position',
  sliced.length >= 2 &&
    Math.abs(sliced[0][0] - m2!.snappedPoint[0]) < 1e-7 &&
    Math.abs(sliced[0][1] - m2!.snappedPoint[1]) < 1e-7,
);
