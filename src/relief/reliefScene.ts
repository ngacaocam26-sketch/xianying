import * as THREE from 'three';
import { DEFAULT_VISUAL, smoothVisual } from '../visual';
import type { VisualState } from '../visual';
import { activityLevel } from '../emotionShape';
import type { ActivitySignal } from '../emotionShape';
import { seededRandom } from './random';
import { buildSculpture, developCurve, formBehavior, pickForm, sculptureCoreVertex, sculptureDustVertex } from './sculpture';
import { imageIndex } from '../imagery';
import type { ImageId } from '../imagery';

// 雕塑的小洞以屏幕为准：试验页的孔半径 0.24（照片宽 5）约等于画面高度的 1/20。
const SCREEN_RADIUS_PER_WORLD = 0.42;
// 压痕分两层：孔的核心只占设定半径的七成，外面还有三倍宽的柔和隆起把材料往外挤，
// 两者叠加后看得见的孔与原来差不多大，但孔外的画面会被推开、鼓起，像按进软泥。
const HOLE_CORE = 0.7;
const SWELL_SPAN = 3;

export interface ReliefParams {
  density: number;
  size: number;
  relief: number;
  spread: number;
  radius: number;
  recover: number;
}

export const DEFAULT_RELIEF: ReliefParams = {
  density: 480, size: 1.8, relief: 0.35, spread: 0.45, radius: 0.24, recover: 0.9,
};

// color 用于取色；height 是模糊过的小图，只用来推起浮雕厚度。
export interface ReliefSource { color: HTMLCanvasElement; height: HTMLCanvasElement; aspect: number }

export interface ReliefOptions {
  params: ReliefParams;
  onStats?: (count: number) => void;
  onError?: (message: string | null) => void;
  // 主页面传入顶栏与底部输入条占用的像素，画面只在两者之间取景。
  insets?: () => { top: number; bottom: number };
  activity?: { current: ActivitySignal };
}

export interface ReliefScene {
  setSource: (source: ReliefSource) => void;
  // 没有照片时的默认雕塑：几块软体挤成的一团，作品参数改变它的形态。
  setSculpture: () => void;
  setParams: (params: ReliefParams) => void;
  // 作品参数只改变光感、冷暖、流速和散开程度，照片主体保持可辨认。
  setVisual: (visual: VisualState) => void;
  // 大模型选出的意象；null 时按参数规则从最早的五种形态里选（旧作品与默认状态）。
  setForm: (form: { image: ImageId; variant: number } | null) => void;
  // AI 给出新参数后调用：雕塑先散成雾再凝聚成新形态，照片边缘散开再收回。
  develop: () => void;
  // 凝结后时间停住，仍可以拨动；phase 用于从回廊恢复同一刻。
  setFrozen: (frozen: boolean, phase?: number) => void;
  setActive: (active: boolean) => void;
  refit: () => void;
  capture: () => { thumbnail: string; phase: number; visual: VisualState };
  dispose: () => void;
}

// 不规则圆角轮廓：越接近 1 越靠外缘。JS 采样浮尘与着色器使用同一公式。
const CONTOUR_GLSL = /* glsl */ `
  float contour(vec2 uv) {
    vec2 n = uv * 2.0 - 1.0;
    float r = pow(pow(abs(n.x), 4.0) + pow(abs(n.y), 4.0), 0.25);
    return r + sin(n.x * 7.0 + n.y * 4.0) * 0.035 + sin(n.y * 10.0 - n.x * 3.0) * 0.025
      + sin(atan(n.y, n.x) * 5.0 + 1.3) * 0.03;
  }
`;

function contour(u: number, v: number) {
  const x = u * 2 - 1;
  const y = v * 2 - 1;
  const r = (Math.abs(x) ** 4 + Math.abs(y) ** 4) ** 0.25;
  return r + Math.sin(x * 7 + y * 4) * 0.035 + Math.sin(y * 10 - x * 3) * 0.025
    + Math.sin(Math.atan2(y, x) * 5 + 1.3) * 0.03;
}

const SURFACE_GLSL = /* glsl */ `
  uniform sampler2D uPhoto;
  uniform sampler2D uHeight;
  uniform sampler2D uDent;
  uniform vec2 uWorld;
  uniform vec2 uDentTexel;
  uniform vec2 uHeightTexel;
  uniform float uRelief;
  uniform float uRadius;
  uniform float uTime;
  uniform float uSpacing;
  uniform float uSize;
  uniform float uProj;
  uniform float uSpread;
  uniform float uMinSize;
  uniform float uLight;
  uniform vec3 uTint;
  ${CONTOUR_GLSL}
  // 亮处略微隆起，再整体弯成轻微的穹面，让照片像一块有厚度的材料。
  float heightAt(vec2 uv) {
    float l = dot(texture2D(uHeight, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
    vec2 n = uv * 2.0 - 1.0;
    return l * uRelief - dot(n, n) * 0.22;
  }
  // r：孔（1-(d/R)²）；g：外围隆起（(1-(d/3R)²)²）。
  vec2 dentAt(vec2 uv) { return texture2D(uDent, uv).rg; }
`;

const coreVertex = /* glsl */ `
  ${SURFACE_GLSL}
  varying vec3 vColor;
  void main() {
    vec2 uv = position.xy;
    float seed = position.z;
    float edge = contour(uv);
    float vanish = smoothstep(0.72, 1.02, edge);
    // 外缘按概率逐渐稀疏，而不是一刀裁齐。
    if (fract(seed * 7.13) < vanish) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    vec2 ex = vec2(uDentTexel.x, 0.0);
    vec2 ey = vec2(0.0, uDentTexel.y);
    vec2 dent = dentAt(uv);
    vec2 dentLeft = dentAt(uv - ex), dentRight = dentAt(uv + ex);
    vec2 dentDown = dentAt(uv - ey), dentUp = dentAt(uv + ey);
    vec2 holeSlope = vec2(dentRight.x - dentLeft.x, dentUp.x - dentDown.x) / (2.0 * uDentTexel * uWorld);
    vec2 swellSlope = vec2(dentRight.y - dentLeft.y, dentUp.y - dentDown.y) / (2.0 * uDentTexel * uWorld);
    vec2 hx = vec2(uHeightTexel.x, 0.0);
    vec2 hy = vec2(0.0, uHeightTexel.y);
    vec2 heightSlope = vec2(heightAt(uv + hx) - heightAt(uv - hx), heightAt(uv + hy) - heightAt(uv - hy))
      / (2.0 * uHeightTexel * uWorld);
    vec3 p = vec3((uv - 0.5) * uWorld, heightAt(uv));

    // 孔：由 1-(r/R)² 反推离孔心的距离，把孔内粒子推到孔沿；随机幅度让孔口不是一刀切的圆。
    // 隆起：越远推得越少，周围的材料被一起挤开；回弹时两层同时变浅，孔从外向内合上。
    float scatter = seed * 6.2831853;
    float holeLength = length(holeSlope), swellLength = length(swellSlope);
    vec2 swellAway = swellLength > 1e-3 ? -swellSlope / swellLength : vec2(cos(scatter), sin(scatter));
    vec2 away = holeLength > 1e-3 ? -holeSlope / holeLength : swellAway;
    float open = 1.0 - sqrt(max(0.0, 1.0 - dent.x));
    p.xy += away * uRadius * open * (0.8 + 0.45 * fract(seed * 17.3)) + swellAway * uRadius * 0.45 * dent.y;
    // 被挤开的材料向上鼓起，法线随之外倾：坑沿一侧受光，一侧落进阴影。
    p.z += uRadius * (0.5 * dent.y + 0.25 * open);
    vec3 normal = normalize(vec3(-heightSlope * 0.6 - swellSlope * uRadius * 0.5, 1.0));

    vec2 outward = normalize(uv * 2.0 - 1.0 + 1e-4);
    float drift = pow(vanish, 1.4) * uSpread;
    p.xy += outward * drift * (0.15 + fract(seed * 3.71)) * 0.5;
    p.z += drift * (fract(seed * 5.3) - 0.5) * 0.8;
    p += vec3(sin(uTime * 0.5 + seed * 40.0), cos(uTime * 0.43 + seed * 31.0), sin(uTime * 0.37 + seed * 17.0))
      * 0.03 * vanish * (0.3 + uSpread);
    p.z += sin(uTime * 0.6 + uv.x * 4.0 + uv.y * 3.0) * 0.025;

    vec3 light = normalize(vec3(-0.45, 0.6, 0.75));
    float shade = max(dot(normal, light), 0.0) / light.z;
    float grain = 0.9 + 0.16 * fract(seed * 91.7);
    vec3 photo = texture2D(uPhoto, uv).rgb;
    vColor = photo * mix(0.35, 1.0, clamp(shade, 0.0, 1.6)) * grain;
    // 被挤压的材料略亮一些，坑沿的明暗主要来自上面的法线。
    vColor *= (1.0 + open * 0.6 + dent.y * 0.15) * uTint * uLight;

    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(uSpacing * uSize * (0.85 + 0.3 * fract(seed * 13.1)) * (1.0 - vanish * 0.45)
      * uProj / -viewPosition.z, uMinSize, 14.0);
  }
`;

const coreFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c);
    if (r2 > 0.25) discard;
    // 每颗中心略亮，近看仍是颗粒，远看连成表面。
    gl_FragColor = vec4(vColor * (1.04 - r2 * 0.5), 1.0);
    #include <colorspace_fragment>
  }
`;

const dustVertex = /* glsl */ `
  ${SURFACE_GLSL}
  attribute float aDrift;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 uv = position.xy;
    float seed = position.z;
    float edge = contour(uv);
    float angle = aDrift * 6.2831853;
    vec2 direction = normalize(normalize(uv * 2.0 - 1.0 + 1e-4) + vec2(cos(angle), sin(angle)) * 0.45);
    // 每颗浮尘循环地从照片上剥离、向外飘远、再淡出。
    float life = fract(uTime * (0.025 + aDrift * 0.035) + seed);
    float reach = (0.1 + pow(fract(seed * 4.17), 2.5) * 1.2) * (0.3 + uSpread) * (0.2 + edge * 0.8);
    float travel = reach * (0.15 + life);
    vec3 p = vec3((uv - 0.5) * uWorld, heightAt(uv));
    p.xy += direction * travel;
    p.z += (fract(seed * 9.7) - 0.5) * travel * 0.9;
    p.xy += vec2(sin(uTime * 0.3 + seed * 50.0), cos(uTime * 0.27 + seed * 23.0)) * 0.05 * travel;

    vColor = (texture2D(uPhoto, uv).rgb * 1.25 + 0.03) * uTint * uLight;
    vAlpha = sin(life * 3.14159) * (0.18 + 0.36 * fract(seed * 2.3))
      * max(smoothstep(0.55, 0.95, edge), 0.15) * min(1.0, 0.25 + uSpread * 1.5);

    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(uSpacing * uSize * (0.6 + 0.8 * fract(seed * 6.1)) * uProj / -viewPosition.z,
      uMinSize * 0.8, 6.0);
  }
`;

const dustFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float alpha = (1.0 - smoothstep(0.2, 1.0, r)) * vAlpha;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(vColor, alpha);
    #include <colorspace_fragment>
  }
`;

// 压痕场：上一帧略微模糊并衰减，再与本帧光标扫过的圆形压痕取最大值。
const stampVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const stampFragment = /* glsl */ `
  uniform sampler2D uPrevious;
  uniform vec2 uTexel;
  uniform vec2 uWorld;
  uniform vec2 uFrom;
  uniform vec2 uTo;
  uniform float uRadius;
  uniform float uSpan;
  uniform float uStrength;
  uniform float uDecay;
  varying vec2 vUv;
  void main() {
    vec2 previous = texture2D(uPrevious, vUv).rg * 0.8
      + (texture2D(uPrevious, vUv + vec2(uTexel.x, 0.0)).rg + texture2D(uPrevious, vUv - vec2(uTexel.x, 0.0)).rg
      + texture2D(uPrevious, vUv + vec2(0.0, uTexel.y)).rg + texture2D(uPrevious, vUv - vec2(0.0, uTexel.y)).rg) * 0.05;
    vec2 p = vUv * uWorld;
    vec2 a = uFrom * uWorld;
    vec2 ab = uTo * uWorld - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float d = length(p - a - ab * t) / uRadius;
    float cap = d < 1.0 ? 1.0 - d * d : 0.0;
    float w = d / uSpan;
    float swell = w < 1.0 ? (1.0 - w * w) * (1.0 - w * w) : 0.0;
    gl_FragColor = vec4(max(previous * uDecay, vec2(cap, swell) * uStrength), 0.0, 1.0);
  }
`;

// 抖动网格：每格一颗，位置随机偏移，避免出现规则的点阵纹理。
function buildCore(aspect: number, longEdge: number) {
  const cols = Math.round(aspect >= 1 ? longEdge : longEdge * aspect);
  const rows = Math.round(aspect >= 1 ? longEdge / aspect : longEdge);
  const random = seededRandom(0x72656c66);
  const data = new Float32Array(cols * rows * 3);
  let offset = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      data[offset++] = (x + 0.5 + (random() - 0.5) * 0.9) / cols;
      data[offset++] = (y + 0.5 + (random() - 0.5) * 0.9) / rows;
      data[offset++] = random();
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data, 3));
  return { geometry, cols, count: cols * rows };
}

// 浮尘主要从外缘剥离，内部只留极少量。
function buildDust(count: number) {
  const random = seededRandom(0x64757374);
  const data = new Float32Array(count * 3);
  const drift = new Float32Array(count);
  let accepted = 0;
  while (accepted < count) {
    const u = random();
    const v = random();
    const edge = contour(u, v);
    const t = Math.max(0, Math.min(1, (edge - 0.55) / 0.4));
    const weight = (edge < 1.08 ? t * t * (3 - 2 * t) : 0) + 0.04;
    if (random() > weight) continue;
    data[accepted * 3] = u;
    data[accepted * 3 + 1] = v;
    data[accepted * 3 + 2] = random();
    drift[accepted] = random();
    accepted++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data, 3));
  geometry.setAttribute('aDrift', new THREE.BufferAttribute(drift, 1));
  return geometry;
}

function createTarget(width: number, height: number) {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
}

export function createReliefScene(container: HTMLElement, ring: HTMLElement, options: ReliefOptions): ReliefScene {
  const { onStats, onError, insets, activity } = options;
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x040507, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '照片粒子浮雕。移动指针或按住拖动，会把粒子推开成一个小洞，离开后慢慢合上。');
  container.appendChild(canvas);

  let params = { ...options.params };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const group = new THREE.Group();
  scene.add(group);

  const uniforms = {
    uPhoto: { value: null as THREE.Texture | null },
    uHeight: { value: null as THREE.Texture | null },
    uDent: { value: null as THREE.Texture | null },
    uWorld: { value: new THREE.Vector2(5, 3.3) },
    uDentTexel: { value: new THREE.Vector2() },
    uHeightTexel: { value: new THREE.Vector2() },
    uRelief: { value: params.relief },
    uRadius: { value: params.radius * HOLE_CORE },
    uTime: { value: 0 },
    uSpacing: { value: 0.01 },
    uSize: { value: params.size },
    uProj: { value: 1 },
    uSpread: { value: params.spread },
    uMinSize: { value: 1 },
    uLight: { value: 1 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uShape: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) },
    uMix: { value: 0 },
    uBehaviorA: { value: 0 },
    uBehaviorB: { value: 0 },
    uVariantA: { value: new THREE.Vector4(0, 1, 1, 0) },
    uVariantB: { value: new THREE.Vector4(0, 1, 1, 0) },
    uHeat: { value: 0 },
    uDevelop: { value: 0 },
    uScreen: { value: new THREE.Vector2(2, 2) },
    uScreenRadius: { value: params.radius * SCREEN_RADIUS_PER_WORLD },
    uTanHalf: { value: 1 },
  };
  const coreMaterial = new THREE.ShaderMaterial({
    uniforms, vertexShader: coreVertex, fragmentShader: coreFragment,
    depthTest: true, depthWrite: true,
  });
  const dustMaterial = new THREE.ShaderMaterial({
    uniforms, vertexShader: dustVertex, fragmentShader: dustFragment,
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const sculptureMaterial = new THREE.ShaderMaterial({
    uniforms, vertexShader: sculptureCoreVertex, fragmentShader: coreFragment,
    depthTest: true, depthWrite: true,
  });
  const sculptureDustMaterial = new THREE.ShaderMaterial({
    uniforms, vertexShader: sculptureDustVertex, fragmentShader: dustFragment,
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  const stampUniforms = {
    uPrevious: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2() },
    // 照片模式是照片平面，雕塑模式是屏幕；每帧按当前内容设置。
    uWorld: { value: new THREE.Vector2(5, 3.3) },
    uFrom: { value: new THREE.Vector2() },
    uTo: { value: new THREE.Vector2() },
    uRadius: { value: params.radius * HOLE_CORE },
    uSpan: { value: SWELL_SPAN },
    uStrength: { value: 0 },
    uDecay: { value: 1 },
  };
  const stampMaterial = new THREE.ShaderMaterial({
    uniforms: stampUniforms, vertexShader: stampVertex, fragmentShader: stampFragment,
    depthTest: false, depthWrite: false,
  });
  const stampScene = new THREE.Scene();
  const stampQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), stampMaterial);
  stampQuad.frustumCulled = false;
  stampScene.add(stampQuad);
  const stampCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let mode: 'photo' | 'sculpture' | null = null;
  // 五种雕塑形态的当前权重与各自的颗粒间距；权重平滑地流向目标形态。
  // A、B 两个槽位里装着的形态；active 是正在显示（或正在流向）的槽。
  let sculpture: ReturnType<typeof buildSculpture> | null = null;
  const slots = { A: { index: -1, variant: 0, spacing: 0.01 }, B: { index: -1, variant: 0, spacing: 0.01 } };
  let activeSlot: 'A' | 'B' = 'A';
  let mixAnimation: { from: number; to: number; start: number } | null = null;
  let chosenForm: { index: number; variant: number } | null = null;
  let source: ReliefSource | null = null;
  // 取景依据的内容尺寸：照片平面或雕塑包围盒。
  const contentSize = new THREE.Vector2(5, 3.3);
  let photoTexture: THREE.CanvasTexture | null = null;
  let heightTexture: THREE.CanvasTexture | null = null;
  let core: THREE.Points | null = null;
  let dust: THREE.Points | null = null;
  let targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;

  // 取景目标：第一次直接到位，之后（回复卡片出现、凝结卡片浮起）在几帧里平滑移过去。
  const framing = { distance: 0, y: 0, ready: false };
  const fitCamera = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const world = contentSize;
    uniforms.uScreen.value.set(camera.aspect * 2, 2);
    uniforms.uTanHalf.value = halfTan;
    // 四周留出浮尘飘散的空间；有 insets 时只用顶栏与输入条之间的高度。
    const reserved = insets?.() ?? { top: 0, bottom: 0 };
    const available = Math.max(80, height - reserved.top - reserved.bottom);
    const margin = camera.aspect < 0.8 ? 1.02 : insets ? 1.22 : 1.36;
    const distance = Math.max(world.y * margin * height / available / 2 / halfTan, world.x * margin / 2 / halfTan / camera.aspect);
    camera.updateProjectionMatrix();
    const viewHeight = 2 * distance * halfTan;
    framing.distance = distance;
    framing.y = insets ? (0.5 - (reserved.top + height - reserved.bottom) / (2 * height)) * viewHeight
      : camera.aspect < 0.8 ? 0.15 : 0.05;
    if (!framing.ready || motion.matches) {
      camera.position.set(0, 0, framing.distance);
      group.position.y = framing.y;
      framing.ready = true;
    }
    uniforms.uProj.value = height * dpr / (2 * halfTan);
    uniforms.uMinSize.value = 1.5 * dpr;
  };

  const clearContent = () => {
    core?.geometry.dispose();
    dust?.geometry.dispose();
    if (core) group.remove(core);
    if (dust) group.remove(dust);
    core = dust = null;
  };

  // 两张半浮点纹理轮流读写压痕场，换内容时清零。
  const allocateDent = (width: number, height: number) => {
    targets?.forEach(target => target.dispose());
    targets = [createTarget(width, height), createTarget(width, height)];
    for (const target of targets) {
      renderer.setRenderTarget(target);
      renderer.clear();
    }
    renderer.setRenderTarget(null);
    stampUniforms.uTexel.value.set(1 / width, 1 / height);
    uniforms.uDentTexel.value.set(1.5 / width, 1.5 / height);
    uniforms.uDent.value = targets[0].texture;
  };

  // 想显示的形态：大模型选的意象；没有时按参数规则选（旧作品、默认状态）。
  const wantedForm = () => chosenForm ?? { index: pickForm(targetVisual), variant: 0 };
  // 把形态写进另一个槽位并流过去；variant 让同一意象每次转角、比例与动态相位略有不同。
  const showForm = (form: { index: number; variant: number }, animate: boolean) => {
    if (!sculpture) return;
    const next = activeSlot === 'A' ? 'B' : 'A';
    const v = form.variant;
    slots[next] = { index: form.index, variant: v, spacing: sculpture.load(next, form.index) };
    uniforms[`uBehavior${next}`].value = formBehavior(form.index);
    uniforms[`uVariant${next}`].value.set(v ? (v - 0.5) * 1.1 : 0, v ? 0.92 + 0.16 * ((v * 7.31) % 1) : 1,
      v ? 0.92 + 0.16 * ((v * 3.17) % 1) : 1, v);
    activeSlot = next;
    const to = next === 'B' ? 1 : 0;
    if (animate) mixAnimation = { from: uniforms.uMix.value, to, start: performance.now() };
    else { uniforms.uMix.value = to; mixAnimation = null; }
  };

  const setSculpture = () => {
    clearContent();
    mode = 'sculpture';
    source = null;
    photoTexture?.dispose();
    heightTexture?.dispose();
    photoTexture = heightTexture = null;
    canvas.setAttribute('aria-label', '粒子雕塑。移动指针或按住拖动，会把粒子推开成一个小洞，离开后慢慢合上。');
    const density = Math.round(params.density);
    const built = buildSculpture(Math.round(density * density * 0.6), Math.round(density * density * 0.1));
    sculpture = built;
    contentSize.copy(built.size).addScalar(0.6);
    slots.A.index = slots.B.index = -1;
    activeSlot = 'B';
    showForm(wantedForm(), false);
    core = new THREE.Points(built.core, sculptureMaterial);
    dust = new THREE.Points(built.dust, sculptureDustMaterial);
    core.frustumCulled = dust.frustumCulled = false;
    group.add(core, dust);
    const aspect = Math.max(0.3, (container.clientWidth || 1) / (container.clientHeight || 1));
    allocateDent(320, Math.round(Math.min(640, 320 / aspect)));
    fitCamera();
    onStats?.(built.count);
  };

  const rebuildGeometry = () => {
    if (mode === 'sculpture') { setSculpture(); return; }
    if (!source) return;
    clearContent();
    const built = buildCore(source.aspect, Math.round(params.density));
    uniforms.uSpacing.value = uniforms.uWorld.value.x / built.cols;
    core = new THREE.Points(built.geometry, coreMaterial);
    dust = new THREE.Points(buildDust(Math.round(built.count * 0.35)), dustMaterial);
    core.frustumCulled = dust.frustumCulled = false;
    dust.renderOrder = 1;
    group.add(core, dust);
    onStats?.(built.count);
  };

  const setSource = (next: ReliefSource) => {
    mode = 'photo';
    source = next;
    canvas.setAttribute('aria-label', '照片粒子浮雕。移动指针或按住拖动，会把粒子推开成一个小洞，离开后慢慢合上。');
    photoTexture?.dispose();
    heightTexture?.dispose();
    photoTexture = new THREE.CanvasTexture(next.color);
    photoTexture.colorSpace = THREE.SRGBColorSpace;
    heightTexture = new THREE.CanvasTexture(next.height);
    for (const texture of [photoTexture, heightTexture]) {
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    }
    uniforms.uPhoto.value = photoTexture;
    uniforms.uHeight.value = heightTexture;
    uniforms.uHeightTexel.value.set(1 / next.height.width, 1 / next.height.height);
    const longEdge = 5;
    uniforms.uWorld.value.set(next.aspect >= 1 ? longEdge : longEdge * next.aspect,
      next.aspect >= 1 ? longEdge / next.aspect : longEdge);
    contentSize.copy(uniforms.uWorld.value);
    allocateDent(Math.round(next.aspect >= 1 ? 320 : 320 * next.aspect), Math.round(next.aspect >= 1 ? 320 / next.aspect : 320));
    rebuildGeometry();
    fitCamera();
  };

  const setParams = (next: ReliefParams) => {
    const densityChanged = Math.round(next.density) !== Math.round(params.density);
    params = { ...next };
    uniforms.uRelief.value = params.relief;
    uniforms.uRadius.value = params.radius * HOLE_CORE;
    uniforms.uSize.value = params.size;
    uniforms.uSpread.value = params.spread;
    if (densityChanged) rebuildGeometry();
  };

  // 指针：鼠标悬停即按压；触屏和手写笔按住时按压。
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const localRay = new THREE.Ray();
  const targetUv = new THREE.Vector2();
  const currentUv = new THREE.Vector2();
  const previousUv = new THREE.Vector2();
  const tilt = new THREE.Vector2();
  let pointerInside = false;
  let pressing = false;
  let capturedPointer: number | null = null;
  let strength = 0;

  const placeRing = (event: PointerEvent) => {
    const bounds = container.getBoundingClientRect();
    ring.style.transform = `translate(${event.clientX - bounds.left}px, ${event.clientY - bounds.top}px)`;
  };
  const updatePointer = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
    pointerInside = true;
    placeRing(event);
  };
  // 鼠标悬停只显示圆环；按住左键或手指按下才推开小洞，看画面时不会被误挖。
  const onPointerMove = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    if (capturedPointer !== null && event.pointerId !== capturedPointer) return;
    updatePointer(event);
    ring.classList.add('is-visible');
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    capturedPointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    updatePointer(event);
    pressing = true;
    ring.classList.add('is-visible', 'is-pressing');
  };
  const release = () => {
    pressing = false;
    pointerInside = false;
    capturedPointer = null;
    ring.classList.remove('is-visible', 'is-pressing');
  };
  const onPointerUp = (event: PointerEvent) => {
    if (capturedPointer !== null && event.pointerId !== capturedPointer) return;
    // 鼠标松开后仍停在画面上，圆环保留；手指抬起就离开了画面。
    if (event.pointerType !== 'mouse') { release(); return; }
    pressing = false;
    capturedPointer = null;
    ring.classList.remove('is-pressing');
  };
  const onPointerLeave = () => { if (capturedPointer === null) release(); };
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('blur', release);

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let time = 0;
  let previousTime: number | undefined;
  let contextLost = false;
  let active = true;
  let frozen = false;
  const currentVisual: VisualState = { ...DEFAULT_VISUAL };
  let targetVisual: VisualState = { ...DEFAULT_VISUAL };
  // 正在进行的显影的开始时刻。
  let developStart: number | null = null;

  const animate = (now: number) => {
    const delta = previousTime === undefined ? 0 : Math.min((now - previousTime) / 1000, 0.05);
    previousTime = now;
    if (!mode || !targets) return;
    const settle = motion.matches ? 1 : 1 - Math.exp(-delta * 5);
    camera.position.z += (framing.distance - camera.position.z) * settle;
    group.position.y += (framing.y - group.position.y) * settle;
    if (frozen || motion.matches) Object.assign(currentVisual, targetVisual);
    else smoothVisual(currentVisual, targetVisual, delta);
    // 中性参数（0.5）与试验页的画面完全一致。
    if (!frozen && !motion.matches) time += delta * (0.35 + currentVisual.motion * 1.3);
    uniforms.uTime.value = time;
    const pulse = !frozen && !motion.matches && activity ? activityLevel(activity.current, now) : 0;
    if (frozen || motion.matches) developStart = null;
    const developing = developStart === null ? null : developCurve((now - developStart) / 1000);
    if (developing?.done) developStart = null;
    const fog = developing?.fog ?? 0, glow = developing?.glow ?? 0;
    uniforms.uDevelop.value = mode === 'sculpture' ? fog : 0;
    if (mode === 'photo') {
      group.scale.setScalar((0.9 + currentVisual.dispersion * 0.2) * (1 + pulse * 0.035) * (1 - fog * 0.04));
      // 照片保持主体可辨认：只让边缘的细尘大幅散开，再收回。
      uniforms.uSpread.value = params.spread * (0.4 + currentVisual.dispersion * 1.2) * (1 + fog * 2.2);
    } else {
      // 雕塑的形态由开放、张力、连贯、轻重四项连续改变；散开控制碎屑与光晕。
      group.scale.setScalar(1 + pulse * 0.035);
      uniforms.uSpread.value = 0.2 + currentVisual.dispersion * 1.2;
      uniforms.uShape.value.set(currentVisual.openness, currentVisual.tension, currentVisual.coherence, currentVisual.weight);
      // 换形态：显影时等雾散开再在雾里换，否则（打开回廊、返回暗房、减少动态）直接到位。
      const wanted = wantedForm();
      const shown = slots[activeSlot];
      if ((wanted.index !== shown.index || wanted.variant !== shown.variant) && (!developing || developing.reshape)) {
        showForm(wanted, Boolean(developing));
      }
      if (mixAnimation) {
        const k = Math.min(1, (now - mixAnimation.start) / 900);
        uniforms.uMix.value = mixAnimation.from + (mixAnimation.to - mixAnimation.from) * k * k * (3 - 2 * k);
        if (k >= 1) mixAnimation = null;
      }
      const mix = uniforms.uMix.value;
      uniforms.uSpacing.value = slots.A.spacing * (1 - mix) + slots.B.spacing * mix;
      // 火焰偏暖时带琥珀色，偏冷时仍是银白的火。
      const flame = (uniforms.uBehaviorA.value === 1 ? 1 - mix : 0) + (uniforms.uBehaviorB.value === 1 ? mix : 0);
      uniforms.uHeat.value = flame * (0.25 + 0.75 * THREE.MathUtils.smoothstep(currentVisual.warmth, 0.4, 0.85));
    }
    uniforms.uLight.value = (0.8 + currentVisual.luminosity * 0.4) * (1 + pulse * 0.16) * (1 + glow);
    const temperature = (currentVisual.warmth - 0.5) * 0.44;
    uniforms.uTint.value.set(1 + temperature, 1, 1 - temperature);

    // 照片只轻微摆动；雕塑左右摆到约 ±40°，约 30 秒一个来回，让体积和暗缝随角度显出来。
    // 不整圈转：海浪、花开、雨这些意象是朝正面做的，转到侧面会变成一条线或只剩背面。
    if (mode === 'photo') group.rotation.set(-0.06 + Math.sin(time * 0.17) * 0.025 + tilt.y, Math.sin(time * 0.2) * 0.07 + tilt.x, 0);
    else group.rotation.set(0.12 + Math.sin(time * 0.13) * 0.06 + tilt.y, Math.sin(time * 0.21) * 0.7 + tilt.x * 1.2, -0.06);
    group.updateMatrixWorld();

    let onSurface = false;
    if (pointerInside) {
      if (mode === 'sculpture') {
        targetUv.set((pointer.x + 1) / 2, (pointer.y + 1) / 2);
        onSurface = true;
      } else {
        raycaster.setFromCamera(pointer, camera);
        localRay.copy(raycaster.ray).applyMatrix4(inverse.copy(group.matrixWorld).invert());
        if (localRay.intersectPlane(plane, hit)) {
          const world = uniforms.uWorld.value;
          targetUv.set(hit.x / world.x + 0.5, hit.y / world.y + 0.5);
          onSurface = targetUv.x > -0.1 && targetUv.x < 1.1 && targetUv.y > -0.1 && targetUv.y < 1.1;
        }
      }
      // 视角轻微朝向指针，让压痕的深度更容易读出来。
      const follow = 1 - Math.exp(-delta * 3);
      tilt.x += (pointer.x * 0.1 - tilt.x) * follow;
      tilt.y += (-pointer.y * 0.07 - tilt.y) * follow;
    }
    if (strength < 0.02) currentUv.copy(targetUv);
    previousUv.copy(currentUv);
    // 孔像一颗有分量的球，略微落后于光标。
    currentUv.lerp(targetUv, 1 - Math.exp(-delta * 7));
    strength += ((pressing && onSurface ? 1 : 0) - strength) * (1 - Math.exp(-delta * 8));

    stampUniforms.uPrevious.value = targets[0].texture;
    stampUniforms.uWorld.value.copy(mode === 'photo' ? uniforms.uWorld.value : uniforms.uScreen.value);
    // 竖屏手机上雕塑按宽度缩小，屏幕孔也跟着缩小，比例与桌面一致。
    uniforms.uScreenRadius.value = params.radius * HOLE_CORE * SCREEN_RADIUS_PER_WORLD * THREE.MathUtils.clamp(camera.aspect, 0.6, 1);
    stampUniforms.uRadius.value = mode === 'photo' ? uniforms.uRadius.value : uniforms.uScreenRadius.value;
    stampUniforms.uFrom.value.copy(previousUv);
    stampUniforms.uTo.value.copy(currentUv);
    stampUniforms.uStrength.value = strength;
    stampUniforms.uDecay.value = Math.exp(-delta * params.recover);
    renderer.setRenderTarget(targets[1]);
    renderer.render(stampScene, stampCamera);
    renderer.setRenderTarget(null);
    targets.reverse();
    uniforms.uDent.value = targets[0].texture;

    renderer.render(scene, camera);
  };

  const resizeObserver = new ResizeObserver(fitCamera);
  resizeObserver.observe(container);
  const syncLoop = () => {
    previousTime = undefined;
    renderer.setAnimationLoop(document.hidden || contextLost || !active ? null : animate);
  };
  const onContextLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    syncLoop();
    onError?.('画面暂时中断，正在等待图形设备恢复。');
  };
  const onContextRestored = () => {
    contextLost = false;
    onError?.(null);
    if (mode === 'sculpture') setSculpture();
    else if (source) setSource(source);
    syncLoop();
  };
  document.addEventListener('visibilitychange', syncLoop);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  fitCamera();
  syncLoop();

  return {
    setSource,
    setSculpture,
    setParams,
    setVisual(visual) { targetVisual = { ...visual }; },
    setForm(form) { chosenForm = form ? { index: imageIndex(form.image), variant: form.variant } : null; },
    develop() {
      if (frozen || motion.matches || !mode) return;
      developStart = performance.now();
    },
    setFrozen(next, phase) {
      frozen = next;
      if (phase !== undefined) time = phase;
    },
    setActive(next) {
      active = next;
      syncLoop();
    },
    refit: fitCamera,
    capture() {
      if (contextLost || !mode) throw new Error('画面还没有准备好，请稍等再凝结。');
      // 复制前立即绘制一帧：WebGL 默认不保留上一帧的画面。
      renderer.render(scene, camera);
      // 封面在回廊里会显影成粒子碎片，尽量清楚；文件太大时退回小一档，存档上限 16 万字符。
      const draw = (previewWidth: number) => {
        const preview = document.createElement('canvas');
        preview.width = previewWidth;
        preview.height = Math.round(previewWidth * 33 / 48);
        const context = preview.getContext('2d');
        if (!context) throw new Error('暂时无法生成作品预览，请重试。');
        context.fillStyle = '#040507';
        context.fillRect(0, 0, preview.width, preview.height);
        // 以作品中心对准封面中心。竖屏按宽度完整装进封面，不裁掉雕塑的上下；
        // 宽屏按顶栏与底部之间作品实际占的高度装满封面，不留大片黑边。
        const portrait = canvas.width < canvas.height;
        const reserved = insets?.() ?? { top: 0, bottom: 0 };
        const ratio = canvas.height / Math.max(1, container.clientHeight);
        const used = Math.max(1, canvas.height - (reserved.top + reserved.bottom) * ratio);
        const scale = portrait ? preview.width / (canvas.width * 1.12)
          : Math.max(preview.width / canvas.width, preview.height / (used * 1.08));
        const center = group.position.clone().project(camera);
        const centerY = (1 - center.y) / 2 * canvas.height;
        const width = canvas.width * scale;
        const height = canvas.height * scale;
        context.drawImage(canvas, (preview.width - width) / 2, preview.height / 2 - centerY * scale, width, height);
        return preview;
      };
      let thumbnail = draw(640).toDataURL('image/jpeg', 0.75);
      if (thumbnail.length > 150_000) thumbnail = draw(480).toDataURL('image/jpeg', 0.75);
      if (thumbnail.length > 150_000) thumbnail = draw(480).toDataURL('image/jpeg', 0.5);
      return { thumbnail, phase: time, visual: { ...currentVisual } };
    },
    dispose() {
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', release);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', syncLoop);
      core?.geometry.dispose();
      dust?.geometry.dispose();
      coreMaterial.dispose();
      dustMaterial.dispose();
      sculptureMaterial.dispose();
      sculptureDustMaterial.dispose();
      stampMaterial.dispose();
      stampQuad.geometry.dispose();
      photoTexture?.dispose();
      heightTexture?.dispose();
      targets?.forEach(target => target.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
