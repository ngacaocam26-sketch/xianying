import { validateVisual } from './visual.ts';
import type { VisualState } from './visual';
import type { PhotoAttachment } from './photoAttachment';
import { validateForm } from './imagery.ts';
import type { SculptureForm } from './imagery.ts';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type ChatStatus = { configured: boolean; provider: string; model: string };
// form 是大模型挑的意象和名字；variant 由前端随机生成，同一意象每次长得略有不同。
export type ChatResult = { visual: VisualState | null; form?: SculptureForm | null; visualWarning?: string };

export async function getChatStatus(signal: AbortSignal): Promise<ChatStatus> {
  const response = await fetch('/api/status', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('文字对话服务尚未启动，请重启项目。');
  const status = await response.json();
  if (typeof status.configured !== 'boolean') throw new Error('文字对话服务尚未启动，请重启项目。');
  return status;
}

export async function streamChat(
  messages: ChatMessage[],
  signal: AbortSignal,
  onText: (text: string) => void,
  context: { image?: PhotoAttachment; visual?: VisualState; form?: SculptureForm | null } = {},
): Promise<ChatResult> {
  const response = await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, ...context }), signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || '文字对话暂时不可用，请稍后重试。');
  }
  if (!response.body) throw new Error('没有收到回复，请重试。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  let text = '';
  let result: ChatResult = { visual: null };
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'delta' && typeof event.text === 'string') {
      text += event.text;
      onText(text);
    } else if (event.type === 'done') {
      completed = true;
      const visual = validateVisual(event.visual);
      const form = validateForm(event.form);
      result = { visual, form: form ? { ...form, variant: Math.random() } : null, visualWarning: visual ? undefined :
        typeof event.visualWarning === 'string' ? event.visualWarning : '回复已收到，画面暂时保留。' };
    }
    else if (event.type === 'error') throw new Error(event.message || '连接中断了，可以重试。');
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (done) { consume(buffer); break; }
    }
    if (!completed || !text.trim()) throw new Error('回复没有完整收到，可以重试。');
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
