import { useEffect, useRef, useState } from 'react';
import type { Artwork, ArtworkCard } from './artwork';
import type { GalleryRepository } from './gallery';
import { Icon } from './icons';

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
  const alive = useRef(false), serial = useRef(0), pending = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const load = async () => {
    const id = ++serial.current; setLoading(true); setError('');
    try { const result = await repository.list(); if (alive.current && id === serial.current) setCards(result); }
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
  // 新作品在前，最先看到最近的一次。
  const visible = cards.filter(card => removed ? card.removedAt !== null : card.removedAt === null)
    .sort((a, b) => b.createdAt - a.createdAt);
  const current = visible[Math.min(active, visible.length - 1)];

  useEffect(() => {
    if (active > Math.max(0, visible.length - 1)) setActive(Math.max(0, visible.length - 1));
  }, [visible.length, active]);
  useEffect(() => { setActive(0); track.current?.scrollTo({ left: 0 }); }, [removed]);

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
        if (event.key === 'ArrowLeft') go(active - 1);
        else if (event.key === 'ArrowRight') go(active + 1);
      }}>
      <h1 id="gallery-title" className="sr-only">本地回廊</h1>
      <div className="gallery-bar">
        <div className="gallery-tabs" role="group" aria-label="回廊分类">
          <button type="button" aria-pressed={!removed} onClick={() => setRemoved(false)}>作品 {cards.filter(c => c.removedAt === null).length}</button>
          <button type="button" aria-pressed={removed} onClick={() => setRemoved(true)}>已移除 {cards.filter(c => c.removedAt !== null).length}</button>
        </div>
        <button ref={closeButton} type="button" className="gallery-back" onClick={onClose}>返回作品</button>
      </div>

      <div className="gallery-stage">
        {!loading && !visible.length && <p className="gallery-empty">{removed ? '这里还没有移除的作品。' : <>回廊还空着。<br />凝结一次，再选择留下它。</>}</p>}
        <div className="gallery-track" ref={track} onScroll={() => {
          const node = track.current;
          if (node) setActive(Math.max(0, Math.min(visible.length - 1, Math.round(node.scrollLeft / slideWidth()))));
        }}>
          {visible.map((card, index) => (
            <article className={`gallery-slide${index === active ? ' is-active' : ''}`} key={card.id} aria-current={index === active}>
              <button type="button" className="gallery-figure" tabIndex={index === active ? 0 : -1}
                aria-label={index === active ? `打开${card.title}` : `查看${card.title}`}
                disabled={Boolean(busy) || (index === active && (removed || !canOpen))}
                onClick={() => { if (index === active) void act(card, 'open'); else go(index); }}>
                <img src={card.thumbnail} alt="" width="320" height="220" loading="lazy" />
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
        {visible.length > 1 && <div className="gallery-dots" role="group" aria-label="选择作品">
          {visible.map((card, index) => <button type="button" key={card.id} aria-label={`第 ${index + 1} 件`} aria-pressed={index === active} onClick={() => go(index)} />)}
        </div>}
        {current && <div className="gallery-actions">
          {removed ? <button type="button" className="meta-pill" disabled={Boolean(busy)} onClick={() => void act(current, 'restore')}>恢复作品</button> : <>
            <button type="button" className="meta-pill" disabled={Boolean(busy) || !canOpen} onClick={() => void act(current, 'open')}>{busy === current.id ? '正在打开…' : '打开'}</button>
            <button type="button" className="meta-pill is-quiet" disabled={Boolean(busy)} onClick={() => void act(current, 'remove')}>移除</button>
          </>}
        </div>}
        {!canOpen && <p className="gallery-message">当前凝结还未保存。可以先返回保存，或让它散去，再打开另一件。</p>}
        {error && <p className="gallery-message is-error" role="alert">{error}</p>}
        <p className="gallery-message" role="status">{loading ? '正在读取本地作品…' : message}</p>
        <p className="gallery-note">只留在这个浏览器里，换浏览器、地址或清除站点数据后不会同步</p>
      </div>
    </section>
  );
}
