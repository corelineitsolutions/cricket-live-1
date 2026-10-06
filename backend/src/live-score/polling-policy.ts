import type { LiveMatch } from './live-match.types';

export const MAX_BACKOFF_MS = 5 * 60_000;
export const MIN_INTERVAL_MS = 1_000;
/** A chase is "critical" in its last six overs or with 30 runs or fewer to win. */
export const CRITICAL_BALLS_REMAINING = 36;
export const CRITICAL_RUNS_REQUIRED = 30;

export type PollMode = 'idle' | 'live' | 'active';
export type PollReason = PollMode | 'backoff' | 'retry-after' | 'quota';

export interface PollingIntervals {
  idleMs: number;
  liveMs: number;
  activeMs: number;
}

export interface PollingInput {
  liveMatches: LiveMatch[];
  intervals: PollingIntervals;
  consecutiveFailures?: number;
  retryAfterMs?: number | null;
  quota?: { remaining: number; msUntilReset: number } | null;
}

export interface PollingDecision {
  intervalMs: number;
  mode: PollMode;
  reason: PollReason;
}

export function isCriticalMatch(match: LiveMatch): boolean {
  if (!match.isLive || match.target === null || match.ballsRemaining === null) {
    return false;
  }
  return (
    match.ballsRemaining <= CRITICAL_BALLS_REMAINING ||
    (match.runsRequired !== null && match.runsRequired <= CRITICAL_RUNS_REQUIRED)
  );
}

export function pollMode(liveMatches: LiveMatch[]): PollMode {
  const live = liveMatches.filter((match) => match.isLive);
  if (live.length === 0) {
    return 'idle';
  }
  return live.some(isCriticalMatch) ? 'active' : 'live';
}

/**
 * Picks the delay before the next Latiyal poll. The base interval comes from match
 * state; failures, Retry-After and the remaining hourly budget can only lengthen it.
 */
export function computeNextPoll(input: PollingInput): PollingDecision {
  const mode = pollMode(input.liveMatches);
  const base =
    mode === 'idle' ? input.intervals.idleMs : mode === 'active' ? input.intervals.activeMs : input.intervals.liveMs;

  let intervalMs = base;
  let reason: PollReason = mode;

  const failures = input.consecutiveFailures ?? 0;
  if (input.retryAfterMs !== null && input.retryAfterMs !== undefined) {
    if (input.retryAfterMs > intervalMs) {
      intervalMs = input.retryAfterMs;
      reason = 'retry-after';
    }
  } else if (failures > 0) {
    const backoff = Math.min(input.intervals.liveMs * 2 ** (failures - 1), MAX_BACKOFF_MS);
    if (backoff > intervalMs) {
      intervalMs = backoff;
      reason = 'backoff';
    }
  }

  if (input.quota) {
    const { remaining, msUntilReset } = input.quota;
    const spacing = remaining <= 0 ? msUntilReset : Math.ceil(msUntilReset / remaining);
    if (spacing > intervalMs) {
      intervalMs = spacing;
      reason = 'quota';
    }
  }

  return { intervalMs: Math.max(MIN_INTERVAL_MS, Math.round(intervalMs)), mode, reason };
}
