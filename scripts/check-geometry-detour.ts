/**
 * Testy logiki filtrowania objazdów routera samochodowego OSRM w geometrii tras.
 *
 * Uruchomienie: `npx tsx scripts/check-geometry-detour.ts`
 */

import {
  distanceM,
  distanceToSegment,
  sanitizeLegCoords,
  isOsrmLegDetour,
  type Coord,
} from '../src/services/routeGeometry';

let passed = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string, extra?: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${label}`);
  } else {
    failures.push(`${label}${extra ? `: ${extra}` : ''}`);
    console.log(`  FAIL ${label}${extra ? `: ${extra}` : ''}`);
  }
}

console.log('=== Geometria tras: filtrowanie objazdów i ubytków OSRM ===');

// 1. Odległość w metrach
{
  const p1: Coord = [50.0632, 19.9431]; // Teatr Słowackiego
  const p2: Coord = [50.0635, 19.9320]; // Teatr Bagatela
  const d = distanceM(p1, p2);
  assert(d > 780 && d < 810, 'distanceM: odległość Teatr Słowackiego -> Bagatela ~794m', `d=${d}`);
}

// 2. Odległość punktu od odcinka
{
  const a: Coord = [50.0, 20.0];
  const b: Coord = [50.0, 20.01]; // ~715 m na wschód
  // Punkt dokładnie w połowie odcinka
  const mid: Coord = [50.0, 20.005];
  assert(distanceToSegment(mid, a, b) < 1, 'distanceToSegment: punkt na odcinku ma dystans ~0m');

  // Punkt przesunięty 200m na północ od środka
  const north: Coord = [50.0018, 20.005]; // ~200 m na północ
  const distNorth = distanceToSegment(north, a, b);
  assert(distNorth > 190 && distNorth < 210, 'distanceToSegment: punkt 200m z boku ma dystans ~200m', `d=${distNorth}`);

  // Punkt za końcem b (na wschód) o 500m
  const pastB: Coord = [50.0, 20.017];
  const distPast = distanceToSegment(pastB, a, b);
  assert(distPast > 490 && distPast < 510, 'distanceToSegment: punkt za końcem b ma dystans do b ~500m', `d=${distPast}`);
}

// 3. Domknięcie i sanityzacja współrzędnych odcinka
{
  const p1: Coord = [50.0632, 19.9431];
  const p2: Coord = [50.0635, 19.9320];
  // Surowe punkty z OSRM z lekkim offsetem od słupka
  const raw: Coord[] = [
    [50.0631, 19.9430],
    [50.0633, 19.9380],
    [50.0634, 19.9330],
  ];
  const sanitized = sanitizeLegCoords(raw, p1, p2);
  assert(
    sanitized[0][0] === p1[0] && sanitized[0][1] === p1[1],
    'sanitizeLegCoords: początek to dokładnie p1',
  );
  assert(
    sanitized[sanitized.length - 1][0] === p2[0] &&
      sanitized[sanitized.length - 1][1] === p2[1],
    'sanitizeLegCoords: koniec to dokładnie p2',
  );
  assert(sanitized.length >= 4, 'sanitizeLegCoords: zawiera punkty pośrednie');

  // Pusta lub krótka lista
  const fallback = sanitizeLegCoords([], p1, p2);
  assert(
    fallback.length === 2 && fallback[0] === p1 && fallback[1] === p2,
    'sanitizeLegCoords: fallback pustej listy zwraca [p1, p2]',
  );
}

// 4. Detekcja objazdów (isOsrmLegDetour)
{
  // A. Przypadek Kraków (Teatr Słowackiego -> Teatr Bagatela):
  // W linii prostej ~794m. OSRM driving przez zakaz wjazdu na Basztową
  // ucieka w uliczki Starego Miasta, leci na Nowy Kleparz i wraca Karmelicką:
  // dystans ~4747m, lateral offset > 1500m.
  const slowacki: Coord = [50.0632, 19.9431];
  const bagatela: Coord = [50.0635, 19.9320];
  const krakowDetourSteps: Coord[] = [
    [50.0629, 19.9431], // św. Krzyża
    [50.0610, 19.9400], // św. Tomasza
    [50.0730, 19.9360], // Nowy Kleparz (1.1 km na północ!)
    [50.0650, 19.9300], // Karmelicka
  ];
  const isKrakowDetour = isOsrmLegDetour(slowacki, bagatela, 4747, krakowDetourSteps);
  assert(isKrakowDetour, 'isOsrmLegDetour: odrzuca objazd Basztowej przez Nowy Kleparz (4.7km zamiast 800m)');

  // B. Przypadek normalnej jazdy jezdnią (DH Wanda -> Os. Strusia):
  // Prosto ~692m, OSRM ~769m, odchylenie od osi ~56m.
  const wanda: Coord = [50.0827, 20.0242];
  const strusia: Coord = [50.0863, 20.0163];
  const normalSteps: Coord[] = [
    [50.0827, 20.0242],
    [50.0845, 20.0200],
    [50.0863, 20.0163],
  ];
  const isNormalDetour = isOsrmLegDetour(wanda, strusia, 769, normalSteps);
  assert(!isNormalDetour, 'isOsrmLegDetour: akceptuje normalny przebieg uliczny (DH Wanda -> Os. Strusia)');

  // C. Przypadek pętli za przystankiem (nawrotka 800m za przystankiem na dwujezdniówce):
  // Prosto 150m, OSRM 1600m z zawrotką daleko z tyłu/przodu.
  const pA: Coord = [50.0800, 20.0000];
  const pB: Coord = [50.0812, 20.0005]; // ~135m
  const uTurnSteps: Coord[] = [
    [50.0800, 20.0000],
    [50.0870, 20.0000], // 800m za celem!
    [50.0812, 20.0005],
  ];
  const isUTurnDetour = isOsrmLegDetour(pA, pB, 1600, uTurnSteps);
  assert(isUTurnDetour, 'isOsrmLegDetour: odrzuca pętlę/nawrotkę za przystankiem');

  // D. Brak geometrii z OSRM (puste steps)
  assert(isOsrmLegDetour(pA, pB, 0, []), 'isOsrmLegDetour: puste steps traktowane jak objazd / fallback');
}

if (failures.length > 0) {
  console.error(`\nNiepowodzenie: ${failures.length} testów nie przeszło.`);
  process.exit(1);
} else {
  console.log(`\nOK: Wszystkie ${passed} asercji sprawdzania geometrii przeszło pomyślnie.`);
}
