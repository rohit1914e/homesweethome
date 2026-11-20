// The HomeSweetHome mark: a simple house outline with one lit window (the lamp).
// Same drawing as client/public/favicon.svg.
export function HouseMark({ className = 'size-7', title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path
        d="M4.5 15.5 16 5.5l11.5 10M8 13.2V25.5A1.5 1.5 0 0 0 9.5 27h13a1.5 1.5 0 0 0 1.5-1.5V13.2"
        fill="none"
        stroke="var(--color-jasmine)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="12.75" y="15.75" width="6.5" height="6.5" rx="1.25" fill="var(--color-lamp)" />
    </svg>
  );
}

export function Wordmark({ className = '', size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const s = {
    sm: { mark: 'size-6', text: 'text-base' },
    md: { mark: 'size-7', text: 'text-lg' },
    lg: { mark: 'size-10', text: 'text-2xl sm:text-3xl' },
  }[size];
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <HouseMark className={s.mark} />
      <span className={`${s.text} font-bold tracking-tight text-jasmine [font-variation-settings:'opsz'_32,'wdth'_90]`}>
        HomeSweetHome
      </span>
    </span>
  );
}
