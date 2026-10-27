export const STUDY_PARTICLE_COUNT = 22_000;
export const STUDY_SEED = 0x5849414e;
export const SHAPE_STUDIES = [
  { id: 'knot', name: '交织的丝线', word: '交织', english: 'INTERTWINED', description: '多股丝线绕行，穿过彼此，留下结与空隙。' },
  { id: 'drape', name: '层叠的垂落体', word: '垂落', english: 'SUSPENDED', description: '薄片层层悬垂，褶皱沿着重量向下延伸。' },
  { id: 'ribbon', name: '舒展的带状体', word: '舒展', english: 'UNFOLDING', description: '从相近的起点出发，向不同方向打开。' },
  { id: 'islands', name: '分离的粒子群', word: '离散', english: 'APART', description: '几团独立的粒子，彼此留有可见的距离。' },
] as const;
export type StudyShape = typeof SHAPE_STUDIES[number]['id'];
type Point = readonly [number, number, number];

function createRandom(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// All four studies use the same indexed appearance values. Only their coordinates differ.
export function createStudyAppearance() {
  const random = createRandom(STUDY_SEED ^ 0xabcdef);
  const sizes = new Float32Array(STUDY_PARTICLE_COUNT);
  const alphas = new Float32Array(STUDY_PARTICLE_COUNT);
  const glows = new Float32Array(STUDY_PARTICLE_COUNT);
  for (let i = 0; i < STUDY_PARTICLE_COUNT; i++) {
    sizes[i] = 0.014 + random() * 0.014;
    alphas[i] = 0.4 + random() * 0.25;
    glows[i] = random() < 0.035 ? 1 : 0;
    if (glows[i]) { sizes[i] *= 2.7; alphas[i] *= 0.28; }
  }
  return { sizes, alphas, glows };
}

const ribbonPaths: readonly (readonly Point[])[] = [
  [[-2, -1.35, -.4], [-1.7, .45, .2], [-.25, 2.5, .8], [1.25, 2, -.3]],
  [[-1.95, -1.3, -.3], [-.4, -.8, .6], [.5, 1.2, -.4], [2.3, .5, .25]],
  [[-1.85, -1.4, -.2], [-.7, -1.8, .6], [1.8, -.2, .7], [2.55, -.95, -.2]],
  [[-1.9, -1.3, -.2], [-2, 1, .3], [-1.1, 1.65, -.3], [-.3, 2.45, .15]],
];
const islandCenters: readonly Point[] = [
  [-1.65, 1.1, -.15], [.65, 1.65, .25], [1.65, -.25, -.3], [-.45, -.8, .45], [-1.8, -1.7, -.3],
];
const islandRadii = [.75, .5, .66, .6, .34];

export function createStudyPositions(kind: StudyShape, seed = STUDY_SEED) {
  const random = createRandom(seed);
  const positions = new Float32Array(STUDY_PARTICLE_COUNT * 3);
  for (let i = 0; i < STUDY_PARTICLE_COUNT; i++) {
    const u = random();
    const v = random() * 2 - 1;
    const thickness = (random() + random() + random() - 1.5) * .065;
    let x: number, y: number, z: number;
    if (kind === 'knot') {
      const strand = i % 7;
      const phase = strand / 7 * Math.PI * 2;
      const t = u * Math.PI * 2;
      // Separate filaments braid around a three-lobed knot with real crossings in depth.
      const braid = .10 * Math.cos(t * 8 + phase);
      x = .82 * (Math.sin(t) + 2 * Math.sin(2 * t)) + braid * Math.cos(t);
      y = .76 * (Math.cos(t) - 2 * Math.cos(2 * t)) + braid * Math.sin(t);
      z = -.78 * Math.sin(3 * t) + .10 * Math.sin(t * 8 + phase);
      x += v * .027; y += thickness; z += v * .025;
    } else if (kind === 'drape') {
      const layer = i % 6;
      const phase = layer * .9;
      const width = (.32 + Math.sin(Math.PI * u) ** .5 * .68) * (.39 + layer * .025);
      const length = 3.55 + .5 * Math.sin(phase + .4);
      x = (layer - 2.5) * .48 + .19 * Math.sin(u * 4 + phase) + v * width;
      y = 2.08 - length * u + .12 * Math.cos(v * 2 + phase) - .25 * v * v * u;
      z = (layer - 2.5) * .27 + .17 * Math.cos(v * Math.PI * 2 + phase)
        + .18 * Math.sin(u * 5 + phase) + thickness;
    } else if (kind === 'ribbon') {
      const lane = i % ribbonPaths.length;
      const [a, b, c, d] = ribbonPaths[lane];
      const s = 1 - u;
      const width = .035 + Math.sin(Math.PI * u) ** .65 * (.23 + lane * .025);
      const dx = 3 * s * s * (b[0] - a[0]) + 6 * s * u * (c[0] - b[0]) + 3 * u * u * (d[0] - c[0]);
      const dy = 3 * s * s * (b[1] - a[1]) + 6 * s * u * (c[1] - b[1]) + 3 * u * u * (d[1] - c[1]);
      const tangentLength = Math.hypot(dx, dy) || 1;
      const twist = Math.sin(u * 4 + lane * .8);
      x = s ** 3 * a[0] + 3 * s * s * u * b[0] + 3 * s * u * u * c[0] + u ** 3 * d[0]
        - dy / tangentLength * v * width;
      y = s ** 3 * a[1] + 3 * s * s * u * b[1] + 3 * s * u * u * c[1] + u ** 3 * d[1]
        + dx / tangentLength * v * width;
      z = s ** 3 * a[2] + 3 * s * s * u * b[2] + 3 * s * u * u * c[2] + u ** 3 * d[2]
        + v * width * twist + .11 * Math.sin(u * 8 + lane) + thickness;
    } else {
      const cluster = i % islandCenters.length;
      const center = islandCenters[cluster];
      const theta = u * Math.PI * 2;
      const vertical = random() * 2 - 1;
      const latitude = Math.sqrt(1 - vertical * vertical);
      const radius = Math.pow(random(), .42) * islandRadii[cluster];
      const irregular = 1 + .17 * Math.sin(theta * 3 + cluster)
        * Math.cos(vertical * 4) + .09 * Math.cos(theta * 5 - vertical * 3);
      x = center[0] + Math.cos(theta) * latitude * radius * irregular * 1.12;
      y = center[1] + vertical * radius * irregular * .8;
      z = center[2] + Math.sin(theta) * latitude * radius * irregular * .7;
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }
  return positions;
}
