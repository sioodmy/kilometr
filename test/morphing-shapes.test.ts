import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_SHAPE_PATH,
  MORPH_SHAPES,
  SHAPE_COUNT,
  expressiveMorphEase,
  interpolateShapePath,
} from '../src/components/morphingShapes';

describe('morphingShapes', () => {
  it('generuje spójne kształty M3 Expressive w granicach viewBox 0..100', () => {
    assert.equal(SHAPE_COUNT, 6);
    const expectedLen = 2 + 24 * 6;
    for (let s = 0; s < SHAPE_COUNT; s++) {
      const coords = MORPH_SHAPES[s];
      assert.equal(coords.length, expectedLen, `shape ${s} length`);
      for (let i = 0; i < coords.length; i++) {
        assert.ok(Number.isFinite(coords[i]), `shape ${s} coord ${i} finite`);
        assert.ok(
          coords[i] >= 2 && coords[i] <= 98,
          `shape ${s} coord ${i}=${coords[i]} within viewBox`,
        );
      }
    }
  });

  it('krzywa sprężysta zaczyna w 0, kończy w 1 i ma kontrolowane przesterowanie', () => {
    assert.equal(expressiveMorphEase(0), 0);
    assert.equal(expressiveMorphEase(1), 1);
    assert.equal(expressiveMorphEase(0.85), 1);

    let peak = 0;
    for (let i = 1; i < 100; i++) {
      const v = expressiveMorphEase(i / 100);
      assert.ok(Number.isFinite(v));
      if (v > peak) peak = v;
    }
    assert.ok(peak > 1.02 && peak < 1.15, `unexpected overshoot peak ${peak}`);
  });

  it('interpolacja generuje poprawną zamkniętą ścieżkę SVG także przy przesterowaniu', () => {
    assert.ok(INITIAL_SHAPE_PATH.startsWith('M'));
    assert.ok(INITIAL_SHAPE_PATH.endsWith('Z'));
    assert.ok(!INITIAL_SHAPE_PATH.includes('NaN'));

    for (let s = 0; s < SHAPE_COUNT; s++) {
      const next = (s + 1) % SHAPE_COUNT;
      for (const t of [0, 0.25, 0.5, 1, 1.09]) {
        const d = interpolateShapePath(MORPH_SHAPES[s], MORPH_SHAPES[next], t);
        assert.ok(d.startsWith('M') && d.endsWith('Z'));
        assert.ok(!d.includes('NaN') && !d.includes('Infinity'));
        const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
        assert.equal(nums.length, 2 + 24 * 6);
        for (const n of nums) {
          assert.ok(n >= 1 && n <= 99, `interpolated coord ${n} clipped viewBox`);
        }
      }
    }
  });
});
