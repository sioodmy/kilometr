import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clampSourceRect,
  computeCloseDurationMs,
  computeDragShellFrame,
  computeGpuShellTransform,
  computePredictiveBackShellFrame,
  computeScaledStripRect,
  computeStripRect,
  isValidTransitionRect,
  shouldDismissFromGesture,
  toRelativeRect,
  topLeftScaleTranslation,
} from '../src/components/routeCardTransitionMath';

describe('routeCardTransitionMath', () => {
  it('przelicza prostokąt okna na współrzędne lokalne kontenera', () => {
    const rel = toRelativeRect({ x: 96, y: 240, width: 358, height: 164 }, { x: 80, y: 40 });
    assert.deepEqual(rel, { x: 16, y: 200, width: 358, height: 164 });
  });

  it('wylicza pozycję paska JourneyStrip względem kontenera i odrzuca puste pomiary', () => {
    const card = { x: 16, y: 210, width: 358, height: 168 };
    const strip = computeStripRect(card, { x: 16, y: 92, width: 326, height: 58 });
    assert.deepEqual(strip, { x: 32, y: 302, width: 326, height: 58 });
    assert.equal(computeStripRect(card, null), null);
    assert.equal(computeStripRect(card, { x: 0, y: 0, width: 10, height: 10 }), null);
  });

  it('waliduje widoczność prostokąta karty w kontenerze', () => {
    assert.equal(isValidTransitionRect({ x: 16, y: 180, width: 358, height: 164 }, 390, 844), true);
    assert.equal(
      isValidTransitionRect({ x: 16, y: 900, width: 358, height: 164 }, 390, 844),
      false,
    );
    assert.equal(
      isValidTransitionRect({ x: 16, y: -200, width: 358, height: 164 }, 390, 844),
      false,
    );
    assert.equal(isValidTransitionRect({ x: 16, y: 100, width: 0, height: 164 }, 390, 844), false);
    assert.equal(isValidTransitionRect(null, 390, 844), false);
  });

  it('ogranicza prostokąt źródłowy do granic kontenera', () => {
    const clamped = clampSourceRect({ x: 16, y: 840, width: 420, height: 160 }, 390, 844);
    assert.equal(clamped.width, 390);
    assert.ok(clamped.y <= 820);
  });

  it('kotwiczy lewy górny róg przy skalowaniu wokół środka', () => {
    const offset = topLeftScaleTranslation(400, 800, 0.5);
    assert.deepEqual(offset, { x: -100, y: -200 });
    const identity = topLeftScaleTranslation(400, 800, 1);
    assert.deepEqual(identity, { x: 0, y: 0 });
  });

  it('wylicza płynną ramkę odklejanego ekranu podczas interaktywnego gestu wstecz', () => {
    const atRest = computeDragShellFrame(0, 0, 0, 390, 844);
    assert.deepEqual(atRest, { x: 0, y: 0, width: 390, height: 844, radius: 0, scale: 1 });

    const mid = computeDragShellFrame(140, 30, 0.5, 390, 844);
    assert.ok(mid.scale < 1 && mid.scale > 0.85);
    assert.ok(mid.x > 40);
    assert.ok(mid.radius >= 24 && mid.radius <= 32);

    const clampedY = computeDragShellFrame(140, 2000, 0.5, 390, 844);
    const clampedYNeg = computeDragShellFrame(140, -2000, 0.5, 390, 844);
    assert.ok(clampedY.y - clampedYNeg.y <= 192.001);
  });

  it('wylicza ramkę Android Predictive Back dla lewej i prawej krawędzi z marginesem 8dp', () => {
    const rest = computePredictiveBackShellFrame(0, 0, 0, 390, 844);
    assert.deepEqual(rest, { x: 0, y: 0, width: 390, height: 844, radius: 0, scale: 1 });

    const fromLeft = computePredictiveBackShellFrame(1, 0, 0, 390, 844);
    const fromRight = computePredictiveBackShellFrame(1, 0, 1, 390, 844);
    assert.ok(Math.abs(fromLeft.scale - 0.84) < 1e-6);
    assert.equal(fromLeft.radius, 28);
    // Gest z lewej odsuwa okno w prawo (8dp marginesu po prawej), z prawej symetrycznie w lewo.
    assert.ok(Math.abs(390 - (fromLeft.x + fromLeft.width) - 8) < 1e-6);
    assert.ok(Math.abs(fromRight.x - 8) < 1e-6);
    assert.ok(fromLeft.x > fromRight.x);

    const movedDown = computePredictiveBackShellFrame(0.8, 400, 0, 390, 844);
    const movedUp = computePredictiveBackShellFrame(0.8, -400, 0, 390, 844);
    assert.ok(movedDown.y > movedUp.y);
    assert.ok(movedDown.y - movedUp.y <= 136.001);
  });

  it('wylicza dokładną przeskalowaną pozycję JourneyStrip przy puszczeniu palca', () => {
    const shell = { x: 50, y: 40, scale: 0.9 };
    const strip = computeScaledStripRect(shell, { x: 30, y: 260, width: 330, height: 56 }, 20);
    assert.equal(Math.round(strip.x), 50 + 27);
    assert.equal(Math.round(strip.y), 40 + 216);
    assert.equal(Math.round(strip.width), 297);
    assert.equal(Math.round(strip.height), Math.round(56 * 0.9));
  });

  it('poprawnie ocenia próg domknięcia gestu wstecz', () => {
    assert.equal(shouldDismissFromGesture(0.05, 100), false);
    assert.equal(shouldDismissFromGesture(0.24, 0), true);
    assert.equal(shouldDismissFromGesture(0.05, 600), true);
    assert.equal(shouldDismissFromGesture(0.15, 350), true);
    assert.equal(shouldDismissFromGesture(0.01, 600), false);
  });

  it('skraca czas zamykania przy przerwaniu otwierania w połowie', () => {
    const full = computeCloseDurationMs(1);
    const mid = computeCloseDurationMs(0.4);
    const tiny = computeCloseDurationMs(0.05);
    assert.equal(full, 215);
    assert.ok(mid < full && mid >= 115);
    assert.ok(tiny >= 115);
  });

  it('przelicza ramkę Predictive Back na transformację GPU zgodną z pozycją krawędzi', () => {
    const rest = computePredictiveBackShellFrame(0, 0, 0, 390, 844);
    assert.deepEqual(computeGpuShellTransform(rest, 390, 844), {
      translateX: 0,
      translateY: 0,
      scale: 1,
      borderRadius: 0,
    });

    for (const edge of [0, 1] as const) {
      const frame = computePredictiveBackShellFrame(1, 40, edge, 390, 844);
      const gpu = computeGpuShellTransform(frame, 390, 844);
      // Po nałożeniu translate i scale wokół środka (390/2) lewa krawędź wypada w frame.x.
      const renderedLeft = (390 * (1 - gpu.scale)) / 2 + gpu.translateX;
      const renderedTop = (844 * (1 - gpu.scale)) / 2 + gpu.translateY;
      assert.ok(Math.abs(renderedLeft - frame.x) < 1e-6);
      assert.ok(Math.abs(renderedTop - frame.y) < 1e-6);
      assert.ok(Math.abs(gpu.borderRadius * gpu.scale - frame.radius) < 1e-6);
    }
  });
});
