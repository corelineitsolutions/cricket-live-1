/**
 * Normalised result of parsing one Cricsheet "classic" CSV file
 * (https://cricsheet.org/format/csv_original/). Data: Cricsheet, ODC-By 1.0.
 */

/** Bump when parsing rules change so --update-changed can re-import affected matches. */
export const PARSER_VERSION = 1;

export type HistMatchOutcome = 'WIN' | 'TIE' | 'DRAW' | 'NO_RESULT' | 'UNKNOWN';

export interface ParseIssue {
  code: string;
  message: string;
  line?: number;
}

export interface ParsedPlayer {
  team: string;
  name: string;
  personId: string;
}

export interface ParsedWicket {
  /** 1-based position on the delivery (one delivery can record several dismissals). */
  ordinal: number;
  kind: string;
  playerOutName: string | null;
  playerOutId: string | null;
  creditedToBowler: boolean;
  countsAsTeamWicket: boolean;
  /** Only filled on the first wicket of the delivery; the source does not say which dismissal they belong to. */
  fielderIds: Array<string | null>;
  unresolvedFielders: string[];
}

export interface ParsedDelivery {
  innings: number;
  /** 1-based order of the row within its innings. */
  seq: number;
  overNo: number;
  ballNo: number;
  legalOverNo: number;
  legalBallNo: number;
  battingTeam: string;
  batterId: string;
  nonStrikerId: string;
  bowlerId: string;
  runsBatter: number;
  extras: number;
  wides: number;
  noballs: number;
  byes: number;
  legbyes: number;
  penalty: number;
  totalRuns: number;
  isLegal: boolean;
  nonBoundary: boolean;
  wickets: ParsedWicket[];
}

export interface ParsedInnings {
  inningsNo: number;
  battingTeam: string | null;
  bowlingTeam: string | null;
  isSuperOver: boolean;
  declared: boolean;
  forfeited: boolean;
  runs: number;
  wickets: number;
  legalBalls: number;
  deliveries: number;
  extras: number;
  wides: number;
  noballs: number;
  byes: number;
  legbyes: number;
  penaltyInDeliveries: number;
  penaltyPre: number;
  penaltyPost: number;
  targetRuns: number | null;
  targetOvers: string | null;
}

export interface ParsedVenue {
  name: string;
  city: string | null;
  cricsheetVenueId: string | null;
}

export interface ParsedMatch {
  cricsheetMatchId: string;
  formatVersion: string;
  ballsPerOver: number;
  teams: [string, string];
  teamType: string;
  gender: string;
  season: string;
  dates: string[];
  startDate: string;
  endDate: string;
  eventName: string | null;
  matchNumber: string | null;
  matchTypeNumber: number | null;
  matchType: string;
  oversLimit: number | null;
  venue: ParsedVenue;
  neutralVenue: boolean;
  tossWinner: string | null;
  tossDecision: string | null;
  tossUncontested: boolean;
  outcome: HistMatchOutcome;
  winner: string | null;
  winByRuns: number | null;
  winByWickets: number | null;
  winByInnings: boolean;
  method: string | null;
  eliminator: string | null;
  bowlOut: string | null;
  hasSuperOver: boolean;
  officials: Record<string, string[]>;
  /** Info keys the parser does not model, kept verbatim so nothing is silently dropped. */
  extraInfo: Record<string, string[][]>;
  playerOfMatchIds: string[];
  /** Registry rows of this file; one person can appear under more than one name. */
  people: Array<{ id: string; name: string }>;
  players: ParsedPlayer[];
  innings: ParsedInnings[];
  deliveries: ParsedDelivery[];
}

export type ParseResult =
  | { ok: true; match: ParsedMatch; warnings: ParseIssue[] }
  | { ok: false; errors: ParseIssue[]; warnings: ParseIssue[] };
