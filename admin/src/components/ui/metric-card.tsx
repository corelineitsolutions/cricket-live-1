import type { ReactNode } from 'react';

export function MetricCard({ label, value, hint, footer }: { label: string; value: ReactNode; hint?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      {footer && <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">{footer}</div>}
    </div>
  );
}

/** Horizontal usage bar: green under 70 %, amber under 90 %, red above. */
export function UsageBar({ used, limit }: { used: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const color = ratio < 0.7 ? 'bg-emerald-500' : ratio < 0.9 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={used}
    >
      <div className={`h-full ${color}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
    </div>
  );
}
