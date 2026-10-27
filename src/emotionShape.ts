import type { VisualState } from './visual.ts';

// Continuous deformations of the selected sculpture. Neutral values reproduce its original rest shape.
export function writeEmotionRest(base: Float32Array, phases: Float32Array, visual: VisualState,
  elapsed: number, out: Float32Array) {
  const open = (visual.openness - 0.5) * 2, tension = (visual.tension - 0.5) * 2;
  const weight = (visual.weight - 0.5) * 2;
  const fragment = Math.max(0, 1 - visual.coherence * 2), connected = Math.max(0, visual.coherence * 2 - 1);
  const breath = 1 + Math.sin(elapsed * 0.43) * 0.025;
  for (let i = 0; i < phases.length; i++) {
    const offset = i * 3, bx = base[offset], by = base[offset + 1], bz = base[offset + 2];
    let x = bx * (1 + open * 0.33) * (1 - tension * 0.12);
    let y = by * (1 + weight * 0.14) - weight * 0.5;
    let z = bz * (1 - open * 0.38) * (1 - connected * 0.18);
    // Shared angular sectors keep fragments as small bodies rather than independent random dots.
    if (fragment > 0) {
      const sector = Math.floor((Math.atan2(by, bx) + Math.PI) / (Math.PI / 3));
      const angle = (sector + 0.5) * Math.PI / 3 - Math.PI;
      x += Math.cos(angle) * fragment * 0.8;
      y += Math.sin(angle) * fragment * 0.65;
      z += Math.sin(sector * 2.4) * fragment * 0.35;
    }
    z += tension * 0.24 * Math.sin(by * 3.2 + bx * 1.7);
    x += tension * 0.1 * Math.sin(by * 5.1);
    const flowX = Math.sin(by * 1.6 + bz * 1.1 + elapsed * 0.27);
    const flowY = Math.sin(bx * 1.2 - bz * 1.3 - elapsed * 0.22);
    const flowZ = Math.sin(bx * 1.1 + by * 0.7 + elapsed * 0.19);
    out[offset] = x * breath + flowX * 0.07;
    out[offset + 1] = y * breath + flowY * 0.07;
    out[offset + 2] = z * (1 + Math.sin(elapsed * 0.3) * 0.018) + flowZ * 0.1;
  }
}

export type ActivitySignal = { level: number; at: number };
export function activityLevel(signal: ActivitySignal, now: number): number {
  return Math.max(0, Math.min(1, signal.level)) * Math.exp(-Math.max(0, now - signal.at) / 350);
}
