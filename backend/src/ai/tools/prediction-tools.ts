import type { FeedsService } from '../../feeds/feeds.service';
import type { MatchDto } from '../../matches/dto/match.dto';
import type { MatchesService } from '../../matches/matches.service';
import { AiTool, parseMatchId } from './ai-tool.types';
import { oversToBalls } from './calculator-tools';
import { formatOf } from './history-tools';
import { summarizeMatch } from './live-tools';

const ESTIMATE_NOTE = 'Estimate only — not a guarantee. Do not treat this as betting advice.';

const matchIdSchema = {
  type: 'object',
  properties: { matchId: { type: 'string', description: 'Numeric match id, e.g. "61521".' } },
  required: ['matchId'],
  additionalProperties: false,
};

function teamName(match: MatchDto, sportmonksId: number | null): string | null {
  if (sportmonksId === null) return null;
  if (match.localTeam.sportmonksId === sportmonksId) return match.localTeam.name;
  if (match.visitorTeam.sportmonksId === sportmonksId) return match.visitorTeam.name;
  return null;
}

/** Overs limit for limited-overs formats; null for Tests / unknown. */
export function oversLimitFor(matchType: string | null): number | null {
  const format = formatOf(matchType);
  if (format === 'T20') return 20;
  if (format === 'ODI') return 50;
  return null;
}

/** Project remaining innings total from current run rate (arithmetic). */
export function projectInningsScore(input: {
  team: string | null;
  score: number | null;
  overs: number | null;
  runRate: number | null;
  oversLimit: number | null;
  wickets: number | null;
}) {
  const score = input.score ?? 0;
  const ballsBowled = oversToBalls(input.overs ?? 0) ?? 0;
  const rate =
    input.runRate !== null && input.runRate !== undefined && input.runRate > 0
      ? input.runRate
      : ballsBowled > 0
        ? Math.round((score / ballsBowled) * 6 * 100) / 100
        : null;
  if (rate === null || input.oversLimit === null) {
    return {
      available: false as const,
      team: input.team,
      score,
      overs: input.overs,
      wickets: input.wickets,
      note: 'Need a limited-overs innings with a measurable run rate to project a score.',
    };
  }
  const ballsLimit = input.oversLimit * 6;
  const ballsLeft = Math.max(0, ballsLimit - ballsBowled);
  if (ballsLeft <= 0 || (input.wickets !== null && input.wickets >= 10)) {
    return {
      available: true as const,
      team: input.team,
      currentScore: score,
      overs: input.overs,
      wickets: input.wickets,
      projectedScore: score,
      runRate: rate,
      oversRemaining: '0.0',
      note: `${ESTIMATE_NOTE} Innings appears complete.`,
    };
  }
  const projected = Math.round(score + (rate * ballsLeft) / 6);
  return {
    available: true as const,
    team: input.team,
    currentScore: score,
    overs: input.overs,
    wickets: input.wickets,
    projectedScore: projected,
    runRate: rate,
    oversRemaining: `${Math.floor(ballsLeft / 6)}.${ballsLeft % 6}`,
    oversLimit: input.oversLimit,
    note: `${ESTIMATE_NOTE} Projected from current run rate × overs remaining (six-ball overs).`,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function pickTeamLabel(row: Record<string, unknown>, match: MatchDto): string | null {
  const byId = num(row.team_id ?? row.teamId ?? row.team_sportmonks_id ?? row.sportmonksId);
  if (byId !== null) return teamName(match, byId);
  for (const key of ['team', 'team_name', 'teamName', 'name'] as const) {
    if (typeof row[key] === 'string' && row[key].trim()) return (row[key] as string).trim();
  }
  return null;
}

function pickProb(row: Record<string, unknown>): number | null {
  for (const key of ['probability', 'prob', 'win_prob', 'winProb', 'percent', 'percentage', 'value'] as const) {
    const n = num(row[key]);
    if (n === null) continue;
    return n > 1 && n <= 100 ? Math.round(n * 10) / 10 : Math.round(n * 1000) / 10;
  }
  return null;
}

/**
 * Best-effort parse of Latiyal matchProbHistory payloads.
 * Accepts arrays of team/prob rows, { data: [...] }, or objects with team1/team2 probs.
 */
export function parseMatchProbHistory(data: unknown, match: MatchDto): {
  available: boolean;
  teams: Array<{ team: string; probabilityPercent: number }>;
  note: string;
  rawShape: string;
} {
  const empty = (rawShape: string, reason: string) => ({
    available: false,
    teams: [] as Array<{ team: string; probabilityPercent: number }>,
    note: reason,
    rawShape,
  });

  if (data === null || data === undefined) {
    return empty('null', 'Latiyal matchProbHistory returned no data for this match.');
  }

  const root = asRecord(data);
  const nested = root ? (root.data ?? root.history ?? root.probabilities ?? root.prob ?? root.result) : null;
  let list: unknown[] | null = Array.isArray(data) ? data : Array.isArray(nested) ? nested : null;

  if (!list && root) {
    const t1 = num(root.team1_prob ?? root.team1Prob ?? root.local_prob ?? root.home_prob);
    const t2 = num(root.team2_prob ?? root.team2Prob ?? root.visitor_prob ?? root.away_prob);
    if (t1 !== null && t2 !== null) {
      const p1 = t1 > 1 ? t1 : t1 * 100;
      const p2 = t2 > 1 ? t2 : t2 * 100;
      return {
        available: true,
        teams: [
          { team: match.localTeam.name ?? 'Team 1', probabilityPercent: Math.round(p1 * 10) / 10 },
          { team: match.visitorTeam.name ?? 'Team 2', probabilityPercent: Math.round(p2 * 10) / 10 },
        ],
        note: ESTIMATE_NOTE + ' Source: Latiyal matchProbHistory.',
        rawShape: 'object_pair',
      };
    }
  }

  // History series: take the latest point that has team probs.
  if (list && list.length > 0) {
    const last = list[list.length - 1];
    const lastRec = asRecord(last);
    if (lastRec && (Array.isArray(lastRec.teams) || Array.isArray(lastRec.probabilities))) {
      list = (lastRec.teams ?? lastRec.probabilities) as unknown[];
    }
  }

  if (!list || list.length === 0) {
    return empty(typeof data, 'Could not parse win probabilities from matchProbHistory for this match.');
  }

  const teams: Array<{ team: string; probabilityPercent: number }> = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const team = pickTeamLabel(row, match);
    const probabilityPercent = pickProb(row);
    if (team && probabilityPercent !== null) teams.push({ team, probabilityPercent });
  }

  if (teams.length === 0) {
    return empty('array', 'matchProbHistory had rows but no team/probability fields we recognise.');
  }

  return {
    available: true,
    teams,
    note: ESTIMATE_NOTE + ' Source: Latiyal matchProbHistory (latest point).',
    rawShape: 'array',
  };
}

export function createPredictionTools(matches: MatchesService, feeds: FeedsService): AiTool[] {
  const getWinProbability: AiTool<{ matchId: string }> = {
    definition: {
      name: 'get_win_probability',
      description:
        'Current win-chance estimate for each team in a live match from Latiyal matchProbHistory. ' +
        'Always describe the numbers as an estimate, never as certain. Unavailable when the feed is empty.',
      parameters: matchIdSchema,
    },
    parse: (raw) => {
      const matchId = parseMatchId(raw.matchId);
      return matchId ? { matchId } : 'matchId must be a numeric id';
    },
    run: async ({ matchId }) => {
      const match = await matches.getMatch(matchId);
      try {
        const feed = await feeds.get('matchProbHistory', { match_id: matchId });
        const parsed = parseMatchProbHistory(feed.data, match);
        return {
          matchId,
          matchTeams: [match.localTeam.name, match.visitorTeam.name],
          isLive: match.isLive,
          stale: feed.stale,
          ...parsed,
          message: feed.message,
        };
      } catch {
        return {
          matchId,
          available: false,
          teams: [],
          note: 'Win-probability feed is temporarily unavailable for this match.',
          rawShape: 'error',
        };
      }
    },
    label: ({ matchId }) => `Win probability ${matchId}`,
  };

  const projectScore: AiTool<{ matchId: string }> = {
    definition: {
      name: 'project_score',
      description:
        'Projected innings total for the batting side from current run rate and overs remaining (limited overs only). ' +
        'Arithmetic estimate — not a guarantee.',
      parameters: matchIdSchema,
    },
    parse: getWinProbability.parse,
    run: async ({ matchId }) => {
      const match = await matches.getMatch(matchId);
      const summary = summarizeMatch(match);
      const limit = oversLimitFor(match.matchType);
      const projection = projectInningsScore({
        team: summary.current?.battingTeam ?? teamName(match, match.battingTeamSportmonksId),
        score: match.score,
        overs: match.overs,
        runRate: match.runRate,
        oversLimit: limit,
        wickets: match.wickets,
      });
      return {
        matchId,
        matchType: match.matchType,
        isLive: match.isLive,
        target: match.target,
        runsRequired: match.runsRequired,
        ...projection,
      };
    },
    label: ({ matchId }) => `Projected score ${matchId}`,
  };

  return [getWinProbability, projectScore] as AiTool[];
}
