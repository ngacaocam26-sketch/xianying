import type { ImageId, SculptureForm } from './imagery';
import type { VisualState } from './visual';

// 雕塑的配色候选：每组三种颜色，lit 是受光面的主色，shade 是背光沉下去的深色，glow 是从缝隙、中心和轮廓透出来的光。
// 缠结的两股管子里，第二股整股用 glow 的颜色。颜色写成 sRGB 十六进制，方便直接调。目前只在 /color-lab 里试看。
export const PALETTES = [
  { id: 'peach', label: '桃金', lit: '#FF6F9F', shade: '#6E1A48', glow: '#FFC24A' },
  { id: 'coral', label: '珊瑚', lit: '#FF8A5C', shade: '#8C2F1E', glow: '#FFE08A' },
  { id: 'sun', label: '明黄', lit: '#FFD35C', shade: '#9A6212', glow: '#FFF4C2' },
  { id: 'rose', label: '玫红', lit: '#FF5FA8', shade: '#6E1650', glow: '#FFC2E0' },
  { id: 'sprout', label: '新绿', lit: '#9CF29A', shade: '#1F6B4A', glow: '#F2FFB0' },
  { id: 'dawn', label: '晨光', lit: '#FFE3CF', shade: '#6D6488', glow: '#FFF0D6' },
  { id: 'deep', label: '深海', lit: '#4F7BEA', shade: '#0E1846', glow: '#8FB0FF' },
  { id: 'indigo', label: '靛青', lit: '#6B5BE6', shade: '#1A1250', glow: '#A99CFF' },
  { id: 'moon', label: '月光', lit: '#C9D6F2', shade: '#2E3A5C', glow: '#E6EEFF' },
  { id: 'ember', label: '蓝里透暖', lit: '#7FA2F0', shade: '#1A2550', glow: '#FFB25C' },
  { id: 'smoulder', label: '暗红', lit: '#B3242A', shade: '#33050A', glow: '#F04A32' },
  { id: 'blaze', label: '烈橙', lit: '#FF7A2E', shade: '#7A1F05', glow: '#FFE07A' },
  { id: 'teal', label: '青绿', lit: '#3FD9B8', shade: '#0B4A48', glow: '#C8FFF0' },
  { id: 'mauve', label: '雾紫', lit: '#C3A9D9', shade: '#4A3D5C', glow: '#EADCF5' },
  { id: 'tangle', label: '拉扯', lit: '#C0322A', shade: '#3A0609', glow: '#6E62E0' },
] as const;

export type PaletteId = typeof PALETTES[number]['id'];
export type Palette = typeof PALETTES[number];
// vivid 是鲜艳度 0—1：0 与现在的单色光雕完全一样，1 是这组配色本来的颜色。
export type SculptureColor = { palette: PaletteId; vivid: number };

export function findPalette(id: PaletteId): Palette {
  return PALETTES.find(item => item.id === id) ?? PALETTES[0];
}

// 每个意象的默认颜色，依据颜色与情绪的心理学研究（见 DEV_LOG 2026-11-06）：
// 明暗跟正负走（浅色偏正面、深色偏负面），鲜艳度跟强度走（越艳越激动）；色相取研究里最稳的联想
// （黄与粉对应喜悦、红对应愤怒、蓝对应悲伤又不负面、青绿对应松一口气、紫最说不清）。悲伤用蓝不用灰：灰在研究里一律是负面的。
// 研究测的是联想，不是“看了就会有的感受”；AI 以后可以在同一套色卡里按具体感受换，比如憋着的火换暗红。
// luminosity 只用于试验页；主暗房的明暗来自作品参数。凝聚保持单色：沉默、还没说出口的，先不上色。
export const IMAGE_COLORS: Record<ImageId, { palette: PaletteId | null; vivid: number; luminosity: number }> = {
  gather: { palette: null, vivid: 0, luminosity: 0.5 },
  braid: { palette: 'tangle', vivid: 0.8, luminosity: 0.45 },
  drape: { palette: 'deep', vivid: 0.45, luminosity: 0.3 },
  unfold: { palette: 'teal', vivid: 0.75, luminosity: 0.65 },
  apart: { palette: 'moon', vivid: 0.8, luminosity: 0.4 },
  flame: { palette: 'coral', vivid: 0.9, luminosity: 0.6 },
  rain: { palette: 'deep', vivid: 0.7, luminosity: 0.4 },
  wave: { palette: 'ember', vivid: 0.8, luminosity: 0.5 },
  vortex: { palette: 'indigo', vivid: 0.75, luminosity: 0.35 },
  cloud: { palette: 'mauve', vivid: 0.7, luminosity: 0.5 },
  thorns: { palette: 'smoulder', vivid: 0.85, luminosity: 0.45 },
  bloom: { palette: 'peach', vivid: 1, luminosity: 0.7 },
};

// 主暗房里的颜色：取 AI 所选意象的默认配色；鲜艳度随“活跃”参数上下浮动（研究里饱和度对应情绪的强弱）。
// 没有配色的意象（凝聚）返回 null，保持单色。开场的雾、照片不调用这里。
export function colorFor(form: SculptureForm, visual: Pick<VisualState, 'motion'>): SculptureColor | null {
  const preset = IMAGE_COLORS[form.image];
  if (!preset?.palette) return null;
  return { palette: preset.palette, vivid: Math.min(1, Math.max(0.25, preset.vivid + (visual.motion - 0.5) * 0.4)) };
}

// 存档里的配色：只接受色卡里有的配色和 0—1 的鲜艳度。
export function validateColor(value: unknown): SculptureColor | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.palette !== 'string' || !PALETTES.some(item => item.id === input.palette)) return null;
  if (typeof input.vivid !== 'number' || !Number.isFinite(input.vivid) || input.vivid < 0 || input.vivid > 1) return null;
  return { palette: input.palette as PaletteId, vivid: input.vivid };
}
