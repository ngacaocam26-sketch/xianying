export type TranscriptLine = { role: 'user' | 'assistant'; text: string };
export type MomentName = { title: string; summary: string };

// 凝结时请 AI 为这次对话起名并写一句总结；只发送最近 12 句文字或语音转写，不发送照片。
export async function nameMoment(lines: TranscriptLine[], signal: AbortSignal): Promise<MomentName> {
  const response = await fetch('/api/title', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ lines: lines.slice(-12).map(line => ({
      role: line.role, text: line.text.trim().slice(0, line.role === 'user' ? 2000 : 4000),
    })) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.title !== 'string' || typeof result?.summary !== 'string') {
    throw new Error(result?.message || '这次没能命名，可以自己写一个名字。');
  }
  return { title: result.title.slice(0, 40), summary: result.summary.slice(0, 120) };
}
