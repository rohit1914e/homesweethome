// Keeps one broken widget from taking down the whole page.
import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from './ui';

export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: (reset: () => void, error: Error) => ReactNode; label?: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[HomeSweetHome] widget failed', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset, error);
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-tile border border-seam bg-room p-5">
        <div>
          <p className="font-semibold text-jasmine">{this.props.label ? `${this.props.label} didn’t load.` : 'This part didn’t load.'}</p>
          <p className="text-sm text-dusk">The rest of the house still works. Try loading it again.</p>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw aria-hidden />} onClick={this.reset}>
          Try again
        </Button>
      </div>
    );
  }
}

/** ErrorBoundary + Suspense around a lazily loaded widget. */
export function Widget({ children, label, fallback }: { children: ReactNode; label: string; fallback: ReactNode }) {
  return (
    <ErrorBoundary label={label}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </ErrorBoundary>
  );
}
