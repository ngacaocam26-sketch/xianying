import { useEffect, useRef, useState } from 'react';
import captureUrl from './voice/capture.worklet.ts?worker&url';
import { VoiceSession } from './voice/session';
import type { VoiceEvent, VoiceState } from './voice/session';
import { VoiceSculptor } from './voice/sculptor';
import type { VisualState } from './visual';
import type { SculptureForm } from './imagery';
import ReplyCard from './ReplyCard';
import { Icon } from './icons';
import type { TranscriptLine } from './title';

type Turn = { id: string; role: 'user' | 'assistant'; text: string; interrupted?: boolean };
const statusText: Record<VoiceState, string> = {
  requesting: '正在准备麦克风…', connecting: '正在接通…', listening: '在听，你可以直接说话',
  'user-speaking': '听到了，请继续说', replying: '正在回应，开口就能打断',
};

export type VoiceSessionFactory = (worklet: string, onEvent: (event: VoiceEvent) => void) => VoiceSession;
export default function VoicePanel({ open, onClose, onCondense, visual, form = null, onVisual, onActivity, onStatus, onTranscript, sessionFactory }: {
  open: boolean; onClose: () => void; onCondense: () => void; visual: VisualState; form?: SculptureForm | null;
  onVisual: (visual: VisualState, form: SculptureForm | null) => void; onActivity: (level: number) => void;
  onStatus: (state: VoiceState | null) => void; onTranscript: (lines: TranscriptLine[]) => void; sessionFactory?: VoiceSessionFactory;
}) {
  const [state, setState] = useState<VoiceState | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const session = useRef<VoiceSession | null>(null);
  const wave = useRef<HTMLSpanElement>(null);
  const visualRef = useRef(visual); visualRef.current = visual;
  const formRef = useRef(form); formRef.current = form;
  const callbacks = useRef({ onVisual, onActivity, onStatus }); callbacks.current = { onVisual, onActivity, onStatus };
  const sculptor = useRef<VoiceSculptor | null>(null);
  const [artMessage, setArtMessage] = useState('');
  const [retryArt, setRetryArt] = useState(false);

  useEffect(() => { callbacks.current.onStatus(state); }, [state]);
  const transcriptCallback = useRef(onTranscript); transcriptCallback.current = onTranscript;
  useEffect(() => {
    transcriptCallback.current(turns.filter(turn => turn.text.trim() && turn.text !== '…').map(turn => ({ role: turn.role, text: turn.text })));
  }, [turns]);

  const stop = () => { sculptor.current?.stop(); sculptor.current = null; session.current?.stop(); session.current = null; setState(null); setArtMessage(''); setRetryArt(false); };
  useEffect(() => {
    if (!open) { stop(); return; }
    // 点麦克风即开始，不再多一步「开始说话」。
    start();
    const leave = () => { stop(); setMessage('语音已结束。'); };
    const hide = () => { if (document.hidden) leave(); };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', hide);
    return () => { stop(); window.removeEventListener('pagehide', leave); document.removeEventListener('visibilitychange', hide); };
  }, [open]);

  const start = () => {
    stop(); setMessage(''); setError(''); setTurns([]); setState('requesting');
    sculptor.current = new VoiceSculptor(() => visualRef.current, (value, chosen) => callbacks.current.onVisual(value, chosen),
      (text, retry) => { setArtMessage(text); setRetryArt(retry); });
    sculptor.current.getForm = () => formRef.current;
    const receive = (event: VoiceEvent) => {
      if (session.current !== next) return;
      if (event.type === 'level') {
        callbacks.current.onActivity(event.level);
        // 声波条直接改样式变量，不为每个音量包重新渲染 React。
        wave.current?.style.setProperty('--level', String(Math.min(1, event.level)));
      } else if (event.type === 'state') setState(event.state);
      else if (event.type === 'ended') {
        session.current = null; setState(null); setMessage(event.message || ''); setError(event.error || '');
        sculptor.current?.stop(); sculptor.current = null; setArtMessage(''); setRetryArt(false);
      } else if (event.type === 'interrupted') {
        sculptor.current?.cancel(); setArtMessage(''); setRetryArt(false);
        setTurns(previous => previous.map((turn, i) => turn.role === 'assistant' && i === previous.length - 1 ? { ...turn, interrupted: true } : turn));
      } else if (event.type === 'user_started' || event.type === 'user' || event.type === 'assistant') {
        if (event.type === 'user_started') sculptor.current?.begin(event.itemId);
        else if (event.type === 'user') void sculptor.current?.complete(event.itemId, event.text);
        const role: Turn['role'] = event.type === 'assistant' ? 'assistant' : 'user';
        const id = `${role}:${event.type === 'assistant' ? event.responseId : event.itemId}`;
        const text = event.type === 'user_started' ? '…' : event.text;
        setTurns(previous => {
          const found = previous.some(turn => turn.id === id);
          return (found ? previous.map(turn => turn.id === id ? { ...turn, text } : turn) : [...previous, { id, role, text }]).slice(-20);
        });
      }
    };
    const next = sessionFactory?.(captureUrl, receive) ?? new VoiceSession(captureUrl, receive);
    session.current = next;
    void next.start();
  };
  const interrupt = () => { sculptor.current?.cancel(); setArtMessage(''); setRetryArt(false); session.current?.interrupt(); };

  return (
    <section className="expression" hidden={!open} aria-label="语音表达">
      <ReplyCard lines={turns.map(turn => ({ ...turn, label: turn.interrupted ? '已打断' : undefined }))}>
        {error ? <p className="reply-error" role="alert">{error}</p> : null}
        {artMessage ? <p className="reply-note" role="status">{artMessage}
          {retryArt && <button type="button" className="reply-action" onClick={() => sculptor.current?.retry()}>重试显影</button>}</p> : null}
      </ReplyCard>

      <div className={`composer voice-bar${state === 'replying' ? ' is-replying' : ''}${state ? '' : ' is-idle'}`} role="group" aria-label="语音">
        <span className="wave" ref={wave} aria-hidden="true"><span /><span /><span /><span /><span /></span>
        <p className="voice-status" role="status" aria-live="polite">{state ? statusText[state] : message || '语音已结束，麦克风已关闭。'}</p>
        {state ? <button type="button" className="voice-text-button" disabled={state === 'requesting' || state === 'connecting'} onClick={interrupt}>打断</button>
          : <button type="button" className="voice-text-button" onClick={start}>重新开始</button>}
        <button type="button" className="composer-icon is-end" aria-label={state ? '结束语音，回到文字' : '回到文字'} title="回到文字"
          onClick={() => { stop(); onClose(); }}><Icon name="close" /></button>
      </div>

      <div className="dock-meta">
        <button type="button" className="meta-pill" onClick={() => { stop(); onCondense(); }}>凝结此刻<span aria-hidden="true">›</span></button>
      </div>
    </section>
  );
}
