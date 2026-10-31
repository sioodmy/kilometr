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
  calcBearing,
  computeBearingsParam,
  removeSpurs,
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

  // D. Flaga hasUturn (nierozwiązana nawrotka w ślepej uliczce)
  assert(isOsrmLegDetour(pA, pB, 200, [[50.08, 20.0], [50.081, 20.0]], true), 'isOsrmLegDetour: odrzuca odcinek z nierozwiązanym U-turnem');

  // E. Brak geometrii z OSRM (puste steps)
  assert(isOsrmLegDetour(pA, pB, 0, []), 'isOsrmLegDetour: puste steps traktowane jak objazd / fallback');
}

// 5. Obliczanie azymutów (calcBearing)
{
  const p0: Coord = [50.0, 20.0];
  const pNorth: Coord = [50.01, 20.0];
  const pEast: Coord = [50.0, 20.01];
  const pSouth: Coord = [49.99, 20.0];
  const pWest: Coord = [50.0, 19.99];

  assert(calcBearing(p0, pNorth) === 0, 'calcBearing: północ to 0°');
  assert(calcBearing(p0, pEast) === 90, 'calcBearing: wschód to 90°');
  assert(calcBearing(p0, pSouth) === 180, 'calcBearing: południe to 180°');
  assert(calcBearing(p0, pWest) === 270, 'calcBearing: zachód to 270°');
}

// 6. Obliczanie bearings dla OSRM (computeBearingsParam)
{
  // Ciągły korytarz wzdłuż Hallera we Wrocławiu (105° -> 100°): kąty w pobliżu 100°
  const corridor: Coord[] = [
    [51.091286, 16.986561], // Aleja Pracy
    [51.090339, 16.992138], // Ojca Beyzyma
    [51.089526, 16.999699], // Mielecka
  ];
  const param = computeBearingsParam(corridor);
  assert(param !== null && param.includes('105,60') && param.includes('100,60'), 'computeBearingsParam: generuje ograniczenia azymutu dla prostego korytarza');

  // Ostry skręt 90°: środkowy przystanek powinien być pusty (brak restrykcji)
  const sharpTurn: Coord[] = [
    [50.0, 20.0],
    [50.01, 20.0], // jedzie na północ (0°)
    [50.01, 20.02], // skręca w prawo na wschód (90°)
  ];
  const turnParam = computeBearingsParam(sharpTurn);
  assert(turnParam !== null && turnParam.split(';')[1] === '', 'computeBearingsParam: nie ogranicza azymutu przy ostrym skręcie (split(";")[1] === "")');
}

// 7. Eliminacja anten / nawrotek (removeSpurs) - przypadek Wrocław Beyzyma
{
  // Ciąg punktów: Aleja Hallera -> wjazd w ślepą Beyzyma na 35m -> nawrotka -> wyjazd na Hallera
  const spurCoords: Coord[] = [
    [51.090401, 16.992284], // Hallera
    [51.090339, 16.992256], // zjazd w Beyzyma
    [51.090330, 16.992253],
    [51.090284, 16.992235],
    [51.090249, 16.992222],
    [51.090237, 16.992217],
    [51.090132, 16.992176],
    [51.090083, 16.992156],
    [51.090013, 16.992128], // dno zaułka (nawrotka)
    [51.090083, 16.992156], // powrót po tych samych współrzędnych
    [51.090132, 16.992176],
    [51.090237, 16.992217],
    [51.090249, 16.992222],
    [51.090284, 16.992235],
    [51.090330, 16.992253],
    [51.090339, 16.992256],
    [51.090401, 16.992284], // powrót na Hallera
    [51.090333, 16.992608], // dalej na wschód Hallera
    [51.090319, 16.992678],
  ];

  const cleaned = removeSpurs(spurCoords);
  assert(cleaned.length === 3, `removeSpurs: redukuje 19 punktów z anteną do 3 punktów na Hallera (len=${cleaned.length})`);
  assert(cleaned[0][0] === 51.090401 && cleaned[1][0] === 51.090333, 'removeSpurs: linia biegnie bezpośrednio wzdłuż Alei Hallera');
}

if (failures.length > 0) {
  console.error(`\nNiepowodzenie: ${failures.length} testów nie przeszło.`);
  process.exit(1);
} else {
  console.log(`\nOK: Wszystkie ${passed} asercji sprawdzania geometrii przeszło pomyślnie.`);
}
