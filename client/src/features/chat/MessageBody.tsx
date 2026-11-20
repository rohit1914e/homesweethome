// Message text with line breaks preserved and http(s) links made clickable.
// Built from React text nodes and <a> elements only — never innerHTML.
import { Fragment, type ReactNode } from 'react';

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
// Punctuation that usually ends a sentence rather than a URL.
const TRAILING = /[.,!?;:)\]}'"’”]+$/;

function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function linkify(text: string, linkClass = ''): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let url = match[0];
    // Keep a closing paren that balances one inside the URL (e.g. Wikipedia links).
    const trail = url.match(TRAILING)?.[0] ?? '';
    if (trail) {
      let cut = trail.length;
      if (trail.startsWith(')') && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) cut -= 1;
      if (cut > 0) url = url.slice(0, url.length - cut);
    }
    const href = safeHref(url);
    if (!href) continue;
    if (start > last) out.push(<Fragment key={key++}>{text.slice(last, start)}</Fragment>);
    out.push(
      <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return out;
}

export function MessageBody({ text, className = '' }: { text: string; className?: string }) {
  return (
    <p className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${className}`}>
      {linkify(text, 'font-medium text-lamp underline decoration-lamp/40 underline-offset-2 hover:decoration-lamp')}
    </p>
  );
}
