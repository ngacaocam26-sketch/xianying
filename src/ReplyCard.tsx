import { Children, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type ReplyLine = { id: string; role: 'user' | 'assistant'; text: string; label?: string };

// 浮在作品上的毛玻璃卡片：平时只显示最近一轮，需要时再展开完整记录。
export default function ReplyCard({ lines, intro, children }: { lines: ReplyLine[]; intro?: ReactNode; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  // 有新的一句时重新出现。
  useEffect(() => { setHidden(false); }, [lines.length]);
  useEffect(() => {
    const body = bodyRef.current;
    if (body && (expanded || body.scrollHeight - body.scrollTop - body.clientHeight < 80)) body.scrollTop = body.scrollHeight;
  }, [lines, expanded]);

  const lastUserIndex = lines.map(line => line.role).lastIndexOf('user');
  const recent = lastUserIndex < 0 ? lines.slice(-1) : lines.slice(lastUserIndex);
  const user = recent.find(line => line.role === 'user');
  const replies = recent.filter(line => line.role === 'assistant');
  // 条件渲染留下的 false/null 不算内容，没有对话时整张卡片不出现。
  if (!lines.length && !intro && !Children.toArray(children).length) return null;
  if (hidden) {
    return <button type="button" className="reply-restore" onClick={() => setHidden(false)}>显示对话</button>;
  }
  return (
    <div className="reply-card" ref={bodyRef} role="log" aria-label="对话" aria-live="off">
      {!lines.length && intro && <p className="reply-intro">{intro}</p>}
      {expanded ? lines.map(line => (
        <p key={line.id} className={`reply-line is-${line.role}`}>
          <span>{line.role === 'user' ? '你' : '显影'}{line.label ? ` · ${line.label}` : ''}</span>{line.text}
        </p>
      )) : <>
        {user && <p className="reply-user">你 · {user.text}</p>}
        {replies.map(line => <p key={line.id} className="reply-text">{line.text}{line.label && <span className="reply-label"> · {line.label}</span>}</p>)}
      </>}
      {children}
      {lines.length > 0 && <div className="reply-foot">
        {lines.length > 2 && <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? '只看最近' : '回看'}</button>}
        <button type="button" onClick={() => { setExpanded(false); setHidden(true); }}>收起</button>
      </div>}
    </div>
  );
}
