import { useEffect, useRef, useState } from 'react';
import ParticleScene from './ParticleScene';
import ReliefView from './ReliefView';
import type { ParticleSceneHandle } from './ParticleScene';
import ChatPanel from './ChatPanel';
import type { ChatLink } from './ChatPanel';
import VoicePanel from './VoicePanel';
import type { VoiceSessionFactory } from './VoicePanel';
import type { VoiceState } from './voice/session';
import { Icon } from './icons';
import { preparePhotoAttachment } from './photoAttachment';
import type { PhotoContext } from './photoAttachment';
import { DEFAULT_VISUAL, resolveVisual } from './visual';
import type { VisualState } from './visual';
import type { PhotoParticleData } from './photoToParticles';
import type { ChangeEvent } from 'react';
import { makeArtwork } from './artwork';
import type { Artwork, ReliefPhoto, SceneSnapshot } from './artwork';
import { localGallery } from './gallery';
import type { GalleryRepository } from './gallery';
import GalleryPanel from './GalleryPanel';
import { nameMoment } from './title';
import type { TranscriptLine } from './title';
import { describeVisual } from './reveal';
import { pickForm, SCULPTURE_FORMS } from './relief/sculpture';
import { imageLabel } from './imagery';
import type { SculptureForm } from './imagery';

type ChatState = { link: ChatLink; busy: boolean };

const voiceLabels: Record<VoiceState, string> = {
  requesting: '准备麦克风', connecting: '正在接通', listening: '在听', 'user-speaking': '听到了', replying: '正在回应',
};

function stamp(time: number) {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function App({ gallery = localGallery, voiceSessionFactory }: { gallery?: GalleryRepository; voiceSessionFactory?: VoiceSessionFactory }) {
  const [notice, setNotice] = useState<{ text: string } | null>(null);
  // 新照片用浮雕画法、默认是新雕塑；photo 与 nebula 快照只用于打开回廊里旧版本（v1/v2）的作品。
  const [relief, setRelief] = useState<ReliefPhoto | null>(null);
  const [photo, setPhoto] = useState<PhotoParticleData | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [photoContext, setPhotoContext] = useState<PhotoContext | null>(null);
  const [visual, setVisual] = useState<VisualState>({ ...DEFAULT_VISUAL });
  // 显影时刻：AI 给出新参数时画面散开再凝聚，并短暂浮出转译后的造型用词。
  const [developId, setDevelopId] = useState(0);
  const [caption, setCaption] = useState<{ id: number; visual: VisualState; name: string } | null>(null);
  // 大模型为默认雕塑选的意象和名字；null 时按参数规则选形态（默认状态、旧作品）。
  const [form, setForm] = useState<SculptureForm | null>(null);
  const [snapshot, setSnapshot] = useState<SceneSnapshot | null>(null);
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [naming, setNaming] = useState(false);
  // 两个面板各自的完整对话；凝结时合起来交给 AI 命名。
  const transcriptRef = useRef<{ text: TranscriptLine[]; voice: TranscriptLine[] }>({ text: [], voice: [] });
  const namingRef = useRef<AbortController | null>(null);
  const titleEdited = useRef(false);
  const stopNaming = () => { namingRef.current?.abort(); namingRef.current = null; setNaming(false); };
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [dispersing, setDispersing] = useState(false);
  const [veiled, setVeiled] = useState(false);
  const [expressionId, setExpressionId] = useState(0);
  const [chatState, setChatState] = useState<ChatState>({ link: 'checking', busy: false });
  const [voiceState, setVoiceState] = useState<VoiceState | null>(null);
  const sceneRef = useRef<ParticleSceneHandle>(null);
  const activityRef = useRef({ level: 0, at: 0 });
  const indicateActivity = (level: number) => { activityRef.current = { level, at: performance.now() }; };
  const savePending = useRef(false);
  const generation = useRef(0);
  const disperseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const veilTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoRequestRef = useRef(0);
  const infoRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const expressing = !snapshot && !galleryOpen;

  // React 只管理入口和界面反馈；逐帧粒子数据由 ParticleScene 自己维护。
  useEffect(() => {
    if (!notice || photoLoading) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice, photoLoading]);

  // 旧请求完成得再晚，也不能覆盖新选择或“返回暗房”的操作。
  useEffect(() => () => {
    namingRef.current?.abort();
    photoRequestRef.current++; generation.current++;
    if (disperseTimer.current) clearTimeout(disperseTimer.current);
    if (veilTimer.current) clearTimeout(veilTimer.current);
  }, []);
  useEffect(() => {
    if (!caption) return;
    const timer = window.setTimeout(() => setCaption(null), 6400);
    return () => window.clearTimeout(timer);
  }, [caption]);
  useEffect(() => {
    if (artwork && !galleryOpen && !veiled) document.getElementById('artwork-title')?.focus({ preventScroll: true });
  }, [artwork?.id, galleryOpen, veiled]);

  // 只有 AI 回复带来的参数触发显影；打开回廊、换照片、返回暗房都直接到位。
  // 模型这次没给出合格的意象时保留当前意象，只更新参数。
  const revealVisual = (next: VisualState, chosen: SculptureForm | null) => {
    const shown = chosen ?? form;
    setVisual(next);
    if (chosen) setForm(chosen);
    setDevelopId(id => id + 1);
    const name = shown?.name ?? imageLabel(SCULPTURE_FORMS[pickForm(next)]);
    setCaption(previous => ({ id: (previous?.id ?? 0) + 1, visual: next, name }));
  };

  const selectPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const request = ++photoRequestRef.current;
    setPhotoLoading(true);
    setNotice({ text: '正在让照片显影…' });
    try {
      // 同一张缩小重编码的照片既用于画面，也是发送给 AI 的缩略图；原文件留在本机。
      const image = await preparePhotoAttachment(file);
      if (request !== photoRequestRef.current) return;
      setRelief({ image: image.dataUrl, width: image.width, height: image.height });
      setPhoto(null);
      setPhotoContext({ id: request, image });
      setVisual({ ...DEFAULT_VISUAL });
      setVoiceOpen(false);
      setNotice({ text: '照片已在本地显影。发送后，AI 才会看到缩略图。' });
    } catch (error) {
      if (request !== photoRequestRef.current) return;
      setNotice({ text: error instanceof Error ? error.message : '照片读取失败，请重试。' });
    } finally {
      if (request === photoRequestRef.current) setPhotoLoading(false);
    }
  };

  const returnToDarkroom = () => {
    if (savePending.current) return;
    generation.current++;
    stopNaming();
    if (disperseTimer.current) clearTimeout(disperseTimer.current);
    if (veilTimer.current) clearTimeout(veilTimer.current);
    setVeiled(false); setDispersing(false); setGalleryOpen(false); setSnapshot(null); setArtwork(null); setSaved(false); setSaveError('');
    setCaption(null); setForm(null);
    setExpressionId(id => id + 1);
    photoRequestRef.current++;
    setPhotoLoading(false);
    setRelief(null);
    setPhoto(null);
    setPhotoContext(null);
    setVisual({ ...DEFAULT_VISUAL });
    setVoiceOpen(false);
    infoRef.current?.close();
    setNotice(null);
    stageRef.current?.querySelector('canvas')?.focus({ preventScroll: true });
  };

  const condense = () => {
    if (photoLoading || snapshot || dispersing || galleryOpen) return;
    try {
      const captured = sceneRef.current?.capture();
      if (!captured) throw new Error('画面还没准备好，请稍等再凝结。');
      const work = makeArtwork(captured.scene, captured.thumbnail);
      generation.current++; photoRequestRef.current++;
      setVoiceOpen(false); setNotice(null); setCaption(null);
      setArtwork(work); setSnapshot(work.scene); setVisual(resolveVisual(work.scene.visual)); setSaved(false); setSaveError('');
      titleEdited.current = false;
      requestName(work.id);
      // 先让画面短暂失焦再清晰，像一次曝光定格。
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setVeiled(true);
        veilTimer.current = setTimeout(() => setVeiled(false), 1100);
      }
    } catch (cause) { setNotice({ text: cause instanceof Error ? cause.message : '暂时无法凝结，请重试。' }); }
  };
  // 有对话才命名；12 秒没有结果就保留默认名字，可以自己改。用户已经改过名字时只补总结。
  const requestName = (id: string) => {
    stopNaming();
    const lines = [...transcriptRef.current.text, ...transcriptRef.current.voice];
    if (!lines.some(line => line.role === 'user')) return;
    const controller = new AbortController();
    namingRef.current = controller;
    setNaming(true);
    const timer = setTimeout(() => controller.abort(), 12000);
    nameMoment(lines, controller.signal).then(({ title, summary }) => {
      if (namingRef.current !== controller) return;
      setArtwork(current => current && current.id === id
        ? { ...current, title: titleEdited.current ? current.title : title, summary } : current);
    }).catch(() => {}).finally(() => {
      clearTimeout(timer);
      if (namingRef.current === controller) { namingRef.current = null; setNaming(false); }
    });
  };
  const saveArtwork = async () => {
    if (!artwork || savePending.current || saved || naming) return;
    savePending.current = true; setSaving(true); setSaveError('');
    const id = generation.current;
    try {
      const result = await gallery.save({ ...artwork, title: artwork.title.trim() || '此刻的显影' });
      if (id === generation.current) { setArtwork(result); setSaved(true); }
    } catch (cause) { if (id === generation.current) setSaveError(cause instanceof Error ? cause.message : '保存失败，当前作品仍在，请重试。'); }
    finally { savePending.current = false; if (id === generation.current) setSaving(false); }
  };
  const disperse = () => {
    if (dispersing || savePending.current) return;
    stopNaming();
    setVoiceOpen(false); setDispersing(true);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    disperseTimer.current = setTimeout(() => {
      returnToDarkroom(); setNotice({ text: '这一刻已散去。回廊里的记录保持原样。' });
    }, reduce ? 0 : 600);
  };
  const continueExpression = () => {
    if (savePending.current) return;
    generation.current++; stopNaming(); setSnapshot(null); setArtwork(null); setSaved(false); setSaveError('');
    setNotice({ text: photo && !photoContext ? '可以继续创作。如需看图交流，请重新投一张照片。' : '回到表达，慢慢来。' });
  };
  const openGallery = () => {
    if (savePending.current || dispersing) return;
    photoRequestRef.current++; setPhotoLoading(false); setVoiceOpen(false);
    setNotice(null); setGalleryOpen(true);
  };
  const openArtwork = (work: Artwork) => {
    generation.current++; photoRequestRef.current++; setExpressionId(id => id + 1); stopNaming();
    setPhotoLoading(false); setPhoto(work.scene.photo); setVisual(resolveVisual(work.scene.visual)); setCaption(null);
    setForm(work.scene.form ?? null);
    const restored = work.scene.relief ?? null;
    setRelief(restored);
    // 浮雕作品保存的照片就是当初的缩略图，继续表达时可以直接再交给 AI 看。
    setPhotoContext(restored ? { id: photoRequestRef.current, image: { dataUrl: restored.image, width: restored.width, height: restored.height } } : null);
    setSnapshot(work.scene); setArtwork(work); setSaved(true); setSaveError(''); setGalleryOpen(false);
    setVoiceOpen(false); setNotice(null);
  };

  // 顶部状态胶囊：只说现在发生什么，不放说明文字。
  const status = galleryOpen ? { label: '回廊', tone: 'ready' }
    : snapshot ? { label: saved ? '已留在回廊' : '已凝结', tone: 'ready' }
    : photoLoading ? { label: '正在显影照片', tone: 'busy' }
    : voiceOpen ? {
      label: voiceState ? voiceLabels[voiceState] : '语音已结束',
      tone: !voiceState ? 'offline' : voiceState === 'listening' || voiceState === 'user-speaking' ? 'ready' : 'busy',
    }
    : chatState.busy ? { label: '正在回应', tone: 'busy' }
    : chatState.link === 'checking' ? { label: '正在连接', tone: 'busy' }
    : chatState.link === 'offline' ? { label: '对话未连接', tone: 'offline' }
    : { label: '', tone: 'ready' };

  return (
    <div className={`experience${photo || relief ? ' has-photo' : ''}${snapshot ? ' is-condensed' : ''}${dispersing ? ' is-dispersing' : ''}${veiled ? ' is-veiled' : ''}`}>
      <header className="site-header">
        <button type="button" className="wordmark" disabled={saving || dispersing} onClick={returnToDarkroom}>显影 <span lang="en">XIAN YING</span></button>
        <p className="status-pill" role="status" aria-live="polite">
          <span className={`status-dot is-${status.tone}`} aria-hidden="true" />显影{status.label && <span className="status-label"> · {status.label}</span>}
        </p>
        <nav className="site-nav" aria-label="项目导航">
          <button type="button" aria-current={!galleryOpen ? 'page' : undefined} disabled={saving || dispersing} onClick={returnToDarkroom}>THE DARKROOM</button>
          <button type="button" aria-current={galleryOpen ? 'page' : undefined} disabled={saving || dispersing} onClick={openGallery}>GALLERY</button>
          <button type="button" onClick={() => infoRef.current?.showModal()}>INFO</button>
        </nav>
      </header>

      <main className="scene-stage" ref={stageRef} aria-label="显影互动暗房" aria-hidden={galleryOpen}>
        {photo || snapshot?.kind === 'nebula'
          ? <ParticleScene ref={sceneRef} photo={photo} visual={visual} snapshot={snapshot} active={!galleryOpen} activity={activityRef} />
          : <ReliefView ref={sceneRef} photo={relief} visual={visual} snapshot={snapshot} active={!galleryOpen} activity={activityRef} form={form} develop={developId} />}
      </main>
      {caption && expressing && <div key={caption.id} className="reveal-caption" role="status" aria-live="polite">
        {!photo && !relief && <p className="reveal-form">{caption.name}</p>}
        <p className="reveal-words">{describeVisual(caption.visual).join(' · ')}</p>
      </div>}
      {veiled && <div className="condense-veil" aria-hidden="true"><p>正在凝结</p></div>}
      <p className={`entry-notice${notice ? ' is-visible' : ''}`} role="status" aria-live="polite" aria-atomic="true">{notice?.text}</p>

      <input ref={photoInputRef} type="file" hidden
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        aria-label="选择本地照片" onChange={selectPhoto} />
      <div className="dock-area" hidden={!expressing}>
        <ChatPanel key={`${expressionId}:${photoContext?.id ?? 'text'}`} open={expressing && !voiceOpen} photo={photoContext} photoBusy={photoLoading}
          visual={visual} form={form} onVisual={revealVisual} onCondense={condense} onActivity={indicateActivity}
          onChoosePhoto={() => photoInputRef.current?.click()} onVoice={() => { setNotice(null); setVoiceOpen(true); }}
          onStatus={(link, busy) => setChatState(previous => previous.link === link && previous.busy === busy ? previous : { link, busy })}
          onTranscript={lines => { transcriptRef.current.text = lines; }} />
        <VoicePanel key={expressionId} open={expressing && voiceOpen} visual={visual} form={form} onVisual={revealVisual} onActivity={indicateActivity}
          onStatus={setVoiceState} onTranscript={lines => { transcriptRef.current.voice = lines; }} sessionFactory={voiceSessionFactory} onCondense={condense} onClose={() => {
            setVoiceOpen(false);
            requestAnimationFrame(() => document.getElementById('chat-input')?.focus());
          }} />
      </div>

      {galleryOpen && <GalleryPanel repository={gallery} onOpen={openArtwork} canOpen={!artwork || saved}
        onClose={() => { setGalleryOpen(false); }} />}

      {artwork && !galleryOpen && <section className="work-panel" aria-label="凝结的作品" aria-busy={saving}>
        <p className={`work-eyebrow${naming ? ' is-naming' : ''}`} role="status">{saved ? '已留在本地回廊' : naming ? '正在为这一刻命名…' : '此刻，凝结在这里'}</p>
        <label className="sr-only" htmlFor="artwork-title">作品名称</label>
        <input id="artwork-title" maxLength={40} value={artwork.title} readOnly={saved || saving || dispersing}
          onChange={event => { titleEdited.current = true; setArtwork({ ...artwork, title: event.target.value }); }} />
        <p className="work-time">{stamp(artwork.createdAt)}</p>
        {artwork.summary && <p className="work-summary">{artwork.summary}</p>}
        {saveError && <p className="work-error" role="alert">{saveError}</p>}
        <div className="work-actions">
          <button type="button" className="orb is-keep" disabled={saving || saved || dispersing || naming} onClick={() => void saveArtwork()}>
            <span className="orb-face"><Icon name="check" /></span><span className="orb-label">{saving ? '正在保存' : saved ? '已留下' : '留下它'}</span>
          </button>
          <button type="button" className="orb" disabled={saving || dispersing} onClick={continueExpression}>
            <span className="orb-face"><Icon name="again" /></span><span className="orb-label">继续表达</span>
          </button>
          <button type="button" className="orb is-release" disabled={saving || dispersing} onClick={disperse}>
            <span className="orb-face"><Icon name="close" /></span><span className="orb-label">让它散去</span>
          </button>
        </div>
        <p className="work-privacy">仍可以拨动它 · 只存在这个浏览器，不含聊天、录音和原文件</p>
      </section>}

      <dialog className="info-dialog" ref={infoRef} aria-labelledby="info-title" onClick={(event) => { if (event.target === event.currentTarget) infoRef.current?.close(); }}>
        <div className="info-content">
          <form method="dialog">
            <button className="close-info" aria-label="关闭介绍"><Icon name="close" /></button>
          </form>
          <h2 id="info-title">显影 <span lang="en">XIAN YING</span></h2>
          <p>把一次情绪，变成可以触碰的粒子雕塑。</p>
          <p>在底部写一句话、点麦克风直接说，或点相机投一张本地照片。按住鼠标或手指在画面上拖动，可以推开一个小洞，松开后慢慢合上。「凝结此刻」固定当前的形态，可以留在回廊，也可以让它散去。</p>
          <p className="info-availability">文字及最近 5 轮对话、主动发送的照片缩略图交给阿里云百炼；语音及最近几句转写用于语音交流和作品转译，不保存录音，每次最长 5 分钟。画面变化来自 AI 给出的作品参数，不是心理测评；没有照片时，AI 还会从火焰、雨、海浪、漩涡、花开等 12 种意象里为这一刻挑一个并起名；每次画面先散开再凝聚成新的样子，并短暂显示这个名字和造型用词（如「内收 · 偏冷」），描述的是作品，不是对你的判断。两种对话历史暂时独立，作品状态可以延续；刷新即清空对话。凝结时，最近 12 句文字或语音转写会再交给百炼一次，用来起标题和写一句总结；不发送照片，标题可以自己改。</p>
          <p className="info-availability">存档含凝结的形态参数、预览图、标题与一句总结；照片作品另存一张缩小重编码的照片（最长边 768，不含原文件和拍摄信息），用来重新显影。不含聊天和录音，只属于当前浏览器和地址，清除站点数据会丢失。散去不改变回廊记录，移除可以恢复。</p>
        </div>
      </dialog>
    </div>
  );
}
