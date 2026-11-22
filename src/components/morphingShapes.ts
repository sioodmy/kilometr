/**
 * Geometria i interpolacja kształtów M3 Expressive dla wskaźnika ładowania.
 * Każdy kształt ma identyczną liczbę segmentów Béziera w tym samym porządku
 * kątowym, dzięki czemu morfing na wątku UI nigdy się nie skręca ani nie tnie.
 */

const SAMPLE_COUNT = 24;
const CENTER = 50;

type Point = readonly [number, number];

function polarShape(radiusAt: (angle: number) => number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const angle = (Math.PI * 2 * i) / SAMPLE_COUNT;
    const r = radiusAt(angle);
    pts.push([CENTER + Math.cos(angle) * r, CENTER + Math.sin(angle) * r]);
  }
  return pts;
}

function superellipseShape(
  rx: number,
  ry: number,
  exponent: number,
  rotateRad = 0,
): Point[] {
  const pts: Point[] = [];
  const cosR = Math.cos(rotateRad);
  const sinR = Math.sin(rotateRad);
  const power = 2 / exponent;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const angle = (Math.PI * 2 * i) / SAMPLE_COUNT;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const lx = rx * Math.sign(ca) * Math.pow(Math.abs(ca), power);
    const ly = ry * Math.sign(sa) * Math.pow(Math.abs(sa), power);
    const x = CENTER + lx * cosR - ly * sinR;
    const y = CENTER + lx * sinR + ly * cosR;
    pts.push([x, y]);
  }
  return pts;
}

/** Zamienia zamkniętą pętlę punktów na płaską tablicę krzywych sześciennych Catmull-Rom. */
function closedPointsToCubicArray(pts: readonly Point[]): readonly number[] {
  const n = pts.length;
  const out: number[] = [pts[0][0], pts[0][1]];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];

    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;

    out.push(c1x, c1y, c2x, c2y, p2[0], p2[1]);
  }
  return out;
}

/**
 * Sześć wyrazistych kształtów M3 Expressive w widoku 0..100:
 * gwiazda miękka -> kapsuła -> koniczyna -> miękki trójkąt -> poduszka -> ciastko.
 */
export const MORPH_SHAPES: readonly (readonly number[])[] = [
  // 0: Soft Burst (6-ramienna gwiazda)
  closedPointsToCubicArray(polarShape((a) => 33.5 + 8.5 * Math.cos(6 * a))),
  // 1: Stadium Pill (pozioma kapsuła)
  closedPointsToCubicArray(superellipseShape(42, 24.5, 3.2, 0)),
  // 2: 4-Leaf Clover (koniczyna)
  closedPointsToCubicArray(polarShape((a) => 32.5 + 9.2 * Math.cos(4 * a))),
  // 3: Soft Triangle (zaokrąglony trójkąt)
  closedPointsToCubicArray(polarShape((a) => 35 + 7.4 * Math.cos(3 * a - Math.PI / 2))),
  // 4: Cushion Diamond (miękki romb / squircle 45°)
  closedPointsToCubicArray(superellipseShape(39, 39, 3.8, Math.PI / 4)),
  // 5: 8-Scalloped Cookie (karbowane ciastko)
  closedPointsToCubicArray(polarShape((a) => 37 + 4.4 * Math.cos(8 * a))),
];

export const SHAPE_COUNT = MORPH_SHAPES.length;

/** Czas jednego kroku morfingu w ms (krótkie wyhamowanie pozwala odczytać kształt). */
export const MORPH_STEP_MS = 650;

/**
 * Ułamek kroku przeznaczony na sam morfing; reszta to spokojny przystanek
 * kształtu przy ciągłym, łagodnym obrocie.
 */
const MORPH_ACTIVE_FRACTION = 0.82;
const DAMPING = 5.8;
const OMEGA = 7.2;
const RAW_SPRING_AT_ONE =
  1 - Math.exp(-DAMPING) * (Math.cos(OMEGA) + (DAMPING / OMEGA) * Math.sin(OMEGA));

/** Krzywa sprężystego przejścia M3 Expressive z lekkim przesterowaniem (~8%). */
export function expressiveMorphEase(localT: number): number {
  'worklet';
  if (localT <= 0) return 0;
  if (localT >= MORPH_ACTIVE_FRACTION) return 1;
  const u = localT / MORPH_ACTIVE_FRACTION;
  const raw =
    1 - Math.exp(-DAMPING * u) * (Math.cos(OMEGA * u) + (DAMPING / OMEGA) * Math.sin(OMEGA * u));
  return raw / RAW_SPRING_AT_ONE;
}

/** Buduje ścieżkę SVG między dwoma kształtami bezpośrednio w worklecie Reanimated. */
export function interpolateShapePath(
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

export const INITIAL_SHAPE_PATH = interpolateShapePath(MORPH_SHAPES[0], MORPH_SHAPES[0], 0);
