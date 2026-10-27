export interface PhotoParticleData {
  positions: Float32Array;
  colors: Float32Array;
  alphas: Float32Array;
  sizes: Float32Array;
  phases: Float32Array;
  flows: Float32Array;
  glows: Float32Array;
  worldWidth: number;
  worldHeight: number;
  sampledWidth: number;
  sampledHeight: number;
}

const MAX_PARTICLES = 64_000;
const MAX_SAMPLE_EDGE = 360;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

// 像素是 sRGB，Three.js 的顶点颜色使用线性值；着色器输出时再转回 sRGB。
function srgbToLinear(byte: number) {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function smoothstep(low: number, high: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

// 固定种子让同一张照片重复加载时形态一致，方便比较视觉调整。
function randomGenerator() {
  let seed = 0x70686f74;
  return () => {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    return (seed >>> 0) / 4294967296;
  };
}

// 像素颜色仍属于原来的位置；抖动打散网格，亮度只提供艺术化厚度。
export function pixelsToParticles(image: ImageData, aspectRatio: number): PhotoParticleData {
  const { width, height, data } = image;
  const positions = new Float32Array(width * height * 3);
  const colors = new Float32Array(width * height * 3);
  const alphas = new Float32Array(width * height);
  const sizes = new Float32Array(width * height);
  const phases = new Float32Array(width * height);
  const flows = new Float32Array(width * height);
  const glows = new Float32Array(width * height);
  const worldHeight = 4;
  const worldWidth = worldHeight * aspectRatio;
  const spacing = Math.min(worldWidth / width, worldHeight / height);
  const random = randomGenerator();
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = (y * width + x) * 4;
      const alpha = data[pixel + 3] / 255;
      if (alpha < 0.02) continue;
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const nx = u * 2 - 1;
      const ny = 1 - v * 2;
      const luminance = (data[pixel] * 0.2126 + data[pixel + 1] * 0.7152
        + data[pixel + 2] * 0.0722) / 255;
      // 圆角、起伏的外缘只消散外围，中央主体不被统一圆形裁掉。
      const radius = (Math.abs(nx) ** 4 + Math.abs(ny) ** 4) ** 0.25;
      const contour = radius + Math.sin(nx * 7 + ny * 4) * 0.035
        + Math.sin(ny * 10 - nx * 3) * 0.025;
      const edge = smoothstep(0.62, 1.05, contour);
      const fade = 1 - smoothstep(0.81, 1.13, contour);
      const dust = random() < 0.08 + edge * 0.26;
      const spread = dust ? (0.06 + edge * 0.4) * random() : 0;
      const angle = Math.atan2(ny, nx) + Math.sin(nx * 4 - ny * 3) * 0.6;
      const offset = count * 3;
      positions[offset] = nx * worldWidth * 0.5 + (random() - 0.5) * worldWidth / width
        + Math.cos(angle) * spread;
      positions[offset + 1] = ny * worldHeight * 0.5 + (random() - 0.5) * spacing
        + Math.sin(angle) * spread;
      positions[offset + 2] = (luminance - 0.45) * 0.44
        + Math.sin(nx * 2.8 + ny * 1.3) * 0.18 + nx * nx * 0.2
        + (random() - 0.5) * (dust ? 0.55 : 0.1);
      colors[offset] = srgbToLinear(data[pixel]);
      colors[offset + 1] = srgbToLinear(data[pixel + 1]);
      colors[offset + 2] = srgbToLinear(data[pixel + 2]);
      alphas[count] = alpha * fade * (0.26 + Math.sqrt(luminance) * 0.5)
        * (dust ? 0.58 : 1);
      sizes[count] = spacing * (0.66 + random() * 0.52 + luminance * 0.25);
      phases[count] = random() * Math.PI * 2;
      flows[count] = 0.018 + edge * 0.19 + (dust ? 0.12 : 0);
      glows[count] = random() < 0.035 && luminance > 0.35 ? 1 : 0;
      if (glows[count]) {
        sizes[count] *= 2.6;
        alphas[count] *= 0.42;
      }
      count++;
    }
  }
  if (!count) throw new Error('这张图片完全透明，请换一张可见的图片。');

  return {
    positions: positions.slice(0, count * 3),
    colors: colors.slice(0, count * 3),
    alphas: alphas.slice(0, count),
    sizes: sizes.slice(0, count),
    phases: phases.slice(0, count),
    flows: flows.slice(0, count),
    glows: glows.slice(0, count),
    worldWidth,
    worldHeight,
    sampledWidth: width,
    sampledHeight: height,
  };
}

export async function photoToParticles(file: File): Promise<PhotoParticleData> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  }
  if (!file.size || file.size > MAX_FILE_BYTES) {
    throw new Error('请选择一张不超过 20 MB 的图片。');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('这张图片无法读取，请换一张 JPG、PNG 或 WebP 图片。');
  }

  try {
    const { width, height } = bitmap;
    if (!width || !height || width * height > 40_000_000) {
      throw new Error('图片尺寸过大，请缩小到 4000 万像素以内后再试。');
    }
    const scale = Math.min(1, MAX_SAMPLE_EDGE / Math.max(width, height),
      Math.sqrt(MAX_PARTICLES / (width * height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('浏览器暂时无法读取图片，请刷新后重试。');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return pixelsToParticles(context.getImageData(0, 0, canvas.width, canvas.height), width / height);
  } finally {
    bitmap.close();
  }
}
