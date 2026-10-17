import type { CommentaryDto } from '../../matches/dto/commentary.dto';
import type { LiveMatchesDto, MatchDto } from '../../matches/dto/match.dto';
import type { ScorecardDto } from '../../matches/dto/scorecard.dto';
import type { MatchDetailService } from '../../matches/match-detail.service';
import type { MatchesService } from '../../matches/matches.service';
import { AiTool, parseIntInRange, parseMatchId } from './ai-tool.types';

const MAX_LIVE_MATCHES = 10;
const MAX_COMMENTARY = 30;

function teamName(match: MatchDto, sportmonksId: number | null): string | null {
  if (sportmonksId === null) return null;
  if (match.localTeam.sportmonksId === sportmonksId) return match.localTeam.name;
  if (match.visitorTeam.sportmonksId === sportmonksId) return match.visitorTeam.name;
  return null;
}

/** True when the batting side is chasing (2nd+ innings with a published target). */
export function isChasePhase(match: MatchDto): boolean {
  const inning = match.currentInning ?? match.innings.length;
  return inning >= 2 && match.target != null;
}

/** first_innings | chase | finished | pre_match */
export function matchPhase(match: MatchDto): 'pre_match' | 'first_innings' | 'chase' | 'finished' {
  if (match.isFinished) return 'finished';
  if (!match.isLive && match.innings.length === 0) return 'pre_match';
  if (isChasePhase(match) || (match.currentInning ?? 0) >= 2) return 'chase';
  if (match.innings.length > 0 || match.isLive) return 'first_innings';
  return 'pre_match';
}

/** Compact, model-friendly view of a match: names instead of ids, nothing the app does not show. */
export function summarizeMatch(match: MatchDto) {
  const phase = matchPhase(match);
  const chasing = isChasePhase(match);
  return {
    matchId: match.matchId,
    teams: [match.localTeam.name, match.visitorTeam.name],
    matchType: match.matchType,
    league: match.league?.name ?? null,
    status: match.status,
    statusDetail: match.statusDetail,
    isLive: match.isLive,
    isFinished: match.isFinished,
    phase,
    /** Only true in a real chase. Do not invent a target from the current 1st-innings score. */
    chaseActive: chasing,
    note: match.note,
    venue: match.venue ? [match.venue.name, match.venue.city].filter(Boolean).join(', ') || null : null,
    startTime: match.startTime,
    innings: match.innings.map((i) => ({
      inning: i.inning,
      team: teamName(match, i.teamSportmonksId),
      score: `${i.score}/${i.wickets}`,
      overs: i.overs,
    })),
    current: match.isLive
      ? {
          battingTeam: teamName(match, match.battingTeamSportmonksId),
          inning: match.currentInning,
          score: match.score,
          wickets: match.wickets,
          overs: match.overs,
          runRate: match.runRate,
          target: chasing ? match.target : null,
          runsRequired: chasing ? match.runsRequired : null,
          ballsRemaining: chasing ? match.ballsRemaining : null,
          requiredRunRate: chasing ? match.requiredRunRate : null,
        }
      : null,
    batsmen: match.batsmen.map((b) => ({ name: b.name, runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes })),
    bowler: match.bowler
      ? { name: match.bowler.name, overs: match.bowler.overs, runs: match.bowler.runs, wickets: match.bowler.wickets }
      : null,
    winner: teamName(match, match.winnerTeamSportmonksId),
    lastUpdatedAt: match.lastUpdatedAt,
    stale: match.stale,
  };
}

export type MatchSummary = ReturnType<typeof summarizeMatch>;

function summarizeLive(board: LiveMatchesDto) {
  return {
    count: board.matches.length,
    stale: board.stale,
    updatedAt: board.updatedAt,
    matches: board.matches.slice(0, MAX_LIVE_MATCHES).map((m) => {
      const s = summarizeMatch(m);
      return { matchId: s.matchId, teams: s.teams, matchType: s.matchType, statusDetail: s.statusDetail, innings: s.innings, note: s.note };
    }),
  };
}

function summarizeScorecard(card: ScorecardDto) {
  return {
    matchId: card.matchId,
    status: card.status,
    stale: card.stale,
    innings: card.innings.map((i) => ({
      inning: i.inning,
      team: i.team.name,
      score: `${i.score}/${i.wickets}`,
      overs: i.overs,
      extras: i.extras?.total ?? null,
      batting: i.batting.map((b) => ({
        name: b.name,
        runs: b.runs,
        balls: b.balls,
        fours: b.fours,
        sixes: b.sixes,
        out: b.isOut,
        dismissal: b.dismissal?.type ?? null,
      })),
      bowling: i.bowling.map((b) => ({ name: b.name, overs: b.overs, runs: b.runs, wickets: b.wickets, economy: b.economy })),
    })),
  };
}

function summarizeCommentary(feed: CommentaryDto, limit: number) {
  return {
    matchId: feed.matchId,
    stale: feed.stale,
    note: 'Newest ball first. Commentary may not include every delivery.',
    items: feed.items.slice(0, limit).map((item) => ({
      over: item.over,
      inning: item.inning,
      text: item.text,
      runs: item.runs,
      wicket: item.isWicket,
      extra: item.extraType,
    })),
  };
}

const matchIdSchema = {
  type: 'object',
  properties: { matchId: { type: 'string', description: 'Numeric match id, e.g. "61521".' } },
  required: ['matchId'],
  additionalProperties: false,
};

export function createLiveTools(matches: MatchesService, details: MatchDetailService): AiTool[] {
  const getLiveMatches: AiTool<Record<string, never>> = {
    definition: {
      name: 'get_live_matches',
      description: 'Matches in play right now with scores and match ids.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    parse: () => ({}),
    run: async () => summarizeLive(await matches.getLive()),
    label: () => 'Live matches',
  };

  const getMatch: AiTool<{ matchId: string }> = {
    definition: {
      name: 'get_match',
      description: 'Current score, status, batsmen, bowler, target and required rate for one match.',
      parameters: matchIdSchema,
    },
    parse: (raw) => {
      const matchId = parseMatchId(raw.matchId);
      return matchId ? { matchId } : 'matchId must be a numeric id';
    },
    run: async ({ matchId }) => summarizeMatch(await matches.getMatch(matchId)),
    label: ({ matchId }) => `Match ${matchId}`,
  };

  const getScorecard: AiTool<{ matchId: string }> = {
    definition: {
      name: 'get_scorecard',
      description: 'Full batting and bowling scorecard for every innings of one match.',
      parameters: matchIdSchema,
    },
    parse: getMatch.parse,
    run: async ({ matchId }) => summarizeScorecard(await details.getScorecard(matchId)),
    label: ({ matchId }) => `Scorecard ${matchId}`,
  };

  const getCommentary: AiTool<{ matchId: string; limit: number }> = {
    definition: {
      name: 'get_recent_commentary',
      description: 'Latest balls of one match (newest first). Use for "last over" or "what just happened".',
      parameters: {
        type: 'object',
        properties: {
          matchId: { type: 'string', description: 'Numeric match id.' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_COMMENTARY, description: 'Number of balls, default 12.' },
        },
        required: ['matchId'],
        additionalProperties: false,
      },
    },
    parse: (raw) => {
      const matchId = parseMatchId(raw.matchId);
      if (!matchId) return 'matchId must be a numeric id';
      const limit = raw.limit === undefined ? 12 : parseIntInRange(raw.limit, 1, MAX_COMMENTARY);
      return limit === null ? `limit must be an integer from 1 to ${MAX_COMMENTARY}` : { matchId, limit };
    },
    run: async ({ matchId, limit }) => summarizeCommentary(await details.getCommentary(matchId, limit), limit),
    label: ({ matchId }) => `Commentary ${matchId}`,
  };

  return [getLiveMatches, getMatch, getScorecard, getCommentary] as AiTool[];
}
