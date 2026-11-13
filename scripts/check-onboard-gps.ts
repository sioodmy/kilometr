import { OnboardEstimator, onboardStops, type OnboardFix } from '../src/services/onboardGps';
import { buildTrainTrack, matchOnTrack } from '../src/services/trainTrack';
import { locateLiveStopPosition } from '../src/services/vehiclePosition';
import { projectPointToPolyline } from '../src/gtfs/geo';
import type { Leg, LegStop } from '../src/types/models';

// Scenariusz jak IC 6130: stacje co ~30 km, opóźnienie rośnie w trasie.
// Estymator ma wykryć przejazdy stacji z GPS i policzyć z nich opóźnienie,
// którego feed PKP nie daje (pociąg „stoi" na stacji początkowej).

function mkStops(): LegStop[] {
  // 1 stopień szerokości ≈ 111 km; stacje co ~0.3 stopnia (33 km).
  const names = ['Wrocław Główny', 'Opole Główne', 'Gliwice', 'Katowice', 'Kraków Główny'];
  return names.map((name, i) => ({
    stopId: `s${i}`,
    name,
    lat: 50.05 + i * 0.3,
    lon: 19.0 + i * 0.2,
    seq: i + 1,
    arriveSec: 36000 + i * 1800,
    departSec: 36000 + i * 1800 + (i === 0 || i === 4 ? 0 : 120),
  }));
}

const stops = mkStops();
const leg: Leg = {
  id: 'ic-6130',
  mode: 'train',
  line: 'IC 6130',
  fromStop: stops[0].name,
  toStop: stops[stops.length - 1].name,
  departAt: '10:00',
  arriveAt: '12:00',
  scheduledDepartureSec: 36000,
  scheduledArrivalSec: 43200,
  stopsCount: stops.length,
  live: false,
  tripId: 'trip-ic-6130',
  fromStopId: stops[0].stopId,
  toStopId: stops[stops.length - 1].stopId,
  intermediateStops: stops,
};

function fixAtStop(stop: LegStop, atMs: number, speed = 8): OnboardFix {
  return { lat: stop.lat!, lon: stop.lon!, accuracy: 15, speed, heading: 60, timestamp: atMs };
}

function fixBetween(a: LegStop, b: LegStop, atMs: number, speed = 40): OnboardFix {
  return {
    lat: (a.lat! + b.lat!) / 2,
    lon: (a.lon! + b.lon!) / 2,
    accuracy: 20,
    speed,
    heading: 70,
    timestamp: atMs,
  };
}

const base = new Date();
base.setHours(0, 0, 0, 0);
const at = (sec: number) => base.getTime() + sec * 1000;

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (oczekiwane ${expected})`}`);
}

function expectNear(label: string, actual: number, expected: number, tol: number): void {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (oczekiwane ~${expected})`}`);
}

const estimator = new OnboardEstimator();

// 1. Pasażer na peronie przed odjazdem: opóźnienia jeszcze nie znamy.
let e = estimator.observe(leg, onboardStops(leg), fixAtStop(stops[0], at(35960), 0), at(35960));
expect('na peronie przed odjazdem: brak opóźnienia', e?.delaySec, null);

// 2. Odjazd 4 min spóźniony: pomiar przy stacji startowej po planowym odjeździe.
e = estimator.observe(leg, onboardStops(leg), fixAtStop(stops[0], at(36240), 0), at(36240));
expect('odjazd +4 min: opóźnienie 240 s', e?.delaySec, 240);

// 3. Między stacjami: GPS nie trafia w promień żadnej stacji, ale opóźnienie
//    z ostatniego przejazdu wciąż obowiązuje.
e = estimator.observe(leg, onboardStops(leg), fixBetween(stops[0], stops[1], at(36900)), at(36900));
expect('między stacjami: opóźnienie z ostatniego pomiaru', e?.delaySec, 240);

// 4. Opole przejechane 10 min po planie: opóźnienie rośnie do 600 s.
e = estimator.observe(leg, onboardStops(leg), fixAtStop(stops[1], at(38400)), at(38400));
expect('Opole +10 min: opóźnienie 600 s', e?.delaySec, 600);

// 5. Szum GPS z powrotem przy stacji startowej nie cofa opóźnienia.
e = estimator.observe(leg, onboardStops(leg), fixAtStop(stops[0], at(38000), 30), at(38000));
expect('szum z powrotem do startu: opóźnienie 600 s', e?.delaySec, 600);

// 6. Pomiar starszy niż 30 s jest odrzucany.
e = estimator.observe(leg, onboardStops(leg), fixAtStop(stops[2], at(39600)), at(39600 + 60_000));
expect('stary pomiar: null', e, null);

// 7. Poza oknem nogi (półtorej godziny po planowym przyjeździe) - brak estymacji.
e = estimator.observe(leg, onboardStops(leg), fixAtStop(stops[4], at(48600)), at(48600));
expect('po oknie nogi: null', e, null);

// 8. Przejazd stacji ponad 1,5 h po planie nie zalicza się (to nie nasz
//    pociąg, tylko np. autobus obok toru).
const fresh = new OnboardEstimator();
e = fresh.observe(leg, onboardStops(leg), fixAtStop(stops[2], at(39600 + 5460)), at(39600 + 5460));
expect('przejazd 1,5 h po planie: brak opóźnienia', e?.delaySec, null);

// 9. Zmiana nogi (przesiadka) resetuje przejazdy stacji: na peronie nowego
//    kursu przed odjazdem nie ma co liczyć, choć stara noga miała opóźnienie.
const stops2 = stops.map((s, i) => ({ ...s, arriveSec: 43200 + i * 1800, departSec: 43200 + i * 1800 }));
const leg2 = {
  ...leg,
  id: 'km-4412',
  tripId: 'trip-km-4412',
  departAt: '12:00',
  arriveAt: '14:00',
  scheduledDepartureSec: 43200,
  scheduledArrivalSec: 50400,
  intermediateStops: stops2,
};
e = estimator.observe(leg2, onboardStops(leg2), fixAtStop(stops2[0], at(43140), 0), at(43140));
expect('nowa noga na peronie: brak opóźnienia', e?.delaySec, null);

// ─── Dopasowanie po geometrii toru między stacjami ───────────────────────────
// Tor z zakolami: prosta między stacjami omija łuk o kilkanaście km,
// więc pomiar na łuku dopasuje wyłącznie oś toru.

const trackStops: LegStop[] = [
  { stopId: 't0', name: 'Alpha', lat: 50.0, lon: 19.0, seq: 1, arriveSec: 36000, departSec: 36000 },
  { stopId: 't1', name: 'Beta', lat: 50.3, lon: 19.0, seq: 2, arriveSec: 37800, departSec: 37920 },
  { stopId: 't2', name: 'Gamma', lat: 50.6, lon: 19.0, seq: 3, arriveSec: 39600, departSec: 39720 },
];
const bend0 = { lat: 50.15, lon: 19.2 };
const bend1 = { lat: 50.45, lon: 19.2 };
const trackShape = [
  { lat: trackStops[0].lat!, lon: trackStops[0].lon! },
  bend0,
  { lat: trackStops[1].lat!, lon: trackStops[1].lon! },
  bend1,
  { lat: trackStops[2].lat!, lon: trackStops[2].lon! },
];
const trackLeg: Leg = {
  ...leg,
  id: 'geo-1',
  tripId: 'trip-geo-1',
  fromStopId: 't0',
  toStopId: 't2',
  fromStop: 'Alpha',
  toStop: 'Gamma',
  departAt: '10:00',
  arriveAt: '11:00',
  intermediateStops: trackStops,
};

const track = buildTrainTrack(trackShape, trackStops, { start: 0, end: 2 });
expect('tor zbudowany', track !== null, true);
expect(
  'stacja wysiadania na końcu osi',
  track != null && Math.abs(track.anchorsM[2] - track.totalM) < 1,
  true,
);
expect(
  'prosta między stacjami nie zna łuku',
  projectPointToPolyline(bend0.lat, bend0.lon, [
    { lat: trackStops[0].lat!, lon: trackStops[0].lon! },
    { lat: trackStops[1].lat!, lon: trackStops[1].lon! },
  ]).distanceMeters > 5000,
  true,
);

const m = track ? matchOnTrack(track, { start: 0, end: 2 }, bend0.lat, bend0.lon, 120) : null;
expect('pomiar na łuku: odcinek 0', m?.gap, 0);
expectNear('pomiar na łuku: połowa odcinka', m?.progress ?? -1, 0.5, 0.01);
expect('pomiar na łuku: przy osi toru', (m?.offsetM ?? 1e9) < 5, true);

// 10. Opóźnienie interpolowane z osi toru: pociąg w połowie odcinka
//     5 min po planowym przejściu tego punktu, więc jest ~5 min po czasie.
const geo = new OnboardEstimator();
e = geo.observe(trackLeg, trackStops, fixAtStop(trackStops[0], at(36240), 0), at(36240), track);
expect('odjazd +4 min: opóźnienie 240 s', e?.delaySec, 240);
const fixAtBend = (ts: number) => ({
  lat: bend0.lat,
  lon: bend0.lon,
  accuracy: 20,
  speed: 40,
  heading: 40,
  timestamp: ts,
});
e = geo.observe(trackLeg, trackStops, fixAtBend(at(37200)), at(37200), track);
expectNear('łuk w połowie odcinka: opóźnienie ~300 s', e?.delaySec ?? -1, 300, 2);

// 11. Beta przejechana, potem szum z powrotem na łuk za Betą: interpolacja
//     nie cofa opóźnienia (pociąg nie cofa się w trasie).
e = geo.observe(trackLeg, trackStops, fixAtStop(trackStops[1], at(38400)), at(38400), track);
expect('Beta +10 min: opóźnienie 600 s', e?.delaySec, 600);
e = geo.observe(trackLeg, trackStops, fixAtBend(at(38500)), at(38500), track);
expect('szum za zaliczoną stacją: opóźnienie 600 s', e?.delaySec, 600);

// 12. Pomiar daleko od osi toru (droga obok toru): interpolacja milczy,
//     zostaje opóźnienie z przejazdu stacji.
e = geo.observe(
  trackLeg,
  trackStops,
  { lat: 50.15, lon: 19.05, accuracy: 20, speed: 40, heading: 40, timestamp: at(38600) },
  at(38600),
  track,
);
expect('pomiar z dala od toru: opóźnienie 600 s', e?.delaySec, 600);

// 13. Marker między stacjami: bez toru prowadzi go szacunek z rozkładu
//     (spóźniony pociąg "powinien" być już za Betą), z torem telefon.
const deviceAtBend = {
  lat: bend0.lat,
  lon: bend0.lon,
  accuracy: 20,
  speed: 40,
  heading: 40,
  timestamp: at(39000),
};
let pos = locateLiveStopPosition(trackStops, trackLeg, null, deviceAtBend, at(39000));
expect('bez toru: szacunek z rozkładu', pos?.source, 'estimate');
expect('bez toru: marker na odcinku 1', pos?.marker?.index, 1);
expect('bez toru: między przystankami', pos?.marker?.placement, 'between');
pos = locateLiveStopPosition(trackStops, trackLeg, null, deviceAtBend, at(39000), undefined, undefined, track);
expect('z torem: pomiar telefonu', pos?.source, 'device');
expect('z torem: marker na odcinku 0', pos?.marker?.index, 0);
expect('z torem: między przystankami', pos?.marker?.placement, 'between');

if (failures > 0) {
  console.error(`check-onboard-gps: ${failures} asercji nie przeszło`);
  process.exit(1);
}
console.log('check-onboard-gps: ok');
