import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyTurn, dragTurn } from '../src/relief/turn.ts';

// 朝向观众的那一点（世界坐标 z 朝外）在转动后去了哪里。
const facing = (orientation, local) => local.clone().applyQuaternion(orientation);

test('dragging right turns the front to the right, dragging up tilts it up, and equal pixels give equal angles', () => {
  const front = new THREE.Vector3(0, 0, 1);
  const right = facing(applyTurn(new THREE.Quaternion(), dragTurn(0.2, 0, 16 / 9)), front);
  assert.ok(right.x > 0.1 && Math.abs(right.y) < 1e-9);
  const up = facing(applyTurn(new THREE.Quaternion(), dragTurn(0, 0.2, 16 / 9)), front);
  assert.ok(up.y > 0.1 && Math.abs(up.x) < 1e-9);

  // 拖过整个画面宽度约 300°；在 1600×900 的画面上竖着拖 300 像素和横着拖 300 像素转的角度一样。
  assert.ok(Math.abs(dragTurn(2, 0, 1).length() - 5.2) < 1e-9);
  const width = 1600, height = 900, pixels = 300;
  assert.ok(Math.abs(dragTurn(0, 2 * pixels / height, width / height).length() - dragTurn(2 * pixels / width, 0, width / height).length()) < 1e-9);
});

test('even upside down, the side facing you still follows the drag', () => {
  // 先竖着翻 180°，现在朝着观众的是原来的背面。
  const flipped = applyTurn(new THREE.Quaternion(), new THREE.Vector3(Math.PI, 0, 0));
  const showing = new THREE.Vector3(0, 0, 1).applyQuaternion(flipped.clone().invert());
  const moved = facing(applyTurn(flipped.clone(), dragTurn(0.2, 0, 1)), showing);
  assert.ok(moved.x > 0.1, 'dragging right should still move the visible side to the right');
});
