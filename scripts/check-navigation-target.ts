import {
  navigationTarget,
  navigationTimeline,
  rideNavigation,
} from '../src/services/navigationTarget';
import {
  matchOnPath,
  nextGuidance,
  nextGuidanceAfter,
  slicePathFromProjection,
  type LegSpan,
} from '../src/services/turnManeuver';
import { createLocationFilterState, filterLocationFix } from '../src/services/locationFilter';
import type { Coord } from '../src/services/routeGeometry';
import type { MapLeg } from '../src/map/types';
import type { Connection, Leg, VehiclePosition } from '../src/types/models';

function leg(
  id: string,
  mode: Leg['mode'],
  from: string,
  to: string,
  departAt: string,
  arriveAt: string,
): Leg {
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
const connection = { legs: [first, second], delayMin: 0 } as Connection;
const departure = new Date(2026, 0, 1, 14, 0).getTime();

check(
  'points to first stop before departure',
  navigationTarget(connection, departure, departure - 10 * 60000)?.leg.id === 'bus-1',
);
check(
  'keeps first stop during the boarding grace period',
  navigationTarget(connection, departure, departure + 30_000)?.phase === 'waiting',
);
check(
  'shows the current ride instead of walking directions to the transfer',
  navigationTarget(connection, departure, departure + 8 * 60000)?.leg.id === 'bus-1' &&
    navigationTarget(connection, departure, departure + 8 * 60000)?.phase === 'riding',
);
check(
  'walks to the transfer only after the first ride ends',
  navigationTarget(connection, departure, departure + 40 * 60000)?.leg.id === 'tram-2' &&
    navigationTarget(connection, departure, departure + 40 * 60000)?.phase === 'transfer',
);
check(
  'last leg points to its arrival stop while riding',
  navigationTarget(connection, departure, departure + 70 * 60000)?.end === true,
);

const overnightStart = new Date(2026, 0, 1, 23, 55).getTime();
const nightLeg = leg('night-1', 'train', 'Start', 'Transfer', '23:55', '00:25');
const morningLeg = leg('morning-2', 'bus', 'Transfer', 'End', '00:35', '01:00');
const overnight = { legs: [nightLeg, morningLeg] } as Connection;
check(
  'keeps the transfer time order across midnight',
  navigationTarget(overnight, overnightStart, new Date(2026, 0, 2, 0, 10).getTime())?.leg.id ===
    'night-1',
);

const walk = leg('walk-only', 'walk', 'Origin', 'Destination', '14:00', '14:20');
check(
  'walk-only connections target the destination',
  navigationTarget({ legs: [walk], delayMin: 0 }, departure, departure)?.end === true,
);

check(
  'empty journey has no target',
  navigationTarget({ legs: [], delayMin: 0 }, departure, departure) === null,
);
check(
  'journey ends after the final ride',
  navigationTarget(connection, departure, departure + 86 * 60000)?.phase === 'arrived',
);
const finalWalk = leg('final-walk', 'walk', 'End', 'Destination', '15:25', '15:35');
check(
  'navigates the final walk',
  navigationTarget(
    { ...connection, legs: [first, second, finalWalk] },
    departure,
    departure + 90 * 60000,
  )?.phase === 'egress',
);
check(
  'overnight transfer starts after alighting',
  navigationTarget(overnight, overnightStart, new Date(2026, 0, 2, 0, 28).getTime())?.phase ===
    'transfer',
);
check(
  'overnight final ride stays on the correct day',
  navigationTarget(overnight, overnightStart, new Date(2026, 0, 2, 0, 40).getTime())?.leg.id ===
    'morning-2',
);
const approach = leg('approach', 'walk', 'Home', 'Start', '13:55', '14:00');
check(
  'first walking leg is before boarding',
  navigationTimeline({ legs: [approach, first] }, departure)[0].departMs === departure - 5 * 60000,
);

const gpsLeg: Leg = {
  ...first,
  tripId: 'trip-4',
  line: '4',
  mode: 'tram',
  stopsCount: 2,
  fromLat: 51.1,
  fromLon: 17.0,
  toLat: 51.12,
  toLon: 17.0,
  intermediateStops: [
    { stopId: 'a', name: 'Start', seq: 1, lat: 51.1, lon: 17.0 },
    { stopId: 'b', name: 'Middle', seq: 2, lat: 51.11, lon: 17.0 },
    { stopId: 'c', name: 'Transfer', seq: 3, lat: 51.12, lon: 17.0 },
  ],
};
const gpsConnection = { ...connection, legs: [gpsLeg, second] };
const rideNow = departure + 10 * 60000;
const riding = navigationTarget(gpsConnection, departure, rideNow)!;
const vehicle: VehiclePosition = {
  vehicleId: 'tram-4-1',
  matchedTripId: 'trip-4',
  line: '4',
  lat: 51.105,
  lon: 17.0001,
  updatedAt: rideNow,
  delaySec: null,
};
const gps = rideNavigation(riding, rideNow, [vehicle]);
check(
  'vehicle marker uses exact GPS coordinates',
  gps.position?.[0] === vehicle.lat && gps.position[1] === vehicle.lon,
);
check(
  'GPS determines next stop and remaining stops',
  gps.nextStop === 'Middle' && gps.stopsLeft === 2,
);
check(
  'schedule alone never creates a vehicle marker',
  rideNavigation(riding, rideNow, []).position === null,
);
check(
  'schedule alone never creates a next stop',
  rideNavigation(riding, rideNow, []).nextStop === null,
);
check(
  'wrong trip on the same line is rejected',
  rideNavigation(riding, rideNow, [{ ...vehicle, matchedTripId: 'other' }]).position === null,
);
check(
  'unmatched vehicle is rejected',
  rideNavigation(riding, rideNow, [{ ...vehicle, matchedTripId: undefined }]).position === null,
);
check(
  'wrong line is rejected',
  rideNavigation(riding, rideNow, [{ ...vehicle, line: '10' }]).position === null,
);
check(
  'stale GPS is rejected',
  rideNavigation(riding, rideNow, [{ ...vehicle, updatedAt: rideNow - 120_001 }]).position === null,
);
check(
  'future GPS is rejected',
  rideNavigation(riding, rideNow, [{ ...vehicle, updatedAt: rideNow + 1 }]).position === null,
);
check(
  'invalid GPS is rejected',
  rideNavigation(riding, rideNow, [{ ...vehicle, lat: NaN }]).position === null,
);
check(
  'GPS does not move with elapsed schedule time',
  rideNavigation(riding, rideNow + 60_000, [vehicle]).position?.[0] === vehicle.lat,
);
check(
  'missing GPS does not invent remaining stops',
  rideNavigation(riding, rideNow, []).stopsLeft === null,
);
const delayedNow = departure + 42 * 60000;
check(
  'fresh GPS keeps a late ride active',
  navigationTarget(gpsConnection, departure, delayedNow, {
    vehicles: [{ ...vehicle, updatedAt: delayedNow }],
    previous: riding,
  })?.leg.id === gpsLeg.id,
);
const earlyTransfer = navigationTarget(gpsConnection, departure, departure + 39 * 60000, {
  previous: riding,
  location: {
    lat: gpsLeg.toLat!,
    lon: gpsLeg.toLon!,
    timestamp: departure + 39 * 60000,
    accuracy: 8,
    speed: 0,
    heading: null,
  },
});
check(
  'GPS at alighting stop starts the transfer',
  earlyTransfer?.phase === 'transfer' && earlyTransfer.leg.id === second.id,
);
check(
  'staying at the boarding stop does not start walking to the transfer',
  navigationTarget(gpsConnection, departure, rideNow, {
    location: {
      lat: gpsLeg.fromLat!,
      lon: gpsLeg.fromLon!,
      timestamp: rideNow,
      accuracy: 8,
      speed: 0,
      heading: null,
    },
  })?.phase === 'waiting',
);
check(
  'device GPS can keep a late ride active without inventing a vehicle marker',
  navigationTarget(gpsConnection, departure, delayedNow, {
    previous: riding,
    location: { lat: 51.105, lon: 17.0, timestamp: delayedNow, accuracy: 8, speed: 6, heading: 0 },
  })?.phase === 'riding' && rideNavigation(riding, delayedNow, []).position === null,
);
check(
  'transfer cannot regress to the previous ride',
  navigationTarget(gpsConnection, departure, departure + 39 * 60000, { previous: earlyTransfer })
    ?.leg.id === second.id,
);
check(
  'late departure stays in approach phase',
  navigationTarget(gpsConnection, departure, departure + 2 * 60000, {
    vehicles: [{ ...vehicle, updatedAt: departure + 2 * 60000, delaySec: 300 }],
  })?.phase === 'approach',
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
    instruction != null &&
      instruction.maneuver.kind !== 'board' &&
      instruction.maneuver.kind !== 'alight',
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
check(
  'map matching snaps user onto the route segment',
  m1 != null && Math.abs(m1.snappedPoint[1] - 17.0) < 1e-6,
);

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
