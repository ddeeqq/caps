import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/** 의존성 없는 아주 작은 라우터: pushState + popstate */
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  window.addEventListener('popstate', fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('popstate', fn);
  };
}

const snapshot = () => window.location.pathname + window.location.search;

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  for (const fn of listeners) fn();
  window.scrollTo(0, 0);
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const full = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [path, search = ''] = full.split('?');
  return { path: path || '/', query: new URLSearchParams(search) };
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
