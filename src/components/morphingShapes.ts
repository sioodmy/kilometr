/**
 * Geometria i interpolacja transportowych kształtów M3 Expressive:
 * Tramwaj -> Autobus -> Pociąg -> Pinezka celu.
 * Wszystkie cztery sylwetki są symetryczne względem osi X = 50 i mają identyczną
 * liczbę krzywych Béziera, dzięki czemu korpus, szyba (lub otwór pinezki) oraz
 * reflektory płynnie w siebie przechodzą na wątku UI bez skręcania ścieżki.
 */

const CENTER_X = 50;

type Point = readonly [number, number];

export type TransitShapeIndex = 0 | 1 | 2 | 3;

export interface TransitKeyframes {
  readonly body: readonly number[];
  readonly window: readonly number[];
  /** Lewy reflektor [cx, cy, r]; prawy jest lustrzany (100 - cx). */
  readonly headlight: readonly [number, number, number];
}

/** Odbija prawą połowę konturu (od środka góry do środka dołu) na pełną pętlę. */
function mirrorRightHalf(right: readonly Point[]): Point[] {
  const pts: Point[] = [...right];
  for (let i = right.length - 2; i >= 1; i--) {
    pts.push([CENTER_X * 2 - right[i][0], right[i][1]]);
  }
  return pts;
}

/** Generuje okrąg z `count` równomiernych punktów zaczynając od 12:00. */
function circlePoints(cx: number, cy: number, r: number, count: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / count;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

/** Zamienia zamkniętą pętlę punktów na płaską tablicę segmentów Catmull-Rom. */
function closedPointsToCubicArray(pts: readonly Point[]): readonly number[] {
  const n = pts.length;
  const out: number[] = [pts[0][0], pts[0][1]];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];

    out.push(
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
      p2[0],
      p2[1],
    );
  }
  return out;
}

/**
 * Cztery klatki kluczowe w widoku 0..100:
 * 0: tramwaj, 1: autobus, 2: pociąg, 3: pinezka celu.
 */
export const TRANSIT_SHAPES: readonly TransitKeyframes[] = [
  // 0: Tramwaj (smukły przód, lekko zaokrąglony dach, wysoka szyba)
  {
    body: closedPointsToCubicArray(
      mirrorRightHalf([
        [50, 21],
        [59, 21.5],
        [68, 23],
        [74, 27],
        [76, 34],
        [76, 45],
        [76, 56],
        [76, 66],
        [74.5, 73.5],
        [69.5, 77.5],
        [62, 78],
        [56, 78],
        [50, 78],
      ]),
    ),
    window: closedPointsToCubicArray(
      mirrorRightHalf([
        [50, 29],
        [61.5, 29],
        [68, 32],
        [68.5, 41],
        [68, 50],
        [61.5, 53],
        [50, 53],
      ]),
    ),
    headlight: [36, 65.5, 4.5],
  },
  // 1: Autobus (szersze nadwozie, płaski dach, szeroka szyba)
  {
    body: closedPointsToCubicArray(
      mirrorRightHalf([
        [50, 20],
        [61, 20],
        [72, 20.5],
        [79, 24],
        [82, 31],
        [82, 42],
        [82, 53],
        [82, 64],
        [80.5, 72],
        [75.5, 76],
        [67, 76],
        [58, 76],
        [50, 76],
      ]),
    ),
    window: closedPointsToCubicArray(
      mirrorRightHalf([
        [50, 27],
        [65, 27],
        [73.5, 29.5],
        [74.5, 39],
        [73.5, 48.5],
        [65, 51],
        [50, 51],
      ]),
    ),
    headlight: [30, 64, 4.7],
  },
  // 2: Pociąg (aerodynamiczny łuk dachu i zaokrąglona przednia szyba)
  {
    body: closedPointsToCubicArray(
      mirrorRightHalf([
        [50, 14],
        [60, 15],
        [69, 19],
        [75, 26],
        [77.5, 35],
        [78, 46],
        [78, 56],
        [77, 66],
        [73.5, 73],
        [67.5, 76.5],
        [61, 77],
        [55, 77],
        [50, 77],
      ]),
    ),
    window: closedPointsToCubicArray(
      mirrorRightHalf([
        [50, 23],
        [61, 24.5],
        [69, 30],
        [70.5, 40],
        [68.5, 48],
        [60.5, 50],
        [50, 50],
      ]),
    ),
    headlight: [35, 64.5, 4.7],
  },
  // 3: Pinezka trasy (korpus zwęża się w grot, szyba zamienia w okrągły środek)
  {
    body: closedPointsToCubicArray(
      mirrorRightHalf([
        [50, 13],
        [61, 14.5],
        [70.5, 20.5],
        [76.5, 30],
        [78.5, 41],
        [76.5, 52],
        [70.5, 62],
        [63.5, 71.5],
        [57.5, 79.5],
        [53.5, 85],
        [51.5, 88],
        [50.5, 89.2],
        [50, 89.5],
      ]),
    ),
    window: closedPointsToCubicArray(circlePoints(50, 41, 11.5, 12)),
    headlight: [50, 41, 0],
  },
];

export const SHAPE_COUNT = TRANSIT_SHAPES.length;

/** Czas jednego kroku morfingu w ms: 530 ms płynnego przejścia + 320 ms czytelnego postoju. */
export const MORPH_STEP_MS = 850;
export const MORPH_ACTIVE_FRACTION = 0.62;

const DAMPING = 5.9;
const OMEGA = 7.0;
const RAW_SPRING_AT_ONE =
  1 - Math.exp(-DAMPING) * (Math.cos(OMEGA) + (DAMPING / OMEGA) * Math.sin(OMEGA));

/** Krzywa sprężysta M3 Expressive z lekkim, czytelnym przesterowaniem (~7%). */
export function expressiveMorphEase(localT: number): number {
  'worklet';
  if (localT <= 0) return 0;
  if (localT >= MORPH_ACTIVE_FRACTION) return 1;
  const u = localT / MORPH_ACTIVE_FRACTION;
  const raw =
    1 - Math.exp(-DAMPING * u) * (Math.cos(OMEGA * u) + (DAMPING / OMEGA) * Math.sin(OMEGA * u));
  return raw / RAW_SPRING_AT_ONE;
}

function interpolateCubicSubpath(
  from: readonly number[],
  to: readonly number[],
  t: number,
): string {
  'worklet';
  const x0 = Math.round((from[0] + (to[0] - from[0]) * t) * 10) / 10;
  const y0 = Math.round((from[1] + (to[1] - from[1]) * t) * 10) / 10;
  let d = `M${x0} ${y0}`;
  const len = from.length;
  for (let i = 2; i < len; i += 6) {
    const c1x = Math.round((from[i] + (to[i] - from[i]) * t) * 10) / 10;
    const c1y = Math.round((from[i + 1] + (to[i + 1] - from[i + 1]) * t) * 10) / 10;
    const c2x = Math.round((from[i + 2] + (to[i + 2] - from[i + 2]) * t) * 10) / 10;
    const c2y = Math.round((from[i + 3] + (to[i + 3] - from[i + 3]) * t) * 10) / 10;
    const ex = Math.round((from[i + 4] + (to[i + 4] - from[i + 4]) * t) * 10) / 10;
    const ey = Math.round((from[i + 5] + (to[i + 5] - from[i + 5]) * t) * 10) / 10;
    d += `C${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`;
  }
  return `${d}Z`;
}

function circleSubpath(cx: number, cy: number, r: number): string {
  'worklet';
  if (r <= 0.35) return '';
  const k = r * 0.5523;
  const rx = Math.round(cx * 10) / 10;
  const ry = Math.round(cy * 10) / 10;
  const rr = Math.round(r * 10) / 10;
  const rk = Math.round(k * 10) / 10;
  const top = Math.round((ry - rr) * 10) / 10;
  const bot = Math.round((ry + rr) * 10) / 10;
  const left = Math.round((rx - rr) * 10) / 10;
  const right = Math.round((rx + rr) * 10) / 10;
  const xPlusK = Math.round((rx + rk) * 10) / 10;
  const xMinusK = Math.round((rx - rk) * 10) / 10;
  const yPlusK = Math.round((ry + rk) * 10) / 10;
  const yMinusK = Math.round((ry - rk) * 10) / 10;
  return (
    `M${rx} ${top}` +
    `C${xPlusK} ${top} ${right} ${yMinusK} ${right} ${ry}` +
    `C${right} ${yPlusK} ${xPlusK} ${bot} ${rx} ${bot}` +
    `C${xMinusK} ${bot} ${left} ${yPlusK} ${left} ${ry}` +
    `C${left} ${yMinusK} ${xMinusK} ${top} ${rx} ${top}Z`
  );
}

/**
 * Buduje złożoną ścieżkę SVG (korpus + szyba/otwór + reflektory) pod fillRule="evenodd",
 * dzięki czemu wycięcia są prawdziwie przezroczyste na każdym tle motywu.
 */
export function interpolateTransitPath(
  from: TransitKeyframes,
  to: TransitKeyframes,
  t: number,
): string {
  'worklet';
  const clampedForCutout = t < 0 ? 0 : t > 1 ? 1 : t;
  const body = interpolateCubicSubpath(from.body, to.body, t);
  const win = interpolateCubicSubpath(from.window, to.window, t);
  const lx = from.headlight[0] + (to.headlight[0] - from.headlight[0]) * clampedForCutout;
  const ly = from.headlight[1] + (to.headlight[1] - from.headlight[1]) * clampedForCutout;
  const lr = from.headlight[2] + (to.headlight[2] - from.headlight[2]) * clampedForCutout;
  const l1 = circleSubpath(lx, ly, lr);
  const l2 = circleSubpath(100 - lx, ly, lr);
  return `${body}${win}${l1}${l2}`;
}

export function initialTransitPath(index: TransitShapeIndex = 0): string {
  const shape = TRANSIT_SHAPES[index];
  return interpolateTransitPath(shape, shape, 0);
}

/**
 * Bezpieczny indeks sylwetki dla postępu animacji.
 * NaN, Infinity i wartości ujemne sprowadza do zakresu 0..SHAPE_COUNT-1.
 */
export function transitShapeStep(progress: number): number {
  'worklet';
  if (!Number.isFinite(progress)) return 0;
  const step = Math.floor(progress) % SHAPE_COUNT;
  return step < 0 ? step + SHAPE_COUNT : step;
}
