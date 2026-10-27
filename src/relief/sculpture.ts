import * as THREE from 'three';
import { seededRandom } from './random.ts';
import type { VisualState } from '../visual.ts';

// 默认雕塑有五种形态，共用同一批粒子：参数变化时，每颗粒子从旧形态的位置流向新形态的位置。
export const SCULPTURE_FORMS = ['gather', 'braid', 'drape', 'unfold', 'apart'] as const;
export type SculptureForm = typeof SCULPTURE_FORMS[number];

// 形态由作品参数直接决定，没有历史状态：同一组参数在回廊里恢复时一定是同一种形态。
// 某一项明显偏离中性才换形态，否则保持凝聚；离散（连贯低）优先，其次看哪一项偏得最多。
export function pickForm(visual: Pick<VisualState, 'openness' | 'tension' | 'coherence' | 'weight'>): number {
  const scores = [
    0.25,
    (visual.tension - 0.5) * 2,
    (visual.weight - 0.5) * 2,
    (visual.openness - 0.5) * 2,
    (0.5 - visual.coherence) * 2 + 0.05,
  ];
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  return best;
}

type Vec3 = [number, number, number];
type Patch = { fn: (u: number, v: number, out: Vec3) => void; sided: boolean; inside?: (u: number, v: number, out: Vec3) => void };
type FormSample = { positions: Float32Array; normals: Float32Array; ao: Float32Array; sided: Float32Array; area: number };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

// 参数曲面按面积均匀取点：先估计每块的面积分配粒子数，再按面积元做拒绝采样，
// 拉伸大的地方不会变稀。封闭曲面用内部参考点把法线翻到朝外；薄片两面都可见。
// 拒绝上限取第 99 百分位而不是最大值：球面两极的面积元在数值上会尖峰，按最大值取会几乎全被拒绝。
function samplePatches(patches: Patch[], count: number, random: () => number): FormSample {
  const h = 1e-3;
  const p: Vec3 = [0, 0, 0], pu: Vec3 = [0, 0, 0], pv: Vec3 = [0, 0, 0], ref: Vec3 = [0, 0, 0], n: Vec3 = [0, 0, 0];
  // 结果写进 n，返回面积元大小；不为每个样本创建新数组。
  const element = (patch: Patch, u: number, v: number) => {
    patch.fn(u, v, p);
    patch.fn(Math.min(1, u + h), v, pu);
    patch.fn(u, Math.min(1, v + h), pv);
    const ax = pu[0] - p[0], ay = pu[1] - p[1], az = pu[2] - p[2];
    const bx = pv[0] - p[0], by = pv[1] - p[1], bz = pv[2] - p[2];
    n[0] = ay * bz - az * by; n[1] = az * bx - ax * bz; n[2] = ax * by - ay * bx;
    return Math.hypot(n[0], n[1], n[2]) / (h * h);
  };
  const stats = patches.map(patch => {
    const samples = Array.from({ length: 1500 }, () => element(patch, random() * 0.999, random() * 0.999)).sort((a, b) => a - b);
    return { area: samples.reduce((sum, value) => sum + value, 0) / samples.length, max: samples[Math.floor(samples.length * 0.99)] * 1.3 };
  });
  const total = stats.reduce((value, item) => value + item.area, 0);
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const ao = new Float32Array(count).fill(1), sided = new Float32Array(count);
  let index = 0;
  patches.forEach((patch, k) => {
    const target = k === patches.length - 1 ? count : Math.min(count, index + Math.round(count * stats[k].area / total));
    while (index < target) {
      const u = random() * 0.999, v = random() * 0.999;
      const a = element(patch, u, v);
      if (random() * stats[k].max > a) continue;
      let scale = 1 / ((a * h * h) || 1);
      if (patch.inside) {
        patch.inside(u, v, ref);
        if (n[0] * (p[0] - ref[0]) + n[1] * (p[1] - ref[1]) + n[2] * (p[2] - ref[2]) < 0) scale = -scale;
      }
      positions[index * 3] = p[0]; positions[index * 3 + 1] = p[1]; positions[index * 3 + 2] = p[2];
      normals[index * 3] = n[0] * scale; normals[index * 3 + 1] = n[1] * scale; normals[index * 3 + 2] = n[2] * scale;
      sided[index] = patch.sided ? 1 : 0;
      index++;
    }
  });
  return { positions, normals, ao, sided, area: total };
}

// 凝聚：几块软体挤成一团，只保留并集的外表面，块与块之间的缝隙压暗。
const LOBES: { center: Vec3; radius: Vec3 }[] = [
  { center: [-0.2, 0.15, 0], radius: [1.05, 0.95, 0.8] },
  { center: [-1.35, 0.35, -0.1], radius: [0.75, 0.8, 0.65] },
  { center: [-0.95, -0.75, 0.2], radius: [0.7, 0.55, 0.6] },
  { center: [0.85, 0.6, -0.15], radius: [0.7, 0.62, 0.6] },
  { center: [1.25, -0.25, 0.1], radius: [0.8, 0.7, 0.62] },
  { center: [0.25, -0.75, 0.35], radius: [0.62, 0.48, 0.55] },
  { center: [-0.45, 0.95, 0.35], radius: [0.45, 0.4, 0.4] },
  { center: [1.9, 0.35, -0.2], radius: [0.42, 0.5, 0.42] },
  { center: [-2.0, -0.35, 0.05], radius: [0.4, 0.42, 0.38] },
];

function sampleGather(count: number, random: () => number): FormSample {
  const lobes = LOBES.map(lobe => ({
    center: lobe.center,
    radius: [lobe.radius[0] * 1.14, lobe.radius[1] * 1.14, lobe.radius[2] * 0.85] as Vec3,
  }));
  const weights = lobes.map(({ radius: [a, b, c] }) => 4 * Math.PI * (((a * b) ** 1.6075 + (a * c) ** 1.6075 + (b * c) ** 1.6075) / 3) ** (1 / 1.6075));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const maxStretch = lobes.map(lobe => 1 / Math.min(...lobe.radius));
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const ao = new Float32Array(count), sided = new Float32Array(count);
  let accepted = 0, drawn = 0;
  while (accepted < count) {
    let pick = random() * totalWeight, i = 0;
    while (i < lobes.length - 1 && pick >= weights[i]) pick -= weights[i++];
    const { center, radius } = lobes[i];
    const z = random() * 2 - 1, turn = random() * Math.PI * 2, ring = Math.sqrt(1 - z * z);
    const dx = ring * Math.cos(turn), dy = ring * Math.sin(turn);
    const stretch = Math.hypot(dx / radius[0], dy / radius[1], z / radius[2]);
    if (random() * maxStretch[i] > stretch) continue;
    drawn++;
    const bump = 1 + 0.035 * Math.sin(dx * 5.1 + dy * 3.7 + i) * Math.sin(z * 4.3 - dx * 2.9 + i * 1.7);
    const x = center[0] + radius[0] * dx * bump, y = center[1] + radius[1] * dy * bump, w = center[2] + radius[2] * z * bump;
    let hidden = false, nearest = Infinity;
    for (let j = 0; j < lobes.length && !hidden; j++) {
      if (j === i) continue;
      const other = lobes[j];
      const value = ((x - other.center[0]) / other.radius[0]) ** 2 + ((y - other.center[1]) / other.radius[1]) ** 2
        + ((w - other.center[2]) / other.radius[2]) ** 2;
      if (value < 1) hidden = true;
      nearest = Math.min(nearest, value);
    }
    if (hidden) continue;
    const n: Vec3 = [dx / radius[0], dy / radius[1], z / radius[2]];
    const size = length(n);
    positions.set([x, y, w], accepted * 3);
    normals.set([n[0] / size, n[1] / size, n[2] / size], accepted * 3);
    ao[accepted] = THREE.MathUtils.smoothstep(nearest, 1, 1.7);
    accepted++;
  }
  return { positions, normals, ao, sided, area: totalWeight * accepted / Math.max(1, drawn) };
}

// 交织：两股粗管沿三叶结绕行，彼此缠绕、前后穿过。
function trefoil(t: number, out: Vec3) {
  out[0] = 0.8 * (Math.sin(t) + 2 * Math.sin(2 * t));
  out[1] = 0.74 * (Math.cos(t) - 2 * Math.cos(2 * t));
  out[2] = -0.8 * Math.sin(3 * t);
}
// 沿结线预先算好 4096 个截面（中心、法向、副法向），取样时线性插值，不再逐点求导。
const FRAME_STEPS = 4096;
function buildBraidFrames() {
  const table = new Float32Array((FRAME_STEPS + 1) * 9);
  const c: Vec3 = [0, 0, 0], c2: Vec3 = [0, 0, 0];
  for (let i = 0; i <= FRAME_STEPS; i++) {
    const t = i / FRAME_STEPS * Math.PI * 2;
    trefoil(t, c); trefoil(t + 1e-3, c2);
    const tangent = sub(c2, c);
    const size = length(tangent) || 1;
    const unit: Vec3 = [tangent[0] / size, tangent[1] / size, tangent[2] / size];
    const side = cross(unit, [0, 0, 1]);
    const s = length(side) || 1;
    const normal: Vec3 = [side[0] / s, side[1] / s, side[2] / s];
    table.set([...c, ...normal, ...cross(unit, normal)], i * 9);
  }
  return table;
}
function braidPatches(): Patch[] {
  const table = buildBraidFrames();
  const frame = new Float32Array(9);
  const lookup = (u: number) => {
    const x = Math.min(0.999999, Math.max(0, u)) * FRAME_STEPS;
    const i = Math.floor(x), f = x - i;
    for (let k = 0; k < 9; k++) frame[k] = table[i * 9 + k] * (1 - f) + table[(i + 1) * 9 + k] * f;
  };
  return [0, Math.PI].map(phase => {
    // 每股管子绕结线中心再旋一圈半径 0.2 的螺旋，两股相差半圈，彼此缠绕。
    const axis = (u: number, out: Vec3) => {
      lookup(u);
      const t = u * Math.PI * 2;
      const a = Math.cos(t * 6 + phase) * 0.2, b = Math.sin(t * 6 + phase) * 0.2;
      for (let k = 0; k < 3; k++) out[k] = frame[k] + frame[3 + k] * a + frame[6 + k] * b;
    };
    return {
      sided: false,
      inside: (u: number, _v: number, out: Vec3) => { axis(u, out); },
      fn: (u: number, v: number, out: Vec3) => {
        axis(u, out);
        const r = 0.2 * (1 + 0.12 * Math.sin(u * Math.PI * 14 + phase));
        const turn = v * Math.PI * 2, cos = Math.cos(turn) * r, sin = Math.sin(turn) * r;
        for (let k = 0; k < 3; k++) out[k] += frame[3 + k] * cos + frame[6 + k] * sin;
      },
    };
  });
}

// 垂落：五层薄片自上而下悬垂，前后错开，下摆向内收。
function drapePatches(): Patch[] {
  return [0, 1, 2, 3, 4].map(layer => {
    const phase = layer * 0.9;
    return {
      sided: true,
      fn: (u: number, v: number, out: Vec3) => {
        const across = v * 2 - 1;
        const width = (0.35 + Math.sin(Math.PI * u) ** 0.5 * 0.65) * (0.5 + layer * 0.03);
        out[0] = (layer - 2) * 0.62 + 0.2 * Math.sin(u * 4 + phase) + across * width;
        out[1] = 1.9 - (3.5 + 0.45 * Math.sin(phase + 0.4)) * u + 0.1 * Math.cos(across * 2 + phase) - 0.28 * across * across * u;
        out[2] = (layer - 2) * 0.32 + 0.2 * Math.cos(across * Math.PI * 1.6 + phase) + 0.2 * Math.sin(u * 5 + phase);
      },
    };
  });
}

// 舒展：四条宽带从相近的起点出发，扭转着向不同方向打开。
const RIBBONS: Vec3[][] = [
  [[-2, -1.35, -0.4], [-1.7, 0.45, 0.2], [-0.25, 2.5, 0.8], [1.25, 2, -0.3]],
  [[-1.95, -1.3, -0.3], [-0.4, -0.8, 0.6], [0.5, 1.2, -0.4], [2.3, 0.5, 0.25]],
  [[-1.85, -1.4, -0.2], [-0.7, -1.8, 0.6], [1.8, -0.2, 0.7], [2.55, -0.95, -0.2]],
  [[-1.9, -1.3, -0.2], [-2, 1, 0.3], [-1.1, 1.65, -0.3], [-0.3, 2.45, 0.15]],
];
function unfoldPatches(): Patch[] {
  return RIBBONS.map(([a, b, c, d], lane) => ({
    sided: true,
    fn: (u: number, v: number, out: Vec3) => {
      const across = v * 2 - 1, s = 1 - u;
      const dx = 3 * s * s * (b[0] - a[0]) + 6 * s * u * (c[0] - b[0]) + 3 * u * u * (d[0] - c[0]);
      const dy = 3 * s * s * (b[1] - a[1]) + 6 * s * u * (c[1] - b[1]) + 3 * u * u * (d[1] - c[1]);
      const tangent = Math.hypot(dx, dy) || 1;
      const width = 0.05 + Math.sin(Math.PI * u) ** 0.65 * (0.42 + lane * 0.04);
      const twist = Math.sin(u * 4 + lane * 0.8);
      for (let k = 0; k < 3; k++) out[k] = s ** 3 * a[k] + 3 * s * s * u * b[k] + 3 * s * u * u * c[k] + u ** 3 * d[k];
      out[0] -= dy / tangent * across * width * Math.cos(twist);
      out[1] += dx / tangent * across * width * Math.cos(twist);
      out[2] += across * width * Math.sin(twist) + 0.1 * Math.sin(u * 8 + lane);
    },
  }));
}

// 离散：五团不规则的小块，彼此留着看得见的距离。
const ISLANDS: { center: Vec3; radius: number }[] = [
  { center: [-1.65, 1.0, -0.15], radius: 0.72 }, { center: [0.7, 1.55, 0.25], radius: 0.5 },
  { center: [1.75, -0.3, -0.3], radius: 0.66 }, { center: [-0.4, -0.75, 0.45], radius: 0.6 },
  { center: [-1.9, -1.55, -0.3], radius: 0.36 },
];
function apartPatches(): Patch[] {
  return ISLANDS.map(({ center, radius }, k) => ({
    sided: false,
    inside: (_u: number, _v: number, out: Vec3) => { out[0] = center[0]; out[1] = center[1]; out[2] = center[2]; },
    fn: (u: number, v: number, out: Vec3) => {
      const theta = u * Math.PI * 2, z = v * 2 - 1, ring = Math.sqrt(Math.max(0, 1 - z * z));
      const r = radius * (1 + 0.16 * Math.sin(theta * 3 + k) * Math.cos(z * 4) + 0.08 * Math.cos(theta * 5 - z * 3));
      out[0] = center[0] + Math.cos(theta) * ring * r * 1.12;
      out[1] = center[1] + z * r * 0.85;
      out[2] = center[2] + Math.sin(theta) * ring * r * 0.75;
    },
  }));
}

// 每种形态缩放到同样的画框里，取景不随形态跳动。
const FRAME = new THREE.Vector2(4.6, 3.3);
function fitToFrame(sample: FormSample) {
  const { positions } = sample;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const scale = Math.min(FRAME.x / (maxX - minX), FRAME.y / (maxY - minY));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] - cx) * scale;
    positions[i + 1] = (positions[i + 1] - cy) * scale;
    positions[i + 2] = (positions[i + 2] - cz) * scale;
  }
  sample.area *= scale * scale;
}

export function buildSculpture(count: number, dustCount: number) {
  const random = seededRandom(0x636c6179);
  const forms = [
    sampleGather(count, random),
    samplePatches(braidPatches(), count, random),
    samplePatches(drapePatches(), count, random),
    samplePatches(unfoldPatches(), count, random),
    samplePatches(apartPatches(), count, random),
  ];
  forms.forEach(fitToFrame);
  const core = new THREE.BufferGeometry();
  forms.forEach((form, k) => {
    // xyz 位置；w 打包缝隙暗度（0–1）与是否双面（+2）。
    const packed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      packed.set(form.positions.subarray(i * 3, i * 3 + 3), i * 4);
      packed[i * 4 + 3] = form.ao[i] + form.sided[i] * 2;
    }
    core.setAttribute(`aP${k}`, new THREE.BufferAttribute(packed, 4));
    core.setAttribute(`aN${k}`, new THREE.BufferAttribute(form.normals, 3));
  });
  core.setAttribute('position', new THREE.BufferAttribute(forms[0].positions, 3));
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = random();
  core.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  // 外围一圈椭圆浮尘，慢慢绕着雕塑转。
  const dustPositions = new Float32Array(dustCount * 3);
  const dustSeeds = new Float32Array(dustCount);
  for (let k = 0; k < dustCount; k++) {
    const z = random() * 2 - 1, turn = random() * Math.PI * 2, ring = Math.sqrt(1 - z * z);
    const reach = 0.78 + random() * 0.42;
    dustPositions.set([ring * Math.cos(turn) * 2.9 * reach, ring * Math.sin(turn) * 2.0 * reach, z * 1.5 * reach], k * 3);
    dustSeeds[k] = random();
  }
  const dust = new THREE.BufferGeometry();
  dust.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  dust.setAttribute('aSeed', new THREE.BufferAttribute(dustSeeds, 1));

  return {
    core, dust, count,
    size: FRAME.clone(),
    // 各形态面积不同，颗粒间距按当前形态混合，表面始终连成一片。
    spacings: forms.map(form => Math.sqrt(form.area / count) * 1.3),
  };
}

// 屏幕空间的穿透孔：粒子投到屏幕后查压痕场，再在观察空间里沿屏幕方向推开。
// r 通道是孔，前后所有层都被推到孔沿外，孔是透的；g 通道是更宽的隆起，把周围一起挤开。
const SCREEN_PUSH_GLSL = /* glsl */ `
  uniform sampler2D uDent;
  uniform vec2 uDentTexel;
  uniform vec2 uScreen;
  uniform float uScreenRadius;
  uniform float uTanHalf;
  // 返回 x 孔、y 隆起；tilt 是隆起让表面外倾的方向，用来给坑沿加明暗。
  vec2 pushAway(inout vec4 viewPosition, float seed, out vec2 tilt) {
    tilt = vec2(0.0);
    vec4 clip = projectionMatrix * viewPosition;
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    vec2 dent = texture2D(uDent, uv).rg;
    if (dent.y < 0.002) return vec2(0.0);
    vec2 ex = vec2(uDentTexel.x, 0.0);
    vec2 ey = vec2(0.0, uDentTexel.y);
    vec2 left = texture2D(uDent, uv - ex).rg, right = texture2D(uDent, uv + ex).rg;
    vec2 down = texture2D(uDent, uv - ey).rg, up = texture2D(uDent, uv + ey).rg;
    vec2 holeSlope = vec2(right.x - left.x, up.x - down.x) / (2.0 * uDentTexel * uScreen);
    vec2 swellSlope = vec2(right.y - left.y, up.y - down.y) / (2.0 * uDentTexel * uScreen);
    float scatter = seed * 6.2831853;
    float holeLength = length(holeSlope), swellLength = length(swellSlope);
    vec2 swellAway = swellLength > 1e-3 ? -swellSlope / swellLength : vec2(cos(scatter), sin(scatter));
    vec2 away = holeLength > 1e-3 ? -holeSlope / holeLength : swellAway;
    float open = 1.0 - sqrt(max(0.0, 1.0 - dent.x));
    // 屏幕上移动 1 个单位（画面高度为 2），观察空间要移动 深度 × tan(半视角)。
    float radius = uScreenRadius * -viewPosition.z * uTanHalf;
    viewPosition.xy += (away * open * (0.8 + 0.45 * fract(seed * 17.3)) + swellAway * 0.45 * dent.y) * radius;
    viewPosition.z += radius * (0.5 * dent.y + 0.25 * open);
    tilt = -swellSlope * uScreenRadius * 0.5;
    return vec2(open, dent.y);
  }
`;

const SHARED_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uSpacing;
  uniform float uSize;
  uniform float uProj;
  uniform float uSpread;
  uniform float uMinSize;
  uniform float uLight;
  uniform vec3 uTint;
  // x 开放、y 张力、z 连贯、w 轻重；0.5 是中性。
  uniform vec4 uShape;
  ${SCREEN_PUSH_GLSL}
`;

export const sculptureCoreVertex = /* glsl */ `
  ${SHARED_GLSL}
  // 五种形态的混合权重：凝聚、交织、垂落、舒展、离散。
  uniform vec4 uFormA;
  uniform float uFormB;
  attribute vec4 aP0; attribute vec4 aP1; attribute vec4 aP2; attribute vec4 aP3; attribute vec4 aP4;
  attribute vec3 aN0; attribute vec3 aN1; attribute vec3 aN2; attribute vec3 aN3; attribute vec3 aN4;
  attribute float aSeed;
  varying vec3 vColor;
  void accumulate(vec4 point, vec3 normal, float weight, inout vec3 p, inout vec3 n, inout float ao, inout float sided) {
    float twoSided = step(1.5, point.w);
    p += point.xyz * weight;
    n += normal * weight;
    ao += (point.w - twoSided * 2.0) * weight;
    sided += twoSided * weight;
  }
  void main() {
    vec3 p = vec3(0.0), n = vec3(0.0);
    float ao = 0.0, sided = 0.0;
    accumulate(aP0, aN0, uFormA.x, p, n, ao, sided);
    accumulate(aP1, aN1, uFormA.y, p, n, ao, sided);
    accumulate(aP2, aN2, uFormA.z, p, n, ao, sided);
    accumulate(aP3, aN3, uFormA.w, p, n, ao, sided);
    accumulate(aP4, aN4, uFormB, p, n, ao, sided);
    // 换形态途中粒子带一点旋流，不是直线滑过去。
    float morph = dot(uFormA, vec4(1.0) - uFormA) + uFormB * (1.0 - uFormB);
    p += vec3(sin(aSeed * 40.0 + uTime * 1.3), cos(aSeed * 31.0 + uTime * 1.1), sin(aSeed * 17.0 + uTime)) * morph * 0.6;
    n = length(n) > 1e-3 ? normalize(n) : vec3(0.0, 0.0, 1.0);

    float open = (uShape.x - 0.5) * 2.0;
    float tension = (uShape.y - 0.5) * 2.0;
    float together = max(0.0, uShape.z - 0.5) * 2.0;
    float weight = (uShape.w - 0.5) * 2.0;
    // 形态之上的连续变化：舒展变宽、沉重下沉压扁、紧绷起细褶、松弛下缘垂坠、连贯挤紧。
    p.x *= 1.0 + open * 0.1 - together * 0.06;
    p.z *= 1.0 - open * 0.12 - together * 0.06;
    p.y = p.y * (1.0 - weight * 0.1) - weight * 0.22;
    p += n * sin(dot(p, vec3(7.0, 5.0, 6.0)) + uTime * 0.6) * 0.035 * max(0.0, tension);
    p.y -= max(0.0, -tension) * 0.02 * p.x * p.x;
    p *= 1.0 + sin(uTime * 0.45) * 0.012;
    // 散开：少数表面颗粒离开表面，成为浮在旁边的碎屑。
    float flake = pow(fract(aSeed * 13.7), 14.0) * uSpread * 0.5;
    p += n * flake * 0.8 + vec3(sin(uTime * 0.4 + aSeed * 30.0), cos(uTime * 0.35 + aSeed * 20.0), 0.0) * flake * 0.15;

    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    vec3 viewNormal = normalize(normalMatrix * n);
    float facing = dot(viewNormal, normalize(-viewPosition.xyz));
    // 封闭体背面的颗粒不画，否则会透过前层空隙露出暗点；薄片两面都画，法线翻向镜头。
    if (sided < 0.5 && facing < -0.05) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    if (facing < 0.0) viewNormal = -viewNormal;
    vec2 tilt;
    vec2 pushed = pushAway(viewPosition, aSeed, tilt);
    gl_Position = projectionMatrix * viewPosition;
    viewNormal = normalize(viewNormal + vec3(tilt, 0.0));

    // 单色：受光面银白，背光和缝隙里带一点冰蓝。
    vec3 light = normalize(vec3(-0.5, 0.65, 0.6));
    float diffuse = max(dot(viewNormal, light), 0.0);
    float wrap = dot(viewNormal, light) * 0.5 + 0.5;
    float rim = pow(1.0 - max(viewNormal.z, 0.0), 2.5);
    float spec = pow(max(reflect(-light, viewNormal).z, 0.0), 28.0);
    float shade = (0.12 + 0.62 * diffuse + 0.28 * wrap) * mix(0.3, 1.0, ao);
    vec3 surface = mix(vec3(0.2, 0.25, 0.34), vec3(0.9, 0.93, 0.96), clamp(shade, 0.0, 1.0)) * (0.35 + 0.65 * shade);
    vColor = (surface + rim * 0.22 * vec3(0.7, 0.85, 1.0) + spec * 0.3) * (0.92 + 0.14 * fract(aSeed * 91.7));
    vColor *= (1.0 + pushed.x * 0.6 + pushed.y * 0.15) * uTint * uLight;
    gl_PointSize = clamp(uSpacing * uSize * (0.85 + 0.3 * fract(aSeed * 13.1)) * uProj / -viewPosition.z, uMinSize, 14.0);
  }
`;

export const sculptureDustVertex = /* glsl */ `
  ${SHARED_GLSL}
  attribute float aSeed;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float seed = aSeed;
    vec3 p = position;
    float angle = uTime * (0.03 + seed * 0.04);
    float c = cos(angle), s = sin(angle);
    p.xz = mat2(c, -s, s, c) * p.xz;
    p += vec3(sin(uTime * 0.3 + seed * 50.0), cos(uTime * 0.27 + seed * 23.0), sin(uTime * 0.22 + seed * 11.0)) * 0.05;
    p *= 1.0 + (uSpread - 0.8) * 0.3;
    p.y -= (uShape.w - 0.5) * 0.4;
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    vec2 tilt;
    pushAway(viewPosition, seed, tilt);
    gl_Position = projectionMatrix * viewPosition;
    float twinkle = 0.6 + 0.4 * sin(uTime * (0.6 + seed) + seed * 40.0);
    vColor = mix(vec3(0.55, 0.68, 0.85), vec3(0.85, 0.92, 0.98), fract(seed * 7.3)) * uTint * uLight;
    vAlpha = 0.18 * twinkle * min(1.0, 0.3 + uSpread);
    gl_PointSize = clamp(uSpacing * uSize * (0.5 + 0.8 * fract(seed * 6.1)) * uProj / -viewPosition.z, uMinSize * 0.8, 5.0);
  }
`;
