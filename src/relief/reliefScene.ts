import * as THREE from 'three';
import { DEFAULT_VISUAL, smoothVisual } from '../visual';
import type { VisualState } from '../visual';
import { activityLevel } from '../emotionShape';
import type { ActivitySignal } from '../emotionShape';

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
  setParams: (params: ReliefParams) => void;
  // 作品参数只改变光感、冷暖、流速和散开程度，照片主体保持可辨认。
  setVisual: (visual: VisualState) => void;
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
  float dentAt(vec2 uv) { return texture2D(uDent, uv).r; }
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

    float dent = dentAt(uv);
    vec2 ex = vec2(uDentTexel.x, 0.0);
    vec2 ey = vec2(0.0, uDentTexel.y);
    vec2 dentSlope = vec2(dentAt(uv + ex) - dentAt(uv - ex), dentAt(uv + ey) - dentAt(uv - ey))
      / (2.0 * uDentTexel * uWorld);
    vec2 hx = vec2(uHeightTexel.x, 0.0);
    vec2 hy = vec2(0.0, uHeightTexel.y);
    vec2 heightSlope = vec2(heightAt(uv + hx) - heightAt(uv - hx), heightAt(uv + hy) - heightAt(uv - hy))
      / (2.0 * uHeightTexel * uWorld);
    vec3 normal = normalize(vec3(-heightSlope * 0.6, 1.0));
    vec3 p = vec3((uv - 0.5) * uWorld, heightAt(uv));

    // 穿透的孔：压痕场是 1 - (r/R)²，由它反推每颗粒子离孔心的距离，
    // 把孔内的粒子正好推到孔沿外，中心露出黑色，被推开的粒子堆成亮环。
    // 压痕回弹变浅时 open 随之变小，孔从外向内慢慢合上。
    float slopeLength = length(dentSlope);
    float scatter = seed * 6.2831853;
    vec2 away = slopeLength > 1e-3 ? -dentSlope / slopeLength : vec2(cos(scatter), sin(scatter));
    float open = 1.0 - sqrt(max(0.0, 1.0 - dent));
    p.xy += away * uRadius * open * (0.92 + 0.3 * fract(seed * 17.3));
    // 被推开的粒子堆到孔沿表面之上，不被原位的邻居挡住，孔沿因此鼓起、发亮。
    p.z += open * uRadius * 0.35;

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
    // 被挤开的粒子带一点亮光，孔沿因此发亮。
    float luminance = dot(photo, vec3(0.2126, 0.7152, 0.0722));
    vColor = vColor * (1.0 + open * 0.7) + open * (0.06 + luminance * 0.3) * vec3(0.92, 0.95, 1.0);
    vColor *= uTint * uLight;

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
  uniform float uStrength;
  uniform float uDecay;
  varying vec2 vUv;
  void main() {
    float previous = texture2D(uPrevious, vUv).r * 0.8
      + (texture2D(uPrevious, vUv + vec2(uTexel.x, 0.0)).r + texture2D(uPrevious, vUv - vec2(uTexel.x, 0.0)).r
      + texture2D(uPrevious, vUv + vec2(0.0, uTexel.y)).r + texture2D(uPrevious, vUv - vec2(0.0, uTexel.y)).r) * 0.05;
    vec2 p = vUv * uWorld;
    vec2 a = uFrom * uWorld;
    vec2 ab = uTo * uWorld - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float d = length(p - a - ab * t) / uRadius;
    float cap = d < 1.0 ? 1.0 - d * d : 0.0;
    gl_FragColor = vec4(max(previous * uDecay, cap * uStrength), 0.0, 0.0, 1.0);
  }
`;

function seededRandom(seed: number) {
  return () => {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    return (seed >>> 0) / 4294967296;
  };
}

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
    uRadius: { value: params.radius },
    uTime: { value: 0 },
    uSpacing: { value: 0.01 },
    uSize: { value: params.size },
    uProj: { value: 1 },
    uSpread: { value: params.spread },
    uMinSize: { value: 1 },
    uLight: { value: 1 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
  };
  const coreMaterial = new THREE.ShaderMaterial({
    uniforms, vertexShader: coreVertex, fragmentShader: coreFragment,
    depthTest: true, depthWrite: true,
  });
  const dustMaterial = new THREE.ShaderMaterial({
    uniforms, vertexShader: dustVertex, fragmentShader: dustFragment,
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  const stampUniforms = {
    uPrevious: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2() },
    uWorld: uniforms.uWorld,
    uFrom: { value: new THREE.Vector2() },
    uTo: { value: new THREE.Vector2() },
    uRadius: uniforms.uRadius,
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

  let source: ReliefSource | null = null;
  let photoTexture: THREE.CanvasTexture | null = null;
  let heightTexture: THREE.CanvasTexture | null = null;
  let core: THREE.Points | null = null;
  let dust: THREE.Points | null = null;
  let targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;

  const fitCamera = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const world = uniforms.uWorld.value;
    // 四周留出浮尘飘散的空间；有 insets 时只用顶栏与输入条之间的高度。
    const reserved = insets?.() ?? { top: 0, bottom: 0 };
    const available = Math.max(80, height - reserved.top - reserved.bottom);
    const margin = camera.aspect < 0.8 ? 1.02 : insets ? 1.22 : 1.36;
    const distance = Math.max(world.y * margin * height / available / 2 / halfTan, world.x * margin / 2 / halfTan / camera.aspect);
    camera.position.set(0, 0, distance);
    camera.updateProjectionMatrix();
    const viewHeight = 2 * distance * halfTan;
    group.position.y = insets ? (0.5 - (reserved.top + height - reserved.bottom) / (2 * height)) * viewHeight
      : camera.aspect < 0.8 ? 0.15 : 0.05;
    uniforms.uProj.value = height * dpr / (2 * halfTan);
    uniforms.uMinSize.value = 1.5 * dpr;
  };

  const rebuildGeometry = () => {
    if (!source) return;
    core?.geometry.dispose();
    dust?.geometry.dispose();
    if (core) group.remove(core);
    if (dust) group.remove(dust);
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
    source = next;
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

    targets?.forEach(target => target.dispose());
    const dentWidth = Math.round(next.aspect >= 1 ? 320 : 320 * next.aspect);
    const dentHeight = Math.round(next.aspect >= 1 ? 320 / next.aspect : 320);
    targets = [createTarget(dentWidth, dentHeight), createTarget(dentWidth, dentHeight)];
    for (const target of targets) {
      renderer.setRenderTarget(target);
      renderer.clear();
    }
    renderer.setRenderTarget(null);
    stampUniforms.uTexel.value.set(1 / dentWidth, 1 / dentHeight);
    uniforms.uDentTexel.value.set(1.5 / dentWidth, 1.5 / dentHeight);
    uniforms.uDent.value = targets[0].texture;
    rebuildGeometry();
    fitCamera();
  };

  const setParams = (next: ReliefParams) => {
    const densityChanged = Math.round(next.density) !== Math.round(params.density);
    params = { ...next };
    uniforms.uRelief.value = params.relief;
    uniforms.uRadius.value = params.radius;
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
  const onPointerMove = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    if (capturedPointer !== null && event.pointerId !== capturedPointer) return;
    updatePointer(event);
    if (event.pointerType === 'mouse') {
      pressing = true;
      ring.classList.add('is-visible');
    }
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.pointerType === 'mouse') return;
    capturedPointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    updatePointer(event);
    pressing = true;
    ring.classList.add('is-visible');
  };
  const release = () => {
    pressing = false;
    pointerInside = false;
    capturedPointer = null;
    ring.classList.remove('is-visible');
  };
  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.type !== 'pointerleave') return;
    if (capturedPointer !== null && event.pointerId !== capturedPointer) return;
    release();
  };
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerEnd);
  canvas.addEventListener('pointercancel', onPointerEnd);
  canvas.addEventListener('pointerleave', onPointerEnd);
  window.addEventListener('blur', release);

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let time = 0;
  let previousTime: number | undefined;
  let contextLost = false;
  let active = true;
  let frozen = false;
  const currentVisual: VisualState = { ...DEFAULT_VISUAL };
  let targetVisual: VisualState = { ...DEFAULT_VISUAL };

  const animate = (now: number) => {
    const delta = previousTime === undefined ? 0 : Math.min((now - previousTime) / 1000, 0.05);
    previousTime = now;
    if (!source || !targets) return;
    if (frozen || motion.matches) Object.assign(currentVisual, targetVisual);
    else smoothVisual(currentVisual, targetVisual, delta);
    // 中性参数（0.5）与试验页的画面完全一致。
    if (!frozen && !motion.matches) time += delta * (0.35 + currentVisual.motion * 1.3);
    uniforms.uTime.value = time;
    const pulse = !frozen && !motion.matches && activity ? activityLevel(activity.current, now) : 0;
    group.scale.setScalar((0.9 + currentVisual.dispersion * 0.2) * (1 + pulse * 0.035));
    uniforms.uSpread.value = params.spread * (0.4 + currentVisual.dispersion * 1.2);
    uniforms.uLight.value = (0.8 + currentVisual.luminosity * 0.4) * (1 + pulse * 0.16);
    const temperature = (currentVisual.warmth - 0.5) * 0.44;
    uniforms.uTint.value.set(1 + temperature, 1, 1 - temperature);

    group.rotation.set(
      -0.06 + Math.sin(time * 0.17) * 0.025 + tilt.y,
      Math.sin(time * 0.2) * 0.07 + tilt.x,
      0,
    );
    group.updateMatrixWorld();

    let onSurface = false;
    if (pointerInside) {
      raycaster.setFromCamera(pointer, camera);
      localRay.copy(raycaster.ray).applyMatrix4(inverse.copy(group.matrixWorld).invert());
      if (localRay.intersectPlane(plane, hit)) {
        const world = uniforms.uWorld.value;
        targetUv.set(hit.x / world.x + 0.5, hit.y / world.y + 0.5);
        onSurface = targetUv.x > -0.1 && targetUv.x < 1.1 && targetUv.y > -0.1 && targetUv.y < 1.1;
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
    if (source) setSource(source);
    syncLoop();
  };
  document.addEventListener('visibilitychange', syncLoop);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  fitCamera();
  syncLoop();

  return {
    setSource,
    setParams,
    setVisual(visual) { targetVisual = { ...visual }; },
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
      if (contextLost || !source) throw new Error('画面还没有准备好，请稍等再凝结。');
      // 复制前立即绘制一帧：WebGL 默认不保留上一帧的画面。
      renderer.render(scene, camera);
      const preview = document.createElement('canvas');
      preview.width = 480;
      preview.height = 330;
      const context = preview.getContext('2d');
      if (!context) throw new Error('暂时无法生成作品预览，请重试。');
      context.fillStyle = '#040507';
      context.fillRect(0, 0, preview.width, preview.height);
      const scale = Math.max(preview.width / canvas.width, preview.height / canvas.height);
      const width = canvas.width * scale;
      const height = canvas.height * scale;
      context.drawImage(canvas, (preview.width - width) / 2, (preview.height - height) / 2, width, height);
      let thumbnail = preview.toDataURL('image/jpeg', 0.75);
      if (thumbnail.length > 150_000) thumbnail = preview.toDataURL('image/jpeg', 0.5);
      return { thumbnail, phase: time, visual: { ...currentVisual } };
    },
    dispose() {
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerEnd);
      canvas.removeEventListener('pointercancel', onPointerEnd);
      canvas.removeEventListener('pointerleave', onPointerEnd);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', syncLoop);
      core?.geometry.dispose();
      dust?.geometry.dispose();
      coreMaterial.dispose();
      dustMaterial.dispose();
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
