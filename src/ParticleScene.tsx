import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import * as THREE from 'three';
import type { PhotoParticleData } from './photoToParticles';
import { createPhotoMotion, updatePhotoDisplacement } from './photoInteraction';
import type { PhotoBrush } from './photoInteraction';
import { DEFAULT_VISUAL, resolveVisual, smoothVisual } from './visual';
import type { VisualState } from './visual';
import { NEBULA_SEED, validateSnapshot } from './artwork';
import type { SceneSnapshot } from './artwork';
import { activityLevel, writeEmotionRest } from './emotionShape';
import type { ActivitySignal } from './emotionShape';

export type ParticleSceneHandle = { capture: () => { scene: SceneSnapshot; thumbnail: string } };

const PARTICLE_COUNT = 22_000;
const POINTER_RADIUS = 0.95;
const SPRING = 19;
const DAMPING = 7.5;

// Canvas 只生成一次光点贴图；每一帧的点云由 WebGL 绘制。
function createPointTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建光点贴图');
  const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.12, 'rgba(255,255,255,0.9)');
  glow.addColorStop(0.32, 'rgba(255,255,255,0.42)');
  glow.addColorStop(0.62, 'rgba(255,255,255,0.09)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

// 相同种子保留同一团初始星云，便于比较参数，不把随机变化当成情绪理解。
function createRandom(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createNebula() {
  const random = createRandom(NEBULA_SEED);
  const base = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const sizes = new Float32Array(PARTICLE_COUNT);
  const alphas = new Float32Array(PARTICLE_COUNT);
  const phases = new Float32Array(PARTICLE_COUNT);
  const glows = new Float32Array(PARTICLE_COUNT);
  const white = new THREE.Color('#FFFDF9');
  const gold = new THREE.Color('#F5C28B');
  const ice = new THREE.Color('#8AB4F8');
  const silver = new THREE.Color('#B0C4DE');
  const night = new THREE.Color('#3B4270');
  const color = new THREE.Color();
  const point = new THREE.Vector3();
  const tangentU = new THREE.Vector3();
  const tangentV = new THREE.Vector3();
  const normal = new THREE.Vector3();

  // 围绕偏心内腔的非闭合弧面。u 沿包裹方向，v 从内侧伸向回卷的唇边。
  // 轮廓来自弧长、宽度与端部回卷，不再先铺开一张矩形曲面。
  const surface = (u: number, v: number, target: THREE.Vector3) => {
    const angle = 0.45 + u * 5.2 + (v - 0.5) * (0.7 - u * 0.8);
    const upperCurl = Math.exp(-(((u - 0.045) / 0.13) ** 2));
    const lowerCup = Math.exp(-(((u - 0.87) / 0.19) ** 2));
    const width = (1.55 + Math.sin(angle * 1.6 + 0.6) * 0.22 + Math.cos(angle * 3) * 0.14)
      * (0.62 + Math.pow(Math.sin(Math.PI * u), 0.45) * 0.38);
    const turn = v * (2.14 + upperCurl * 0.38 - lowerCup * 0.15);
    const inner = 0.24 + Math.sin(angle + 0.9) * 0.09;
    const radius = inner + width * Math.sin(turn);
    const ripple = Math.sin(angle * 3.2 + v * 8) * Math.sin(Math.PI * v) * 0.06;
    const curledTip = upperCurl * v ** 3;
    const liftedLip = lowerCup * v ** 2;
    target.set(
      0.18 + Math.cos(angle) * (radius + ripple) * 1.22
        - curledTip * 0.48 + liftedLip * 0.3 - Math.sin(Math.PI * u) * 0.18,
      0.09 + Math.sin(angle) * (radius + ripple) * 1.06
        - curledTip * 0.64 + liftedLip * 0.5
        + Math.sin(u * Math.PI * 3) * Math.sin(Math.PI * v) * 0.16,
      -0.95 + width * (1 - Math.cos(turn)) * 0.87
        + Math.sin(angle * 1.4 - 0.6) * 0.32 + curledTip * 0.5 + liftedLip * 0.28,
    );
    return target;
  };

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const u = 0.003 + random() * 0.994;
    const v = 0.015 + Math.sqrt(random()) * 0.97;
    surface(u, v, point);
    surface(u + 0.002, v, tangentU).sub(point);
    surface(u, v + 0.002, tangentV).sub(point);
    normal.crossVectors(tangentU, tangentV).normalize();
    const dust = random() < 0.1;
    const thickness = (random() + random() + random() - 1.5) * (dust ? 0.68 : 0.13);
    point.addScaledVector(normal, thickness);
    if (dust) {
      point.x += (random() - 0.5) * 0.26;
      point.y += (random() - 0.5) * 0.2;
    }
    const offset = i * 3;
    point.toArray(base, offset);

    const ridge = Math.pow(1 - Math.abs(normal.z), 0.6);
    const warmth = Math.exp(-((u - 0.83) ** 2 / 0.045 + (v - 0.6) ** 2 / 0.1))
      + Math.exp(-((u - 0.12) ** 2 / 0.035 + (v - 0.66) ** 2 / 0.08)) * 0.7;
    const innerShade = 1 - THREE.MathUtils.smoothstep(v, 0.15, 0.65);
    color.copy(ice).lerp(silver, ridge * 0.7);
    color.lerp(night, innerShade * 0.48);
    color.lerp(gold, Math.min(0.95, warmth));
    color.lerp(white, warmth * ridge * 0.32);
    color.toArray(colors, offset);
    const edgeFade = THREE.MathUtils.smoothstep(u, 0, 0.045)
      * (1 - THREE.MathUtils.smoothstep(u, 0.95, 1))
      * (1 - THREE.MathUtils.smoothstep(v, 0.91, 1));
    const innerExposure = 0.3 + THREE.MathUtils.smoothstep(v, 0.08, 0.55) * 0.7;
    alphas[i] = (0.46 + random() * 0.25) * edgeFade * innerExposure * (0.64 + ridge * 0.36);
    if (dust) alphas[i] *= 0.4;
    sizes[i] = 0.014 + random() * 0.016;
    glows[i] = random() < 0.05 ? 1 : 0;
    if (glows[i]) {
      sizes[i] *= 2.8;
      alphas[i] *= 0.38;
    }
    phases[i] = random() * Math.PI * 2;
  }
  return { base, colors, sizes, alphas, phases, glows };
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uPointScale;
  uniform float uMaxPointSize;
  uniform float uPixelRatio;
  uniform float uCenterDepth;
  uniform float uPhotoMode;
  uniform float uModelScale;
  uniform vec3 uVisual;
  uniform float uLight;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aPhase;
  attribute float aGlow;
  attribute float aFlow;
  attribute vec3 aDisplacement;
  varying vec3 vTint;
  varying float vAlpha;
  varying float vGlow;
  void main() {
    vec3 point = position;
    if (uPhotoMode > 0.5) {
      // 主体几乎静止，边缘共享低频流场，浮尘再叠一层轻微错相。
      float wave = sin(position.x * 2.0 + position.y * 1.4 + uTime * 0.65);
      point.x += aFlow * (sin(position.y * 2.4 + uTime * 0.5) + 0.3 * sin(aPhase + uTime * 0.8));
      point.y += aFlow * (wave + 0.25 * cos(aPhase + uTime * 0.6));
      point.z += aFlow * sin(position.x * 1.7 - position.y + uTime * 0.45) * 1.4;
      point += aDisplacement;
    }
    vec4 viewPosition = modelViewMatrix * vec4(point, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    float projectedSize = aSize * uModelScale * uPointScale / -viewPosition.z;
    gl_PointSize = clamp(projectedSize, mix(1.6, 0.8, uPhotoMode) * uPixelRatio, uMaxPointSize);
    vTint = color * mix(0.96 + 0.04 * sin(uTime * 0.35 + aPhase), 1.0, uPhotoMode);
    float temperature = (uVisual.z - 0.5) * 0.44;
    vTint *= vec3(1.0 + temperature, 1.0, 1.0 - temperature);
    vTint *= uLight;
    // 最小尺寸保住圆点边缘，同时补偿面积，避免远处的小点被放大成亮团。
    float areaCompensation = min(1.0, pow(projectedSize / gl_PointSize, 2.0));
    // 后层保持锐利但稍暗；以物体中心为基准，窄屏拉远相机不会整体变暗。
    float depthCue = mix(0.42, 1.0, smoothstep(-1.7, 1.8, viewPosition.z + uCenterDepth));
    vAlpha = aAlpha * areaCompensation * mix(depthCue, 1.0, uPhotoMode);
    vGlow = aGlow;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uPointMap;
  varying vec3 vTint;
  varying float vAlpha;
  varying float vGlow;
  void main() {
    float radius = length(gl_PointCoord - 0.5) * 2.0;
    float edgeWidth = fwidth(radius);
    // 主体为可辨认的亮核，只有圆周有一层抗锯齿软边。
    float crispPoint = 1.0 - smoothstep(0.68 - edgeWidth * 0.5, 0.68 + edgeWidth * 0.5, radius);
    float softGlow = texture2D(uPointMap, gl_PointCoord).a;
    // 约 95% 清晰粒子 + 5% 低强度柔光，共用同一个 Points / draw call。
    float alpha = mix(crispPoint, softGlow, vGlow) * vAlpha;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(vTint, alpha);
    #include <colorspace_fragment>
  }
`;

export default function ParticleScene({ photo = null, visual = DEFAULT_VISUAL, snapshot = null, active = true, activity, ref }: {
  photo?: PhotoParticleData | null; visual?: VisualState; snapshot?: SceneSnapshot | null; active?: boolean;
  activity?: { current: ActivitySignal }; ref?: Ref<ParticleSceneHandle>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const targetVisualRef = useRef(visual);
  const activeRef = useRef(active);
  const wakeRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const captureRef = useRef<ParticleSceneHandle['capture'] | null>(null);
  useImperativeHandle(ref, () => ({ capture() {
    if (!captureRef.current) throw new Error('画面还没有准备好，请稍等再凝结。');
    return captureRef.current();
  } }), []);

  useEffect(() => {
    targetVisualRef.current = visual;
    wakeRef.current?.();
  }, [visual]);
  useEffect(() => { activeRef.current = active; wakeRef.current?.(); }, [active]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    let texture: THREE.CanvasTexture;
    try {
      texture = createPointTexture();
      try {
        renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
      } catch (cause) {
        texture.dispose();
        throw cause;
      }
    } catch {
      setError('暂时无法显示星云。请开启浏览器硬件加速后刷新页面。');
      return;
    }
    setError(null);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = renderer.domElement;
    canvas.setAttribute('aria-label', photo
      ? '照片粒子浮雕，鼠标划过或手指轻划可拨开粒子，移开或松开后缓缓恢复'
      : '发光星云，移动指针或轻划触屏可拨开粒子，松开后缓缓归位');
    canvas.setAttribute('role', 'img');
    canvas.tabIndex = 0;
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    const count = photo ? photo.alphas.length : PARTICLE_COUNT;
    const { base, colors, sizes, alphas, phases, glows } = photo ? {
      base: photo.positions,
      colors: photo.colors,
      sizes: photo.sizes,
      alphas: photo.alphas,
      phases: photo.phases,
      glows: photo.glows,
    } : createNebula();
    const positions = new Float32Array(base);
    const rest = new Float32Array(base);
    // 流动的原位 + 可回弹的手势位移 = 最终位置，不把逐帧数据放进 React。
    const displacement = new Float32Array(base.length);
    const displacementAttribute = new THREE.BufferAttribute(displacement, 3).setUsage(THREE.DynamicDrawUsage);
    const velocity = new Float32Array(base.length);
    const photoMotion = photo ? createPhotoMotion(photo, velocity) : null;
    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aGlow', new THREE.BufferAttribute(glows, 1));
    geometry.setAttribute('aFlow', new THREE.BufferAttribute(photo?.flows ?? new Float32Array(count), 1));
    geometry.setAttribute('aDisplacement', displacementAttribute);
    const gl = renderer.getContext();
    const pointSizeRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPointMap: { value: texture },
        uPointScale: { value: 1 },
        uMaxPointSize: { value: Math.min(32, pointSizeRange[1]) },
        uPixelRatio: { value: 1 },
        uCenterDepth: { value: 10.5 },
        uPhotoMode: { value: photo ? 1 : 0 },
        uModelScale: { value: 1 },
        uVisual: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uLight: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      // 照片以细点和透明度控制叠光，暗部融入暗房，亮部保留光尘。
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const particles = new THREE.Points(geometry, material);
    particles.frustumCulled = false;
    scene.add(particles);

    const experience = container.closest('.experience');
    const dockArea = experience?.querySelector<HTMLElement>('.dock-area');
    let projectionVersion = 0;
    let framingScale = 1;
    const currentVisual = resolveVisual(snapshot?.visual ?? targetVisualRef.current);

    const resize = () => {
      projectionVersion++;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      renderer.setPixelRatio(dpr);
      material.uniforms.uPixelRatio.value = dpr;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // 光纱比原星云更收拢，窄屏适度靠近，仍留出标题与底部入口的空间。
      const framingWidth = camera.aspect < 0.8 ? 8.2 : 11.7;
      camera.position.set(0, 0, Math.max(10.5, framingWidth / camera.aspect));
      material.uniforms.uCenterDepth.value = camera.position.z;
      camera.updateProjectionMatrix();
      // 底部输入条比顶栏高，星云略微上移，落在两者之间的视觉中心。
      particles.position.y = camera.aspect < 0.8 ? 0.2 : 0.3;
      particles.scale.setScalar(height < 500 ? 0.72 : 1);
      if (photo) {
        // 照片占满顶栏与底部输入条之间；浮在上面的回复卡片不参与取景，免得流式回复时画面跳动。
        const canvasTop = container.getBoundingClientRect().top;
        const condensed = experience?.classList.contains('is-condensed');
        const header = experience?.querySelector<HTMLElement>('.site-header');
        const top = (header?.getBoundingClientRect().bottom ?? 70) - canvasTop + 16;
        const dock = experience?.querySelector<HTMLElement>(condensed ? '.work-panel' : '.expression:not([hidden]) .composer');
        const bottom = Math.min(height - 18, dock ? dock.getBoundingClientRect().top - canvasTop - 20 : height * 0.8);
        const availableHeight = Math.max(24, bottom - top);
        const viewHeight = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const scale = Math.min(viewHeight * camera.aspect * 0.9 / (photo.worldWidth + 1.1),
          viewHeight * availableHeight / height / (photo.worldHeight + 1.1)) * 0.98;
        particles.scale.setScalar(scale);
        particles.position.y = (0.5 - (top + bottom) / (2 * height)) * viewHeight;
        material.uniforms.uModelScale.value = scale;
      } else if (snapshot) {
        // 凝结操作区出现后，为雕塑留出完整的可见和可触碰空间。
        const panel = experience?.querySelector<HTMLElement>('.work-panel');
        const header = experience?.querySelector<HTMLElement>('.site-header');
        if (panel) {
          const canvasTop = container.getBoundingClientRect().top;
          const top = (header?.getBoundingClientRect().bottom ?? 70) - canvasTop + 20;
          const bottom = panel.getBoundingClientRect().top - canvasTop - 20;
          const available = Math.max(24, bottom - top);
          const viewHeight = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
          const expansion = 0.8 + currentVisual.dispersion * 0.4;
          particles.scale.setScalar(Math.min(1, viewHeight * available / height / 5.8,
            viewHeight * camera.aspect * 0.85 / 6) / expansion);
          particles.position.y = (0.5 - (top + bottom) / (2 * height)) * viewHeight;
        }
      }
      framingScale = particles.scale.x;
      material.uniforms.uPointScale.value = height * dpr / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      camera.updateMatrixWorld();
      particles.updateMatrixWorld();
      if (photo) renderer.render(scene, camera);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    if (photo && dockArea) resizeObserver.observe(dockArea);
    const workPanel = experience?.querySelector<HTMLElement>('.work-panel');
    if (workPanel) resizeObserver.observe(workPanel);
    resize();

    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const localRay = new THREE.Ray();
    const inverse = new THREE.Matrix4();
    const depthPlane = new THREE.Plane();
    const brushCenter = new THREE.Vector3();
    const depthWeights = new Float32Array(80);
    const depthSums = new Float32Array(80);
    const depthCounts = new Uint16Array(80);
    const binWidth = 0.25;
    const pickRadiusSquared = 0.4 ** 2;
    const depthHalfWidth = 0.5;
    let pointerActive = false;
    let capturedPointer: number | null = null;
    let hasDepth = false;
    let pickRequested = false;
    let lastPickClientX = 0;
    let lastPickClientY = 0;
    const photoPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const photoHit = new THREE.Vector3();
    // 保留一帧内的真实轨迹，包括反向与抬起前尚未渲染的移动。
    const photoSamples = new Float32Array(64 * 3);
    const photoBrushes: PhotoBrush[] = [];
    const previousPhotoPointer = new THREE.Vector2();
    const previousPhotoHit = new THREE.Vector3();
    let photoSampleCount = 0;
    let photoNeedsStart = true;
    let photoHasPrevious = false;
    let photoProjectionVersion = projectionVersion;
    let photoOffset = 0;

    const updateLocalRay = () => {
      particles.updateMatrixWorld();
      raycaster.setFromCamera(pointer, camera);
      localRay.copy(raycaster.ray).applyMatrix4(inverse.copy(particles.matrixWorld).invert());
    };

    // 用原位的前方密集簇选层；被手势推开的孔不会让拾取继续钻向后层。
    const pickDepth = () => {
      depthWeights.fill(0);
      depthSums.fill(0);
      depthCounts.fill(0);
      hasDepth = false;
      const origin = localRay.origin;
      const direction = localRay.direction;
      const start = -origin.dot(direction) - depthWeights.length * binWidth * 0.5;
      for (let i = 0; i < count; i++) {
        if (alphas[i] < 0.15 || glows[i] > 0) continue;
        const offset = i * 3;
        const x = rest[offset] - origin.x;
        const y = rest[offset + 1] - origin.y;
        const z = rest[offset + 2] - origin.z;
        const depth = x * direction.x + y * direction.y + z * direction.z;
        if (depth <= 0) continue;
        const dx = x - direction.x * depth;
        const dy = y - direction.y * depth;
        const dz = z - direction.z * depth;
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared >= pickRadiusSquared) continue;
        const bin = Math.floor((depth - start) / binWidth);
        if (bin < 0 || bin >= depthWeights.length) continue;
        const weight = (1 - distanceSquared / pickRadiusSquared) * alphas[i];
        depthWeights[bin] += weight;
        depthSums[bin] += depth * weight;
        depthCounts[bin]++;
      }
      let strongest = 0;
      for (let bin = 1; bin < depthWeights.length - 1; bin++) {
        strongest = Math.max(strongest, depthWeights[bin - 1] + depthWeights[bin] + depthWeights[bin + 1]);
      }
      const minimumSupport = Math.max(0.8, strongest * 0.1);
      for (let bin = 1; bin < depthWeights.length - 1; bin++) {
        const weight = depthWeights[bin - 1] + depthWeights[bin] + depthWeights[bin + 1];
        const count = depthCounts[bin - 1] + depthCounts[bin] + depthCounts[bin + 1];
        if (depthCounts[bin] < 2 || count < 6 || weight < minimumSupport) continue;
        const depth = (depthSums[bin - 1] + depthSums[bin] + depthSums[bin + 1]) / weight;
        localRay.at(depth, brushCenter);
        depthPlane.setFromNormalAndCoplanarPoint(direction, brushCenter);
        hasDepth = true;
        break;
      }
    };

    const updatePointer = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1,
        1 - (event.clientY - bounds.top) / bounds.height * 2);
      // 悬停移动超过 12 CSS 像素才重新选层，避免离散点让深度逐帧跳动。
      if (capturedPointer === null && (!pointerActive
        || (event.clientX - lastPickClientX) ** 2 + (event.clientY - lastPickClientY) ** 2 > 144)) {
        pickRequested = true;
        lastPickClientX = event.clientX;
        lastPickClientY = event.clientY;
      }
      pointerActive = true;
      if (photo) {
        const samples = event.getCoalescedEvents?.() ?? [];
        for (const sample of samples.length ? samples : [event]) {
          // 极端事件频率下保留起点和最终位置，数组不会无限增长。
          const slot = Math.min(photoSampleCount, 63) * 3;
          photoSamples[slot] = (sample.clientX - bounds.left) / bounds.width * 2 - 1;
          photoSamples[slot + 1] = 1 - (sample.clientY - bounds.top) / bounds.height * 2;
          photoSamples[slot + 2] = photoNeedsStart ? 1 : 0;
          photoNeedsStart = false;
          photoSampleCount = Math.min(64, photoSampleCount + 1);
        }
      }
      if (photo && motionPreference.matches && activeRef.current && !document.hidden && !contextLost) {
        renderer.setAnimationLoop(animate);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if (capturedPointer !== null && event.pointerId !== capturedPointer) return;
      capturedPointer = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      updatePointer(event);
      if (photo) return;
      updateLocalRay();
      pickDepth();
      pickRequested = false;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      if (capturedPointer !== null && event.pointerId !== capturedPointer) return;
      if (event.pointerType === 'mouse' || event.pointerId === capturedPointer) updatePointer(event);
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (capturedPointer !== null && event.pointerId !== capturedPointer) return;
      pointerActive = false;
      photoNeedsStart = true;
      hasDepth = false;
      pickRequested = false;
      capturedPointer = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const onPointerLeave = () => {
      if (capturedPointer !== null) return;
      pointerActive = false;
      photoNeedsStart = true;
      hasDepth = false;
      pickRequested = false;
    };
    const clearPointer = () => {
      pointerActive = false;
      photoNeedsStart = true;
      photoHasPrevious = false;
      photoSampleCount = 0;
      hasDepth = false;
      pickRequested = false;
      if (capturedPointer !== null && canvas.hasPointerCapture(capturedPointer)) canvas.releasePointerCapture(capturedPointer);
      capturedPointer = null;
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerEnd);
    canvas.addEventListener('pointercancel', onPointerEnd);
    canvas.addEventListener('lostpointercapture', onPointerEnd);
    canvas.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('blur', clearPointer);

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let elapsed = snapshot?.phase ?? 0;
    let previousTime: number | undefined;
    let contextLost = false;

    const animate = (time: number) => {
      const delta = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, 0.04);
      previousTime = time;
      if (!snapshot) {
        if (motionPreference.matches) Object.assign(currentVisual, targetVisualRef.current);
        else smoothVisual(currentVisual, targetVisualRef.current, delta);
        if (!motionPreference.matches) elapsed += delta * (0.35 + currentVisual.motion * 1.3);
      }
      const expansion = 0.8 + currentVisual.dispersion * 0.4;
      const pulse = !snapshot && !motionPreference.matches && activity ? activityLevel(activity.current, time) : 0;
      particles.scale.setScalar(framingScale * expansion * (1 + pulse * 0.035));
      material.uniforms.uModelScale.value = photo ? particles.scale.x : expansion;
      material.uniforms.uVisual.value.set(currentVisual.dispersion, currentVisual.motion, currentVisual.warmth);
      material.uniforms.uTime.value = elapsed;
      material.uniforms.uLight.value = (photo ? 0.8 + currentVisual.luminosity * 0.4 : 0.65 + currentVisual.luminosity * 0.7) * (1 + pulse * 0.16);
      if (photo && photoMotion) {
        // 保留 GPU 环境流动，只上传独立的手势偏移，不改写照片原位。
        particles.rotation.set(
          Math.sin(elapsed * 0.23) * 0.035,
          Math.sin(elapsed * 0.19) * 0.11,
          Math.sin(elapsed * 0.16) * 0.012,
        );
        particles.updateMatrixWorld();
        photoBrushes.length = 0;
        if (photoProjectionVersion !== projectionVersion) {
          photoHasPrevious = false;
          photoProjectionVersion = projectionVersion;
        }
        const localPerPixel = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
          / (Math.max(1, container.clientHeight) * particles.scale.x);
        const shortEdge = Math.min(photo.worldWidth, photo.worldHeight);
        const radius = THREE.MathUtils.clamp(48 * localPerPixel, Math.min(0.35, shortEdge * 0.1), shortEdge * 0.24);
        for (let sample = 0; sample < photoSampleCount; sample++) {
          const index = sample * 3;
          if (photoSamples[index + 2]) photoHasPrevious = false;
          if (photoHasPrevious) {
            pointer.copy(previousPhotoPointer);
            updateLocalRay();
            if (!localRay.intersectPlane(photoPlane, previousPhotoHit)) photoHasPrevious = false;
          }
          pointer.set(photoSamples[index], photoSamples[index + 1]);
          updateLocalRay();
          if (localRay.intersectPlane(photoPlane, photoHit)) {
            if (photoHasPrevious) photoBrushes.push({
              previousX: previousPhotoHit.x, previousY: previousPhotoHit.y,
              x: photoHit.x, y: photoHit.y, radius,
            });
            previousPhotoPointer.copy(pointer);
            photoHasPrevious = true;
          } else photoHasPrevious = false;
        }
        photoSampleCount = 0;
        if (photoBrushes.length || photoOffset > 0) {
          photoOffset = updatePhotoDisplacement(photo, displacement, photoMotion, delta, elapsed, photoBrushes);
          displacementAttribute.needsUpdate = true;
        }
        renderer.render(scene, camera);
        if (motionPreference.matches && photoOffset === 0) {
          renderer.setAnimationLoop(null);
          previousTime = undefined;
        }
        return;
      }
      writeEmotionRest(base, phases, currentVisual, elapsed, rest);
      // 轻微侧摆提供前后视差；减少动态效果时，elapsed 停止推进。
      particles.rotation.set(
        0.12 + Math.sin(elapsed * 0.12) * 0.025,
        0.3 + Math.sin(elapsed * 0.15) * 0.08,
        -0.08 + Math.sin(elapsed * 0.1) * 0.018,
      );
      particles.updateMatrixWorld();
      let brushActive = false;
      if (pointerActive) {
        updateLocalRay();
        if (pickRequested && capturedPointer === null) {
          pickDepth();
          pickRequested = false;
        }
        brushActive = hasDepth && localRay.intersectPlane(depthPlane, brushCenter) !== null;
      }
      const steps = Math.max(1, Math.ceil(delta / (1 / 90)));
      const step = delta / steps;
      const drag = Math.exp(-DAMPING * step);
      const radiusSquared = POINTER_RADIUS * POINTER_RADIUS;
      const direction = localRay.direction;
      for (let i = 0; i < count; i++) {
        const offset = i * 3;
        const x = rest[offset], y = rest[offset + 1], z = rest[offset + 2];
        let fx = 0;
        let fy = 0;
        let fz = 0;
        // 深度范围依据原位计算，不因受力位移变化而误选后层。
        const layerDistance = Math.abs(depthPlane.normal.x * x + depthPlane.normal.y * y
          + depthPlane.normal.z * z + depthPlane.constant);
        if (brushActive && layerDistance < depthHalfWidth) {
          const px = x + displacement[offset] - brushCenter.x;
          const py = y + displacement[offset + 1] - brushCenter.y;
          const pz = z + displacement[offset + 2] - brushCenter.z;
          const along = px * direction.x + py * direction.y + pz * direction.z;
          const dx = px - direction.x * along;
          const dy = py - direction.y * along;
          const dz = pz - direction.z * along;
          const distanceSquared = dx * dx + dy * dy + dz * dz;
          if (distanceSquared < radiusSquared) {
            const distance = Math.sqrt(distanceSquared);
            const depthWeight = 1 - THREE.MathUtils.smoothstep(layerDistance, 0.16, depthHalfWidth);
            const strength = (1 - distance / POINTER_RADIUS) ** 2 * 22 * depthWeight;
            const inverseDistance = 1 / Math.max(distance, 0.035);
            // 排斥 + 绕视线的切向旋流，不硬挖圆洞。
            const nx = distance < 0.001 ? Math.cos(phases[i]) : dx * inverseDistance;
            const ny = distance < 0.001 ? Math.sin(phases[i]) : dy * inverseDistance;
            const nz = dz * inverseDistance;
            fx = (nx + (direction.y * nz - direction.z * ny) * 0.42) * strength;
            fy = (ny + (direction.z * nx - direction.x * nz) * 0.42) * strength;
            fz = (nz + (direction.x * ny - direction.y * nx) * 0.42) * strength;
          }
        }
        // dt 子步积分 + 指数阻尼，防止慢帧或后台恢复时突然爆开。
        for (let substep = 0; substep < steps; substep++) {
          velocity[offset] = (velocity[offset] + (fx - displacement[offset] * SPRING) * step) * drag;
          velocity[offset + 1] = (velocity[offset + 1] + (fy - displacement[offset + 1] * SPRING) * step) * drag;
          velocity[offset + 2] = (velocity[offset + 2] + (fz - displacement[offset + 2] * SPRING) * step) * drag;
          displacement[offset] += velocity[offset] * step;
          displacement[offset + 1] += velocity[offset + 1] * step;
          displacement[offset + 2] += velocity[offset + 2] * step;
        }
        positions[offset] = x + displacement[offset];
        positions[offset + 1] = y + displacement[offset + 1];
        positions[offset + 2] = z + displacement[offset + 2];
      }
      positionAttribute.needsUpdate = true;
      renderer.render(scene, camera);
    };

    const onVisibilityChange = () => {
      clearPointer();
      previousTime = undefined;
      if (activeRef.current && !document.hidden && !contextLost) {
        const panel = experience?.querySelector<HTMLElement>('.work-panel');
        if (panel) resizeObserver.observe(panel);
        resize();
      }
      const stillPhoto = photo && motionPreference.matches && photoOffset === 0;
      renderer.setAnimationLoop(document.hidden || !activeRef.current || contextLost || stillPhoto ? null : animate);
      if (stillPhoto && activeRef.current && !document.hidden && !contextLost) animate(performance.now());
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      renderer.setAnimationLoop(null);
      setError('星云的显示暂时中断，正在等待图形设备恢复。');
    };
    wakeRef.current = onVisibilityChange;
    const onContextRestored = () => {
      contextLost = false;
      setError(null);
      onVisibilityChange();
    };
    captureRef.current = () => {
      if (contextLost) throw new Error('图形设备正在恢复，请稍后再凝结。');
      const sceneData = validateSnapshot({ version: snapshot?.version ?? 2, kind: photo ? 'photo' : 'nebula', seed: NEBULA_SEED,
        phase: elapsed, visual: currentVisual, photo });
      // Draw immediately before copying; WebGL's default framebuffer is not retained between frames.
      renderer.render(scene, camera);
      // 回廊轮播会放大显示，预览比早期的 320×220 大一些；仍在存档的长度上限内。
      const preview = document.createElement('canvas'); preview.width = 480; preview.height = 330;
      const ctx = preview.getContext('2d');
      if (!ctx) throw new Error('暂时无法生成作品预览，请重试。');
      ctx.fillStyle = '#040507'; ctx.fillRect(0, 0, preview.width, preview.height);
      // 铺满裁切：竖屏手机的画布不再被缩成预览中间的一小块。
      const scale = Math.max(preview.width / canvas.width, preview.height / canvas.height);
      const width = canvas.width * scale, height = canvas.height * scale;
      ctx.drawImage(canvas, (preview.width - width) / 2, (preview.height - height) / 2, width, height);
      let thumbnail = preview.toDataURL('image/jpeg', 0.75);
      if (thumbnail.length > 150_000) thumbnail = preview.toDataURL('image/jpeg', 0.5);
      return { scene: sceneData, thumbnail };
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    motionPreference.addEventListener('change', onVisibilityChange);
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    onVisibilityChange();

    return () => {
      captureRef.current = null;
      wakeRef.current = null;
      renderer.setAnimationLoop(null);
      clearPointer();
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerEnd);
      canvas.removeEventListener('pointercancel', onPointerEnd);
      canvas.removeEventListener('lostpointercapture', onPointerEnd);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('blur', clearPointer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      motionPreference.removeEventListener('change', onVisibilityChange);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      geometry.dispose();
      material.dispose();
      texture.dispose();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [photo, snapshot]);

  return <div className="particle-viewport" data-visual-target={JSON.stringify(resolveVisual(snapshot?.visual ?? visual))} data-condensed={Boolean(snapshot)} ref={containerRef}>{error && <p className="scene-error" role="alert">{error}</p>}</div>;
}
