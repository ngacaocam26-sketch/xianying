import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSculpture, pickForm, SCULPTURE_FORMS } from '../src/relief/sculpture.ts';

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

test('all five forms share one particle set, stay finite, fit the same frame and have unit normals', () => {
  const count = 6000;
  const built = buildSculpture(count, 500);
  assert.equal(built.count, count);
  assert.equal(built.spacings.length, 5);
  for (let k = 0; k < 5; k++) {
    const points = built.core.getAttribute(`aP${k}`).array;
    const normals = built.core.getAttribute(`aN${k}`).array;
    assert.equal(points.length, count * 4);
    assert.equal(normals.length, count * 3);
    let maxX = 0, maxY = 0;
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < 4; j++) assert.ok(Number.isFinite(points[i * 4 + j]));
      maxX = Math.max(maxX, Math.abs(points[i * 4])); maxY = Math.max(maxY, Math.abs(points[i * 4 + 1]));
      const w = points[i * 4 + 3];
      assert.ok((w >= 0 && w <= 1) || (w >= 2 && w <= 3), `packed ao/sided ${w}`);
      assert.ok(Math.abs(Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) - 1) < 1e-3);
    }
    assert.ok(maxX <= 2.31 && maxY <= 1.66, `${SCULPTURE_FORMS[k]} fits frame`);
    assert.ok(built.spacings[k] > 0 && Number.isFinite(built.spacings[k]));
  }
  // Fixed seed: rebuilding produces identical coordinates.
  assert.deepEqual(buildSculpture(count, 500).core.getAttribute('aP2').array, built.core.getAttribute('aP2').array);
});
