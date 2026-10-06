import { MatchStatus } from '@prisma/client';

export interface StatusInfo {
  status: MatchStatus;
  isLive: boolean;
  isFinished: boolean;
}

const TERMINAL: Array<[RegExp, MatchStatus]> = [
  [/abandon/i, MatchStatus.ABANDONED],
  [/cancel/i, MatchStatus.CANCELLED],
  [/postpone/i, MatchStatus.POSTPONED],
  [/finish|complete|result|ended|\bwon\b|\bdrawn?\b|\btied?\b/i, MatchStatus.COMPLETED],
];

const INTERRUPTED = /rain|interrupt|delay|suspend|wet|bad light/i;
const NOT_STARTED = /upcoming|not started|scheduled|yet to|^ns$/i;

/**
 * Maps a Latiyal match status string to the backend status.
 * Being in liveMatchList puts the match in the active set even when its status still
 * says it has not started (toss done, players walking out). A terminal status
 * (finished, abandoned, cancelled, postponed) still wins over that.
 * The raw Latiyal string is kept separately as `statusDetail`.
 */
export function mapStatus(raw: string | null, inLiveList: boolean): StatusInfo {
  const text = raw?.trim() ?? '';
  for (const [pattern, status] of TERMINAL) {
    if (pattern.test(text)) {
      return { status, isLive: false, isFinished: true };
    }
  }
  if (INTERRUPTED.test(text)) {
    return { status: MatchStatus.INTERRUPTED, isLive: true, isFinished: false };
  }
  if (inLiveList) {
    return { status: MatchStatus.LIVE, isLive: true, isFinished: false };
  }
  if (NOT_STARTED.test(text)) {
    return { status: MatchStatus.SCHEDULED, isLive: false, isFinished: false };
  }
  if (/live|innings|stumps|lunch|tea|break|progress/i.test(text)) {
    return { status: MatchStatus.LIVE, isLive: true, isFinished: false };
  }
  return { status: MatchStatus.UNKNOWN, isLive: false, isFinished: false };
}
