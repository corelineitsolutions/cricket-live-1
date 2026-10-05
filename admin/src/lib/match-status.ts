import type { Tone } from '@/components/ui/status-badge';
import type { MatchStatus } from './types';

export function matchStatusTone(status: MatchStatus): Tone {
  if (status === 'LIVE') return 'success';
  if (status === 'INTERRUPTED') return 'warning';
  if (status === 'COMPLETED') return 'info';
  if (status === 'ABANDONED' || status === 'CANCELLED') return 'danger';
  return 'neutral';
}
