// Shared primitives. Props are a CONTRACT used by every page — restyle freely, keep the props.
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-lamp text-lamp-ink hover:brightness-110 active:brightness-95',
  secondary: 'bg-wall text-jasmine hover:bg-seam',
  ghost: 'bg-transparent text-dusk hover:bg-wall hover:text-jasmine',
  danger: 'bg-chili-soft text-chili hover:bg-chili hover:text-night',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}) {
  const sizes = {
    sm: 'h-8 px-3 text-sm gap-1.5 [&_svg]:size-4',
    md: 'h-10 px-4 text-sm gap-2 [&_svg]:size-4',
    lg: 'h-12 px-5 text-base gap-2 [&_svg]:size-5',
  };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-chip font-semibold whitespace-nowrap transition duration-150 select-none active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 ${sizes[size]} ${VARIANTS[variant]} ${className}`}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function Card({
  className = '',
  children,
  as = 'section',
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' }) {
  const Tag = as;
  return (
    <Tag {...rest} className={`rounded-tile border border-seam bg-room p-5 ${className}`}>
      {children}
    </Tag>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-dusk">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

/** Quiet placeholder block for loading states. Purely visual. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse-soft rounded-chip bg-wall ${className}`} />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      {icon && <div className="mb-1 text-haze [&_svg]:size-8">{icon}</div>}
      <p className="font-semibold text-jasmine">{title}</p>
      {description && <p className="max-w-sm text-sm text-dusk">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div className="min-w-0">
        <h1 className="type-display text-4xl font-bold sm:text-5xl">{title}</h1>
        {description && <p className="mt-2 max-w-prose text-dusk">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Labelled text input with optional hint/error. */
export function TextField({
  label,
  hint,
  error,
  className = '',
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={fid} className="text-sm font-semibold text-jasmine">
        {label}
      </label>
      <input
        {...rest}
        id={fid}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${fid}-desc` : undefined}
        className="h-11 rounded-chip border border-seam bg-wall px-3 text-jasmine placeholder:text-haze focus-visible:border-lamp focus-visible:outline-none aria-invalid:border-chili"
      />
      {(hint || error) && (
        <p id={`${fid}-desc`} className={`text-sm ${error ? 'text-chili' : 'text-dusk'}`}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export function TextArea({
  label,
  hint,
  className = '',
  id,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={fid} className="text-sm font-semibold text-jasmine">
        {label}
      </label>
      <textarea
        {...rest}
        id={fid}
        aria-describedby={hint ? `${fid}-desc` : undefined}
        className="min-h-24 resize-y rounded-chip border border-seam bg-wall px-3 py-2.5 leading-relaxed text-jasmine placeholder:text-haze focus-visible:border-lamp focus-visible:outline-none"
      />
      {hint && (
        <p id={`${fid}-desc`} className="text-sm text-dusk">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Accessible modal built on <dialog>. Esc / backdrop click cancels. */
export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children?: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby={titleId}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-tile border border-seam bg-room p-0 text-jasmine shadow-lift backdrop:bg-night/75 backdrop:backdrop-blur-sm open:animate-rise"
    >
      <div className="p-6">
        <h2 id={titleId} className="type-title text-xl font-bold">
          {title}
        </h2>
        <div className="mt-2 leading-relaxed text-dusk">{children}</div>
      </div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-seam px-6 py-4">{footer}</div>}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  loading = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={() => !loading && onCancel()}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description}
      {children}
    </Dialog>
  );
}
