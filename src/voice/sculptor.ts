import { validateVisual } from '../visual.ts';
import type { VisualState } from '../visual.ts';

export async function translateSpeech(utterances: string[], visual: VisualState, signal: AbortSignal): Promise<VisualState> {
  const response = await fetch('/api/sculpture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ utterances, visual }), signal });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || '这次画面暂时没有显影，仍可以继续说话。');
  const valid = validateVisual(result?.visual, false);
  if (!valid) throw new Error('这次画面暂时保留，可以继续说话或重试显影。');
  return valid;
}

export class VoiceSculptor {
  words: { id: string; text: string }[] = [];
  current = '';
  serial = 0;
  controller: AbortController | null = null;
  getVisual: () => VisualState;
  apply: (visual: VisualState) => void;
  status: (message: string, retry: boolean) => void;
  translate: typeof translateSpeech;
  constructor(getVisual: () => VisualState, apply: (visual: VisualState) => void,
    status: (message: string, retry: boolean) => void, translate = translateSpeech) {
    this.getVisual = getVisual; this.apply = apply; this.status = status; this.translate = translate;
  }
  cancel() { this.serial++; this.controller?.abort(); this.controller = null; }
  begin(id: string) {
    this.cancel(); this.current = id;
    this.words = [...this.words.filter(word => word.id !== id), { id, text: '' }].slice(-5);
    this.status('', false);
  }
  async complete(id: string, text: string) {
    const word = this.words.find(word => word.id === id);
    if (!word) return;
    word.text = text.trim().slice(0, 1600);
    if (id !== this.current || !word.text) return;
    this.cancel(); const serial = this.serial;
    const controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    this.status('画面正在随这段表达显影…', false);
    try {
      const visual = await this.translate(this.words.filter(word => word.text).map(word => word.text), this.getVisual(), controller.signal);
      if (serial !== this.serial || controller.signal.aborted) return;
      this.apply(visual); this.status('这段表达已进入作品。', false);
    } catch (error) {
      if (serial === this.serial) this.status(controller.signal.aborted ? '显影等待较久，画面暂时保留，可以重试。' :
        error instanceof Error ? error.message : '画面暂时保留，可以重试。', true);
    } finally { clearTimeout(timer); if (serial === this.serial) this.controller = null; }
  }
  retry() { const word = this.words.find(word => word.id === this.current); if (word?.text) void this.complete(word.id, word.text); }
  stop() { this.cancel(); this.words = []; this.current = ''; }
}
