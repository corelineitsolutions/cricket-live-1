import { MatchStatus } from '@prisma/client';

export interface StatusInfo {
  status: MatchStatus;
  isLive: boolean;
  isFinished: boolean;
}

const FINISHED: Record<string, MatchStatus> = {
  Finished: MatchStatus.COMPLETED,
  'Aban.': MatchStatus.ABANDONED,
  'Cancl.': MatchStatus.CANCELLED,
  'Postp.': MatchStatus.POSTPONED,
};

const IN_PLAY = new Set([
  '1st Innings',
  '2nd Innings',
  '3rd Innings',
  '4th Innings',
  'Innings Break',
  'Lunch',
  'Tea',
  'Dinner',
  'Delayed',
]);

const STUMPS = /^Stump Day \d+$/;

/** Maps a Sportmonks cricket status string to the backend status. */
export function mapStatus(raw: string | null, liveFlag: boolean | null): StatusInfo {
  if (raw && FINISHED[raw]) {
    return { status: FINISHED[raw], isLive: false, isFinished: true };
  }
  if (raw === 'Int.') {
    return { status: MatchStatus.INTERRUPTED, isLive: true, isFinished: false };
  }
  if (raw && (IN_PLAY.has(raw) || STUMPS.test(raw))) {
    return { status: MatchStatus.LIVE, isLive: true, isFinished: false };
  }
  if (raw === 'NS') {
    return { status: MatchStatus.SCHEDULED, isLive: false, isFinished: false };
  }
  if (liveFlag) {
    return { status: MatchStatus.LIVE, isLive: true, isFinished: false };
  }
  return { status: MatchStatus.UNKNOWN, isLive: false, isFinished: false };
}
