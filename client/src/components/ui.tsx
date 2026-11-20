// Shared primitives. Props are a CONTRACT used by every page — restyle freely, keep the props.
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-lamp text-lamp-ink hover:brightness-110',
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
  const sizes = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-5 text-base gap-2' };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center rounded-chip font-semibold transition duration-150 select-none disabled:cursor-not-allowed disabled:opacity-50 ${sizes[size]} ${VARIANTS[variant]} ${className}`}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function Card({ className = '', children, ...rest }: React.HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' }) {
  return (
    <section {...rest} className={`rounded-tile border border-seam bg-room p-5 ${className}`}>
      {children}
    </section>
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
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight [font-variation-settings:'opsz'_96] sm:text-4xl">{title}</h1>
        {description && <p className="mt-1 text-dusk">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Accessible modal built on <dialog>. Esc / backdrop click cancels. */
export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children?: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="dialog-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-tile border border-seam bg-room p-0 text-jasmine backdrop:bg-night/70 backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <h2 id="dialog-title" className="text-xl font-bold">
          {title}
        </h2>
        <div className="mt-2 text-dusk">{children}</div>
      </div>
      {footer && <div className="flex justify-end gap-2 border-t border-seam px-6 py-4">{footer}</div>}
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
      onClose={onCancel}
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
