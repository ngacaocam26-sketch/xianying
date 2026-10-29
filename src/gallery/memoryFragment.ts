import * as THREE from 'three';

// 回廊里的「记忆碎片」：每件作品一块边缘被侵蚀的照片，内部是细密的粒子，边缘慢慢溶进黑暗，漏出画面颜色的亮尘。
// 形状只由作品 id 决定，同一件作品每次看到的都一样；静态封面的遮罩与实时碎片用同一条大形。

const HARMONICS = 5;

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 大形安静：接近照片的圆角形，只带一点歪斜（5 个低阶谐波，起伏很小）。
// 不规则主要交给着色器里的侵蚀纹理：边缘被一点点溶掉，有残缺、有散落的小块。
// noise 是这件作品侵蚀纹理的偏移，同一件作品每次一样，不同作品各不相同。
export type FragmentShape = { amp: number[]; phase: number[]; noise: [number, number] };
const ROUNDNESS = 2.6, BASE = 0.84;
export function fragmentShape(id: string): FragmentShape {
  const random = seededRandom(hash(id));
  const amp: number[] = [], phase: number[] = [];
  for (let i = 0; i < HARMONICS; i++) {
    amp.push((i < 2 ? 0.045 : 0.02) * (0.5 + 0.5 * random()));
    phase.push(random() * Math.PI * 2);
  }
  return { amp, phase, noise: [random() * 50, random() * 50] };
}
// 坐标按封面框归一化到 [-1, 1]；圆角矩形的半径再加上轻微起伏。
export function boundary(shape: FragmentShape, theta: number): number {
  const c = Math.abs(Math.cos(theta)), s = Math.abs(Math.sin(theta));
  let r = BASE * Math.pow(Math.pow(c, ROUNDNESS) + Math.pow(s, ROUNDNESS), -1 / ROUNDNESS);
  for (let i = 0; i < HARMONICS; i++) r += shape.amp[i] * Math.cos((i + 2) * theta + shape.phase[i]);
  return r;
}

// 雕塑本身就有轮廓：碎片的边放大到雕塑外面，只在外围留一圈淡淡的尘雾，不切到雕塑。
export const SCULPTURE_SHAPE_SCALE = 1.2;

// 封面框的比例；照片按自己的比例完整放进框里（竖照片就是竖的碎片），碎片的轮廓贴着照片本身。
export const COVER_ASPECT = 48 / 33;
// 封面框随作品比例变，竖照片不至于缩成一小块；太窄或太宽时照片在框里留边。
export function frameAspect(aspect: number) { return Math.min(1.6, Math.max(0.8, aspect)); }
export function containRect(box: { x: number; y: number; width: number; height: number }, aspect: number) {
  const width = Math.min(box.width, box.height * aspect), height = width / aspect;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

// 静态封面用的遮罩：同一条大形，向内羽化成一圈柔和的渐隐。遮罩铺满封面框，形状画在照片所占的那块里。
const masks = new Map<string, string>();
export function fragmentMask(id: string, sculpture = false, aspect = COVER_ASPECT): string {
  const key = `${id}:${sculpture}:${aspect.toFixed(3)}`;
  const box = frameAspect(aspect);
  const cached = masks.get(key);
  if (cached) return cached;
  const width = 240, height = Math.round(240 / box);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const shape = fragmentShape(id);
  const area = containRect({ x: 0, y: 0, width, height }, aspect);
  const steps = 12;
  for (let step = 0; step < steps; step++) {
    const scale = 1 - 0.26 * (step / (steps - 1));
    context.globalAlpha = 1 / steps;
    context.beginPath();
    for (let s = 0; s <= 180; s++) {
      const theta = (s / 180) * Math.PI * 2;
      const r = boundary(shape, theta) * scale * (sculpture ? SCULPTURE_SHAPE_SCALE : 1);
      const x = width / 2 + Math.cos(theta) * r * area.width / 2, y = height / 2 - Math.sin(theta) * r * area.height / 2;
      if (s === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath();
    context.fillStyle = '#fff';
    context.fill();
  }
  const url = canvas.toDataURL('image/png');
  masks.set(key, url);
  return url;
}

const SHAPE_GLSL = /* glsl */ `
  uniform float uAmp[${HARMONICS}];
  uniform float uPhase[${HARMONICS}];
  uniform vec2 uNoise;
  float boundary(float theta) {
    vec2 a = abs(vec2(cos(theta), sin(theta)));
    float r = ${BASE.toFixed(3)} * pow(pow(a.x, ${ROUNDNESS.toFixed(2)}) + pow(a.y, ${ROUNDNESS.toFixed(2)}), -1.0 / ${ROUNDNESS.toFixed(2)});
    for (int i = 0; i < ${HARMONICS}; i++) r += uAmp[i] * cos(float(i + 2) * theta + uPhase[i]);
    return r;
  }
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float valueNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // 侵蚀纹理：大尺度决定哪段边被吃进去更多，小尺度是毛边和散落的小块。结果约在 -0.5—0.5。
  float erosion(vec2 q) {
    vec2 p = q * vec2(1.45, 1.0) + uNoise;
    return valueNoise(p * 1.8) * 0.55 + valueNoise(p * 4.5) * 0.3 + valueNoise(p * 11.0) * 0.15 - 0.5;
  }
`;

const COMMON_GLSL = /* glsl */ `
  uniform sampler2D uImage;
  uniform vec2 uCenter;
  uniform vec2 uHalf;
  uniform vec2 uUvScale;
  uniform vec2 uUvOffset;
  uniform float uTime;
  uniform float uReveal;
  uniform float uSculpture;
  uniform float uDpr;
  uniform float uShapeScale;
  ${SHAPE_GLSL}
  vec3 sampleImage(vec2 q) {
    vec2 uv = uUvOffset + (q * 0.5 + 0.5) * uUvScale;
    return texture2D(uImage, clamp(uv, 0.0, 1.0)).rgb;
  }
  float lightness(vec3 color) { return dot(color, vec3(0.299, 0.587, 0.114)); }
  // 雕塑作品的封面底色是黑的：按亮度决定可见度，只剩雕塑本身。
  float presence(vec3 color) {
    float light = max(color.r, max(color.g, color.b));
    return mix(1.0, smoothstep(0.04, 0.2, light), uSculpture);
  }
`;

const SURFACE_VERTEX = /* glsl */ `
  ${COMMON_GLSL}
  uniform float uPointSize;
  attribute vec2 aQ;
  attribute float aSeed;
  varying vec4 vColor;
  varying float vRound;
  void main() {
    float rho = length(aQ);
    float theta = atan(aQ.y, aQ.x);
    // 到轮廓的距离加上侵蚀：有的地方被吃进去一大块，有的地方留下伸出的残片。
    float d = boundary(theta) * uShapeScale - rho + erosion(aQ) * 0.3;
    // 内部实心；边缘一圈越来越稀、越来越淡，自己溶进黑暗里，不是一刀切断。
    float inner = smoothstep(-0.02, 0.2, d);
    float edge = 1.0 - inner;
    float keep = step(aSeed, inner * inner * (3.0 - 2.0 * inner));
    vec3 color = sampleImage(aQ);
    // 边上暗的颗粒直接隐进黑暗（否则半透明的暗点像一圈焦边），亮的留下并提亮，像光从画面边缘透出来。
    float glow = smoothstep(0.06, 0.45, lightness(color));
    float alpha = keep * presence(color) * mix(1.0, glow, edge);
    // 边缘的颗粒要么清楚可见，要么不出现：一层半亮不亮的淡颗粒会连成灰蒙蒙的雾，像脏边。
    alpha *= smoothstep(0.25, 0.45, alpha);
    color = mix(color, color * 1.25 + vec3(0.1), edge * glow);

    vec2 dir = rho > 1e-4 ? aQ / rho : vec2(0.0);
    vec2 q = aQ + dir * edge * edge * 0.03 * (0.6 + 0.4 * sin(uTime * 0.6 + aSeed * 40.0));
    // 出现与散去：粒子从四周的雾里聚拢，散去时沿原路飘开。
    float away = 1.0 - uReveal;
    vec2 scatter = vec2(sin(aSeed * 91.7), cos(aSeed * 53.3)) * (0.25 + 0.9 * fract(aSeed * 7.3));
    q += (dir * 0.5 + scatter) * away * away * 1.1;
    alpha *= clamp(uReveal * 1.6 - fract(aSeed * 3.7) * 0.6, 0.0, 1.0);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(uCenter + q * uHalf, 0.0, 1.0);
    gl_PointSize = alpha < 0.01 ? 0.0 : uPointSize * (1.0 - edge * 0.45) * uDpr;
    vColor = vec4(color, alpha);
    vRound = step(0.15, edge);
  }
`;
const SURFACE_FRAGMENT = /* glsl */ `
  varying vec4 vColor;
  varying float vRound;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (vRound > 0.5 && dot(c, c) > 0.25) discard;
    gl_FragColor = vColor;
  }
`;

const DUST_VERTEX = /* glsl */ `
  ${COMMON_GLSL}
  attribute float aTheta;
  attribute float aSeed;
  varying vec4 vColor;
  void main() {
    vec2 dir = vec2(cos(aTheta), sin(aTheta));
    // 亮尘从被侵蚀的边上漏出来：起点在侵蚀后的边附近，往外慢慢飘，略往上。
    float b = boundary(aTheta) * uShapeScale;
    float start = b - 0.12 + 0.12 * fract(aSeed * 17.3);
    start += erosion(dir * start) * 0.3;
    float life = fract(uTime * (0.03 + 0.05 * fract(aSeed * 5.1)) + aSeed);
    float reach = 0.03 + 0.28 * pow(fract(aSeed * 11.7), 2.5);
    vec2 q = dir * (start + life * reach);
    q += vec2(sin(uTime * 0.5 + aSeed * 30.0), cos(uTime * 0.4 + aSeed * 20.0)) * 0.012 + vec2(0.0, life * 0.05);
    // 颜色和亮度都来自画面本身：亮处漏出的尘多而亮，暗处几乎没有。
    vec3 tint = sampleImage(dir * clamp(start, 0.0, 0.97));
    float light = lightness(tint);
    float twinkle = 0.6 + 0.4 * sin(uTime * (1.2 + 2.0 * fract(aSeed * 13.1)) + aSeed * 60.0);
    float alpha = sin(life * 3.14159) * twinkle * smoothstep(0.25, 0.75, light) * mix(1.0, 0.5, uSculpture) * uReveal;
    alpha *= smoothstep(0.12, 0.3, alpha);
    // 散去时亮尘被吹远一些。
    q += dir * (1.0 - uReveal) * 0.25 * fract(aSeed * 9.1);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(uCenter + q * uHalf, 0.0, 1.0);
    gl_PointSize = (0.8 + 1.4 * fract(aSeed * 29.3)) * uDpr;
    vColor = vec4(mix(tint * 1.6, vec3(1.0, 0.97, 0.92), 0.45) * alpha * 1.3, 1.0);
  }
`;
const DUST_FRAGMENT = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c);
    if (r > 0.25) discard;
    vec3 light = min(vColor.rgb * smoothstep(0.25, 0.0, r), vec3(1.0));
    gl_FragColor = vec4(light, max(light.r, max(light.g, light.b)));
  }
`;

export type FragmentContent = { id: string; image: string; sculpture: boolean };
export type FragmentRect = { x: number; y: number; width: number; height: number };
export type MemoryFragment = {
  // 显示一件作品：rect 是封面框在画布里的位置（CSS 像素，左上为原点）。onShown 在碎片聚拢后调用。
  show: (content: FragmentContent, rect: FragmentRect, onShown?: () => void) => void;
  hide: () => void;
  dispose: () => void;
};

export function createMemoryFragment(canvas: HTMLCanvasElement, compact: boolean): MemoryFragment {
  // 透明画布按预乘合成（默认）：半透明的边缘颗粒才是淡淡的亮色，而不是被压暗成黑点；亮尘则是叠加上去的光。
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // 每件作品新建一张纹理：图片尺寸不同，沿用旧纹理会残留上一件的画面。
  const makeTexture = (image?: HTMLImageElement) => {
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = Boolean(image);
    return texture;
  };
  const uniforms = {
    uImage: { value: makeTexture() },
    uCenter: { value: new THREE.Vector2() }, uHalf: { value: new THREE.Vector2(1, 1) },
    uUvScale: { value: new THREE.Vector2(1, 1) }, uUvOffset: { value: new THREE.Vector2() },
    uTime: { value: 0 }, uReveal: { value: 0 }, uSculpture: { value: 0 }, uShapeScale: { value: 1 }, uDpr: { value: dpr },
    uPointSize: { value: 2 },
    uAmp: { value: new Array(HARMONICS).fill(0) }, uPhase: { value: new Array(HARMONICS).fill(0) }, uNoise: { value: new THREE.Vector2() },
  };
  const surfaceMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader: SURFACE_VERTEX, fragmentShader: SURFACE_FRAGMENT,
    transparent: true, depthTest: false, depthWrite: false });
  // 亮尘是叠加上去的光：颜色与不透明度一起累加，不透明度取自身亮度。
  // 透明画布按预乘合成，颜色不能超过不透明度，否则浏览器可能把它合成成黑点。
  const dustMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader: DUST_VERTEX, fragmentShader: DUST_FRAGMENT,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true });

  // 粒子按封面框的比例铺成网格，每颗在格子里随机偏一点，看不出行列。
  const columns = compact ? 230 : 330;
  let surface: THREE.Points | null = null;
  let builtAspect = 0;
  const buildSurface = (aspect: number) => {
    if (surface && Math.abs(builtAspect - aspect) < 0.01) return;
    if (surface) { scene.remove(surface); surface.geometry.dispose(); }
    const rows = Math.max(8, Math.round(columns / aspect));
    const count = columns * rows;
    const q = new Float32Array(count * 2), seeds = new Float32Array(count);
    const random = seededRandom(0x6d656d6f);
    for (let row = 0, i = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++, i++) {
        q[i * 2] = ((column + 0.2 + random() * 0.6) / columns) * 2 - 1;
        q[i * 2 + 1] = ((row + 0.2 + random() * 0.6) / rows) * 2 - 1;
        seeds[i] = random();
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('aQ', new THREE.BufferAttribute(q, 2));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    surface = new THREE.Points(geometry, surfaceMaterial);
    surface.frustumCulled = false;
    scene.add(surface);
    builtAspect = aspect;
  };
  {
    const count = compact ? 5000 : 9000;
    const theta = new Float32Array(count), seeds = new Float32Array(count);
    const random = seededRandom(0x64757374);
    for (let i = 0; i < count; i++) { theta[i] = random() * Math.PI * 2; seeds[i] = random(); }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('aTheta', new THREE.BufferAttribute(theta, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const dust = new THREE.Points(geometry, dustMaterial);
    dust.frustumCulled = false;
    dust.renderOrder = 1;
    scene.add(dust);
  }

  const resize = () => {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.left = 0; camera.right = width; camera.top = height; camera.bottom = 0;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  // 状态：target 为 1 时聚拢显示，为 0 时散去；散尽后才换下一件，避免两件叠在一起。
  let target = 0;
  let next: { content: FragmentContent; rect: FragmentRect; image: HTMLImageElement; onShown?: () => void } | null = null;
  let shownCallback: (() => void) | undefined;
  let loadSerial = 0;
  const apply = (content: FragmentContent, rect: FragmentRect, image: HTMLImageElement) => {
    uniforms.uImage.value.dispose();
    uniforms.uImage.value = makeTexture(image);
    const shape = fragmentShape(content.id);
    uniforms.uAmp.value = shape.amp;
    uniforms.uPhase.value = shape.phase;
    uniforms.uNoise.value.set(shape.noise[0], shape.noise[1]);
    uniforms.uSculpture.value = content.sculpture ? 1 : 0;
    uniforms.uShapeScale.value = content.sculpture ? SCULPTURE_SHAPE_SCALE : 1;
    const height = canvas.clientHeight;
    uniforms.uCenter.value.set(rect.x + rect.width / 2, height - (rect.y + rect.height / 2));
    uniforms.uHalf.value.set(rect.width / 2, rect.height / 2);
    // 与封面 object-fit: cover 一致：图片按框裁切，不变形。
    const boxAspect = rect.width / rect.height, imageAspect = image.naturalWidth / image.naturalHeight;
    const scale = imageAspect > boxAspect ? [boxAspect / imageAspect, 1] : [1, imageAspect / boxAspect];
    uniforms.uUvScale.value.set(scale[0], scale[1]);
    uniforms.uUvOffset.value.set((1 - scale[0]) / 2, (1 - scale[1]) / 2);
    buildSurface(boxAspect);
    uniforms.uPointSize.value = (rect.width / columns) * 1.45;
  };

  let previous: number | undefined;
  let time = 0;
  renderer.setAnimationLoop((now: number) => {
    const delta = previous === undefined ? 0 : Math.min((now - previous) / 1000, 0.05);
    previous = now;
    if (!motion.matches) time += delta;
    uniforms.uTime.value = time;
    const reveal = uniforms.uReveal.value;
    if (next && reveal <= 0.001) {
      apply(next.content, next.rect, next.image);
      shownCallback = next.onShown;
      next = null;
      target = 1;
    }
    const speed = target > reveal ? 1.3 : 3.2;
    const step = motion.matches ? 1 : delta * speed;
    uniforms.uReveal.value = target > reveal ? Math.min(target, reveal + step) : Math.max(target, reveal - step);
    if (shownCallback && uniforms.uReveal.value >= 0.999) { shownCallback(); shownCallback = undefined; }
    renderer.render(scene, camera);
  });

  return {
    show(content, rect, onShown) {
      const serial = ++loadSerial;
      const image = new Image();
      image.onload = () => {
        if (serial !== loadSerial) return;
        next = { content, rect, image, onShown };
        target = 0;
      };
      image.src = content.image;
    },
    hide() { loadSerial++; next = null; shownCallback = undefined; target = 0; },
    dispose() {
      loadSerial++;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      scene.traverse(object => { if (object instanceof THREE.Points) object.geometry.dispose(); });
      surfaceMaterial.dispose(); dustMaterial.dispose(); uniforms.uImage.value.dispose();
      renderer.dispose();
    },
  };
}
