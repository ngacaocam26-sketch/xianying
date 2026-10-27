import type { ReliefSource } from './reliefScene';
import type { ReliefPhoto } from '../artwork';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function drawScaled(image: CanvasImageSource, width: number, height: number, longEdge: number, filter = 'none') {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器暂时无法读取图片，请刷新后重试。');
  // 不支持 filter 的浏览器会忽略它，小尺寸加线性采样仍足够平滑。
  context.filter = filter;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function prepareSource(image: CanvasImageSource, width: number, height: number): ReliefSource {
  return {
    color: drawScaled(image, width, height, 1024),
    height: drawScaled(image, width, height, 192, 'blur(2px)'),
    aspect: width / height,
  };
}

// 照片只在本机解码和缩小，不上传、不保存。
export async function loadPhotoSource(file: File): Promise<ReliefSource> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  }
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('请选择一张不超过 20 MB 的图片。');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('这张图片无法读取，请换一张 JPG、PNG 或 WebP 图片。');
  }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) {
      throw new Error('图片尺寸过大，请缩小到 4000 万像素以内后再试。');
    }
    return prepareSource(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

// 主页面与回廊：从保存的缩小照片重新生成同一件浮雕。
export async function loadReliefPhoto(photo: ReliefPhoto): Promise<ReliefSource> {
  const image = new Image();
  image.src = photo.image;
  await image.decode();
  return prepareSource(image, image.naturalWidth, image.naturalHeight);
}
