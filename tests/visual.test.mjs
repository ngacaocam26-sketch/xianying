import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VISUAL, validateVisual, smoothVisual } from '../src/visual.ts';

test('renderer rejects non-finite or missing parameters without accepting numeric strings', () => {
  for (const value of [null, {}, { ...DEFAULT_VISUAL, motion: NaN }, { ...DEFAULT_VISUAL, warmth: Infinity },
    { ...DEFAULT_VISUAL, dispersion: '0.2' }]) assert.equal(validateVisual(value), null);
  assert.deepEqual(validateVisual({ dispersion: -20, motion: 100, warmth: 0.5 }), { ...DEFAULT_VISUAL, dispersion: 0, motion: 1, warmth: 0.5 });
});

test('artwork transitions smoothly, stays finite during slow frames and reaches target at different frame rates', () => {
  const target = { ...DEFAULT_VISUAL, dispersion: 0.9, motion: 0.1, warmth: 0.8, openness: 0.85, coherence: 0.15 };
  const sample = { ...DEFAULT_VISUAL };
  smoothVisual(sample, target, 1 / 60);
  assert.ok(sample.dispersion > 0.5 && sample.dispersion < 0.9);
  for (const fps of [30, 60, 144]) {
    const current = { ...DEFAULT_VISUAL };
    for (let i = 0; i < fps * 5; i++) smoothVisual(current, target, 1 / fps);
    assert.deepEqual(current, target);
    smoothVisual(current, DEFAULT_VISUAL, 30);
    assert.ok(Object.values(current).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  }
});
