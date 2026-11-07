import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Artwork, ArtworkCard } from './artwork';
import type { GalleryRepository } from './gallery';
import { Icon } from './icons';
import { containRect, COVER_ASPECT, createMemoryFragment, fragmentMask, frameAspect } from './gallery/memoryFragment';
import type { MemoryFragment } from './gallery/memoryFragment';
import { cleanNote, clockTime, dayLabel, groupByDay, NOTE_LIMIT } from './diary';
import { composeDaySheet, dayPrintFileName, sheetToBlob } from './print';
import type { DayFrame } from './print';
import PrintSheet from './PrintSheet';

const compact = window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600;
// 回廊（一件件横着翻）和日记（每天一页印样）两种看法，记住上次用的那一种。
type View = 'gallery' | 'diary';
const VIEW_KEY = 'xianying.galleryView';
function savedView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'diary' ? 'diary' : 'gallery'; } catch { return 'gallery'; }
}

function stamp(time: number) {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

export default function GalleryPanel({ repository, onOpen, onClose, canOpen }: {
  repository: GalleryRepository; onOpen: (work: Artwork) => void; onClose: () => void; canOpen: boolean;
}) {
  const [cards, setCards] = useState<ArtworkCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [removed, setRemoved] = useState(false);
  const [message, setMessage] = useState('');
  const [active, setActive] = useState(0);
  const [view, setView] = useState<View>(savedView);
  const chooseView = (next: View) => {
    setView(next);
    if (next === 'diary') setRemoved(false);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* 隐私模式下不记也没关系 */ }
  };
  // 日记里给每一天写的一句；正在改的是哪一天（用 ref 防止回车和失焦各存一次）。
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const editingDay = useRef<string | null>(null);
  // 一天的印样：冲好的图，以及是否印上写的那句。
  const [dayPrint, setDayPrint] = useState<{ day: string; blob: Blob; withNote: boolean } | null>(null);
  const [printingDay, setPrintingDay] = useState<string | null>(null);
  const alive = useRef(false), serial = useRef(0), pending = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const fragment = useRef<MemoryFragment | null>(null);
  // 照片作品用存档里的原照片显影，比封面截图清楚，也保留照片原本的比例；读过的留着，来回滑不必再读。
  const [sources, setSources] = useState<Record<string, { image: string; aspect: number }>>({});
  // 正在以粒子碎片显示的作品：它的静态封面隐去，只留碎片。
  const [liveId, setLiveId] = useState<string | null>(null);
  const load = async () => {
    const id = ++serial.current; setLoading(true); setError('');
    try {
      const [result, saved] = await Promise.all([repository.list(), repository.listNotes().catch(() => ({}))]);
      if (alive.current && id === serial.current) { setCards(result); setNotes(saved); }
    }
    catch (cause) { if (alive.current && id === serial.current) setError(cause instanceof Error ? cause.message : '回廊暂时无法读取，请重试。'); }
    finally { if (alive.current && id === serial.current) setLoading(false); }
  };
  useEffect(() => {
    alive.current = true; closeButton.current?.focus(); void load();
    return () => { alive.current = false; serial.current++; };
  }, [repository]);
  const act = async (card: ArtworkCard, action: 'open' | 'remove' | 'restore') => {
    if (pending.current) return;
    pending.current = true; setBusy(card.id); setError(''); setMessage('');
    try {
      if (action === 'open') {
        const work = await repository.get(card.id);
        if (alive.current) onOpen(work);
      } else {
        await repository.setRemoved(card.id, action === 'remove');
        if (alive.current) { setMessage(action === 'remove' ? '已移到「已移除」，随时可以恢复。' : '作品已回到回廊。'); await load(); }
      }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '操作未完成，请重试。'); }
    finally { pending.current = false; if (alive.current) setBusy(null); }
  };
  const startNote = (day: string) => { editingDay.current = day; setDraft(notes[day] ?? ''); setEditing(day); };
  const cancelNote = () => { editingDay.current = null; setEditing(null); };
  const saveNote = async (day: string) => {
    if (editingDay.current !== day) return;
    editingDay.current = null; setEditing(null);
    const text = cleanNote(draft);
    if (text === (notes[day] ?? '')) return;
    try {
      const saved = await repository.setNote(day, text);
      if (alive.current) setNotes(previous => {
        const next = { ...previous };
        if (saved) next[day] = saved; else delete next[day];
        return next;
      });
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '这一句没有记下，请重试。'); }
  };
  // 印样用每件作品存档里的封面；某张读不出来时那一格留黑，不影响其他格。
  const printDay = async (day: string, items: ArtworkCard[], withNote: boolean) => {
    if (printingDay) return;
    setPrintingDay(day); setError('');
    try {
      const frames: DayFrame[] = await Promise.all(items.map(async card => {
        const image = new Image();
        image.src = card.thumbnail;
        const ok = await image.decode().then(() => true, () => false);
        return { image: ok ? image : null, title: card.title.trim() || '此刻的显影', createdAt: card.createdAt };
      }));
      const blob = await sheetToBlob(await composeDaySheet(day, frames, withNote ? notes[day] ?? '' : ''));
      if (alive.current) setDayPrint({ day, blob, withNote });
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '这一天没能冲印，请重试。'); }
    finally { if (alive.current) setPrintingDay(null); }
  };

  // 新作品在前，最先看到最近的一次。
  const visible = cards.filter(card => removed ? card.removedAt !== null : card.removedAt === null)
    .sort((a, b) => b.createdAt - a.createdAt);
  const current = visible[Math.min(active, visible.length - 1)];
  const diaryDays = groupByDay(cards.filter(card => card.removedAt === null));

  useEffect(() => {
    if (active > Math.max(0, visible.length - 1)) setActive(Math.max(0, visible.length - 1));
  }, [visible.length, active]);
  useEffect(() => { setActive(0); track.current?.scrollTo({ left: 0 }); }, [removed]);

  useEffect(() => {
    if (!canvas.current) return;
    try { fragment.current = createMemoryFragment(canvas.current, compact); }
    catch { fragment.current = null; }
    return () => { fragment.current?.dispose(); fragment.current = null; };
  }, []);
  const visibleIds = visible.map(card => card.id).join(',');
  useEffect(() => {
    let cancelled = false;
    for (const card of visible) {
      if (sources[card.id]) continue;
      void (async () => {
        let image = card.thumbnail;
        if (card.kind === 'relief') {
          try { image = (await repository.get(card.id)).scene.relief?.image ?? image; } catch { /* 读不到原照片时用封面 */ }
        }
        const probe = new Image();
        probe.src = image;
        try { await probe.decode(); } catch { return; }
        if (!cancelled && alive.current) setSources(previous => ({ ...previous, [card.id]: { image, aspect: probe.naturalWidth / probe.naturalHeight } }));
      })();
    }
    return () => { cancelled = true; };
  }, [visibleIds]);

  // 当前作品停稳后（放大过渡结束）再显影成碎片；一滑走就先散去。
  const currentId = current?.id;
  const currentSource = current ? sources[current.id] : undefined;
  useEffect(() => {
    const live = fragment.current;
    if (!live || !current) return;
    live.hide(); setLiveId(null);
    if (!currentSource || view === 'diary') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const stage = canvas.current?.getBoundingClientRect();
      const figure = track.current?.children[visible.indexOf(current)]?.querySelector('.gallery-figure')?.getBoundingClientRect();
      if (!stage || !figure) return;
      const box = { x: figure.left - stage.left, y: figure.top - stage.top, width: figure.width, height: figure.height };
      live.show({ id: current.id, image: currentSource.image, sculpture: current.kind === 'sculpture' || current.kind === 'nebula' },
        containRect(box, currentSource.aspect), () => { if (!cancelled) setLiveId(current.id); });
    }, 560);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [currentId, removed, currentSource, view]);

  const slideWidth = () => (track.current?.firstElementChild as HTMLElement | null)?.offsetWidth ?? 1;
  const go = (index: number) => {
    const next = Math.max(0, Math.min(visible.length - 1, index));
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.current?.scrollTo({ left: next * slideWidth(), behavior: smooth ? 'smooth' : 'auto' });
    setActive(next);
  };

  return (
    <section className="gallery-panel" aria-labelledby="gallery-title"
      onKeyDown={(event) => {
        if (view !== 'gallery') return;
        if (event.key === 'ArrowLeft') go(active - 1);
        else if (event.key === 'ArrowRight') go(active + 1);
      }}>
      <h1 id="gallery-title" className="sr-only">本地回廊</h1>
      <div className="gallery-bar">
        <button ref={closeButton} type="button" className="gallery-back" onClick={onClose}><Icon name="left" />返回</button>
        <div className="gallery-views" role="group" aria-label="看法">
          <button type="button" aria-pressed={view === 'gallery'} onClick={() => chooseView('gallery')}>回廊</button>
          <button type="button" aria-pressed={view === 'diary'} onClick={() => chooseView('diary')}>日记</button>
        </div>
        <div className="gallery-tabs" role="group" aria-label="回廊分类" hidden={view === 'diary'}>
          <button type="button" aria-pressed={!removed} onClick={() => setRemoved(false)}>作品 {cards.filter(c => c.removedAt === null).length}</button>
          <button type="button" aria-pressed={removed} onClick={() => setRemoved(true)}>已移除 {cards.filter(c => c.removedAt !== null).length}</button>
        </div>
      </div>

      {/* 日记：每天一页印样，凌晨 4 点前算前一天；点一格打开那一刻。 */}
      {view === 'diary' && <div className="diary">
        {!loading && !diaryDays.length && <p className="gallery-empty">日记还空着。<br />凝结一次并留下它，这一天就有了一页。</p>}
        {diaryDays.map(({ day, items }) => {
          const label = dayLabel(day);
          return (
            <section className="diary-day" key={day} aria-label={`${label.date} ${label.weekday}`}>
              <header>
                <h2>{label.date}</h2><span>{label.weekday} · {items.length} 个时刻</span>
                <button type="button" className="diary-print" aria-busy={printingDay === day}
                  onClick={() => void printDay(day, items, true)}><Icon name="print" />{printingDay === day ? '正在冲印…' : '冲印这一天'}</button>
              </header>
              {editing === day
                ? <input className="diary-note-input" autoFocus value={draft} maxLength={NOTE_LIMIT}
                    placeholder="给这一天写一句" aria-label={`给 ${label.date} 写一句`}
                    onChange={event => setDraft(event.target.value)} onBlur={() => void saveNote(day)}
                    onKeyDown={event => {
                      // 中文输入法选字时的回车只是上屏，不算写完。
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void saveNote(day); }
                      else if (event.key === 'Escape') { event.stopPropagation(); cancelNote(); }
                    }} />
                : <button type="button" className={`diary-note${notes[day] ? '' : ' is-empty'}`} onClick={() => startNote(day)}
                    aria-label={notes[day] ? `改写这一天的那句：${notes[day]}` : `给 ${label.date} 写一句`}>
                    {notes[day] ?? '给这一天写一句…'}
                  </button>}
              <ol className="diary-sheet">
                {items.map((card, index) => (
                  <li key={card.id}>
                    <button type="button" className="diary-frame" aria-label={`打开${card.title}`}
                      disabled={Boolean(busy) || !canOpen} onClick={() => void act(card, 'open')}>
                      <img src={card.thumbnail} alt="" width="320" height="220" loading="lazy" />
                      <span className="diary-frame-no">{String(index + 1).padStart(2, '0')}</span>
                      <time>{clockTime(card.createdAt)}</time>
                    </button>
                    <h3>{busy === card.id ? '正在打开…' : card.title}</h3>
                    {card.summary && <p>{card.summary}</p>}
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>}

      <div className="gallery-stage" hidden={view === 'diary'}>
        <canvas ref={canvas} className="gallery-fragment" aria-hidden="true" />
        {!loading && !visible.length && <p className="gallery-empty">{removed ? '这里还没有移除的作品。' : <>回廊还空着。<br />凝结一次，再选择留下它。</>}</p>}
        <div className="gallery-track" ref={track} onScroll={() => {
          const node = track.current;
          if (node) setActive(Math.max(0, Math.min(visible.length - 1, Math.round(node.scrollLeft / slideWidth()))));
        }}>
          {visible.map((card, index) => (
            <article className={`gallery-slide${index === active ? ' is-active' : ''}`} key={card.id} aria-current={index === active}>
              <button type="button" className="gallery-figure" tabIndex={index === active ? 0 : -1}
                style={{ '--frame': frameAspect(sources[card.id]?.aspect ?? COVER_ASPECT) } as CSSProperties}
                aria-label={index === active ? `打开${card.title}` : `查看${card.title}`}
                disabled={Boolean(busy) || (index === active && (removed || !canOpen))}
                onClick={() => { if (index === active) void act(card, 'open'); else go(index); }}>
                {(() => {
                  const source = sources[card.id];
                  const mask = `url(${fragmentMask(card.id, card.kind === 'sculpture' || card.kind === 'nebula', source?.aspect ?? COVER_ASPECT)})`;
                  return <img src={source?.image ?? card.thumbnail} alt="" width="320" height="220" loading="lazy"
                    className={liveId === card.id && index === active ? 'is-live' : undefined}
                    style={{ maskImage: mask, WebkitMaskImage: mask }} />;
                })()}
              </button>
              <h2>{card.title}</h2>
              {card.summary && index === active && <p className="gallery-summary">{card.summary}</p>}
              <p>{card.kind === 'nebula' || card.kind === 'sculpture' ? 'SCULPTURE' : 'PHOTO'} · {stamp(card.createdAt)}</p>
            </article>
          ))}
        </div>
        {visible.length > 1 && <>
          <button type="button" className="gallery-arrow is-left" aria-label="上一件" disabled={active === 0} onClick={() => go(active - 1)}><Icon name="left" /></button>
          <button type="button" className="gallery-arrow is-right" aria-label="下一件" disabled={active >= visible.length - 1} onClick={() => go(active + 1)}><Icon name="right" /></button>
        </>}
      </div>

      <div className="gallery-footer">
        {view === 'gallery' && visible.length > 1 && <div className="gallery-dots" role="group" aria-label="选择作品">
          {visible.map((card, index) => <button type="button" key={card.id} aria-label={`第 ${index + 1} 件`} aria-pressed={index === active} onClick={() => go(index)} />)}
        </div>}
        {view === 'gallery' && current && <div className="gallery-actions">
          {removed ? <button type="button" className="meta-pill" disabled={Boolean(busy)} onClick={() => void act(current, 'restore')}>恢复作品</button> : <>
            <button type="button" className="meta-pill" disabled={Boolean(busy) || !canOpen} onClick={() => void act(current, 'open')}>{busy === current.id ? '正在打开…' : '打开'}</button>
            <button type="button" className="meta-pill is-quiet" disabled={Boolean(busy)} onClick={() => void act(current, 'remove')}>移除</button>
          </>}
        </div>}
        {!canOpen && <p className="gallery-message">当前凝结还未保存。可以先返回保存，或让它散去，再打开另一件。</p>}
        {error && <p className="gallery-message is-error" role="alert">{error}</p>}
        <p className="gallery-message" role="status">{loading ? '正在读取本地作品…' : message}</p>
        <p className="gallery-note">{view === 'diary' ? '作品和写下的话' : ''}只留在这个浏览器里，换浏览器、地址或清除站点数据后不会同步</p>
      </div>
      {dayPrint && <PrintSheet blob={dayPrint.blob} name={dayPrintFileName(dayPrint.day)} label={`冲印好的印样：${dayLabel(dayPrint.day).date}`}
        busy={Boolean(printingDay)} onClose={() => setDayPrint(null)}
        option={notes[dayPrint.day] ? { text: '印上写的那句', checked: dayPrint.withNote, onChange: checked => {
          const page = diaryDays.find(entry => entry.day === dayPrint.day);
          if (page) void printDay(page.day, page.items, checked);
        } } : undefined} />}
    </section>
  );
}
