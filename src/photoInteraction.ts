import type { PhotoParticleData } from './photoToParticles';

export interface PhotoBrush {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  radius: number;
}

export interface PhotoMotion {
  velocity: Float32Array;
  coupling: Float32Array;
  frequency: Float32Array;
  drift: Float32Array;
}

// 固定的逐点响应，不改变照片坐标、颜色、点径或透明度。
export function createPhotoMotion(photo: PhotoParticleData, velocity: Float32Array): PhotoMotion {
  const count = photo.alphas.length;
  const coupling = new Float32Array(count);
  const frequency = new Float32Array(count);
  const drift = new Float32Array(count * 3);
  let seed = 0x78696e67;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    // 仅少量粒子明显扬起，多数只轻轻移动，避免整片照片压成发亮的堤岸。
    coupling[i] = 0.012 + random() ** 5 * 0.988;
    frequency[i] = 0.82 + random() * 0.38;
    drift[i * 3] = random() * 2 - 1;
    drift[i * 3 + 1] = random() * 2 - 1;
    drift[i * 3 + 2] = random() * 2 - 1;
  }
  return { velocity, coupling, frequency, drift };
}

// 每帧只处理真实划动的轨迹；停止输入后速度仍连续存在。
// 返回位移/速度的最大分量，只有两者都归零才能停止按需渲染。
export function updatePhotoDisplacement(
  photo: PhotoParticleData,
  displacement: Float32Array,
  motion: PhotoMotion,
  delta: number,
  time: number,
  brushes: readonly PhotoBrush[],
) {
  const dt = Math.max(0, Math.min(delta, 0.05));
  const strokes = brushes.map(brush => {
    const sx = brush.x - brush.previousX;
    const sy = brush.y - brush.previousY;
    const length = Math.hypot(sx, sy);
    return { ...brush, sx, sy, length,
      samples: Math.min(32, Math.max(1, Math.ceil(length / (brush.radius * 0.3)))),
      minX: Math.min(brush.x, brush.previousX) - brush.radius * 1.2,
      maxX: Math.max(brush.x, brush.previousX) + brush.radius * 1.2,
      minY: Math.min(brush.y, brush.previousY) - brush.radius * 1.2,
      maxY: Math.max(brush.y, brush.previousY) + brush.radius * 1.2,
    };
  }).filter(stroke => stroke.length > 0.00001);
  const { velocity, coupling, frequency, drift } = motion;
  const shortEdge = Math.min(photo.worldWidth, photo.worldHeight);
  const travelScale = Math.min(1, shortEdge / 4);
  let activity = 0;

  for (let i = 0; i < photo.alphas.length; i++) {
    const o = i * 3;
    let vx = velocity[o], vy = velocity[o + 1], vz = velocity[o + 2];
    const ox = displacement[o], oy = displacement[o + 1], oz = displacement[o + 2];
    const bx = photo.positions[o], by = photo.positions[o + 1];
    const flow = photo.flows[i];
    const phase = photo.phases[i];
    let x = 0, y = 0, hasFlow = false;
    for (const stroke of strokes) {
      if (photo.alphas[i] < 0.005
        || bx + ox < stroke.minX - flow * 1.3 || bx + ox > stroke.maxX + flow * 1.3
        || by + oy < stroke.minY - flow * 1.25 || by + oy > stroke.maxY + flow * 1.25) continue;
      if (!hasFlow) {
        x = bx + ox + flow * (Math.sin(by * 2.4 + time * 0.5) + 0.3 * Math.sin(phase + time * 0.8));
        y = by + oy + flow * (Math.sin(bx * 2 + by * 1.4 + time * 0.65) + 0.25 * Math.cos(phase + time * 0.6));
        hasFlow = true;
      }
      // 软边界与逐点错位：轨迹积分不会盖圆形印章，也没有单位径向向量的奇点。
      const warpX = stroke.radius * (0.1 * Math.sin(by * 3.1) + drift[o] * 0.09);
      const warpY = stroke.radius * (0.1 * Math.sin(bx * 2.7) + drift[o + 1] * 0.09);
      let weight = 0;
      for (let s = 0; s < stroke.samples; s++) {
        const t = (s + 0.5) / stroke.samples;
        const dx = (x - stroke.previousX - stroke.sx * t + warpX) / stroke.radius;
        const dy = (y - stroke.previousY - stroke.sy * t + warpY) / stroke.radius;
        const q = Math.max(0, 1 - dx * dx - dy * dy);
        weight += q * q * q / stroke.samples;
      }
      const turn = 0.22 * Math.sin(bx * 2.2 + by * 2.8) + drift[o + 1] * 0.65;
      const gain = weight * coupling[i] * 5.4;
      // 只施加速度冲量，不直接改位置。反向移动先减速再转向。
      vx += (stroke.sx * (0.85 + drift[o] * 0.15) - stroke.sy * turn) * gain;
      vy += (stroke.sy * (0.85 + drift[o] * 0.15) + stroke.sx * turn) * gain;
      vz += stroke.length * drift[o + 2] * gain * 0.42;
    }
    // 平滑限制速度与大幅移动：不在统一半径处硬截断，避免新的亮环。
    const speed = Math.hypot(vx, vy, vz);
    const speedLimit = travelScale * (0.4 + coupling[i] * 0.95);
    if (speed > speedLimit) {
      const scale = speedLimit / speed;
      vx *= scale; vy *= scale; vz *= scale;
    }
    const distance = Math.hypot(ox, oy, oz);
    const overflow = Math.max(0, distance / Math.max(travelScale * 0.7, 0.001) - 1);
    const omega = frequency[i] * (1 + overflow * overflow);
    // 临界阻尼解析解：位置与速度连续，短暂惯性后缓慢收拢，无机械振荡。
    const decay = Math.exp(-omega * dt);
    const ax = vx + omega * ox, ay = vy + omega * oy, az = vz + omega * oz;
    displacement[o] = (ox + ax * dt) * decay;
    displacement[o + 1] = (oy + ay * dt) * decay;
    displacement[o + 2] = (oz + az * dt) * decay;
    velocity[o] = (vx - omega * ax * dt) * decay;
    velocity[o + 1] = (vy - omega * ay * dt) * decay;
    velocity[o + 2] = (vz - omega * az * dt) * decay;
    for (let axis = 0; axis < 3; axis++) {
      const magnitude = Math.max(Math.abs(displacement[o + axis]), Math.abs(velocity[o + axis]));
      if (magnitude < 0.00001) {
        displacement[o + axis] = 0;
        velocity[o + axis] = 0;
      } else activity = Math.max(activity, magnitude);
    }
  }
  return activity;
}
