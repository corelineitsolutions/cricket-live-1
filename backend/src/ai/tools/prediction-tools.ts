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

/** Latiyal team-comparison APIs use numeric match_type (same family as H2H samples). */
export function latiyalTeamMatchTypeParam(matchType: string | null): string {
  const t = (matchType ?? '').toUpperCase();
  if (/TEST|5.?DAY|FC|FIRST.?CLASS|MDM/.test(t)) return '3';
  if (/ODI|LIST.?A|ONE.?DAY|ODM/.test(t)) return '2';
  return '1'; // T20 / IT20 / T10 / default
}

/** Overs limit for limited-overs formats; null for Tests / unknown. */
export function oversLimitFor(matchType: string | null): number | null {
  const format = formatOf(matchType);
  if (format === 'T20') return 20;
  if (format === 'ODI') return 50;
  const raw = (matchType ?? '').toLowerCase();
  // Latiyal / feed variants not covered by formatOf.
  if (/\b50\b|one[\s-]?day|\bodi\b|list\s*a/.test(raw)) return 50;
  if (/\b20\b|t20|it20|t10/.test(raw)) return /t10/.test(raw) ? 10 : 20;
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
  const early = ballsBowled < 30; // fewer than 5 overs — RR is unstable
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
    earlyInnings: early,
    note: early
      ? `${ESTIMATE_NOTE} Very early innings — projection from current RR is unstable.`
      : `${ESTIMATE_NOTE} Projected from current run rate × overs remaining (six-ball overs).`,
  };
}

export type RateSignal = { source: string; rate: number; weight: number };

const LIVE_SOURCES = new Set(['live_rr', 'recent_overs']);

/**
 * Blend weighted run-rate signals into a next-N-overs band.
 * Live RR / recent overs are the anchor; archive signals only nudge within ±40% of that
 * anchor and never dominate the weight (so a T20 powerplay RR ~12 cannot collapse to ~4).
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

  const liveSignals = input.signals.filter((s) => LIVE_SOURCES.has(s.source) && s.rate > 0);
  const liveAnchor =
    liveSignals.length > 0
      ? liveSignals.reduce((s, x) => s + x.rate * x.weight, 0) / liveSignals.reduce((s, x) => s + x.weight, 0)
      : null;

  const normalized: RateSignal[] = input.signals
    .filter((s) => s.rate > 0 && s.weight > 0)
    .map((s) => {
      if (!liveAnchor || LIVE_SOURCES.has(s.source)) return s;
      // Archive / striker signals may only nudge; clamp to 60–140% of live form.
      const lo = liveAnchor * 0.6;
      const hi = liveAnchor * 1.4;
      const rate = Math.min(hi, Math.max(lo, s.rate));
      return { ...s, rate: Math.round(rate * 100) / 100 };
    });

  // Keep live share ≥ 65% whenever a live anchor exists.
  if (liveAnchor !== null) {
    const liveWeight = normalized.filter((s) => LIVE_SOURCES.has(s.source)).reduce((s, x) => s + x.weight, 0);
    const otherWeight = normalized.filter((s) => !LIVE_SOURCES.has(s.source)).reduce((s, x) => s + x.weight, 0);
    if (liveWeight > 0 && otherWeight > 0) {
      const targetOther = liveWeight * (0.35 / 0.65);
      const scale = targetOther / otherWeight;
      for (const s of normalized) {
        if (!LIVE_SOURCES.has(s.source)) s.weight = Math.round(s.weight * scale * 1000) / 1000;
      }
    }
  }

  const weightSum = normalized.reduce((s, x) => s + x.weight, 0);
  const blendedRate =
    weightSum > 0
      ? Math.round((normalized.reduce((s, x) => s + x.rate * x.weight, 0) / weightSum) * 100) / 100
      : null;
  if (blendedRate === null || blendedRate <= 0) {
    return {
      available: false as const,
      team: input.team,
      oversAhead: input.oversAhead,
      signals: normalized,
      note: 'Could not blend run-rate signals.',
    };
  }
  const mid = Math.round(blendedRate * input.oversAhead);
  const historySignals = normalized.filter((s) => !LIVE_SOURCES.has(s.source)).length;
  const spread = historySignals >= 2 ? 0.12 : historySignals === 1 ? 0.14 : 0.15;
  const low = Math.max(0, Math.round(mid * (1 - spread)));
  const high = Math.round(mid * (1 + spread));
  return {
    available: true as const,
    team: input.team,
    currentScore: input.score,
    currentOvers: input.overs,
    blendedRunRate: blendedRate,
    liveRunRate: liveAnchor !== null ? Math.round(liveAnchor * 100) / 100 : null,
    oversAhead: input.oversAhead,
    estimatedRunsLow: low,
    estimatedRunsMid: mid,
    estimatedRunsHigh: high,
    rangeText: `${low}-${high}`,
    signals: normalized,
    note: `${ESTIMATE_NOTE} Live RR is the anchor; archive only nudges. Not a trained ML model.`,
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

/** Flatten over-by-over rows from Latiyal matchOverHistory (best-effort). */
export function listOverHistoryRows(data: unknown): Array<Record<string, unknown>> {
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
  return list.map(asRecord).filter((row): row is Record<string, unknown> => row !== null);
}

function overNumberOf(row: Record<string, unknown>): number | null {
  const n = num(row.over ?? row.over_no ?? row.over_number ?? row.ov ?? row.overs ?? row.overNo);
  if (n === null) return null;
  // Some feeds use 0-based over index; cricket overs are 1..N.
  if (n >= 0 && n < 1) return 1;
  return Math.floor(n);
}

function overRunsOf(row: Record<string, unknown>): number | null {
  const r = num(row.runs ?? row.total_runs ?? row.run ?? row.score ?? row.over_runs ?? row.runs_scored);
  if (r === null || r < 0 || r > 36) return null;
  return r;
}

/** Average runs in the last few completed overs from Latiyal matchOverHistory (best-effort). */
export function recentOversRunRate(data: unknown, lastN = 3): number | null {
  const runs = listOverHistoryRows(data)
    .map(overRunsOf)
    .filter((r): r is number => r !== null);
  if (runs.length === 0) return null;
  const slice = runs.slice(-Math.max(1, lastN));
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  return Math.round(avg * 100) / 100;
}

/**
 * Sum runs in overs [1..toOver] from matchOverHistory.
 * Used for "first 6 overs / powerplay kitne run" on the LIVE innings (not archive).
 */
export function sumFirstOversRuns(
  data: unknown,
  toOver: number,
): {
  available: boolean;
  runs: number | null;
  oversCounted: number;
  oversRequested: number;
  complete: boolean;
  perOver: Array<{ over: number; runs: number }>;
  note: string | null;
} {
  const oversRequested = Math.max(1, Math.min(20, Math.floor(toOver)));
  const rows = listOverHistoryRows(data);
  const byOver = new Map<number, number>();
  let sequential = 0;
  for (const row of rows) {
    const runs = overRunsOf(row);
    if (runs === null) continue;
    const overNo = overNumberOf(row);
    if (overNo !== null && overNo >= 1 && overNo <= 50) {
      byOver.set(overNo, (byOver.get(overNo) ?? 0) + runs);
    } else {
      sequential += 1;
      if (sequential <= oversRequested) byOver.set(sequential, (byOver.get(sequential) ?? 0) + runs);
    }
  }
  const perOver: Array<{ over: number; runs: number }> = [];
  for (let o = 1; o <= oversRequested; o++) {
    if (byOver.has(o)) perOver.push({ over: o, runs: byOver.get(o)! });
  }
  if (perOver.length === 0) {
    return {
      available: false,
      runs: null,
      oversCounted: 0,
      oversRequested,
      complete: false,
      perOver: [],
      note: 'Over-by-over history not available yet for this innings.',
    };
  }
  const runs = perOver.reduce((s, x) => s + x.runs, 0);
  const complete = perOver.length >= oversRequested;
  return {
    available: true,
    runs,
    oversCounted: perOver.length,
    oversRequested,
    complete,
    perOver,
    note: complete
      ? null
      : `Only ${perOver.length} of ${oversRequested} overs completed so far — this is the live total through those overs, not a finished powerplay.`,
  };
}

/** Default powerplay length by format. */
export function powerplayOversFor(matchType: string | null): number {
  const limit = oversLimitFor(matchType);
  if (limit === 50) return 10;
  if (limit === 10) return 3;
  return 6; // T20 / default
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
 * Parse matchInfo / liveMatch for an already-completed toss.
 */
export function parseTossResult(data: unknown, match: MatchDto): {
  tossComplete: boolean;
  tossWinner: string | null;
  tossDecision: string | null;
} {
  const root = asRecord(data);
  if (!root) return { tossComplete: false, tossWinner: null, tossDecision: null };
  const nested = asRecord(root.toss ?? root.toss_info ?? root.match_info) ?? root;
  const winnerId = num(nested.toss_winner_id ?? nested.tossWinnerId ?? nested.toss_win_team_id);
  const winnerName =
    (typeof nested.toss_winner === 'string' && nested.toss_winner.trim()) ||
    (typeof nested.toss_win_team === 'string' && nested.toss_win_team.trim()) ||
    (typeof nested.tossWinner === 'string' && nested.tossWinner.trim()) ||
    (winnerId !== null ? teamName(match, winnerId) : null) ||
    null;
  const decision =
    (typeof nested.toss_decision === 'string' && nested.toss_decision.trim()) ||
    (typeof nested.decision === 'string' && nested.decision.trim()) ||
    (typeof nested.toss_choose === 'string' && nested.toss_choose.trim()) ||
    null;
  return {
    tossComplete: Boolean(winnerName),
    tossWinner: winnerName,
    tossDecision: decision,
  };
}

/**
 * Historical toss comparison between two teams (Latiyal tossComparisonByTeamId).
 * This is form/history — not a live "who will win tonight" guarantee.
 */
export function parseTossComparison(
  data: unknown,
  match: MatchDto,
): {
  available: boolean;
  teams: Array<{ team: string; tossWins: number | null; tossWinPercent: number | null }>;
  lean: string | null;
  note: string;
} {
  const empty = (note: string) => ({
    available: false,
    teams: [] as Array<{ team: string; tossWins: number | null; tossWinPercent: number | null }>,
    lean: null as string | null,
    note,
  });
  if (data === null || data === undefined) return empty('No toss-comparison data from Latiyal for these teams.');
  const root = asRecord(data);
  const nested = root ? (root.data ?? root.result ?? root.comparison ?? root.toss) : null;
  const src = asRecord(nested) ?? root;
  if (!src && !Array.isArray(data) && !Array.isArray(nested)) {
    return empty('Toss comparison payload was empty or unreadable.');
  }

  const teamA = match.localTeam.name ?? 'Team A';
  const teamB = match.visitorTeam.name ?? 'Team B';
  const readSide = (prefixes: string[]) => {
    let wins: number | null = null;
    let pct: number | null = null;
    const bag = src ?? {};
    for (const p of prefixes) {
      wins = wins ?? num(bag[`${p}_toss_win`] ?? bag[`${p}_toss_wins`] ?? bag[`${p}_win`] ?? bag[`${p}_wins`]);
      const rawPct = num(bag[`${p}_toss_per`] ?? bag[`${p}_toss_percent`] ?? bag[`${p}_per`] ?? bag[`${p}_percent`]);
      if (rawPct !== null) pct = rawPct > 1 ? Math.round(rawPct * 10) / 10 : Math.round(rawPct * 1000) / 10;
    }
    return { wins, pct };
  };

  let a = readSide(['team_a', 'teama', 'team1', 'a']);
  let b = readSide(['team_b', 'teamb', 'team2', 'b']);

  if (Array.isArray(nested) || Array.isArray(data)) {
    const list = (Array.isArray(nested) ? nested : data) as unknown[];
    for (const row of list) {
      const r = asRecord(row);
      if (!r) continue;
      const label = pickTeamLabel(r, match);
      const wins = num(r.toss_wins ?? r.toss_win ?? r.wins ?? r.won);
      const rawPct = num(r.toss_percent ?? r.percent ?? r.percentage ?? r.per);
      const pct = rawPct === null ? null : rawPct > 1 ? Math.round(rawPct * 10) / 10 : Math.round(rawPct * 1000) / 10;
      if (label && (label === teamA || label === match.localTeam.shortName)) a = { wins, pct };
      if (label && (label === teamB || label === match.visitorTeam.shortName)) b = { wins, pct };
      const id = num(r.team_id ?? r.teamId);
      if (id !== null && id === match.localTeam.sportmonksId) a = { wins, pct };
      if (id !== null && id === match.visitorTeam.sportmonksId) b = { wins, pct };
    }
  }

  if (a.wins === null && a.pct === null && b.wins === null && b.pct === null) {
    return empty('Toss comparison had no usable win counts or percentages.');
  }

  const teams = [
    { team: teamA, tossWins: a.wins, tossWinPercent: a.pct },
    { team: teamB, tossWins: b.wins, tossWinPercent: b.pct },
  ];
  let lean: string | null = null;
  if (a.pct !== null && b.pct !== null) lean = a.pct >= b.pct ? teamA : teamB;
  else if (a.wins !== null && b.wins !== null) lean = a.wins >= b.wins ? teamA : teamB;

  return {
    available: true,
    teams,
    lean,
    note:
      ESTIMATE_NOTE +
      ' Based on Latiyal toss comparison (historical toss form between these teams), not a live forecast of tonight\'s coin toss.',
  };
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
  nextBallsWindow: { balls: number; runs: number } | null;
  note: string | null;
} {
  const empty = {
    available: false,
    favouriteTeam: null as string | null,
    teams: [] as Array<{ team: string; probabilityPercent: number }>,
    projectedScore: null as number | null,
    nextBallsWindow: null as { balls: number; runs: number } | null,
    note: null as string | null,
  };
  const root = asRecord(data);
  if (!root) return empty;
  const nested = asRecord(root.prediction ?? root.predictions ?? root.predict ?? root.fav ?? root.favourite);
  const src = nested ?? root;

  const favNameRaw =
    (typeof src.fav_team === 'string' && src.fav_team.trim()) ||
    (typeof src.favourite === 'string' && src.favourite.trim()) ||
    (typeof src.favorite === 'string' && src.favorite.trim()) ||
    (typeof src.fav_team_name === 'string' && src.fav_team_name.trim()) ||
    null;
  const favId = num(src.fav_team_id ?? src.favourite_team_id ?? src.favorite_team_id);
  const favResolved = favNameRaw ?? (favId !== null ? teamName(match, favId) : null);
  // Never treat Draw/Tie/NR as a match favourite for "who will win".
  const favouriteTeam =
    favResolved && /^(the\s+)?(draw|tie|tied|nr|n\/?r|no\s*result|abandoned)$/i.test(favResolved.trim())
      ? null
      : favResolved;

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
  const projectedScore = num(
    src.projected_score ??
      src.project_score ??
      src.predicted_score ??
      src.predicted_total ??
      src.proj_score ??
      src.s_score ??
      src.exp_score ??
      src.expected_score ??
      src.twenty_over_score ??
      src.t20_score ??
      src.score_prediction ??
      src.s_team_score ??
      root?.projected_score ??
      root?.project_score ??
      root?.predicted_score,
  );

  // Optional session-style markets: "next 14 balls → 28 runs" style pairs when present.
  const nextBalls = num(src.next_balls ?? src.next_ball ?? src.balls_ahead ?? src.session_balls);
  const nextBallsRuns = num(
    src.next_balls_runs ?? src.next_ball_runs ?? src.session_runs ?? src.runs_in_balls ?? src.min_runs ?? src.max_runs,
  );

  if (!favouriteTeam && teams.length === 0 && projectedScore === null && nextBalls === null) return empty;
  return {
    available: true,
    favouriteTeam,
    teams,
    projectedScore,
    nextBallsWindow: nextBalls !== null && nextBallsRuns !== null ? { balls: nextBalls, runs: nextBallsRuns } : null,
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
    // Heaviest weight: what is happening in this innings right now.
    signals.push({ source: 'live_rr', rate: liveRate, weight: 2.2 });
  }
  context.liveRunRate = liveRate;
  context.liveScore = match.score;
  context.liveOvers = match.overs;

  const striker = match.batsmen[0];
  const strikerRr = strikeRateToRunRate(striker?.strikeRate ?? null);
  if (strikerRr !== null && strikerRr > 0) {
    signals.push({ source: 'striker_sr', rate: strikerRr, weight: 0.35 });
  }

  try {
    const overFeed = await feeds.get('matchOverHistory', { match_id: matchId });
    const recent = recentOversRunRate(overFeed.data, 3);
    if (recent !== null && recent > 0) {
      signals.push({ source: 'recent_overs', rate: recent, weight: 1.4 });
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
  const format = formatOf(match.matchType) as HistoryFormat | null;
  context.matchFormat = format;
  // Skip archive blend without a format — otherwise Test career rates (~3 RPO) poison a T20.
  if (history && identity && format && format !== 'Test') {
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
        signals.push({ source: 'batter_venue', rate: venueRates.battingRunRate, weight: 0.45 });
        context.batterVenue = venueRates;
      }
    }
    if (bowlerId && venueIds.length > 0) {
      const bowlVenue = await history.playerVenueRates(bowlerId, venueIds, format);
      if (bowlVenue.bowlingEconomy !== null && bowlVenue.bowlingInnings >= 2) {
        signals.push({ source: 'bowler_venue', rate: bowlVenue.bowlingEconomy, weight: 0.35 });
        context.bowlerVenue = bowlVenue;
      }
    }
    if (batterId && bowlerId) {
      const matchup = await history.batterVsBowlerRate(batterId, bowlerId, format);
      if (matchup.runRate !== null && matchup.balls >= 12) {
        signals.push({ source: 'batter_vs_bowler', rate: matchup.runRate, weight: 0.5 });
        context.batterVsBowler = matchup;
      }
    }
  } else if (!history || !identity) {
    context.historyBlend = 'skipped (history/identity not wired or AI_HISTORY_ENABLED off)';
  } else {
    context.historyBlend = format === 'Test' ? 'skipped for Test' : 'skipped (unknown match format)';
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
        'Who is favoured to win this match (live or upcoming). Uses Latiyal matchProbHistory, then liveMatch ' +
        'prediction fields. For "match kon jit sakta", "who will win", "win chance". Always an estimate, never certain. ' +
        'For toss questions use get_toss_prediction instead.',
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
            isFinished: match.isFinished,
            stale: feed.stale,
            kind: 'match_win',
            ...parsed,
            message: feed.message,
          };
        }
      } catch {
        /* fall through */
      }
      try {
        const live = await feeds.get('liveMatch', { match_id: matchId });
        const fromLive = parseLiveMatchPrediction(live.data, match);
        if (fromLive.available && (fromLive.teams.length > 0 || fromLive.favouriteTeam)) {
          return {
            matchId,
            matchTeams: [match.localTeam.name, match.visitorTeam.name],
            isLive: match.isLive,
            isFinished: match.isFinished,
            stale: live.stale || stale,
            available: true,
            kind: 'match_win',
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
        matchTeams: [match.localTeam.name, match.visitorTeam.name],
        isLive: match.isLive,
        isFinished: match.isFinished,
        available: false,
        kind: 'match_win',
        teams: [],
        note:
          'Live win-probability / prediction is not available for this match yet (common before the match starts or if Latiyal has no fav%). Do not invent percentages.',
        rawShape: 'unavailable',
      };
    },
    label: ({ matchId }) => `Win probability ${matchId}`,
  };

  const getTossPrediction: AiTool<{ matchId: string }> = {
    definition: {
      name: 'get_toss_prediction',
      description:
        'Toss outlook for a match: if the toss is already done, return the winner; otherwise Latiyal ' +
        'tossComparisonByTeamId historical toss form. Use for "who will win the toss", "toss kon jit sakta". ' +
        'Never invent a coin-toss result. Always say historical form is an estimate only.',
      parameters: matchIdSchema,
    },
    parse: getWinProbability.parse,
    run: async ({ matchId }) => {
      const match = await matches.getMatch(matchId);
      const teams = [match.localTeam.name, match.visitorTeam.name];
      // 1) Already tossed?
      for (const endpoint of ['matchInfo', 'liveMatch'] as const) {
        try {
          const feed = await feeds.get(endpoint, { match_id: matchId });
          const tossed = parseTossResult(feed.data, match);
          if (tossed.tossComplete) {
            return {
              matchId,
              matchTeams: teams,
              available: true,
              kind: 'toss',
              tossComplete: true,
              tossWinner: tossed.tossWinner,
              tossDecision: tossed.tossDecision,
              teams: [],
              lean: tossed.tossWinner,
              note: 'Toss has already happened (from Latiyal match info / live feed).',
              stale: feed.stale,
              rawShape: endpoint,
            };
          }
        } catch {
          /* try next */
        }
      }
      // 2) Historical toss comparison between the two teams
      const aId = match.localTeam.sportmonksId;
      const bId = match.visitorTeam.sportmonksId;
      if (aId == null || bId == null) {
        return {
          matchId,
          matchTeams: teams,
          available: false,
          kind: 'toss',
          tossComplete: false,
          note: 'Cannot load toss comparison — team ids missing for this match.',
          teams: [],
          lean: null,
          rawShape: 'no_team_ids',
        };
      }
      try {
        const feed = await feeds.get('tossComparisonByTeamId', {
          team_a_id: String(aId),
          team_b_id: String(bId),
          match_type: latiyalTeamMatchTypeParam(match.matchType),
        });
        const parsed = parseTossComparison(feed.data, match);
        return {
          matchId,
          matchTeams: teams,
          kind: 'toss',
          tossComplete: false,
          tossWinner: null,
          tossDecision: null,
          stale: feed.stale,
          rawShape: 'tossComparisonByTeamId',
          ...parsed,
        };
      } catch {
        return {
          matchId,
          matchTeams: teams,
          available: false,
          kind: 'toss',
          tossComplete: false,
          teams: [],
          lean: null,
          note: 'Toss comparison feed is temporarily unavailable. Do not invent who will win the toss.',
          rawShape: 'unavailable',
        };
      }
    },
    label: ({ matchId }) => `Toss outlook ${matchId}`,
  };

  const projectScore: AiTool<{ matchId: string }> = {
    definition: {
      name: 'project_score',
      description:
        'Projected innings total / estimated target for the batting side. Prefers Latiyal liveMatch projected_score ' +
        '(20-over / final prediction when the feed sends it), blended with current run-rate arithmetic. Estimate only.',
      parameters: matchIdSchema,
    },
    parse: getWinProbability.parse,
    run: async ({ matchId }) => {
      const match = await matches.getMatch(matchId);
      const summary = summarizeMatch(match);
      const current = summary.current;
      // Prefer live innings fields from summary when top-level match score/RR is briefly null.
      const score = match.score ?? current?.score ?? null;
      const overs = match.overs ?? current?.overs ?? null;
      const runRate = match.runRate ?? current?.runRate ?? null;
      const wickets = match.wickets ?? current?.wickets ?? null;
      let limit = oversLimitFor(match.matchType);
      // Unknown format strings still get a limited-overs projection (prefer 50 unless clearly T20).
      if (limit === null) {
        limit = /t20|it20|t10/i.test(match.matchType ?? '') ? 20 : 50;
      }
      const projection = projectInningsScore({
        team: current?.battingTeam ?? teamName(match, match.battingTeamSportmonksId),
        score: typeof score === 'number' ? score : null,
        overs: typeof overs === 'number' ? overs : null,
        runRate: typeof runRate === 'number' ? runRate : null,
        oversLimit: limit,
        wickets: typeof wickets === 'number' ? wickets : null,
      });
      const chasing = (match.currentInning ?? 0) >= 2 && match.target != null;
      const crrProjected =
        projection.available && 'projectedScore' in projection ? Number(projection.projectedScore) : null;

      let latiyalProjected: number | null = null;
      let nextBallsWindow: { balls: number; runs: number } | null = null;
      try {
        const live = await feeds.get('liveMatch', { match_id: matchId });
        const parsed = parseLiveMatchPrediction(live.data, match);
        if (parsed.projectedScore != null && parsed.projectedScore > 0) latiyalProjected = parsed.projectedScore;
        if (parsed.nextBallsWindow) nextBallsWindow = parsed.nextBallsWindow;
      } catch {
        /* optional feed */
      }

      let projected = crrProjected;
      let method: 'current_rr' | 'latiyal_projection' | 'blended_latiyal_and_crr' | 'unavailable' = 'unavailable';
      if (latiyalProjected != null && crrProjected != null && Number.isFinite(crrProjected)) {
        projected = Math.round(latiyalProjected * 0.65 + crrProjected * 0.35);
        method = 'blended_latiyal_and_crr';
      } else if (latiyalProjected != null) {
        projected = latiyalProjected;
        method = 'latiyal_projection';
      } else if (crrProjected != null && Number.isFinite(crrProjected)) {
        projected = crrProjected;
        method = 'current_rr';
      }

      const methodNote =
        method === 'blended_latiyal_and_crr'
          ? `${ESTIMATE_NOTE} Blended Latiyal live projection (${latiyalProjected}) with current RR projection (${crrProjected}).`
          : method === 'latiyal_projection'
            ? `${ESTIMATE_NOTE} From Latiyal liveMatch projected score (not only CRR).`
            : method === 'current_rr'
              ? projection.available && 'note' in projection
                ? String(projection.note)
                : ESTIMATE_NOTE
              : 'No projection available yet.';

      return {
        matchId,
        matchType: match.matchType,
        isLive: match.isLive,
        phase: chasing ? 'chase' : 'first_innings',
        chaseActive: chasing,
        // Official chase target only; never currentScore+1 during the 1st innings.
        target: chasing ? match.target : null,
        runsRequired: chasing ? match.runsRequired : null,
        // If still batting first: estimated final total, and what the chase target *would be* if they finish near that.
        estimatedFinalTotal: !chasing && projected != null ? projected : null,
        estimatedChaseTargetIfFinishNearProjection:
          !chasing && projected != null && Number.isFinite(projected) ? projected + 1 : null,
        ...projection,
        available: projected != null,
        projectedScore: projected,
        crrProjectedScore: crrProjected,
        latiyalProjectedScore: latiyalProjected,
        projectionMethod: method,
        nextBallsWindow,
        note: methodNote,
      };
    },
    label: ({ matchId }) => `Projected score ${matchId}`,
  };

  const getFirstOversScore: AiTool<{ matchId: string; overs: number }> = {
    definition: {
      name: 'get_first_overs_score',
      description:
        'How many runs in the FIRST N overs / powerplay of THIS live innings (e.g. "first 6 overs me kitne run", "powerplay score"). ' +
        'Uses Latiyal matchOverHistory — not Cricsheet archive, and not "next N overs".',
      parameters: {
        type: 'object',
        properties: {
          matchId: { type: 'string', description: 'Numeric match id.' },
          overs: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'First N overs (powerplay: T20=6, ODI=10). Default 6.',
          },
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
      const ballsBowled = oversToBalls(match.overs ?? 0) ?? 0;
      const phaseBalls = overs * 6;
      let overHistory: unknown = null;
      let stale = false;
      try {
        const feed = await feeds.get('matchOverHistory', { match_id: matchId });
        overHistory = feed.data;
        stale = feed.stale;
      } catch {
        /* optional */
      }
      const summed = sumFirstOversRuns(overHistory, overs);
      // Fallback: if history missing but we have already completed the phase, use live score.
      const phaseDone = ballsBowled >= phaseBalls;
      let runs = summed.runs;
      let source: 'over_history' | 'live_score' | 'unavailable' = summed.available ? 'over_history' : 'unavailable';
      if ((!summed.available || runs === null) && phaseDone && typeof match.score === 'number') {
        runs = match.score;
        source = 'live_score';
      }
      const remainingInPhase = Math.max(0, phaseBalls - ballsBowled);
      let remainingEstimate: ReturnType<typeof projectNextOvers> | null = null;
      if (!phaseDone && remainingInPhase > 0 && match.runRate != null && match.runRate > 0) {
        remainingEstimate = projectNextOvers({
          team,
          score: match.score,
          overs: match.overs,
          runRate: match.runRate,
          oversAhead: Math.round((remainingInPhase / 6) * 100) / 100,
        });
      }
      return {
        matchId,
        matchType: match.matchType,
        isLive: match.isLive,
        team,
        oversRequested: overs,
        currentScore: match.score,
        currentOvers: match.overs,
        wickets: match.wickets,
        phaseDone,
        phaseLabel: overs === powerplayOversFor(match.matchType) ? 'powerplay' : `first_${overs}_overs`,
        available: runs != null,
        runsInPhase: runs,
        oversCounted: summed.oversCounted,
        complete: summed.complete || phaseDone,
        perOver: summed.perOver,
        source,
        stale,
        remainingBallsInPhase: remainingInPhase,
        remainingEstimate: remainingEstimate?.available ? remainingEstimate : null,
        note:
          runs != null
            ? summed.note ??
              (phaseDone
                ? `Actual runs in the first ${overs} overs of this innings.`
                : `Innings still inside the first ${overs} overs — showing runs so far.`)
            : 'Could not read first-overs totals from live over history yet.',
      };
    },
    label: ({ matchId, overs }) => `First ${overs} overs ${matchId}`,
  };

  const projectNextOversTool: AiTool<{ matchId: string; overs: number; balls?: number }> = {
    definition: {
      name: 'project_next_overs',
      description:
        'Estimate how many runs the batting side may score in the next N overs OR next N balls ' +
        '(e.g. "next 6 overs", "next 14 balls"). Blends live RR, recent overs, and archive signals when mapped. ' +
        'If Latiyal sends a next-balls session market, include it as context. Estimate only.',
      parameters: {
        type: 'object',
        properties: {
          matchId: { type: 'string', description: 'Numeric match id.' },
          overs: { type: 'number', minimum: 0.1, maximum: 20, description: 'Upcoming overs to estimate (default 6).' },
          balls: {
            type: 'integer',
            minimum: 1,
            maximum: 120,
            description: 'Optional: upcoming balls instead of overs (e.g. 14). Converted to overs/6.',
          },
        },
        required: ['matchId'],
        additionalProperties: false,
      },
    },
    parse: (raw) => {
      const matchId = parseMatchId(raw.matchId);
      if (!matchId) return 'matchId must be a numeric id';
      const balls = raw.balls === undefined ? undefined : parseIntInRange(raw.balls, 1, 120);
      if (raw.balls !== undefined && balls === null) return 'balls must be an integer from 1 to 120';
      let overs: number;
      if (balls != null) {
        overs = Math.round((balls / 6) * 100) / 100;
      } else if (raw.overs === undefined) {
        overs = 6;
      } else {
        const n = typeof raw.overs === 'number' ? raw.overs : Number(raw.overs);
        if (!Number.isFinite(n) || n < 0.1 || n > 20) return 'overs must be between 0.1 and 20';
        overs = Math.round(n * 100) / 100;
      }
      return { matchId, overs, ...(balls != null ? { balls } : {}) };
    },
    run: async ({ matchId, overs, balls }) => {
      const match = await matches.getMatch(matchId);
      const summary = summarizeMatch(match);
      const team = summary.current?.battingTeam ?? teamName(match, match.battingTeamSportmonksId);
      const { signals, context } = await collectNextOversSignals(match, feeds, matchId, opts);
      const latiyalWindow = (context.latiyalLivePrediction as { nextBallsWindow?: { balls: number; runs: number } } | undefined)
        ?.nextBallsWindow;
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
        ballsAhead: balls ?? null,
        latiyalNextBallsWindow: latiyalWindow ?? null,
        ...estimate,
        context,
      };
    },
    label: ({ matchId, overs, balls }) =>
      balls != null ? `Next ${balls} balls ${matchId}` : `Next ${overs} overs ${matchId}`,
  };

  return [getWinProbability, getTossPrediction, projectScore, getFirstOversScore, projectNextOversTool] as AiTool[];
}
