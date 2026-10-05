import type { MatchStatus } from '@prisma/client';

export interface LiveTeam {
  sportmonksId: number | null;
  name: string | null;
  shortName: string | null;
  imageUrl: string | null;
}

export interface LiveLeague {
  sportmonksId: number;
  name: string | null;
  code: string | null;
  imageUrl: string | null;
}

export interface LiveSeason {
  sportmonksId: number;
  name: string | null;
}

export interface LiveVenue {
  name: string | null;
  city: string | null;
}

export interface LiveInnings {
  inning: number;
  teamSportmonksId: number;
  score: number;
  wickets: number;
  overs: number;
}

export interface LiveBatsman {
  sportmonksId: number;
  name: string | null;
  imageUrl: string | null;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strikeRate: number | null;
}

export interface LiveBowler {
  sportmonksId: number;
  name: string | null;
  imageUrl: string | null;
  overs: number;
  maidens: number;
  runs: number;
  wickets: number;
  economy: number | null;
}

/** Backend-owned live match state stored in Redis and published on live-score-updates. */
export interface LiveMatch {
  /** Backend match id from MySQL. Null until the metadata row exists. */
  matchId: string | null;
  sportmonksId: number;
  league: LiveLeague | null;
  season: LiveSeason | null;
  matchType: string | null;
  round: string | null;
  status: MatchStatus;
  /** Raw Sportmonks status, for example "2nd Innings" or "Innings Break". */
  statusDetail: string | null;
  isLive: boolean;
  /** True once play is over: completed, abandoned, cancelled or postponed. */
  isFinished: boolean;
  note: string | null;
  startTime: string | null;
  venue: LiveVenue | null;
  localTeam: LiveTeam;
  visitorTeam: LiveTeam;
  winnerTeamSportmonksId: number | null;
  innings: LiveInnings[];
  currentInning: number | null;
  battingTeamSportmonksId: number | null;
  score: number | null;
  wickets: number | null;
  overs: number | null;
  runRate: number | null;
  target: number | null;
  runsRequired: number | null;
  ballsRemaining: number | null;
  requiredRunRate: number | null;
  batsmen: LiveBatsman[];
  bowler: LiveBowler | null;
  /** When the tracked live data last changed. */
  lastUpdatedAt: string;
  /** True when the last Sportmonks poll failed and this is the last known state. */
  stale: boolean;
}

export type LiveScoreEventType =
  | 'MATCH_STARTED'
  | 'MATCH_UPDATED'
  | 'MATCH_FINISHED'
  | 'MATCH_STALE'
  | 'MATCH_REMOVED';

export interface LiveScoreEvent {
  type: LiveScoreEventType;
  matchId: string | null;
  sportmonksId: number;
  changedFields: string[];
  data: LiveMatch;
  updatedAt: string;
}
