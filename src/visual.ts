export type LegacyVisual = { dispersion: number; motion: number; warmth: number };
export type VisualState = LegacyVisual & { openness: number; tension: number; coherence: number; weight: number; luminosity: number };
export const VISUAL_KEYS = ['dispersion', 'motion', 'warmth', 'openness', 'tension', 'coherence', 'weight', 'luminosity'] as const;

export const DEFAULT_VISUAL: VisualState = Object.freeze({ dispersion: 0.5, motion: 0.5, warmth: 0.5,
  openness: 0.5, tension: 0.5, coherence: 0.5, weight: 0.5, luminosity: 0.5 });

// These values describe the artwork, never a psychological measurement.
export function validateVisual(value: unknown, allowLegacy = true): VisualState | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const result = { ...DEFAULT_VISUAL };
  const legacy = allowLegacy && VISUAL_KEYS.slice(3).every(key => candidate[key] === undefined);
  for (const key of VISUAL_KEYS) {
    if (legacy && VISUAL_KEYS.indexOf(key) >= 3) continue;
    const number = candidate[key];
    if (typeof number !== 'number' || !Number.isFinite(number)) return null;
    result[key] = Math.max(0, Math.min(1, number));
  }
  return result;
}

export function resolveVisual(value: LegacyVisual | VisualState): VisualState { return { ...DEFAULT_VISUAL, ...value }; }

export function smoothVisual(current: VisualState, target: VisualState, delta: number): boolean {
  const blend = 1 - Math.exp(-Math.max(0, Math.min(delta, 0.05)) * 2.5);
  let changing = false;
  for (const key of VISUAL_KEYS) {
    current[key] += (target[key] - current[key]) * blend;
    if (Math.abs(target[key] - current[key]) < 0.001) current[key] = target[key];
    else changing = true;
  }
  return changing;
}
