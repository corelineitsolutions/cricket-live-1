import type { ReactNode } from 'react';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONES: Record<Tone, { badge: string; dot: string }> = {
  success: { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', dot: 'bg-emerald-500' },
  warning: { badge: 'bg-amber-50 text-amber-800 ring-amber-600/20', dot: 'bg-amber-500' },
  danger: { badge: 'bg-rose-50 text-rose-700 ring-rose-600/20', dot: 'bg-rose-500' },
  info: { badge: 'bg-sky-50 text-sky-700 ring-sky-600/20', dot: 'bg-sky-500' },
  neutral: { badge: 'bg-slate-100 text-slate-600 ring-slate-500/20', dot: 'bg-slate-400' },
};

export function StatusBadge({ tone, children, dot = true }: { tone: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone].badge}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${TONES[tone].dot}`} aria-hidden />}
      {children}
    </span>
  );
}

/** Tone for service health values coming from the API. */
export function healthTone(status: string | null | undefined): Tone {
  switch (status) {
    case 'up':
    case 'live':
    case 'idle':
      return 'success';
    case 'backoff':
    case 'rate-limited':
    case 'starting':
    case 'unknown':
      return 'warning';
    case 'down':
    case 'quota-exhausted':
      return 'danger';
    default:
      return 'neutral';
  }
}
