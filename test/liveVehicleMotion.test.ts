import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { LIVE_VEHICLE_MOTION_SCRIPT } from '../src/map/liveVehicleMotion';
import { buildLiveVehiclesMapDocument } from '../src/map/liveVehiclesMapDocument';

interface RenderedItem {
  id: string;
  lat: number;
  lon: number;
  bearing?: number;
  isSel: boolean;
}

interface MotionController {
  ingest: (
    vehicles: Array<{
      id: string;
      line: string;
      mode: string;
      bg: string;
      fg: string;
      lat: number;
      lon: number;
      bearing?: number;
      bearingExact?: boolean;
      delaySec: number | null;
      updatedAt?: number;
    }>,
    nowMs: number,
  ) => void;
  stepFrame: (
    nowMs: number,
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null,
    selectedId: string | null,
  ) => { items: RenderedItem[]; animating: boolean };
  setIntersections: (pts: Array<{ lat: number; lon: number }>) => number;
  extractIntersectionsFromGeoFeatures: (features: unknown[]) => Array<{ lat: number; lon: number }>;
  getIntersectionCount: () => number;
}

function createController(): MotionController {
  const factory = vm.runInNewContext(
    `${LIVE_VEHICLE_MOTION_SCRIPT}; createVehicleMotionController;`,
  ) as () => MotionController;
  return factory();
}

function makeVehicle(overrides: Partial<{
  id: string;
  line: string;
  lat: number;
  lon: number;
  bearing: number;
  bearingExact: boolean;
  updatedAt: number;
}> = {}) {
  return {
    id: overrides.id ?? '10-1',
    line: overrides.line ?? '10',
    mode: 'tram' as const,
    bg: '#1565C0',
    fg: '#FFFFFF',
    lat: overrides.lat ?? 51.11,
    lon: overrides.lon ?? 17.03,
    bearing: overrides.bearing,
    bearingExact: overrides.bearingExact,
    delaySec: 0,
    updatedAt: overrides.updatedAt ?? 1000,
  };
}

test('interpolacja plynnie przesuwa pojazd miedzy probkami bez przekraczania celu', () => {
  const ctrl = createController();
  const v0 = makeVehicle({ lat: 51.11, lon: 17.03, bearing: 0, updatedAt: 10_000 });
  ctrl.ingest([v0], 10_000);

  const frame0 = ctrl.stepFrame(10_000, null, null);
  assert.equal(frame0.animating, false);
  assert.equal(frame0.items[0].lat, 51.11);

  const v1 = makeVehicle({ lat: 51.1105, lon: 17.03, bearing: 0, updatedAt: 15_000 });
  ctrl.ingest([v1], 15_000);

  const fStart = ctrl.stepFrame(15_000, null, null);
  const fMid = ctrl.stepFrame(17_400, null, null);
  const fEnd = ctrl.stepFrame(20_000, null, null);

  assert.equal(fStart.animating, true);
  assert.equal(fMid.animating, true);
  assert.equal(fEnd.animating, false);
  assert.ok(fMid.items[0].lat > fStart.items[0].lat && fMid.items[0].lat < v1.lat);
  assert.equal(fEnd.items[0].lat, v1.lat);
});

test('ponowne podanie tej samej probki nie resetuje aktywnej animacji', () => {
  const ctrl = createController();
  ctrl.ingest([makeVehicle({ lat: 51.11, lon: 17.03, bearing: 0, updatedAt: 10_000 })], 10_000);
  ctrl.ingest([makeVehicle({ lat: 51.1105, lon: 17.03, bearing: 0, updatedAt: 15_000 })], 15_000);

  const before = ctrl.stepFrame(17_400, null, null).items[0].lat;
  ctrl.ingest([makeVehicle({ lat: 51.1105, lon: 17.03, bearing: 0, updatedAt: 15_000 })], 17_400);
  const after = ctrl.stepFrame(17_450, null, null).items[0].lat;

  assert.ok(after >= before);
  assert.ok(after < 51.1105);
});

test('tlumi drobne cofanie GPS w tyl wzdluz kierunku jazdy', () => {
  const ctrl = createController();
  ctrl.ingest([makeVehicle({ lat: 51.11, lon: 17.03, bearing: 0, updatedAt: 10_000 })], 10_000);
  ctrl.ingest([makeVehicle({ lat: 51.1105, lon: 17.03, bearing: 0, updatedAt: 15_000 })], 15_000);
  ctrl.stepFrame(20_000, null, null);

  ctrl.ingest([makeVehicle({ lat: 51.1104, lon: 17.03, bearing: 0, updatedAt: 20_000 })], 20_000);
  const fHold = ctrl.stepFrame(22_000, null, null);
  assert.equal(fHold.animating, false);
  assert.equal(fHold.items[0].lat, 51.1105);
});

test('pozwala na nawrot na petli przy zmianie kierunku > 125 stopni i ruchu >= 18m', () => {
  const ctrl = createController();
  ctrl.ingest([makeVehicle({ lat: 51.11, lon: 17.03, bearing: 0, updatedAt: 10_000 })], 10_000);
  ctrl.ingest([makeVehicle({ lat: 51.1105, lon: 17.03, bearing: 180, updatedAt: 15_000 })], 15_000);
  ctrl.stepFrame(20_000, null, null);

  ctrl.ingest([makeVehicle({ lat: 51.11025, lon: 17.03, bearing: 180, updatedAt: 20_000 })], 20_000);
  const fTurn = ctrl.stepFrame(22_000, null, null);
  assert.equal(fTurn.animating, true);
  assert.ok(fTurn.items[0].lat < 51.1105 && fTurn.items[0].lat > 51.11025);
});

test('wykrywa skrzyzowania drog i torowisk z warstw wektorowych oraz ignoruje proste podzialy kafelkow', () => {
  const ctrl = createController();
  const features = [
    {
      layer: { id: 'drogi-glowna' },
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [17.029, 51.11],
          [17.03, 51.11],
          [17.031, 51.11],
        ],
      },
    },
    {
      layer: { id: 'drogi-drobne' },
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [17.03, 51.109],
          [17.03, 51.11],
          [17.03, 51.111],
        ],
      },
    },
    {
      layer: { id: 'drogi-glowna' },
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [17.039, 51.11],
          [17.04, 51.11],
          [17.041, 51.11],
        ],
      },
    },
    {
      layer: { id: 'szyny' },
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [17.05, 51.1095],
          [17.05, 51.11],
          [17.05, 51.1105],
        ],
      },
    },
    {
      layer: { id: 'drogi-drobne' },
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [17.0495, 51.11],
          [17.05, 51.11],
          [17.0505, 51.11],
        ],
      },
    },
  ];

  const ix = ctrl.extractIntersectionsFromGeoFeatures(features);
  assert.equal(ix.length, 2);
});

test('przy wolnym przejezdzie przez skrzyzowanie pojazd zatrzymuje sie przed nim na chwile i nie cofa sie', () => {
  const ctrl = createController();
  ctrl.setIntersections([{ lat: 51.11015, lon: 17.03 }]);

  ctrl.ingest([makeVehicle({ lat: 51.11, lon: 17.03, bearing: 0, updatedAt: 10_000 })], 10_000);
  ctrl.ingest([makeVehicle({ lat: 51.110225, lon: 17.03, bearing: 0, updatedAt: 15_000 })], 15_000);

  const lats: number[] = [];
  for (let ms = 15_000; ms <= 20_000; ms += 200) {
    const f = ctrl.stepFrame(ms, null, null);
    lats.push(f.items[0].lat);
  }

  for (let i = 1; i < lats.length; i++) {
    assert.ok(lats[i] >= lats[i - 1], `pozycja nie moze sie cofac w kroku ${i}`);
  }

  let identicalPauseFrames = 0;
  for (let i = 2; i < lats.length - 2; i++) {
    if (Math.abs(lats[i] - lats[i - 1]) < 1e-10) identicalPauseFrames++;
  }
  assert.ok(identicalPauseFrames >= 3, 'pojazd powinien zatrzymac sie przed skrzyzowaniem');
});

test('przy szybkim przejezdzie przez skrzyzowanie (zielone swiatlo) pojazd jedzie plynnie bez postoju', () => {
  const ctrl = createController();
  ctrl.setIntersections([{ lat: 51.11025, lon: 17.03 }]);

  ctrl.ingest([makeVehicle({ lat: 51.11, lon: 17.03, bearing: 0, updatedAt: 10_000 })], 10_000);
  ctrl.ingest([makeVehicle({ lat: 51.1105, lon: 17.03, bearing: 0, updatedAt: 15_000 })], 15_000);

  const lats: number[] = [];
  for (let ms = 15_000; ms <= 19_600; ms += 200) {
    lats.push(ctrl.stepFrame(ms, null, null).items[0].lat);
  }

  for (let i = 1; i < lats.length; i++) {
    assert.ok(lats[i] > lats[i - 1], `szybki przejazd powinien byc plynny w kroku ${i}`);
  }
});

test('stepFrame filtruje pojazdy do widocznego viewportu, ale zachowuje wybrany pojazd', () => {
  const ctrl = createController();
  ctrl.ingest(
    [
      makeVehicle({ id: 'in-view', lat: 51.11, lon: 17.03, updatedAt: 10_000 }),
      makeVehicle({ id: 'selected-out', lat: 51.2, lon: 17.2, updatedAt: 10_000 }),
      makeVehicle({ id: 'hidden-out', lat: 51.25, lon: 17.25, updatedAt: 10_000 }),
    ],
    10_000,
  );
  ctrl.ingest(
    [
      makeVehicle({ id: 'in-view', lat: 51.11, lon: 17.03, updatedAt: 15_000 }),
      makeVehicle({ id: 'selected-out', lat: 51.2, lon: 17.2, updatedAt: 15_000 }),
      makeVehicle({ id: 'hidden-out', lat: 51.2505, lon: 17.25, updatedAt: 15_000 }),
    ],
    15_000,
  );

  const bounds = { minLat: 51.1, maxLat: 51.12, minLon: 17.02, maxLon: 17.04 };
  const frame = ctrl.stepFrame(17_000, bounds, 'selected-out');

  assert.deepEqual(
    Array.from(frame.items, (x) => x.id),
    ['in-view', 'selected-out'],
  );
  assert.equal(frame.animating, false);
});

test('buildLiveVehiclesMapDocument osadza skrypt ruchu, warstwy trasy pojazdu i ikony przewoznikow', () => {
  const html = buildLiveVehiclesMapDocument({
    center: [17.0385, 51.1079],
    vehicles: [makeVehicle()],
    stops: [],
    selectedId: null,
    selectedStopId: null,
    selectedRoute: {
      color: '#1565C0',
      coords: [
        [51.11, 17.03],
        [51.112, 17.035],
      ],
      stops: [
        { id: 'S1', name: 'Start', lat: 51.11, lon: 17.03, passed: true, isNext: false },
        { id: 'S2', name: 'Koniec', lat: 51.112, lon: 17.035, passed: false, isNext: true },
      ],
    },
    userPos: null,
  });
  assert.ok(html.includes('createVehicleMotionController'));
  assert.ok(html.includes('paddedViewportBounds'));
  assert.ok(html.includes('live-selected-route-line'));
  assert.ok(html.includes('live-selected-stop'));
  assert.ok(html.includes('drawOrbitDirectionArrow'));
  assert.ok(html.includes('RAIL_SPECS'));
});

test('dokladny kierunek z geometrii (bearingExact) aktualizuje stojacy pojazd i utrzymuje zakret', () => {
  const ctrl = createController();
  ctrl.ingest([makeVehicle({ id: 'IC-100', lat: 51.11, lon: 17.03, bearing: 90, updatedAt: 10_000 })], 10_000);
  // Asynchronicznie doczytany shape PLK z ta sama probka powinien poprawic kierunek bez ruchu
  ctrl.ingest([makeVehicle({ id: 'IC-100', lat: 51.11, lon: 17.03, bearing: 42, bearingExact: true, updatedAt: 10_000 })], 10_200);
  const fIdle = ctrl.stepFrame(10_200, null, null);
  assert.equal(fIdle.animating, false);
  assert.equal(fIdle.items[0].bearing, 42);

  // Na ciasnym luku (> 100 deg wzgledem cieciwy) bearingExact nie powinien byc nadpisany przez moveB
  ctrl.ingest([makeVehicle({ id: 'IC-100', lat: 51.1103, lon: 17.0303, bearing: 175, bearingExact: true, updatedAt: 15_000 })], 15_000);
  const fCurve = ctrl.stepFrame(20_000, null, null);
  assert.equal(fCurve.items[0].bearing, 175);
});
