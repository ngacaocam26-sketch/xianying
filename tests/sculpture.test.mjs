import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForm, buildSculpture, developCurve, DEVELOP, DEVELOP_TOTAL, pickForm, SCULPTURE_FORMS } from '../src/relief/sculpture.ts';
import { describeVisual } from '../src/reveal.ts';
import { DEFAULT_VISUAL } from '../src/visual.ts';

const neutral = { openness: 0.5, tension: 0.5, coherence: 0.5, weight: 0.5 };

test('form choice is a pure function of artwork parameters, so restored works show the same form', () => {
  assert.equal(SCULPTURE_FORMS[pickForm(neutral)], 'gather');
  assert.equal(SCULPTURE_FORMS[pickForm({ ...neutral, openness: 0.6 })], 'gather');
  assert.equal(SCULPTURE_FORMS[pickForm({ ...neutral, tension: 0.9 })], 'braid');
  assert.equal(SCULPTURE_FORMS[pickForm({ ...neutral, weight: 0.9 })], 'drape');
  assert.equal(SCULPTURE_FORMS[pickForm({ ...neutral, openness: 0.9 })], 'unfold');
  assert.equal(SCULPTURE_FORMS[pickForm({ ...neutral, coherence: 0.15 })], 'apart');
  assert.equal(pickForm({ ...neutral, tension: 0.9, openness: 0.7 }), pickForm({ ...neutral, tension: 0.9, openness: 0.7 }));
});

test('every imagery form fills the same particle set, stays finite, fits the frame and has unit normals', () => {
  const count = 6000;
  assert.equal(SCULPTURE_FORMS.length, 12);
  for (let k = 0; k < SCULPTURE_FORMS.length; k++) {
    const { packed, normals, flow, spacing } = buildForm(k, count);
    assert.equal(packed.length, count * 4);
    assert.equal(normals.length, count * 3);
    assert.equal(flow.length, count);
    let maxX = 0, maxY = 0;
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < 4; j++) assert.ok(Number.isFinite(packed[i * 4 + j]));
      maxX = Math.max(maxX, Math.abs(packed[i * 4])); maxY = Math.max(maxY, Math.abs(packed[i * 4 + 1]));
      const w = packed[i * 4 + 3];
      assert.ok((w >= 0 && w <= 1) || (w >= 2 && w <= 3), `packed ao/sided ${w}`);
      assert.ok(Math.abs(Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) - 1) < 1e-3, SCULPTURE_FORMS[k]);
    }
    assert.ok(maxX <= 2.31 && maxY <= 1.66, `${SCULPTURE_FORMS[k]} fits frame (${maxX}, ${maxY})`);
    assert.ok(spacing > 0 && Number.isFinite(spacing));
  }
  // Fixed seed per form: rebuilding produces identical coordinates, so restored works match.
  assert.deepEqual(buildForm(6, count).packed, buildForm(6, count).packed);
  const built = buildSculpture(count, 500);
  assert.ok(built.load('B', 5) > 0);
  assert.deepEqual(built.core.getAttribute('aPB').array, buildForm(5, count).packed);
});

test('develop keeps the old form until the fog is open, then gathers back to a clean surface', () => {
  const gatherStart = DEVELOP.scatter + DEVELOP.hold;
  assert.equal(developCurve(0).fog, 0);
  assert.equal(developCurve(0.2).reshape, false);
  assert.equal(developCurve(DEVELOP.scatter + 0.01).fog, 1);
  assert.equal(developCurve(DEVELOP.scatter + 0.01).reshape, true);
  let previous = 1;
  for (let t = gatherStart; t <= gatherStart + DEVELOP.gather; t += 0.05) {
    const { fog } = developCurve(t);
    assert.ok(fog <= previous + 1e-9 && fog >= 0);
    previous = fog;
  }
  const end = developCurve(DEVELOP_TOTAL);
  assert.deepEqual([end.fog, end.glow, end.done], [0, 0, true]);
});

test('caption names the strongest shape changes, or says the work stayed near neutral', () => {
  assert.deepEqual(describeVisual(DEFAULT_VISUAL), ['接近中性']);
  const visual = { ...DEFAULT_VISUAL, openness: 0.15, warmth: 0.3, weight: 0.8, motion: 0.55, luminosity: 0.62 };
  assert.deepEqual(describeVisual(visual), ['内收', '下沉', '偏冷']);
});
