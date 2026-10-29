import { VISUAL_KEYS } from './visual.ts';
import type { VisualState } from './visual.ts';

// 显影时短暂浮出的造型用词：描述作品长成什么样，不是对用户情绪的判断或评分。
// 每项参数两端各一个词；「舒展」「离散」已是形态名，参数用词避开它们。
const WORDS: Record<typeof VISUAL_KEYS[number], [low: string, high: string]> = {
  dispersion: ['收拢', '疏散'],
  motion: ['静缓', '流动'],
  warmth: ['偏冷', '偏暖'],
  openness: ['内收', '敞开'],
  tension: ['松弛', '紧绷'],
  coherence: ['碎裂', '连贯'],
  weight: ['轻盈', '下沉'],
  luminosity: ['黯淡', '明亮'],
};

// 取偏离中性最明显的几项；都接近中性时如实说明。
export function describeVisual(visual: VisualState, limit = 3, threshold = 0.1): string[] {
  const words = VISUAL_KEYS
    .map(key => ({ key, offset: visual[key] - 0.5 }))
    .filter(item => Math.abs(item.offset) >= threshold)
    .sort((a, b) => Math.abs(b.offset) - Math.abs(a.offset))
    .slice(0, limit)
    .map(item => WORDS[item.key][item.offset > 0 ? 1 : 0]);
  return words.length ? words : ['接近中性'];
}
