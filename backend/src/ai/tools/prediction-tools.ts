import type { FeedsService } from '../../feeds/feeds.service';
import type { HistoryFormat, HistoryQueryService } from '../../history/history-query.service';
import type { IdentityService } from '../../identity/identity.service';
import type { MatchDto } from '../../matches/dto/match.dto';
import type { MatchesService } from '../../matches/matches.service';
import { AiTool, parseIntInRange, parseMatchId } from './ai-tool.types';
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

export type RateSignal = { source: string; rate: number; weight: number };

/**
 * Blend weighted run-rate signals into a next-N-overs band.
 * More history signals → slightly tighter band; live-only → ±15%.
 */
export function blendNextOversEstimate(input: {
  team: string | null;
  score: number | null;
  overs: number | null;
  oversAhead: number;
  signals: RateSignal[];
}) {
  if (input.oversAhead <= 0 || input.signals.length === 0) {
    return {
      available: false as const,
      team: input.team,
      oversAhead: input.oversAhead,
      signals: input.signals,
      note: 'Need at least one run-rate signal (live RR or history) to estimate the next overs.',
    };
  }
  const weightSum = input.signals.reduce((s, x) => s + x.weight, 0);
  const blendedRate =
    weightSum > 0
      ? Math.round((input.signals.reduce((s, x) => s + x.rate * x.weight, 0) / weightSum) * 100) / 100
      : null;
  if (blendedRate === null || blendedRate <= 0) {
    return {
      available: false as const,
      team: input.team,
      oversAhead: input.oversAhead,
      signals: input.signals,
      note: 'Could not blend run-rate signals.',
    };
  }
  const mid = Math.round(blendedRate * input.oversAhead);
  const historySignals = input.signals.filter((s) => s.source !== 'live_rr' && s.source !== 'recent_overs').length;
  const spread = historySignals >= 2 ? 0.1 : historySignals === 1 ? 0.12 : 0.15;
  const low = Math.max(0, Math.round(mid * (1 - spread)));
  const high = Math.round(mid * (1 + spread));
  return {
    available: true as const,
    team: input.team,
    currentScore: input.score,
    currentOvers: input.overs,
    blendedRunRate: blendedRate,
    oversAhead: input.oversAhead,
    estimatedRunsLow: low,
    estimatedRunsMid: mid,
    estimatedRunsHigh: high,
    rangeText: `${low}-${high}`,
    signals: input.signals,
    note: `${ESTIMATE_NOTE} Blended live + archive signals (weights in "signals"). Not a trained ML model.`,
  };
}

/** Estimate runs in the next N overs from current run rate only (fallback band). */
export function projectNextOvers(input: {
  team: string | null;
  score: number | null;
  overs: number | null;
  runRate: number | null;
  oversAhead: number;
}) {
  const ballsBowled = oversToBalls(input.overs ?? 0) ?? 0;
  const score = input.score ?? 0;
  const rate =
    input.runRate !== null && input.runRate !== undefined && input.runRate > 0
      ? input.runRate
      : ballsBowled > 0
        ? Math.round((score / ballsBowled) * 6 * 100) / 100
        : null;
  if (rate === null) {
    return {
      available: false as const,
      team: input.team,
      oversAhead: input.oversAhead,
      signals: [] as RateSignal[],
      note: 'Need a current run rate (live innings in progress) to estimate the next overs.',
    };
  }
  return blendNextOversEstimate({
    team: input.team,
    score,
    overs: input.overs,
    oversAhead: input.oversAhead,
    signals: [{ source: 'live_rr', rate, weight: 1 }],
  });
}

/** Average runs in the last few completed overs from Latiyal matchOverHistory (best-effort). */
export function recentOversRunRate(data: unknown, lastN = 3): number | null {
  const root = asRecord(data);
  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(root?.data)
      ? (root!.data as unknown[])
      : Array.isArray(root?.overs)
        ? (root!.overs as unknown[])
        : Array.isArray(root?.history)
          ? (root!.history as unknown[])
          : [];
  const runs: number[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const r = num(row.runs ?? row.total_runs ?? row.run ?? row.score ?? row.over_runs ?? row.runs_scored);
    if (r !== null && r >= 0 && r <= 36) runs.push(r);
  }
  if (runs.length === 0) return null;
  const slice = runs.slice(-Math.max(1, lastN));
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  return Math.round(avg * 100) / 100;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Strike rate (runs/100 balls) → runs per over. */
export function strikeRateToRunRate(strikeRate: number | null | undefined): number | null {
  if (strikeRate === null || strikeRate === undefined || !Number.isFinite(strikeRate) || strikeRate <= 0) return null;
  return Math.round((strikeRate / 100) * 6 * 100) / 100;
}

/**
 * Best-effort extract of Latiyal liveMatch "prediction" / favourite fields.
 * Shapes vary; we keep whatever is readable as context (not a run-rate signal).
 */
export function parseLiveMatchPrediction(data: unknown, match: MatchDto): {
  available: boolean;
  favouriteTeam: string | null;
  teams: Array<{ team: string; probabilityPercent: number }>;
  projectedScore: number | null;
  note: string | null;
} {
  const empty = {
    available: false,
    favouriteTeam: null as string | null,
    teams: [] as Array<{ team: string; probabilityPercent: number }>,
    projectedScore: null as number | null,
    note: null as string | null,
  };
  const root = asRecord(data);
  if (!root) return empty;
  const nested = asRecord(root.prediction ?? root.predictions ?? root.predict ?? root.fav ?? root.favourite);
  const src = nested ?? root;

  const favName =
    (typeof src.fav_team === 'string' && src.fav_team.trim()) ||
    (typeof src.favourite === 'string' && src.favourite.trim()) ||
    (typeof src.favorite === 'string' && src.favorite.trim()) ||
    (typeof src.fav_team_name === 'string' && src.fav_team_name.trim()) ||
    null;
  const favId = num(src.fav_team_id ?? src.favourite_team_id ?? src.favorite_team_id);
  const favouriteTeam = favName ?? (favId !== null ? teamName(match, favId) : null);

  const teams: Array<{ team: string; probabilityPercent: number }> = [];
  const p1 = num(src.team_a_per ?? src.team_a_win ?? src.team1_prob ?? src.teama_win ?? src.a_win ?? src.win_team_a);
  const p2 = num(src.team_b_per ?? src.team_b_win ?? src.team2_prob ?? src.teamb_win ?? src.b_win ?? src.win_team_b);
  if (p1 !== null && p2 !== null) {
    const n1 = p1 > 1 ? p1 : p1 * 100;
    const n2 = p2 > 1 ? p2 : p2 * 100;
    teams.push(
      { team: match.localTeam.name ?? 'Team A', probabilityPercent: Math.round(n1 * 10) / 10 },
      { team: match.visitorTeam.name ?? 'Team B', probabilityPercent: Math.round(n2 * 10) / 10 },
    );
  }
  const projectedScore = num(src.projected_score ?? src.project_score ?? src.predicted_score ?? src.s_score ?? src.exp_score);

  if (!favouriteTeam && teams.length === 0 && projectedScore === null) return empty;
  return {
    available: true,
    favouriteTeam,
    teams,
    projectedScore,
    note: ESTIMATE_NOTE + ' Source: Latiyal liveMatch prediction fields (when present).',
  };
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
    return empty('null', 'Latiyal has no win-probability data for this match yet.');
  }

  if (Array.isArray(data) && data.length === 0) {
    return empty('empty_array', 'Latiyal has no win-probability points for this match (feed returned empty).');
  }

  const root = asRecord(data);
  const nested = root
    ? (root.data ?? root.history ?? root.probabilities ?? root.prob ?? root.result ?? root.list ?? root.items)
    : null;
  let list: unknown[] | null = Array.isArray(data) ? data : Array.isArray(nested) ? nested : null;

  if (!list && root) {
    const t1 = num(
      root.team1_prob ?? root.team1Prob ?? root.local_prob ?? root.home_prob ?? root.team1 ?? root.teama_win ?? root.teamA,
    );
    const t2 = num(
      root.team2_prob ?? root.team2Prob ?? root.visitor_prob ?? root.away_prob ?? root.team2 ?? root.teamb_win ?? root.teamB,
    );
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
    // Flatten one level of nested objects that look like { teamA: { win: 55 }, ... }.
    for (const value of Object.values(root)) {
      const rec = asRecord(value);
      if (!rec) continue;
      const nestedT1 = num(rec.team1_prob ?? rec.win ?? rec.probability ?? rec.percent);
      if (nestedT1 !== null && pickTeamLabel(rec, match)) {
        list = Object.values(root);
        break;
      }
    }
  }

  // History series: take the latest point that has team probs.
  if (list && list.length > 0) {
    const last = list[list.length - 1];
    const lastRec = asRecord(last);
    if (lastRec && (Array.isArray(lastRec.teams) || Array.isArray(lastRec.probabilities))) {
      list = (lastRec.teams ?? lastRec.probabilities) as unknown[];
    } else if (lastRec) {
      // Many feeds store a time series of { t1: n, t2: n } — use the last point.
      const t1 = num(lastRec.team1_prob ?? lastRec.team1 ?? lastRec.teama ?? lastRec.a ?? lastRec.prob1);
      const t2 = num(lastRec.team2_prob ?? lastRec.team2 ?? lastRec.teamb ?? lastRec.b ?? lastRec.prob2);
      if (t1 !== null && t2 !== null) {
        const p1 = t1 > 1 ? t1 : t1 * 100;
        const p2 = t2 > 1 ? t2 : t2 * 100;
        return {
          available: true,
          teams: [
            { team: match.localTeam.name ?? 'Team 1', probabilityPercent: Math.round(p1 * 10) / 10 },
            { team: match.visitorTeam.name ?? 'Team 2', probabilityPercent: Math.round(p2 * 10) / 10 },
          ],
          note: ESTIMATE_NOTE + ' Source: Latiyal matchProbHistory (latest point).',
          rawShape: 'series_pair',
        };
      }
    }
  }

  if (!list || list.length === 0) {
    return empty(typeof data, 'Latiyal has no usable win-probability figures for this match.');
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
    return empty('array', 'Latiyal win-probability rows were present but no team/percentage fields matched.');
  }

  return {
    available: true,
    teams,
    note: ESTIMATE_NOTE + ' Source: Latiyal matchProbHistory (latest point).',
    rawShape: 'array',
  };
}

export type PredictionToolOptions = {
  history?: HistoryQueryService | null;
  identity?: IdentityService | null;
};

async function collectNextOversSignals(
  match: MatchDto,
  feeds: FeedsService,
  matchId: string,
  opts: PredictionToolOptions,
): Promise<{ signals: RateSignal[]; context: Record<string, unknown> }> {
  const signals: RateSignal[] = [];
  const context: Record<string, unknown> = {
    batsmen: match.batsmen.map((b) => ({ name: b.name, runs: b.runs, balls: b.balls, strikeRate: b.strikeRate })),
    bowler: match.bowler
      ? { name: match.bowler.name, overs: match.bowler.overs, runs: match.bowler.runs, wickets: match.bowler.wickets, economy: match.bowler.economy }
      : null,
    venue: match.venue,
  };

  const ballsBowled = oversToBalls(match.overs ?? 0) ?? 0;
  const score = match.score ?? 0;
  const liveRate =
    match.runRate !== null && match.runRate !== undefined && match.runRate > 0
      ? match.runRate
      : ballsBowled > 0
        ? Math.round((score / ballsBowled) * 6 * 100) / 100
        : null;
  if (liveRate !== null && liveRate > 0) {
    signals.push({ source: 'live_rr', rate: liveRate, weight: 1 });
  }

  const striker = match.batsmen[0];
  const strikerRr = strikeRateToRunRate(striker?.strikeRate ?? null);
  if (strikerRr !== null && strikerRr > 0) {
    signals.push({ source: 'striker_sr', rate: strikerRr, weight: 0.45 });
  }

  try {
    const overFeed = await feeds.get('matchOverHistory', { match_id: matchId });
    const recent = recentOversRunRate(overFeed.data, 3);
    if (recent !== null && recent > 0) {
      signals.push({ source: 'recent_overs', rate: recent, weight: 0.9 });
      context.recentOversRate = recent;
    }
  } catch {
    /* optional feed */
  }

  let livePrediction: ReturnType<typeof parseLiveMatchPrediction> | null = null;
  try {
    const liveFeed = await feeds.get('liveMatch', { match_id: matchId });
    livePrediction = parseLiveMatchPrediction(liveFeed.data, match);
    if (livePrediction.available) context.latiyalLivePrediction = livePrediction;
  } catch {
    /* optional */
  }

  let winProb: ReturnType<typeof parseMatchProbHistory> | null = null;
  try {
    const probFeed = await feeds.get('matchProbHistory', { match_id: matchId });
    winProb = parseMatchProbHistory(probFeed.data, match);
    if (winProb.available) context.latiyalWinProbability = winProb.teams;
  } catch {
    /* optional */
  }
  if (!winProb?.available && livePrediction?.teams.length) {
    context.latiyalWinProbability = livePrediction.teams;
  }

  const history = opts.history;
  const identity = opts.identity;
  if (history && identity) {
    const format = formatOf(match.matchType) as HistoryFormat | null;
    let venueIds: number[] = [];
    if (match.venue?.name) {
      venueIds = await identity.confirmedVenuesFor(match.venue.name, match.venue.city);
      context.venueMapped = venueIds.length > 0;
    }

    const batterId = striker?.sportmonksId ? await identity.confirmedPersonFor(striker.sportmonksId) : null;
    const bowlerId = match.bowler?.sportmonksId ? await identity.confirmedPersonFor(match.bowler.sportmonksId) : null;
    context.batterMapped = Boolean(batterId);
    context.bowlerMapped = Boolean(bowlerId);
    if (striker) context.batterName = striker.name;
    if (match.bowler) context.bowlerName = match.bowler.name;

    if (batterId && venueIds.length > 0) {
      const venueRates = await history.playerVenueRates(batterId, venueIds, format);
      if (venueRates.battingRunRate !== null && venueRates.battingInnings >= 2) {
        signals.push({ source: 'batter_venue', rate: venueRates.battingRunRate, weight: 0.7 });
        context.batterVenue = venueRates;
      }
    }
    if (bowlerId && venueIds.length > 0) {
      const bowlVenue = await history.playerVenueRates(bowlerId, venueIds, format);
      if (bowlVenue.bowlingEconomy !== null && bowlVenue.bowlingInnings >= 2) {
        signals.push({ source: 'bowler_venue', rate: bowlVenue.bowlingEconomy, weight: 0.5 });
        context.bowlerVenue = bowlVenue;
      }
    }
    if (batterId && bowlerId) {
      const matchup = await history.batterVsBowlerRate(batterId, bowlerId, format);
      if (matchup.runRate !== null && matchup.balls >= 12) {
        signals.push({ source: 'batter_vs_bowler', rate: matchup.runRate, weight: 0.8 });
        context.batterVsBowler = matchup;
      }
    }
  } else {
    context.historyBlend = 'skipped (history/identity not wired or AI_HISTORY_ENABLED off)';
  }

  return { signals, context };
}

export function createPredictionTools(
  matches: MatchesService,
  feeds: FeedsService,
  opts: PredictionToolOptions = {},
): AiTool[] {
  const getWinProbability: AiTool<{ matchId: string }> = {
    definition: {
      name: 'get_win_probability',
      description:
        'Current win-chance estimate for each team in a live match from Latiyal matchProbHistory ' +
        '(and liveMatch prediction fields when present). Always describe as an estimate, never as certain.',
      parameters: matchIdSchema,
    },
    parse: (raw) => {
      const matchId = parseMatchId(raw.matchId);
      return matchId ? { matchId } : 'matchId must be a numeric id';
    },
    run: async ({ matchId }) => {
      const match = await matches.getMatch(matchId);
      let stale = false;
      try {
        const feed = await feeds.get('matchProbHistory', { match_id: matchId });
        stale = feed.stale;
        const parsed = parseMatchProbHistory(feed.data, match);
        if (parsed.available) {
          return {
            matchId,
            matchTeams: [match.localTeam.name, match.visitorTeam.name],
            isLive: match.isLive,
            stale: feed.stale,
            ...parsed,
            message: feed.message,
          };
        }
      } catch {
        /* fall through to liveMatch prediction */
      }
      try {
        const live = await feeds.get('liveMatch', { match_id: matchId });
        const fromLive = parseLiveMatchPrediction(live.data, match);
        if (fromLive.available && fromLive.teams.length > 0) {
          return {
            matchId,
            matchTeams: [match.localTeam.name, match.visitorTeam.name],
            isLive: match.isLive,
            stale: live.stale || stale,
            available: true,
            teams: fromLive.teams,
            favouriteTeam: fromLive.favouriteTeam,
            note: fromLive.note,
            rawShape: 'liveMatch_prediction',
          };
        }
      } catch {
        /* ignore */
      }
      return {
        matchId,
        available: false,
        teams: [],
        note: 'Win-probability / prediction is temporarily unavailable for this match.',
        rawShape: 'unavailable',
      };
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

  const projectNextOversTool: AiTool<{ matchId: string; overs: number }> = {
    definition: {
      name: 'project_next_overs',
      description:
        'Estimate how many runs the batting side may score in the next N overs (e.g. "how many runs in next 6 overs"). ' +
        'Blends live run rate, recent overs, batter@venue / bowler economy / batter-vs-bowler from the Cricsheet archive when identity maps exist, ' +
        'and includes Latiyal live prediction / win% as context. Returns a low–mid–high band. Say it is an estimate, not certain.',
      parameters: {
        type: 'object',
        properties: {
          matchId: { type: 'string', description: 'Numeric match id.' },
          overs: { type: 'integer', minimum: 1, maximum: 20, description: 'How many upcoming overs to estimate (default 6).' },
        },
        required: ['matchId'],
        additionalProperties: false,
      },
    },
    parse: (raw) => {
      const matchId = parseMatchId(raw.matchId);
      if (!matchId) return 'matchId must be a numeric id';
      const overs = raw.overs === undefined ? 6 : parseIntInRange(raw.overs, 1, 20);
      if (overs === null) return 'overs must be an integer from 1 to 20';
      return { matchId, overs };
    },
    run: async ({ matchId, overs }) => {
      const match = await matches.getMatch(matchId);
      const summary = summarizeMatch(match);
      const team = summary.current?.battingTeam ?? teamName(match, match.battingTeamSportmonksId);
      const { signals, context } = await collectNextOversSignals(match, feeds, matchId, opts);
      const estimate =
        signals.length > 0
          ? blendNextOversEstimate({
              team,
              score: match.score,
              overs: match.overs,
              oversAhead: overs,
              signals,
            })
          : projectNextOvers({
              team,
              score: match.score,
              overs: match.overs,
              runRate: match.runRate,
              oversAhead: overs,
            });
      return {
        matchId,
        matchType: match.matchType,
        isLive: match.isLive,
        ...estimate,
        context,
      };
    },
    label: ({ matchId, overs }) => `Next ${overs} overs ${matchId}`,
  };

  return [getWinProbability, projectScore, projectNextOversTool] as AiTool[];
}
