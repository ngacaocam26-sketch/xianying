import type { ReactNode } from 'react';

type IconName = 'photo' | 'mic' | 'send' | 'stop' | 'close' | 'check' | 'again' | 'left' | 'right' | 'gallery';

const paths: Record<IconName, ReactNode> = {
  photo: <><path d="M8 6 9.5 3.5h5L16 6h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3Z" /><circle cx="12" cy="12.5" r="3.5" /></>,
  mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3" /></>,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  close: <path d="m7 7 10 10M17 7 7 17" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  again: <><path d="M5 12a7 7 0 1 0 2.1-5" /><path d="M5 4v4h4" /></>,
  left: <path d="m14.5 6-6 6 6 6" />,
  right: <path d="m9.5 6 6 6-6 6" />,
  gallery: <><rect x="4" y="7" width="12" height="12" rx="2" /><path d="M8 4h9a3 3 0 0 1 3 3v9" /></>,
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
