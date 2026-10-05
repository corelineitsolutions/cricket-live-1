import type { ReactNode } from 'react';
import type { ApiError } from '@/lib/api';
import { Button } from './button';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-r-transparent" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorState({ error, title = 'Could not load data', onRetry }: { error: ApiError | Error | string; title?: string; onRetry?: () => void }) {
  const message = typeof error === 'string' ? error : 'describe' in error ? error.describe() : error.message;
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center" role="alert">
      <p className="text-sm font-semibold text-rose-800">{title}</p>
      <p className="mt-1 text-sm text-rose-700">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Small inline notice, e.g. a failed background refresh while old data stays visible. */
export function InlineNotice({ tone = 'warning', children }: { tone?: 'warning' | 'info'; children: ReactNode }) {
  const style = tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-sky-200 bg-sky-50 text-sky-800';
  return <div className={`rounded-md border px-4 py-2.5 text-sm ${style}`}>{children}</div>;
}
