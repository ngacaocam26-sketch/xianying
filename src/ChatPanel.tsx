import { useEffect, useRef, useState } from 'react';
import { getChatStatus, streamChat } from './chat';
import type { ChatMessage, ChatStatus } from './chat';
import type { PhotoContext } from './photoAttachment';
import type { VisualState } from './visual';
import ReplyCard from './ReplyCard';
import type { ReplyLine } from './ReplyCard';
import { Icon } from './icons';

type Turn = {
  id: number; input: string; output: string;
  state: 'pending' | 'done' | 'error' | 'stopped'; error?: string; visualNote?: string;
};
export type ChatLink = 'checking' | 'ready' | 'offline';

export default function ChatPanel({ open, photo, photoBusy, visual, onVisual, onChoosePhoto, onVoice, onCondense, onActivity, onStatus }: {
  open: boolean; photo: PhotoContext | null; photoBusy: boolean;
  visual: VisualState; onVisual: (visual: VisualState) => void; onChoosePhoto: () => void; onVoice: () => void;
  onCondense: () => void; onActivity: (level: number) => void; onStatus: (link: ChatLink, busy: boolean) => void;
}) {
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [checking, setChecking] = useState(open);
  const [statusVersion, setStatusVersion] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const serialRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const statusCallback = useRef(onStatus); statusCallback.current = onStatus;
  const busy = turns.some((turn) => turn.state === 'pending');
  const link: ChatLink = checking ? 'checking' : status?.configured && !statusError ? 'ready' : 'offline';

  useEffect(() => { statusCallback.current(link, busy); }, [link, busy]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setChecking(true);
    setStatusError('');
    getChatStatus(controller.signal).then(setStatus).catch(() => {
      if (!controller.signal.aborted) {
        setStatus(null);
        setStatusError('文字对话服务尚未启动，请重启项目。');
      }
    }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [open, statusVersion]);

  useEffect(() => () => {
    serialRef.current++;
    requestRef.current?.abort();
  }, []);

  // Navigation can also close the panel; stop any request before it becomes hidden.
  useEffect(() => {
    if (open) return;
    serialRef.current++;
    requestRef.current?.abort();
    requestRef.current = null;
    setTurns((previous) => previous.map((turn) =>
      turn.state === 'pending' ? { ...turn, state: 'stopped' } : turn));
  }, [open]);

  // 输入框随内容长高，最多四行左右。
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }, [draft]);

  const stop = () => {
    serialRef.current++;
    requestRef.current?.abort();
    requestRef.current = null;
    setTurns((previous) => previous.map((turn) =>
      turn.state === 'pending' ? { ...turn, state: 'stopped' } : turn));
  };

  const send = async (retry?: Turn) => {
    const input = (retry?.input ?? draft).trim() || (photo ? '看看这张照片，和我聊聊。' : '');
    if (!input || input.length > 2000 || requestRef.current || !status?.configured || checking) return;
    const id = ++serialRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    const previous = retry ? turns.filter((turn) => turn.id !== retry.id) : turns;
    // Only complete turns are sent as context. Failed fragments never become AI history.
    const history: ChatMessage[] = previous.filter((turn) => turn.state === 'done').slice(-5)
      .flatMap((turn) => [
        { role: 'user' as const, content: turn.input },
        { role: 'assistant' as const, content: turn.output },
      ]);
    const current: Turn = { id, input, output: '', state: 'pending' };
    setTurns([...previous, current]);
    if (!retry) setDraft('');
    const update = (change: Partial<Turn>) => {
      if (serialRef.current === id) {
        setTurns((items) => items.map((turn) => turn.id === id ? { ...turn, ...change } : turn));
      }
    };
    try {
      const result = await streamChat([...history, { role: 'user', content: input }], controller.signal,
        (output) => update({ output }), { image: photo?.image, visual });
      if (serialRef.current === id) {
        if (result.visual) onVisual(result.visual);
        update({ state: 'done', visualNote: result.visual ? '画面已随这次表达变化' : result.visualWarning });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        update({ state: 'error', error: error instanceof Error ? error.message : '连接中断了，可以重试。' });
      }
    } finally {
      if (serialRef.current === id) requestRef.current = null;
    }
  };

  const lines: ReplyLine[] = turns.flatMap((turn) => [
    { id: `u${turn.id}`, role: 'user' as const, text: turn.input },
    ...(turn.output ? [{ id: `a${turn.id}`, role: 'assistant' as const, text: turn.output,
      label: turn.state === 'stopped' ? '未完成' : undefined }] : []),
  ]);
  const last = turns[turns.length - 1];
  const canSend = (Boolean(draft.trim()) || Boolean(photo)) && link === 'ready';

  return (
    <section className="expression" hidden={!open} aria-label="文字表达"
      onKeyDown={(event) => { if (event.key === 'Escape' && busy) { event.stopPropagation(); stop(); } }}>
      <ReplyCard lines={lines} intro={photo ? <>照片已经在这里了。<br />说一句此刻的想法，或直接发送。</> : undefined}>
        {last?.state === 'pending' && !last.output && <p className="reply-pending" role="status"><span /><span /><span /></p>}
        {last?.state === 'error' ? <p className="reply-error" role="alert">{last.error}</p> : null}
        {last?.state === 'stopped' && !last.output && <p className="reply-note">已停止，这次没有回复。</p>}
        {last?.state === 'done' && last.visualNote && <p className="reply-note" role="status">{last.visualNote}</p>}
        {last && (last.state === 'stopped' || last.state === 'error') &&
          <button type="button" className="reply-action" disabled={busy || link !== 'ready'} onClick={() => void send(last)}>重试这句话</button>}
        {link === 'offline' && <p className="reply-error" role="alert">
          {statusError || '文字对话尚未连接。配置本机 API Key 并重启后可以开始。'}
          <button type="button" className="reply-action" onClick={() => setStatusVersion((value) => value + 1)}>重新检查</button>
        </p>}
      </ReplyCard>

      <form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <button type="button" className="composer-icon" aria-busy={photoBusy} disabled={photoBusy}
          aria-label={photo ? '更换照片' : '投一张照片'} title={photo ? '更换照片' : '投一张照片'} onClick={onChoosePhoto}>
          {photo ? <img src={photo.image.dataUrl} alt="" /> : <Icon name="photo" />}
        </button>
        <label className="sr-only" htmlFor="chat-input">写下此刻想说的话</label>
        <textarea ref={inputRef} id="chat-input" rows={1} maxLength={2000} value={draft}
          placeholder={photo ? '说说这张照片…' : '此刻，想说些什么…'}
          onChange={(event) => { setDraft(event.target.value); onActivity(0.45); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault(); void send();
            }
          }} />
        {busy ? <button type="button" className="composer-icon is-stop" aria-label="停止回复" title="停止回复" onClick={stop}><Icon name="stop" /></button>
          : canSend && <button type="submit" className="composer-icon is-send" aria-label={!draft.trim() && photo ? '发送照片' : '发送'}><Icon name="send" /></button>}
        <button type="button" className="composer-icon" aria-label="改用语音" title="改用语音" onClick={() => { stop(); onVoice(); }}><Icon name="mic" /></button>
      </form>

      <div className="dock-meta">
        <button type="button" className="meta-pill" onClick={() => { stop(); onCondense(); }}>凝结此刻<span aria-hidden="true">›</span></button>
      </div>
      <p className="dock-note">发送的文字{photo ? '与照片缩略图' : ''}交给阿里云百炼处理 · 详见 INFO</p>
    </section>
  );
}
