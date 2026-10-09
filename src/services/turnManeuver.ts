// Wyznaczanie manewru na trasie: „skręć w lewo za 50 m”, „wsiadaj”, „wysiadaj”.
//
// RAPTOR zna tylko przystanki, a człowiek idący do tramwaju potrzebuje czegoś
// zupełnie innego: kolejnego skrętu i odległości do niego. Ten moduł bierze
// prawdziwą geometrię nóg (OSRM pieszy / samochodowy), rzutuje na nią pozycję
// użytkownika i znajduje najbliższy istotny manewr.
//
// Świadomie bez React Native i bez sieci, żeby dało się to policzyć na hoście
// (`npm run check:nav`) i przetestować na prawdziwej geometrii.

import type { Coord } from './routeGeometry';
import type { MapLeg, MapRoute } from '../map/types';

/** Ile stopni musi zmienić się kurs, żeby uznać zakręt za manewr. */
const TURN_THRESHOLD_DEG = 32;
/** Poniżej tego kąta to szum GPS albo łuk drogi, a nie skręt. */
const TURN_NOISE_DEG = 14;
/** Drobne odchylenia łączy w jeden skręt, żeby nie mówić o każdym metrze. */
const TURN_MERGE_M = 22;
/** Poniżej tylu metrów manewr jest tuż przed Tobą (w promieniu słucha). */
const MANEUVER_NEAR_M = 25;

export type ManeuverKind =
  | 'depart'
  | 'straight'
  | 'slightLeft'
  | 'left'
  | 'sharpLeft'
  | 'slightRight'
  | 'right'
  | 'sharpRight'
  | 'uturn'
  | 'board'
  | 'alight'
  | 'arrive';

export interface Maneuver {
  kind: ManeuverKind;
  /** odległość od użytkownika wzdłuż trasy [m] */
  distanceM: number;
  /** współrzędne miejsca manewru */
  at: Coord;
  /** fragment trasy od użytkownika do manewru (do rysowania na minimapce) */
  path: Coord[];
}

export interface RouteProgress {
  /** 0..1 wzdłuż całej trasy */
  progress: number;
  /** indeks wierzchołka, przy którym ląduje rzut */
  index: number;
  /** 0 = tuż przed manewrem, 1 = manewr za Tobą */
  side: 0 | 1;
}

function distanceM(p: Coord, q: Coord): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = (q[0] - p[0]) * 111320;
  const dLon = (q[1] - p[1]) * 111320 * Math.cos(toRad((p[0] + q[0]) / 2));
  return Math.hypot(dLat, dLon);
}

function bearing(p: Coord, q: Coord): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const p1 = toRad(p[0]);
  const p2 = toRad(q[0]);
  const dl = toRad(q[1] - p[1]);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Różnica kursów w zakresie [-180, 180]. Dodatnia = w prawo. */
export function angleDelta(a: Coord, b: Coord, c: Coord): number {
  let d = bearing(b, c) - bearing(a, b);
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function classify(delta: number): ManeuverKind {
  const abs = Math.abs(delta);
  if (abs > 160) return 'uturn';
  if (abs >= 115) return delta > 0 ? 'sharpRight' : 'sharpLeft';
  if (abs >= TURN_THRESHOLD_DEG) return delta > 0 ? 'right' : 'left';
  if (abs >= TURN_NOISE_DEG) return delta > 0 ? 'slightRight' : 'slightLeft';
  return 'straight';
}

interface Turn {
  /** wierzchołek, przy którym trasa zmienia kierunek */
  index: number;
  kind: ManeuverKind;
  /** znormalizowana zmiana kursu w [-180, 180] */
  delta: number;
  /** pierwszy wierzchołek okna ocenianego jako kierunek dojazdu */
  startIdx?: number;
}

/**
 * Klasyfikuje skręt po kursie PRZED oknem i PO oknie, a nie przez sumowanie
 * kątów. Dwa łagodne zakręty w jednym miejscu dają wtedy kierunek netto,
 * zawrót zaś wymaga prawdziwego odwrócenia kursu. Sumowanie kątów potrafiło
 * z dwóch łagodnych zrobić zawrót, a z dwóch przeciwnych „jedź prosto”.
 */
function turnFromWindow(coords: Coord[], from: number, to: number): Turn {
  const before = Math.max(0, from - LOOKBACK_PTS);
  const after = Math.min(coords.length - 1, to + LOOKBACK_PTS);
  const delta = angleDelta(coords[before], coords[from], coords[after]);
  return { index: to, kind: classify(delta), delta };
}

/** Ile wierzchołków w obie strony oceniamy jako kierunek dojazdu. */
const LOOKBACK_PTS = 2;

/**
 * Wierzchołki trasy, przy których kierunek zmienia się wyraźnie.
 * Zwraca też odległość od początku (alongM) i do końca (remainM).
 */
export function findTurns(
  coords: Coord[],
): { index: number; kind: ManeuverKind; delta: number; alongM: number; remainM: number }[] {
  if (coords.length < 3) return [];
  const cum: number[] = [0];
  for (let i = 0; i < coords.length - 1; i++) {
    cum.push(cum[i] + distanceM(coords[i], coords[i + 1]));
  }
  const total = cum[cum.length - 1];

  const turns: Turn[] = [];
  for (let i = 1; i < coords.length - 1; i++) {
    const local = classify(angleDelta(coords[i - 1], coords[i], coords[i + 1]));
    if (local === 'straight') continue;

    const prev = turns[turns.length - 1];
    if (prev && cum[i] - prev.index === 0) continue;
    // Skręty oddalone o kilka metrów i w tę samą stronę to jedno miejsce.
    if (prev && cum[i] - cum[prev.index] < TURN_MERGE_M) {
      const window = turnFromWindow(coords, prev.startIdx ?? prev.index, i);
      if (window.kind !== 'straight' && window.kind !== 'uturn') {
        prev.index = i;
        prev.kind = window.kind;
        prev.delta = window.delta;
        prev.startIdx = window.index;
        continue;
      }
    }
    turns.push({ index: i, kind: local, delta: angleDelta(coords[i - 1], coords[i], coords[i + 1]), startIdx: i });
  }

  return turns.map((t) => ({
    index: t.index,
    kind: t.kind,
    delta: t.delta,
    alongM: cum[t.index],
    remainM: total - cum[t.index],
  }));
}

/**
 * Rzutuje punkt na linię trasy. Zwraca pozycję wzdłuż trasy i informację po
 * której stronie punktu wypadł (mapa to ulica o szerokości, nie nić).
 */
export function projectOnPath(
  coords: Coord[],
  point: Coord,
): { index: number; t: number; offsetM: number; alongM: number; progress: number } | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) {
    return {
      index: 0,
      t: 0,
      offsetM: distanceM(coords[0], point),
      alongM: 0,
      progress: 0,
    };
  }
  const toRad = (d: number) => (d * Math.PI) / 180;
  const cum: number[] = [0];
  for (let i = 0; i < coords.length - 1; i++) {
    cum.push(cum[i] + distanceM(coords[i], coords[i + 1]));
  }
  const total = cum[cum.length - 1];

  let best = Infinity;
  let bestIndex = 0;
  let bestT = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lat1, lon1] = coords[i];
    const [lat2, lon2] = coords[i + 1];
    const kx = Math.cos(toRad((lat1 + lat2) / 2));
    const x = toRad(point[1] - lon1) * kx;
    const y = toRad(point[0] - lat1);
    const dx = toRad(lon2 - lon1) * kx;
    const dy = toRad(lat2 - lat1);
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, (x * dx + y * dy) / lenSq)) : 0;
    const pLat = lat1 + t * (lat2 - lat1);
    const pLon = lon1 + t * (lon2 - lon1);
    const d = Math.hypot(toRad(point[0] - pLat), toRad(point[1] - pLon) * kx);
    if (d < best) {
      best = d;
      bestIndex = i;
      bestT = t;
    }
  }

  const alongM = cum[bestIndex] + bestT * (cum[bestIndex + 1] - cum[bestIndex]);
  return {
    index: bestIndex,
    t: bestT,
    offsetM: distanceM(
      [coords[bestIndex][0] + bestT * (coords[bestIndex + 1][0] - coords[bestIndex][0]),
       coords[bestIndex][1] + bestT * (coords[bestIndex + 1][1] - coords[bestIndex][1])],
      point,
    ),
    alongM,
    progress: total > 0 ? Math.max(0, Math.min(1, alongM / total)) : 0,
  };
}

/** Gdzie na trasie jest dana noga i w którym jej punkcie. */
export interface LegSpan {
  leg: MapLeg;
  /** indeks pierwszego wierzchołka nogi w trasie */
  start: number;
  /** indeks ostatniego wierzchołka nogi */
  end: number;
}

/**
 * Łączy nogi w jeden ciąg wierzchołków. Wspólne końce (przystanek, na którym
 * kończy się jedna noga i zaczyna następna) zapisywane są raz.
 */
export function buildRoutePath(legs: MapLeg[]): { coords: Coord[]; spans: LegSpan[] } {
  const coords: Coord[] = [];
  const spans: LegSpan[] = [];
  for (const leg of legs) {
    if (leg.stops.length < 2) continue;
    const start = coords.length === 0 ? 0 : coords.length - 1;
    for (let i = 0; i < leg.stops.length; i++) {
      const stop = leg.stops[i];
      const coord: Coord = [stop.lat, stop.lon];
      const last = coords[coords.length - 1];
      const duplicate =
        last && Math.abs(last[0] - coord[0]) < 1e-7 && Math.abs(last[1] - coord[1]) < 1e-7;
      if (!duplicate) coords.push(coord);
    }
    spans.push({ leg, start, end: coords.length - 1 });
  }
  return { coords, spans };
}

/**
 * Ścieżka od pozycji użytkownika do `stopIndex` wzdłuż trasy.
 * Gdy użytkownik jest już za celem, zwracamy odcinek powrotny (do końca trasy).
 */
export function pathToIndex(
  coords: Coord[],
  fromIndex: number,
  stopIndex: number,
): { path: Coord[]; reversed: boolean } {
  const lo = Math.min(fromIndex, stopIndex);
  const hi = Math.max(fromIndex, stopIndex);
  const path = coords.slice(lo, hi + 1);
  if (fromIndex > stopIndex) path.reverse();
  return { path, reversed: fromIndex > stopIndex };
}

/** Ile metrów zostało do wskazanego wierzchołka trasy. */
export function distanceAlong(
  coords: Coord[],
  fromIndex: number,
  toIndex: number,
): number {
  const lo = Math.min(fromIndex, toIndex);
  const hi = Math.max(fromIndex, toIndex);
  let total = 0;
  for (let i = lo; i < hi; i++) total += distanceM(coords[i], coords[i + 1]);
  return total;
}

/**
 * Następny manewr na ścieżku `path`, licząc od `fromIndex` (pozycja użytkownika).
 * Liczy tylko skręty; wejście/wyjście z pojazdu dokłada caller.
 */
export function nextTurnOnPath(
  coords: Coord[],
  fromIndex: number,
): Maneuver | null {
  const turns = findTurns(coords).filter((t) => t.index > fromIndex + 1);
  const turn = turns.find((t) => t.alongM - distanceAlong(coords, 0, fromIndex) >= MANEUVER_NEAR_M);
  if (!turn) return null;
  return {
    kind: turn.kind,
    distanceM: Math.max(0, turn.alongM - distanceAlong(coords, 0, fromIndex)),
    at: coords[turn.index],
    path: coords.slice(fromIndex, turn.index + 1),
  };
}

/** Trasa do wyświetlenia: nogi złożone w jeden ciąg wierzchołków. */
export function guidanceRoute(route: MapRoute): { coords: Coord[]; spans: LegSpan[] } {
  return buildRoutePath(route.legs);
}

/** Do której nogi należy dany indeks wierzchołka trasy. */
function spanAt(spans: LegSpan[], index: number): LegSpan | null {
  for (const span of spans) {
    if (index >= span.start && index <= span.end) return span;
  }
  return null;
}

/**
 * Co użytkownik ma zrobić jako następne: skręt na trasie, wejście do
 * pojazdu, wyjście z niego albo dotarcie do celu. To jedyne miejsce, które
 * zamienia listę skrętów na instrukcję dla człowieka.
 */
export interface Guidance {
  /** manewr do wykonania */
  maneuver: Maneuver;
  /** noga, po której idziemy */
  leg: MapLeg;
  /** do wskazanego miejsca zostało [m] wzdłuż trasy */
  remainM: number;
  /** użytkownika rzutuje na trasę z dokładnością [m] */
  offsetM: number;
  /** cała trasa do narysowania */
  path: Coord[];
  /** odcinek od użytkownika do manewru */
  toManeuver: Coord[];
  /** true, gdy użytkownik jest już za celem */
  overshot: boolean;
}

/** Na końcu nogi kursowej zaczyna się przyjazd albo trzeba wysiąść. */
function legEndAction(leg: MapLeg): ManeuverKind {
  return leg.mode === 'walk' ? 'arrive' : 'alight';
}

/** Na początku nogi kursowej trzeba wsiąść. */
function legStartAction(leg: MapLeg): ManeuverKind | null {
  if (leg.mode === 'walk') return null;
  return leg.departAt ? 'board' : null;
}

const HEADING_PTS = 4;

/**
 * Wyznacza następny manewr wzdłuż trasy od pozycji użytkownika.
 *
 * Kolejność ma znaczenie: wejście i wyjście z pojazdu są ważniejsze niż
 * skręt na chodniku tuż przed przystankiem, więc sprawdzamy je w granicach
 * tej samej nogi zanim zajmiemy się zakrętami. Dla nóg kursowych liczymy
 * tylko skręty na drodze do przystanku, nie między przystankami.
 */
export function nextGuidance(
  coords: Coord[],
  spans: LegSpan[],
  userPos: Coord,
): Guidance | null {
  if (coords.length < 2 || spans.length === 0) return null;
  const proj = projectOnPath(coords, userPos);
  if (!proj) return null;

  const last = spans[spans.length - 1];
  const at = Math.min(proj.index, coords.length - 2);
  const span = spanAt(spans, at) ?? last;
  const leg = span.leg;

  const progressM = proj.alongM;
  const totalM = distanceAlong(coords, 0, coords.length - 1);
  const remainToEnd = Math.max(0, totalM - progressM);

  const base = (kind: ManeuverKind, atIndex: number, distanceM: number): Guidance => {
    const idx = Math.max(0, Math.min(coords.length - 1, atIndex));
    return {
      maneuver: { kind, distanceM, at: coords[idx], path: [] },
      leg,
      remainM: distanceM,
      offsetM: proj.offsetM,
      path: coords,
      toManeuver: coords.slice(at, idx + 1),
      overshot: false,
    };
  };

  // Użytkownik jest za końcem trasy: cel osiągnięty.
  if (at >= coords.length - 2 && remainToEnd < MANEUVER_NEAR_M) {
    const g = base('arrive', coords.length - 1, 0);
    g.remainM = 0;
    g.overshot = true;
    return g;
  }

  // Skręt liczymy tylko w obrębie bieżącej nogi. Na nodze kursowej między
  // przystankami zakręt nie jest instrukcją dla pieszego, więc tam pomijamy
  // skręty w ogóle i zostaje wsiadanie albo wysiadanie.
  const turns = findTurns(coords);
  const legTurns = leg.mode === 'walk'
    ? turns.filter((t) => t.index > at + 1 && t.index <= span.end)
    : [];

  // Do końca bieżącej nogi zostało X metrów wzdłuż trasy.
  const legEndDist = distanceAlong(coords, at, span.end);

  if (leg.mode !== 'walk') {
    // Stoisz przy końcu przebiegu: wysiadaj.
    if (legEndDist <= MANEUVER_NEAR_M) {
      return base('alight', span.end, legEndDist);
    }
    // Stoisz przy starcie, jeszcze nie wsiadłeś.
    const intoLeg = progressM - distanceAlong(coords, 0, span.start);
    if (intoLeg <= MANEUVER_NEAR_M) {
      return base('board', span.start, Math.max(0, intoLeg));
    }
    // Jedziesz: pokaż, ile zostało do wysiadania.
    return base('alight', span.end, legEndDist);
  }

  // Noga piesza: najbliższy skręt na chodniku.
  const turn = legTurns.find((t) => t.alongM - progressM >= MANEUVER_NEAR_M);
  const endIsCloser = legEndDist <= (turn ? turn.alongM - progressM : Infinity);

  if (endIsCloser) {
    return base(legEndAction(leg), span.end, legEndDist);
  }
  if (!turn) {
    return base('straight', span.end, legEndDist);
  }
  return base(turn.kind, turn.index, turn.alongM - progressM);
}

/**
 * Kolejny manewr po już wykonanym — do linijki „potem” pod główną instrukcją.
 * Zwraca null, gdy kolejny manewr jest tak blisko, że zabrzmi jak duplikat.
 */
export function nextGuidanceAfter(
  coords: Coord[],
  spans: LegSpan[],
  userPos: Coord,
  minGapM = 35,
): Guidance | null {
  const proj = projectOnPath(coords, userPos);
  if (!proj) return null;
  const at = Math.min(proj.index, coords.length - 2);
  const span = spanAt(spans, at);
  if (!span) return null;

  const start = Math.max(at + 1, span.start + (span.leg.mode !== 'walk' ? 1 : 0));
  const turns = findTurns(coords).filter((t) => t.index >= start);
  const first = turns[0];
  if (!first) return null;
  const dist = first.alongM - proj.alongM;
  if (dist < minGapM) return null;

  return {
    maneuver: { kind: first.kind, distanceM: dist, at: coords[first.index], path: [] },
    leg: spanAt(spans, first.index)?.leg ?? span.leg,
    remainM: Math.max(0, distanceAlong(coords, 0, coords.length - 1) - proj.alongM),
    offsetM: proj.offsetM,
    path: coords,
    toManeuver: coords.slice(at, first.index + 1),
    overshot: false,
  };
}

/** Punkt manewru w trasie (zabezpieczony przed wyjściem poza zakres). */
export function maneuverAnchor(coords: Coord[], index: number): Coord {
  const i = Math.max(0, Math.min(coords.length - 1, index));
  return [coords[i][0], coords[i][1]];
}