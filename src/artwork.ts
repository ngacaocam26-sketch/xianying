import { validateVisual } from './visual.ts';
import type { VisualState, LegacyVisual } from './visual.ts';
import type { PhotoParticleData } from './photoToParticles.ts';
import { validateForm } from './imagery.ts';
import type { SculptureForm } from './imagery.ts';

export const NEBULA_SEED = 0x5849414e;
// v3 照片浮雕保存缩小重编码的照片（最长边 ≤ 1024，无原文件元数据），恢复时由它重新生成粒子。
export type ReliefPhoto = { image: string; width: number; height: number };
export type SceneSnapshot = {
  version: 1 | 2 | 3; kind: 'nebula' | 'photo' | 'relief' | 'sculpture'; seed: number; phase: number;
  visual: VisualState | LegacyVisual; photo: PhotoParticleData | null; relief?: ReliefPhoto;
  // 大模型为默认雕塑选的意象、名字与随机变化；更早的 v3 雕塑没有这一项，按参数规则恢复。
  form?: SculptureForm;
};
export type Artwork = {
  version: 1 | 2 | 3; id: string; title: string; createdAt: number; thumbnail: string; scene: SceneSnapshot;
  // AI 在凝结时写的一句总结；早期作品和没有对话的作品没有这一项。
  summary?: string;
};
const JPEG_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
export type ArtworkCard = Omit<Artwork, 'scene'> & { kind: SceneSnapshot['kind']; removedAt: number | null };

const invalid = () => new Error('这件作品的数据不完整或版本暂不支持，原存档没有被改动。');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw invalid();
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw invalid();
  return value;
}
function array(value: unknown, length: number, min: number, max: number): Float32Array {
  if (!(value instanceof Float32Array) || value.length !== length) throw invalid();
  for (const item of value) number(item, min, max);
  return value.slice();
}
export function validateSnapshot(value: unknown): SceneSnapshot {
  const input = object(value);
  if (![1, 2, 3].includes(Number(input.version)) || typeof input.version !== 'number' || input.seed !== NEBULA_SEED) throw invalid();
  // v1/v2 只有旧星云与旧照片点云；v3 是新画法的照片浮雕和默认雕塑，旧版本数据的读取规则保持不变。
  if (!(input.version === 3 ? ['relief', 'sculpture'] : ['nebula', 'photo']).includes(String(input.kind))) throw invalid();
  const full = validateVisual(input.visual, input.version === 1);
  if (!full) throw invalid();
  const visual = input.version === 1 ? { dispersion: full.dispersion, motion: full.motion, warmth: full.warmth } : full;
  const phase = number(input.phase, 0, 1e9);
  let photo: PhotoParticleData | null = null;
  if (input.kind === 'photo') {
    const p = object(input.photo);
    if (!(p.alphas instanceof Float32Array)) throw invalid();
    const count = p.alphas.length;
    if (!count || count > 64000) throw invalid();
    const width = number(p.sampledWidth, 1, 360), height = number(p.sampledHeight, 1, 360);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width * height > 64000 || count > width * height) throw invalid();
    photo = {
      positions: array(p.positions, count * 3, -1e9, 1e9), colors: array(p.colors, count * 3, 0, 1.001),
      alphas: array(p.alphas, count, 0, 1.001), sizes: array(p.sizes, count, 0, 64),
      phases: array(p.phases, count, 0, 6.284), flows: array(p.flows, count, 0, 1), glows: array(p.glows, count, 0, 1),
      worldWidth: number(p.worldWidth, Number.MIN_VALUE, 1e9), worldHeight: number(p.worldHeight, Number.MIN_VALUE, 1e9),
      sampledWidth: width, sampledHeight: height,
    };
  } else if (input.photo !== null) throw invalid();
  let relief: ReliefPhoto | undefined;
  if (input.kind === 'relief') {
    const r = object(input.relief);
    if (typeof r.image !== 'string' || r.image.length > 330_000 || !JPEG_DATA_URL.test(r.image)) throw invalid();
    const width = number(r.width, 1, 1024), height = number(r.height, 1, 1024);
    if (!Number.isInteger(width) || !Number.isInteger(height)) throw invalid();
    relief = { image: r.image, width, height };
  } else if (input.relief !== undefined) throw invalid();
  let form: SculptureForm | undefined;
  if (input.form !== undefined) {
    const valid = input.kind === 'sculpture' ? validateForm(input.form) : null;
    if (!valid) throw invalid();
    form = valid;
  }
  return { version: input.version as 1 | 2 | 3, kind: input.kind as SceneSnapshot['kind'], seed: NEBULA_SEED, phase, visual, photo,
    ...(relief ? { relief } : {}), ...(form ? { form } : {}) };
}
function metadata(value: unknown) {
  const input = object(value);
  if ((input.version !== 1 && input.version !== 2 && input.version !== 3) || typeof input.id !== 'string' || !/^[\w-]{1,80}$/.test(input.id) ||
    typeof input.title !== 'string' || !input.title.trim() || input.title.length > 40 ||
    typeof input.thumbnail !== 'string' || input.thumbnail.length > 160000 ||
    !JPEG_DATA_URL.test(input.thumbnail)) throw invalid();
  if (input.summary !== undefined && (typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 120)) throw invalid();
  return { version: input.version as 1 | 2 | 3, id: input.id, title: input.title.trim(),
    createdAt: number(input.createdAt, 0, 8.64e15), thumbnail: input.thumbnail,
    ...(typeof input.summary === 'string' ? { summary: input.summary.trim() } : {}) };
}
export function validateArtwork(value: unknown): Artwork {
  const input = object(value);
  // Project only artwork fields: conversations, original files and recordings never enter storage.
  return { ...metadata(input), scene: validateSnapshot(input.scene) };
}
export function artworkCard(work: Artwork, removedAt: number | null = null): ArtworkCard {
  return { version: work.version, id: work.id, title: work.title, createdAt: work.createdAt, thumbnail: work.thumbnail,
    ...(work.summary ? { summary: work.summary } : {}), kind: work.scene.kind, removedAt };
}
export function validateCard(value: unknown): ArtworkCard {
  const input = object(value);
  if (!['photo', 'nebula', 'relief', 'sculpture'].includes(String(input.kind))) throw invalid();
  return { ...metadata(input), kind: input.kind as ArtworkCard['kind'], removedAt: input.removedAt === null ? null : number(input.removedAt, 0, 8.64e15) };
}

// 部分 App 内置浏览器（如较旧的抖音、微信内核）没有 crypto.randomUUID，退回到 getRandomValues 拼一个同格式的 id。
function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function makeArtwork(scene: SceneSnapshot, thumbnail: string): Artwork {
  return validateArtwork({ version: scene.version === 3 ? 3 : 2, id: newId(), title: '此刻的显影', createdAt: Date.now(), thumbnail, scene });
}
