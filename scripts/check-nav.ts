// Test na hoście: wyznaczanie manewrów na PRAWDZIWEJ geometrii OSRM.
// Odpala realne zapytania do routera pieszego i sprawdza, czy z surowej
// listy wierzchołków wychodzi sensowna kolejność skrętów i odległości.
//
//   npm run check:nav

import { findTurns, projectOnPath, distanceAlong, pathToIndex, buildRoutePath, nextGuidance } from '../src/services/turnManeuver';
import type { Coord } from '../src/services/routeGeometry';
import type { MapLeg } from '../src/map/types';

const FOOT = 'https://routing.openstreetmap.de/routed-foot';
const CAR = 'https://router.project-osrm.org';

async function fetchRoute(base: string, profile: string, pts: Coord[]): Promise<Coord[]> {
  const p = pts.map(([la, lo]) => `${lo.toFixed(6)},${la.toFixed(6)}`).join(';');
  const res = await fetch(`${base}/route/v1/${profile}/${p}?overview=full&geometries=geojson`);
  const body = (await res.json()) as any;
  if (body.code !== 'Ok') throw new Error(`OSRM ${body.code}`);
  return (body.routes[0].geometry.coordinates as [number, number][]).map(([lo, la]) => [la, lo] as Coord);
}

function dist(p: Coord, q: Coord): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = (q[0] - p[0]) * 111320;
  const dLon = (q[1] - p[1]) * 111320 * Math.cos(toRad((p[0] + q[0]) / 2));
  return Math.hypot(dLat, dLon);
}

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.log(`  FAIL ${label}${detail ? `: ${detail}` : ''}`);
    failures++;
  }
}

// ── 1. Prosta: skręt w prawo ──────────────────────────────────
async function testRightTurn() {
  console.log('\n[1] Skręt w prawo (Wrocław, ul. Świdnicka -> Podwale)');
  const coords = await fetchRoute(FOOT, 'foot', [
    [51.1055, 17.0310],
    [51.1045, 17.0320],
    [51.1040, 17.0335],
  ]);
  const turns = findTurns(coords);
  const total = distanceAlong(coords, 0, coords.length - 1);
  check('geometria pobrana', coords.length > 5, `${coords.length} pkt`);
  check('jest przynajmniej jeden skręt', turns.length >= 1, `${turns.length} skrętów`);
  check('nie ma skrętu w 0 m', turns.every((t) => t.alongM > 2), `pierwszy na ${Math.round(turns[0]?.alongM ?? -1)} m`);
  check('odległości rosną', turns.every((t, i) => i === 0 || t.alongM > turns[i - 1].alongM));
  check('skręty mieszczą się w trasie', turns.every((t) => t.alongM >= 0 && t.remainM >= 0));
  check('suma trasy > 0', total > 50, `${Math.round(total)} m`);
  const rights = turns.filter((t) => t.kind === 'right' || t.kind === 'slightRight');
  console.log(`  kierunki: ${turns.map((t) => `${t.kind}@${Math.round(t.alongM)}m`).join(', ') || 'brak'}`);
  check('jest skręt w prawo', rights.length >= 1);
}

// ── 2. Skręt w lewo ───────────────────────────────────────────
async function testLeftTurn() {
  console.log('\n[2] Skręt w lewo');
  const coords = await fetchRoute(FOOT, 'foot', [
    [51.1080, 17.0400],
    [51.1090, 17.0410],
    [51.1105, 17.0400],
  ]);
  const turns = findTurns(coords);
  const lefts = turns.filter((t) => t.kind === 'left' || t.kind === 'slightLeft');
  console.log(`  kierunki: ${turns.map((t) => `${t.kind}@${Math.round(t.alongM)}m`).join(', ') || 'brak'}`);
  check('jest skręt w lewo', lefts.length >= 1, `${lefts.length} lewych`);
}

// ── 3. Prosta linia: zero skrętów ─────────────────────────────
async function testStraight() {
  console.log('\n[3] Prosta (brak skrętów)');
  // Wzdłuż prostej, z minimalnym zakrętem na końcach.
  const coords: Coord[] = [];
  for (let i = 0; i <= 20; i++) coords.push([51.1050 + i * 0.0002, 17.0300]);
  const turns = findTurns(coords);
  check('prosta nie daje skrętów', turns.length === 0, `${turns.length} skrętów`);
}

// ── 4. Rzutowanie na trasę ────────────────────────────────────
async function testProjection() {
  console.log('\n[4] Rzut pozycji na trasę');
  const coords = await fetchRoute(FOOT, 'foot', [
    [51.1035, 17.0425],
    [51.1052, 17.0381],
  ]);
  // Punkt leżący dokładnie na 2. wierzchołku.
  const onRoute = coords[2];
  const p1 = projectOnPath(coords, onRoute);
  check('rzut zwraca wynik', p1 != null);
  check('offset ~0 m dla punktu na trasie', (p1?.offsetM ?? 99) < 12, `${(p1?.offsetM ?? -1).toFixed(1)} m`);
  check('progress w 0..1', p1 !== null && p1.progress >= 0 && p1.progress <= 1, `${p1?.progress.toFixed(2)}`);

  // Punkt 40 m na wschód od wierzchołka. Trasa się zakrzywia, więc
  // rzut mierzy dystans do NAJBLIŻSZEGO punktu trasy, nie do wierzchołka:
  // porównujemy z prawdziwą odległością policzoną niezależnie.
  const [lat, lon] = coords[3];
  const kx = Math.cos((lat * Math.PI) / 180) * 111320;
  const aside: Coord = [lat, lon + 40 / kx];
  const p2 = projectOnPath(coords, aside);
  const trueOffset = Math.min(...coords.map((c) => dist(c, aside)));
  check(
    'offset = odległość do najbliższego punktu trasy',
    p2 !== null && Math.abs(p2.offsetM - trueOffset) < 3,
    `rzut ${p2?.offsetM.toFixed(1)} m vs prawda ${trueOffset.toFixed(1)} m`,
  );
  check('rzut poza trasą daje progress 0..1', p2 !== null && p2.progress >= 0 && p2.progress <= 1);

  // Środek odcinka leży dokładnie na trasie: rzut musi dać offset ~0
  // i wskazać ten odcinek.
  let longest = 0;
  let li = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = dist(coords[i], coords[i + 1]);
    if (d > longest) {
      longest = d;
      li = i;
    }
  }
  const mid: Coord = [(coords[li][0] + coords[li + 1][0]) / 2, (coords[li][1] + coords[li + 1][1]) / 2];
  const pMid = projectOnPath(coords, mid);
  check('środek odcinka daje offset ~0', pMid !== null && pMid.offsetM < 1, `${pMid?.offsetM.toFixed(2)} m`);
  check('środek odcinka wskazuje ten odcinek', pMid?.index === li, `index ${pMid?.index}, oczekiwany ${li}`);

  // Punkt daleko od trasy: rzut nadal daje najbliższy wierzchołek sensownie.
  const far: Coord = [51.16, 17.10];
  const p3 = projectOnPath(coords, far);
  check('daleki punkt też się rzutuje', p3 != null, `progress ${p3?.progress.toFixed(2)}`);
}

// ── 5. Ścieżka do wskazanego przystanku ───────────────────────
async function testPathToIndex() {
  console.log('\n[5] Ścieżka od użytkownika do przystanku');
  const coords = await fetchRoute(CAR, 'driving', [
    [51.1035, 17.0425],
    [51.1052, 17.0381],
    [51.1078, 17.0392],
    [51.1115, 17.0411],
  ]);
  check('4 waypointy pobrane', coords.length > 10, `${coords.length} pkt`);
  const forward = pathToIndex(coords, 0, coords.length - 1);
  check('ścieżka do przodu nie jest odwrócona', forward.reversed === false);
  check('ścieżka do przodu zaczyna się w coords[0]', forward.path[0][0] === coords[0][0] && forward.path[0][1] === coords[0][1]);
  const back = pathToIndex(coords, coords.length - 1, 0);
  check('ścieżka do tyłu jest odwrócona', back.reversed === true);
  check('odwrócona zaczyna się na końcu', back.path[0][0] === coords[coords.length - 1][0]);
  // Obie ścieżki mają tyle samo punktów.
  check('ta sama długość po odwróceniu', forward.path.length === back.path.length, `${forward.path.length} vs ${back.path.length}`);
}

// ── 6. Przypadki brzegowe ─────────────────────────────────────
function testEdges() {
  console.log('\n[6] Przypadki brzegowe');
  check('pusta trasa → brak skrętów', findTurns([]).length === 0);
  check('1 punkt → brak skrętów', findTurns([[51.1, 17.0]]).length === 0);
  check('2 punkty → brak skrętów', findTurns([[51.1, 17.0], [51.1001, 17.0]]).length === 0);
  check('pusta trasa → rzut null', projectOnPath([], [51.1, 17.0]) === null);
  check('1 punkt → rzut działa', projectOnPath([[51.1, 17.0]], [51.1, 17.0])?.progress === 0);
  // Dwa identyczne punkty nie mogą dać NaN.
  const dup = projectOnPath([[51.1, 17.0], [51.1, 17.0], [51.1002, 17.0]], [51.1001, 17.0]);
  check('zdublowane wierzchołki nie dają NaN', dup != null && Number.isFinite(dup.progress), `${dup?.progress}`);
}

// ── 7. Pełna instrukcja na realnym planie ───────────────────
/** Noga testowa: spacer -> tram -> spacer, z prawdziwymi przystankami. */
function makeLeg(id: string, mode: 'walk' | 'tram', from: Coord, to: Coord, line?: string): MapLeg {
  return {
    id,
    mode,
    line,
    direction: mode === 'walk' ? undefined : 'ZOO',
    color: '#00A884',
    fromStop: mode === 'walk' ? 'Start' : 'Przystanek A',
    toStop: mode === 'walk' ? 'Przystanek A' : 'Przystanek B',
    departAt: '19:00',
    arriveAt: '19:20',
    stopsCount: mode === 'walk' ? 0 : 3,
    live: false,
    approx: false,
    stops: [
      { id: `${id}#0`, legId: id, lat: from[0], lon: from[1], name: mode === 'walk' ? 'Start' : 'Przystanek A', seq: 0, role: mode === 'walk' ? 'walk' : 'board' },
      { id: `${id}#1`, legId: id, lat: to[0], lon: to[1], name: mode === 'walk' ? 'Przystanek A' : 'Przystanek B', seq: 1, role: mode === 'walk' ? 'walk' : 'alight' },
    ],
  };
}

async function testGuidance() {
  console.log('\n[7] Instrukcja na realnym planie (spacer -> tram -> spacer)');
  // Wrocław: Inżynierska -> Hutmen -> Dworzec Główny -> Hala Stulecia.
  const legs: MapLeg[] = [
    makeLeg('l1', 'walk', [51.1035, 17.0425], [51.1052, 17.0381]),
    makeLeg('l2', 'tram', [51.1052, 17.0381], [51.1115, 17.0411], '11'),
    makeLeg('l3', 'walk', [51.1115, 17.0411], [51.1136, 17.0452]),
  ];

  // Prawdziwa geometria każdej nogi (OSRM pieszy / samochodowy).
  const geo1 = await fetchRoute(FOOT, 'foot', legs[0].stops.map((s) => [s.lat, s.lon] as Coord));
  const geo2 = await fetchRoute(CAR, 'driving', legs[1].stops.map((s) => [s.lat, s.lon] as Coord));
  const geo3 = await fetchRoute(FOOT, 'foot', legs[2].stops.map((s) => [s.lat, s.lon] as Coord));

  // Wklejamy prawdziwą geometrię jako dodatkowe przystanki-noga (jak po
  // resolveGeometry w aplikacji).
  legs[0].stops = geo1.map((c, i) => ({
    id: `l1#${i}`, legId: 'l1', lat: c[0], lon: c[1], name: 'x', seq: i, role: 'walk' as const,
  }));
  legs[1].stops = geo2.map((c, i) => ({
    id: `l2#${i}`, legId: 'l2', lat: c[0], lon: c[1], name: 'x', seq: i, role: 'intermediate' as const,
  }));
  legs[1].stops[0].role = 'board';
  legs[1].stops[legs[1].stops.length - 1].role = 'alight';
  legs[2].stops = geo3.map((c, i) => ({
    id: `l3#${i}`, legId: 'l3', lat: c[0], lon: c[1], name: 'x', seq: i, role: 'walk' as const,
  }));

  const { coords, spans } = buildRoutePath(legs);
  check('trasa złożona z 3 nóg', spans.length === 3, `${spans.length} nóg`);
  check('wierzchołki połączone bez dziur', coords.length > 200, `${coords.length} pkt`);

  const total = distanceAlong(coords, 0, coords.length - 1);
  console.log(`  długość trasy: ${Math.round(total)} m`);

  // Start: użytkownik w punkcie startowym -> wsiadanie w 0 m.
  const g0 = nextGuidance(coords, spans, coords[0]);
  check('na starcie instrukcja istnieje', g0 != null);
  console.log(`  start: ${g0?.maneuver.kind} @${Math.round(g0?.maneuver.distanceM ?? -1)} m`);
  check('start to noga piesza', g0?.leg.id === 'l1', g0?.leg.id);

  // Kilkaset metrów dalej, wciąż na nodze pieszej: jakiś skręt lub dojście.
  let g1: ReturnType<typeof nextGuidance> = null;
  for (let i = 10; i < coords.length; i += 5) {
    const probe = nextGuidance(coords, spans, coords[i]);
    if (probe && probe.leg.id === 'l1' && probe.maneuver.distanceM > 20) {
      g1 = probe;
      break;
    }
  }
  check('w trakcie spaceru jest manewr', g1 != null);
  console.log(`  spacer: ${g1?.maneuver.kind} @${Math.round(g1?.maneuver.distanceM ?? -1)} m`);
  check('manewr ma sensowny dystans', g1 != null && g1.maneuver.distanceM > 0 && g1.maneuver.distanceM < 600, `${Math.round(g1?.maneuver.distanceM ?? -1)} m`);

  // Środek nóg kursowej -> wsiadaj albo jedź.
  const midLeg2 = Math.floor((spans[1].start + spans[1].end) / 2);
  const g2 = nextGuidance(coords, spans, coords[midLeg2]);
  check('na trasie kursowej jest instrukcja', g2 != null);
  console.log(`  tram: ${g2?.maneuver.kind} @${Math.round(g2?.maneuver.distanceM ?? -1)} m (noga ${g2?.leg.id})`);
  check('instrukcja na nodze kursowej nie jest skrętem po chodniku',
    g2 == null || g2.maneuver.kind === 'board' || g2.maneuver.kind === 'alight',
    g2?.maneuver.kind);

  // Prawie koniec nóg kursowej: do wysiadania zostaje mało. Geometria OSRM
  // ma wierzchołki co kilka-kilkadziesiąt metrów, więc sprawdzamy, że
  // dystans jest mały względem długości nogi, a nie że jest zerem.
  const legLen = distanceAlong(coords, spans[1].start, spans[1].end);
  const nearEnd = Math.max(spans[1].start, spans[1].end - 2);
  const g3 = nextGuidance(coords, spans, coords[nearEnd]);
  check('blisko końca nóg kursowej: wysiadaj', g3?.maneuver.kind === 'alight', g3?.maneuver.kind);
  check(
    'do wysiadania ułamek nogi',
    (g3?.maneuver.distanceM ?? 999) < legLen * 0.1,
    `${Math.round(g3?.maneuver.distanceM ?? -1)} m z ${Math.round(legLen)} m nogi`,
  );
  check('noga kursowa wskazana do wysiadania', g3?.leg.id === 'l2', g3?.leg.id);

  // Dokładnie na przystanku, na którym kończy się kurs: wysiadaj, nie „idź”.
  const atBoard = nextGuidance(coords, spans, coords[spans[1].end]);
  check('na samym przystanku wysiadania: wysiadaj', atBoard?.maneuver.kind === 'alight', atBoard?.maneuver.kind);

  // Spacer dojrzedl do przystanku, na ktorym zaczyna sie kurs: to nie
  // „dotarlismy”, tylko „wsiadaj”, bo celem jest dopiero koniec trasy.
  const gBoard = nextGuidance(coords, spans, coords[spans[0].end]);
  check('na koncu nogi pieszej przed kursem: wsiadaj', gBoard?.maneuver.kind === 'board', gBoard?.maneuver.kind);
  check('wsiadanie dotyczy nogi pieszej', gBoard?.leg.id === 'l1', gBoard?.leg.id);

  // Ostatnia noga piesza kończy sie w celu, tam „dotarlismy” jest wlasciwe.
  const gArrive = nextGuidance(coords, spans, coords[spans[2].end - 1]);
  check('na koncu ostatniej nogi: dotarcie', gArrive?.maneuver.kind === 'arrive', gArrive?.maneuver.kind);

  // Cel -> dotarliśmy.
  const g4 = nextGuidance(coords, spans, coords[coords.length - 1]);
  check('na końcu trasy: dotarcie', g4?.maneuver.kind === 'arrive', g4?.maneuver.kind);
  check('cel oznaczony jako przesunięty za kres', g4?.overshot === true);

  // Żaden manewr nie może wskazywać na przeszłość.
  let negative = 0;
  for (let i = 0; i < coords.length; i += 17) {
    const g = nextGuidance(coords, spans, coords[i]);
    if (g && g.maneuver.distanceM < -1) negative++;
  }
  check('żaden manewr nie ma ujemnego dystansu', negative === 0, `${negative} ujemnych`);
}

(async () => {
  console.log('=== Wyznaczanie manewrów: test na prawdziwej geometrii ===');
  await testRightTurn();
  await testLeftTurn();
  testStraight();
  await testProjection();
  await testPathToIndex();
  testEdges();
  await testGuidance();
  console.log(`\n${failures === 0 ? 'OK: wszystkie testy przeszły' : `BLEDY: ${failures}`}`);
  process.exit(failures === 0 ? 0 : 1);
})();