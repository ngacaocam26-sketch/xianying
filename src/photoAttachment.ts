export type PhotoAttachment = { dataUrl: string; width: number; height: number };
export type PhotoContext = { id: number; image: PhotoAttachment };

// Re-encoding a bitmap drops the original metadata; the original file stays local.
export async function preparePhotoAttachment(file: File): Promise<PhotoAttachment> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('请选择一张不超过 20 MB 的图片。');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('这张图片无法读取，请换一张 JPG、PNG 或 WebP 图片。');
  }
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error('图片尺寸过大，请缩小到 4000 万像素以内后再试。');
    const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法准备照片，请重新选择。');
    context.fillStyle = '#090d14';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    for (const quality of [0.8, 0.65, 0.5]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= 320_000) return { dataUrl, width, height };
    }
    throw new Error('照片缩略图仍然过大，请换一张尺寸较小的图片。');
  } finally {
    bitmap.close();
  }
}
