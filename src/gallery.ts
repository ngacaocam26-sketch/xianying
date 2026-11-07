import { artworkCard, validateArtwork, validateCard } from './artwork.ts';
import type { Artwork, ArtworkCard } from './artwork.ts';
import { cleanNote, isDay } from './diary.ts';

export interface GalleryRepository {
  list(): Promise<ArtworkCard[]>;
  get(id: string): Promise<Artwork>;
  save(work: Artwork): Promise<Artwork>;
  setRemoved(id: string, removed: boolean): Promise<void>;
  // 日记里用户给某一天写的一句（day 为 YYYY-MM-DD）；写空即删除。返回实际存下的文字。
  listNotes(): Promise<Record<string, string>>;
  setNote(day: string, note: string): Promise<string>;
}
type Store = 'works' | 'cards' | 'days';
function storageError(error: unknown): Error {
  const name = error instanceof Error ? error.name : '';
  if (name === 'QuotaExceededError') return new Error('本地空间不足，这件作品还没有保存。请保留当前页面，释放浏览器空间后重试。');
  if (name === 'SecurityError' || name === 'InvalidStateError') return new Error('浏览器暂不允许本地存档。请检查隐私设置，当前作品仍留在页面中。');
  return error instanceof Error ? error : new Error('本地存档暂时不可用，请重试。');
}
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
}
function completed(tx: IDBTransaction): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('本地保存被中断，请重试。'));
    tx.onerror = () => { /* onabort provides the final transaction error. */ };
  });
  void done.catch(() => {});
  return done;
}
export function createGalleryRepository(name = 'xianying-local-gallery', factory?: IDBFactory): GalleryRepository {
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const idb = factory ?? globalThis.indexedDB;
      if (!idb) { reject(new Error('当前浏览器不支持本地存档，当前作品仍留在页面中。')); return; }
      let settled = false;
      const fail = (error: unknown) => { settled = true; clearTimeout(timer); reject(storageError(error)); };
      const timer = setTimeout(() => fail(new Error('本地存档打开较慢，请关闭同站点的其他旧页面后重试。')), 5000);
      let opening: IDBOpenDBRequest;
      // 版本 2 新增 days（日记里写给每一天的一句）；从版本 1 升级时作品和卡片原样保留。
      try { opening = idb.open(name, 2); } catch (error) { fail(error); return; }
      opening.onupgradeneeded = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains('works')) db.createObjectStore('works', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('days')) db.createObjectStore('days', { keyPath: 'day' });
      };
      opening.onblocked = () => fail(new Error('存档被其他旧页面占用，请关闭同站点的其他页面后重试。'));
      opening.onerror = () => fail(opening.error);
      opening.onsuccess = () => {
        clearTimeout(timer);
        if (settled) { opening.result.close(); return; }
        settled = true; opening.result.onversionchange = () => opening.result.close(); resolve(opening.result);
      };
    });
  }
  async function transaction<T>(mode: IDBTransactionMode, action: (tx: IDBTransaction) => Promise<T>, stores: Store[] = ['works', 'cards']): Promise<T> {
    const db = await open();
    let tx: IDBTransaction | undefined;
    try {
      tx = db.transaction(stores, mode); const done = completed(tx);
      const result = await action(tx); await done; return result;
    } catch (error) {
      try { tx?.abort(); } catch { /* Already committed/aborted. */ }
      throw storageError(error);
    } finally { db.close(); }
  }
  return {
    list: () => transaction('readonly', async tx => {
      const cards = await request(tx.objectStore('cards').getAll());
      return cards.map(validateCard).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    }),
    get: id => transaction('readonly', async tx => {
      const [raw, card] = await Promise.all([request(tx.objectStore('works').get(id)), request(tx.objectStore('cards').get(id))]);
      if (!raw || !card || validateCard(card).removedAt !== null) throw new Error('这件作品已被移除，请在回廊的「已移除」中恢复。');
      return validateArtwork(raw);
    }),
    save: value => {
      const work = validateArtwork(value);
      return transaction('readwrite', async tx => {
        const existing = await request(tx.objectStore('cards').get(work.id));
        if (existing) {
          if (validateCard(existing).removedAt !== null) throw new Error('这件作品已移除，请先在本地回廊恢复。');
          return validateArtwork(await request(tx.objectStore('works').get(work.id)));
        }
        await request(tx.objectStore('works').add(work));
        await request(tx.objectStore('cards').add(artworkCard(work)));
        return work;
      });
    },
    setRemoved: (id, removed) => transaction('readwrite', async tx => {
      const store = tx.objectStore('cards'); const value = await request(store.get(id));
      if (!value) throw new Error('没有找到这件作品，请刷新回廊。');
      const card = validateCard(value);
      await request(store.put({ ...card, removedAt: removed ? Date.now() : null }));
    }),
    listNotes: () => transaction('readonly', async tx => {
      const notes: Record<string, string> = {};
      for (const value of await request(tx.objectStore('days').getAll()) as unknown[]) {
        const { day, note } = (value ?? {}) as { day?: unknown; note?: unknown };
        if (isDay(day) && typeof note === 'string' && cleanNote(note)) notes[day] = cleanNote(note);
      }
      return notes;
    }, ['days']),
    setNote: (day, note) => {
      if (!isDay(day)) return Promise.reject(new Error('这一天的日期不对，没有记下。'));
      const text = cleanNote(note);
      return transaction('readwrite', async tx => {
        const store = tx.objectStore('days');
        if (text) await request(store.put({ day, note: text, updatedAt: Date.now() }));
        else await request(store.delete(day));
        return text;
      }, ['days']);
    },
  };
}
export const localGallery = createGalleryRepository();
