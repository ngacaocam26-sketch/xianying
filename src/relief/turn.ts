import * as THREE from 'three';

// 用手转雕塑：像转一个悬在空中的球。横着拖绕竖轴转，竖着拖绕横轴翻，斜着拖就斜着转；
// 转动叠在自动摆动之上、按屏幕方向算，所以不管已经转到哪一面，往哪边拖它就往哪边走。

// 横向拖过整个画面约转 300°（与之前只能左右转时一样）；竖着拖同样多的像素，转同样的角度。
export const TURN_PER_SCREEN = 2.6;

// 一次拖动（画面坐标 -1…1 的增量，y 向上）换成转动向量：方向是转轴，长度是弧度。aspect 为画面宽 / 高。
export function dragTurn(dx: number, dy: number, aspect: number, out = new THREE.Vector3()) {
  return out.set(-dy * TURN_PER_SCREEN / aspect, dx * TURN_PER_SCREEN, 0);
}

const step = new THREE.Quaternion();
const axis = new THREE.Vector3();
// 把转动向量（乘以 scale，比如一帧的秒数）叠到朝向上，按世界坐标转。
export function applyTurn(orientation: THREE.Quaternion, vector: THREE.Vector3, scale = 1) {
  const angle = vector.length() * scale;
  if (angle < 1e-9) return orientation;
  step.setFromAxisAngle(axis.copy(vector).normalize(), angle);
  return orientation.premultiply(step).normalize();
}
