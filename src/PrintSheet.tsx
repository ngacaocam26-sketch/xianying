import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { savePrint } from './print';

// 冲印好的相纸（单张或一天的印样）：挂在 body 下盖住整个页面，回廊里打开也不会被顶栏压住；
// 收起后焦点回到按下「冲印」的那个按钮。保存的结果写在相纸下面，不会被遮住。
export default function PrintSheet({ blob, name, label, option, busy = false, onClose }: {
  blob: Blob; name: string; label: string; busy?: boolean;
  option?: { text: string; checked: boolean; onChange: (checked: boolean) => void };
  onClose: () => void;
}) {
  const [returnTo] = useState(() => document.activeElement);
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next); setStatus('');
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  // 等一拍再看相纸是否真的收起了（开发模式下 React 会先假装卸载一次）。
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => () => {
    window.setTimeout(() => { if (!sheet.current && returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus(); }, 0);
  }, [returnTo]);

  const save = async () => {
    try {
      const result = await savePrint(blob, name);
      setStatus(result === 'downloaded' ? '已保存为图片。' : '');
    } catch { setStatus('没能保存，可以长按图片保存。'); }
  };

  return createPortal(
    <div ref={sheet} className="print-sheet" role="dialog" aria-modal="true" aria-label={label}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      {url && <img src={url} alt={label} />}
      {option && <label className="print-option">
        {/* 重画期间不禁用（禁用会让焦点掉出相纸，Esc 失灵），只是不理会。 */}
        <input type="checkbox" checked={option.checked} aria-busy={busy} onChange={event => { if (!busy) option.onChange(event.target.checked); }} />
        {option.text}
      </label>}
      <div className="print-actions">
        <button type="button" className="meta-pill" autoFocus onClick={() => { if (!busy) void save(); }}>保存图片</button>
        <button type="button" className="meta-pill is-quiet" onClick={onClose}>收起</button>
      </div>
      <p className="print-note" role="status">{status || '相纸只在这台设备上生成，不上传。点保存没有反应时，长按图片保存。'}</p>
    </div>,
    document.body,
  );
}
