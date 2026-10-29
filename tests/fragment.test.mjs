import test from 'node:test';
import assert from 'node:assert/strict';
import { boundary, fragmentShape } from '../src/gallery/memoryFragment.ts';

const ids = ['a1f3c2e0-0000-4000-8000-000000000001', 'b7d9e4a1-0000-4000-8000-000000000002', 'c0ffee00-0000-4000-8000-000000000003'];
const outline = id => {
  const shape = fragmentShape(id);
  return Array.from({ length: 720 }, (_, step) => {
    const theta = (step / 720) * Math.PI * 2, r = boundary(shape, theta);
    return { r, x: Math.cos(theta) * r, y: Math.sin(theta) * r };
  });
};

test('every memory fragment outline stays inside its cover frame and keeps a full, calm body', () => {
  for (const id of ids) {
    const points = outline(id);
    assert.ok(Math.max(...points.map(p => Math.max(Math.abs(p.x), Math.abs(p.y)))) <= 0.98, `${id} leaves the frame`);
    assert.ok(Math.min(...points.map(p => p.r)) >= 0.7, `${id} has a deep dent`);
  }
});

test('the same artwork always gets the same fragment, and different artworks differ', () => {
  assert.deepEqual(fragmentShape(ids[0]), fragmentShape(ids[0]));
  const [a, b] = [fragmentShape(ids[0]), fragmentShape(ids[1])];
  assert.notDeepEqual(a.noise, b.noise);
  const [ra, rb] = [outline(ids[0]), outline(ids[1])];
  const difference = ra.reduce((sum, p, i) => sum + Math.abs(p.r - rb[i].r), 0) / ra.length;
  assert.ok(difference > 0.01, `outlines too similar: ${difference}`);
});
