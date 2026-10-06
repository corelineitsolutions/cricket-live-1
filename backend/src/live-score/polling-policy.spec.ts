import { latiyalMatch, LatiyalMatchOptions, LOCAL_TEAM_ID, VISITOR_TEAM_ID } from '../testing/latiyal-fixtures';
import { normalizeLatiyalMatch } from './live-match.normalizer';
import { computeNextPoll, isCriticalMatch, MAX_BACKOFF_MS } from './polling-policy';

const intervals = { idleMs: 60_000, liveMs: 10_000, activeMs: 5_000 };
const HOUR_MS = 3_600_000;

function match(options: LatiyalMatchOptions) {
  return normalizeLatiyalMatch(latiyalMatch(options), null, new Date());
}

const firstInnings = match({ status: '1st Innings', runs: [[1, LOCAL_TEAM_ID, 64, 1, 7.4]] });
const earlyChase = match({
  runs: [
    [1, LOCAL_TEAM_ID, 180, 6, 20],
    [2, VISITOR_TEAM_ID, 40, 1, 5],
  ],
});
const lastOvers = match({
  runs: [
    [1, LOCAL_TEAM_ID, 180, 6, 20],
    [2, VISITOR_TEAM_ID, 120, 3, 15.2],
  ],
});
const finished = match({ status: 'Finished' });

describe('computeNextPoll', () => {
  it('polls every 60 s when nothing is live', () => {
    expect(computeNextPoll({ liveMatches: [], intervals })).toEqual({ intervalMs: 60_000, mode: 'idle', reason: 'idle' });
    expect(computeNextPoll({ liveMatches: [finished], intervals }).mode).toBe('idle');
  });

  it('polls every 10 s when the only listed match still says Upcoming', () => {
    const notStartedButLive = match({ id: 71391, status: 'Upcoming', runs: [] });

    expect(notStartedButLive.isLive).toBe(true);
    expect(computeNextPoll({ liveMatches: [notStartedButLive], intervals })).toEqual({
      intervalMs: 10_000,
      mode: 'live',
      reason: 'live',
    });
  });

  it('polls every 10 s during normal live play', () => {
    expect(computeNextPoll({ liveMatches: [firstInnings, earlyChase], intervals })).toEqual({
      intervalMs: 10_000,
      mode: 'live',
      reason: 'live',
    });
  });

  it('polls every 5 s when any chase is in its critical phase', () => {
    expect(isCriticalMatch(lastOvers)).toBe(true);
    expect(isCriticalMatch(earlyChase)).toBe(false);
    expect(computeNextPoll({ liveMatches: [earlyChase, lastOvers], intervals })).toEqual({
      intervalMs: 5_000,
      mode: 'active',
      reason: 'active',
    });
  });

  it('backs off exponentially after consecutive failures, capped at 5 minutes', () => {
    const at = (failures: number) =>
      computeNextPoll({ liveMatches: [earlyChase], intervals, consecutiveFailures: failures });

    expect(at(1).intervalMs).toBe(10_000);
    expect(at(2)).toMatchObject({ intervalMs: 20_000, reason: 'backoff' });
    expect(at(4).intervalMs).toBe(80_000);
    expect(at(20).intervalMs).toBe(MAX_BACKOFF_MS);
  });

  it('waits for Retry-After instead of the backoff', () => {
    expect(
      computeNextPoll({ liveMatches: [lastOvers], intervals, consecutiveFailures: 5, retryAfterMs: 90_000 }),
    ).toMatchObject({ intervalMs: 90_000, reason: 'retry-after' });
  });

  it('spreads the remaining budget over the time left in the window', () => {
    expect(
      computeNextPoll({ liveMatches: [lastOvers], intervals, quota: { remaining: 10, msUntilReset: 600_000 } }),
    ).toMatchObject({ intervalMs: 60_000, mode: 'active', reason: 'quota' });
    expect(
      computeNextPoll({ liveMatches: [lastOvers], intervals, quota: { remaining: 0, msUntilReset: 120_000 } }),
    ).toMatchObject({ intervalMs: 120_000, reason: 'quota' });
    expect(
      computeNextPoll({ liveMatches: [lastOvers], intervals, quota: { remaining: 1500, msUntilReset: HOUR_MS } }),
    ).toMatchObject({ intervalMs: 5_000, reason: 'active' });
  });

  it('keeps the configured cadence within the 1600 calls/hour budget', () => {
    expect(HOUR_MS / intervals.idleMs).toBe(60);
    expect(HOUR_MS / intervals.liveMs).toBe(360);
    expect(HOUR_MS / intervals.activeMs).toBe(720);
    expect(HOUR_MS / intervals.activeMs).toBeLessThan(1600);
  });
});
