import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHAPE_COUNT,
  TRANSIT_SHAPES,
  expressiveMorphEase,
  initialTransitPath,
  interpolateTransitPath,
  transitShapeStep,
} from '../src/components/morphingShapes';

describe('morphingShapes (transit)', () => {
  it('generuje 4 spójne sylwetki transportowe w granicach viewBox 0..100', () => {
    assert.equal(SHAPE_COUNT, 4);
    const bodyLen = 2 + 24 * 6;
    const winLen = 2 + 12 * 6;
    for (let s = 0; s < SHAPE_COUNT; s++) {
      const kf = TRANSIT_SHAPES[s];
      assert.equal(kf.body.length, bodyLen, `shape ${s} body length`);
      assert.equal(kf.window.length, winLen, `shape ${s} window length`);
      for (const arr of [kf.body, kf.window]) {
        for (let i = 0; i < arr.length; i++) {
          assert.ok(Number.isFinite(arr[i]), `shape ${s} coord ${i} finite`);
          assert.ok(
            arr[i] >= 5 && arr[i] <= 95,
            `shape ${s} coord ${i}=${arr[i]} within viewBox`,
          );
        }
      }
      const [lx, ly, lr] = kf.headlight;
      assert.ok(lx >= 20 && lx <= 50);
      assert.ok(ly >= 35 && ly <= 75);
      assert.ok(lr >= 0 && lr <= 8);
    }
  });

  it('krzywa sprężysta zaczyna w 0, kończy w 1 i ma kontrolowane przesterowanie', () => {
    assert.equal(expressiveMorphEase(0), 0);
    assert.equal(expressiveMorphEase(1), 1);
    assert.equal(expressiveMorphEase(0.7), 1);

    let peak = 0;
    for (let i = 1; i < 100; i++) {
      const v = expressiveMorphEase(i / 100);
      assert.ok(Number.isFinite(v));
      if (v > peak) peak = v;
    }
    assert.ok(peak > 1.02 && peak < 1.14, `unexpected overshoot peak ${peak}`);
  });

  it('sprowadza postęp animacji do bezpiecznego indeksu sylwetki', () => {
    assert.equal(transitShapeStep(Number.NaN), 0);
    assert.equal(transitShapeStep(Number.POSITIVE_INFINITY), 0);
    assert.equal(transitShapeStep(Number.NEGATIVE_INFINITY), 0);
    assert.equal(transitShapeStep(-1), SHAPE_COUNT - 1);
    assert.equal(transitShapeStep(-0.2), SHAPE_COUNT - 1);
    for (let p = 0; p < SHAPE_COUNT * 2; p++) {
      assert.equal(transitShapeStep(p + 0.5), p % SHAPE_COUNT);
    }
  });

  it('interpolacja generuje poprawne złożone ścieżki evenodd także przy przesterowaniu', () => {
    for (const idx of [0, 1, 2, 3] as const) {
      const d = initialTransitPath(idx);
      assert.ok(d.startsWith('M') && d.endsWith('Z'));
      assert.ok(!d.includes('NaN') && !d.includes('Infinity'));
    }

    for (let s = 0; s < SHAPE_COUNT; s++) {
      const next = (s + 1) % SHAPE_COUNT;
      for (const t of [0, 0.25, 0.5, 1, 1.08]) {
        const d = interpolateTransitPath(TRANSIT_SHAPES[s], TRANSIT_SHAPES[next], t);
        assert.ok(d.startsWith('M') && d.endsWith('Z'));
        assert.ok(!d.includes('NaN') && !d.includes('Infinity'));
        const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
        assert.ok(nums.length >= 2 + 24 * 6 + 2 + 12 * 6);
        for (const n of nums) {
          assert.ok(n >= 1 && n <= 99, `interpolated coord ${n} clipped viewBox`);
        }
      }
    }
  });
});
