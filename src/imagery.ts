// 默认雕塑的意象库：大模型读完表达后从这里挑一个意象，并为这一刻的形态起名。
// 前五个是最早的五种形态，id 与顺序不能改：没有记录意象的旧作品按参数规则恢复成其中之一。
export const IMAGERY = [
  { id: 'gather', label: '凝聚', hint: '几块软体挤成一团，沉默、压着、积攒、自我保护' },
  { id: 'braid', label: '缠结', hint: '两股粗管互相缠绕，纠结、拉扯、矛盾、放不下' },
  { id: 'drape', label: '垂落', hint: '几层薄片自上而下悬垂，低落、疲惫、失落、被压垮' },
  { id: 'unfold', label: '舒展', hint: '几条宽带扭转着向外打开，释然、自由、松一口气、向往' },
  { id: 'apart', label: '离散', hint: '几团小块彼此隔开，孤独、疏离、破碎、关系断开' },
  { id: 'flame', label: '火焰', hint: '火苗往上窜、不停跳动，愤怒、激动、热烈、燃起斗志' },
  { id: 'rain', label: '雨', hint: '一层云下不停落雨，悲伤、想哭、委屈、怀念' },
  { id: 'wave', label: '海浪', hint: '一片起伏的浪面，心绪翻涌、起伏不定、思念涌上来' },
  { id: 'vortex', label: '漩涡', hint: '一个旋转的漏斗，焦虑、混乱、停不下来的念头、被卷进去' },
  { id: 'cloud', label: '云雾', hint: '几团柔软的雾慢慢飘，迷茫、恍惚、说不清、空落' },
  { id: 'thorns', label: '尖刺', hint: '一团核心向外长出尖刺，刺痛、防备、被冒犯、烦躁' },
  { id: 'bloom', label: '花开', hint: '花瓣从中心向外张开，喜悦、被理解、温柔、希望' },
] as const;

export type ImageId = typeof IMAGERY[number]['id'];
export const IMAGE_IDS = IMAGERY.map(item => item.id) as ImageId[];
// variant 是 0—1 的随机数：同一种意象每次长得略有不同，存档时一起保存，恢复时一模一样。
export type SculptureForm = { image: ImageId; name: string; variant: number };

// 还没有表达时暗房里是一团雾；第一次表达后才显影成模型挑的意象。
export const OPENING_FORM: SculptureForm = { image: 'cloud', name: '一团雾', variant: 0 };

export function imageIndex(id: ImageId): number { return IMAGE_IDS.indexOf(id); }
export function imageLabel(id: ImageId): string { return IMAGERY[imageIndex(id)].label; }

// 模型的名字去掉首尾引号与标点，太长或为空时用意象本身的名字。
export function cleanFormName(value: unknown, image: ImageId): string {
  const text = typeof value === 'string'
    ? value.replace(/^[\s"'“”‘’《》「」『』]+|[\s"'“”‘’《》「」『』。．.!！,，]+$/g, '').replace(/\s+/g, '') : '';
  return text && text.length <= 10 ? text : imageLabel(image);
}

export function validateForm(value: unknown): SculptureForm | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.image !== 'string' || !IMAGE_IDS.includes(input.image as ImageId)) return null;
  const image = input.image as ImageId;
  const variant = typeof input.variant === 'number' && Number.isFinite(input.variant)
    ? Math.min(1, Math.max(0, input.variant)) : 0;
  return { image, name: cleanFormName(input.name, image), variant };
}
