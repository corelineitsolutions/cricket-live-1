import type { LatiyalRecord } from '../latiyal/latiyal.types';
import {
  asRecord,
  matchIdOf,
  mergeRecords,
  pick,
  pickNumber,
  pickRecord,
  pickText,
  toNumber,
  toRecords,
  toText,
} from '../latiyal/latiyal.validation';
import type { LiveBatsman, LiveBowler, LiveInnings, LiveMatch, LiveTeam } from './live-match.types';
import { mapStatus } from './match-status';

const OVERS_PER_INNINGS: Record<string, number> = {
  T10: 10,
  T20: 20,
  T20I: 20,
  ODI: 50,
  'ONE DAY': 50,
  'LIST A': 50,
};

/** Latiyal publishes local Indian times without a zone. */
const PROVIDER_UTC_OFFSET = '+05:30';

const NEED_RUNS = /need[s]?\s+(\d+)\s+runs?\s+(?:in|from|off)\s+(\d+)\s+balls?/i;

type Side = 'a' | 'b';

interface ScoreLine {
  score: number;
  wickets: number;
  overs: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Converts cricket overs notation (12.3 = 12 overs and 3 balls) to balls. */
export function oversToBalls(overs: number): number {
  const whole = Math.trunc(overs);
  const balls = Math.round((overs - whole) * 10);
  return whole * 6 + Math.min(Math.max(balls, 0), 5);
}

/**
 * Stable negative id for entities Latiyal sends without one. Negative ids never collide
 * with provider ids and are never written to MySQL.
 */
export function syntheticId(name: string): number {
  let hash = 0x811c9dc5;
  for (const char of name.toLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return -((hash % 2_000_000_000) + 1);
}

const sideKeys = (side: Side, suffixes: readonly string[]) =>
  suffixes.flatMap((suffix) => [`team_${side}${suffix}`, `team${side}${suffix}`]);

function toTeam(raw: LatiyalRecord, side: Side): LiveTeam {
  const name = pickText(raw, sideKeys(side, ['', '_name']));
  const id = pickNumber(raw, sideKeys(side, ['_id']));
  return {
    sportmonksId: id !== null && id > 0 ? id : name ? syntheticId(name) : null,
    name,
    shortName: pickText(raw, sideKeys(side, ['_short', '_short_name', '_code'])),
    imageUrl: pickText(raw, sideKeys(side, ['_img', '_image', '_logo', '_flag'])),
  };
}

/** "188-6", "188/6 (20)", "250 & 120-3" or `{ "1": { score, wicket, over } }` as score lines. */
export function parseScoreLines(value: unknown, oversValue: unknown): ScoreLine[] {
  const records = toRecords(value);
  if (records.length > 0) {
    return records
      .map((record) => ({
        score: toNumber(pick(record, ['score', 'run', 'runs'])),
        wickets: toNumber(pick(record, ['wicket', 'wickets', 'wkts'])) ?? 0,
        overs: toNumber(pick(record, ['over', 'overs'])) ?? 0,
      }))
      .filter((line): line is ScoreLine => line.score !== null);
  }

  const text = toText(value);
  if (!text) {
    return [];
  }
  const segments = text.split('&').map((segment) => segment.trim());
  const lines: ScoreLine[] = [];
  segments.forEach((segment, index) => {
    const match = /^(\d+)(?:\s*[-/]\s*(\d+))?(?:\s*\(?\s*([\d.]+)\s*(?:ov(?:ers)?)?\s*\)?)?/i.exec(segment);
    if (!match) {
      return;
    }
    const isLast = index === segments.length - 1;
    const overs = toNumber(match[3]) ?? (isLast ? toNumber(oversValue) : null);
    lines.push({ score: Number(match[1]), wickets: match[2] ? Number(match[2]) : 10, overs: overs ?? 0 });
  });
  const last = lines[lines.length - 1];
  if (last && !/[-/]/.test(segments[segments.length - 1])) {
    last.wickets = 0;
  }
  return lines;
}

function scoreLines(raw: LatiyalRecord, side: Side): ScoreLine[] {
  return parseScoreLines(
    pick(raw, sideKeys(side, ['_scores', '_score', '_scores_full'])),
    pick(raw, sideKeys(side, ['_over', '_overs'])),
  );
}

function resolveSide(value: unknown, local: LiveTeam, visitor: LiveTeam): Side | null {
  const id = toNumber(value);
  if (id !== null && id > 0) {
    return id === local.sportmonksId ? 'a' : id === visitor.sportmonksId ? 'b' : null;
  }
  const text = toText(value)?.toLowerCase();
  if (!text) {
    return null;
  }
  const matches = (team: LiveTeam) => [team.name, team.shortName].some((label) => label?.toLowerCase() === text);
  return matches(local) ? 'a' : matches(visitor) ? 'b' : null;
}

function startTimeOf(raw: LatiyalRecord): string | null {
  const epoch = pickNumber(raw, ['match_timestamp', 'timestamp', 'start_timestamp', 'date_time_unix']);
  if (epoch !== null && epoch > 0) {
    return new Date(epoch < 1e12 ? epoch * 1000 : epoch).toISOString();
  }

  const full = pickText(raw, ['date_time', 'match_date_time', 'start_time', 'starting_at', 'datetime']);
  const date = pickText(raw, ['date_wise', 'match_date', 'date']);
  const time = pickText(raw, ['match_time', 'time']);
  const candidates = [full, date && time ? `${date.split(',')[0]} ${time}` : null].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)$/i.test(candidate);
    const parsed = Date.parse(hasZone ? candidate : `${candidate} GMT${PROVIDER_UTC_OFFSET.replace(':', '')}`);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return null;
}

function playerRecords(raw: LatiyalRecord, keys: readonly string[]): LatiyalRecord[] {
  const value = pick(raw, keys);
  const single = asRecord(value);
  if (single && pick(single, ['name', 'player_name', 'batsman_name', 'bowler_name']) !== undefined) {
    return [single];
  }
  return toRecords(value);
}

function playerId(row: LatiyalRecord, name: string | null, idKeys: readonly string[]): number | null {
  const id = pickNumber(row, idKeys);
  if (id !== null && id > 0) {
    return id;
  }
  return name ? syntheticId(name) : null;
}

function toBatsman(row: LatiyalRecord): LiveBatsman | null {
  const name = pickText(row, ['name', 'batsman_name', 'player_name', 'batsman']);
  const id = playerId(row, name, ['player_id', 'batsman_id', 'id']);
  if (id === null) {
    return null;
  }
  const runs = pickNumber(row, ['run', 'runs', 'r']) ?? 0;
  const balls = pickNumber(row, ['ball', 'balls', 'b']) ?? 0;
  return {
    sportmonksId: id,
    name,
    imageUrl: pickText(row, ['image', 'img', 'player_img', 'player_image']),
    runs,
    balls,
    fours: pickNumber(row, ['fours', 'four', '4s', 'four_x']) ?? 0,
    sixes: pickNumber(row, ['sixes', 'six', '6s', 'six_x']) ?? 0,
    strikeRate: pickNumber(row, ['strike_rate', 'sr', 'strikerate']) ?? (balls > 0 ? round2((runs * 100) / balls) : null),
  };
}

function toBowler(row: LatiyalRecord): LiveBowler | null {
  const name = pickText(row, ['name', 'bowler_name', 'player_name', 'bowler']);
  const id = playerId(row, name, ['player_id', 'bowler_id', 'id']);
  if (id === null) {
    return null;
  }
  return {
    sportmonksId: id,
    name,
    imageUrl: pickText(row, ['image', 'img', 'player_img', 'player_image']),
    overs: pickNumber(row, ['over', 'overs', 'o']) ?? 0,
    maidens: pickNumber(row, ['maiden', 'maidens', 'm', 'medians']) ?? 0,
    runs: pickNumber(row, ['run', 'runs', 'r']) ?? 0,
    wickets: pickNumber(row, ['wicket', 'wickets', 'w']) ?? 0,
    economy: pickNumber(row, ['economy', 'eco', 'er', 'econ']),
  };
}

function winnerOf(raw: LatiyalRecord, local: LiveTeam, visitor: LiveTeam): number | null {
  const side = resolveSide(pick(raw, ['winning_team_id', 'winner_team_id', 'winner_id', 'winning_team']), local, visitor);
  if (side) {
    return side === 'a' ? local.sportmonksId : visitor.sportmonksId;
  }
  const result = pickText(raw, ['result'])?.toLowerCase();
  if (!result || !/\bwon\b|\bwin\b|\bbeat\b/.test(result)) {
    return null;
  }
  const startsWith = (team: LiveTeam) =>
    [team.name, team.shortName].some((label) => label && result.startsWith(label.toLowerCase()));
  return startsWith(local) ? local.sportmonksId : startsWith(visitor) ? visitor.sportmonksId : null;
}

/**
 * Builds the backend live match from a liveMatchList item and, when available, its
 * liveMatch detail. Missing values stay null instead of being guessed.
 */
export function normalizeLatiyalMatch(
  summary: LatiyalRecord,
  detail: LatiyalRecord | null,
  now: Date,
  options: { inLiveList?: boolean; matchId?: string | null } = {},
): LiveMatch {
  const raw = mergeRecords(summary, detail);
  const id = matchIdOf(summary) ?? matchIdOf(raw)!;
  const statusDetail = pickText(raw, ['match_status', 'status_str', 'matchStatus', 'game_state']) ?? toText(raw.status);
  const statusInfo = mapStatus(statusDetail, options.inLiveList ?? true);
  const matchType = pickText(raw, ['match_type', 'matchType', 'format']);
  const oversLimit = matchType ? (OVERS_PER_INNINGS[matchType.toUpperCase()] ?? null) : null;

  const localTeam = toTeam(raw, 'a');
  const visitorTeam = toTeam(raw, 'b');
  const lines: Record<Side, ScoreLine[]> = { a: scoreLines(raw, 'a'), b: scoreLines(raw, 'b') };
  const teamId = (side: Side) => (side === 'a' ? localTeam.sportmonksId : visitorTeam.sportmonksId);

  let batting = resolveSide(pick(raw, ['batting_team', 'batting_team_id', 'current_batting_team']), localTeam, visitorTeam);
  if (!batting) {
    const balls = (side: Side) => lines[side].reduce((sum, line) => sum + oversToBalls(line.overs), 0);
    if (lines.a.length > 0 && lines.b.length === 0) batting = 'a';
    else if (lines.b.length > 0 && lines.a.length === 0) batting = 'b';
    else if (lines.a.length > 0) batting = lines.a.length > lines.b.length ? 'a' : lines.b.length > lines.a.length ? 'b' : balls('a') < balls('b') ? 'a' : 'b';
  }

  const innings: LiveInnings[] = [];
  if (batting) {
    const second: Side = batting;
    const first: Side = batting === 'a' ? 'b' : 'a';
    const order: Side[] = lines[first].length > 0 ? [first, second] : [second];
    const rounds = Math.max(lines.a.length, lines.b.length);
    for (let i = 0; i < rounds; i += 1) {
      for (const side of order) {
        const line = lines[side][i];
        if (line) {
          innings.push({ inning: innings.length + 1, teamSportmonksId: teamId(side)!, ...line });
        }
      }
    }
    const last = innings[innings.length - 1];
    if (statusInfo.isLive && teamId(batting) !== null && last?.teamSportmonksId !== teamId(batting)) {
      innings.push({ inning: innings.length + 1, teamSportmonksId: teamId(batting)!, score: 0, wickets: 0, overs: 0 });
    }
  }
  const current = innings[innings.length - 1] ?? null;

  const needText = pickText(raw, ['need_run_ball', 'equation', 'status_note']);
  const need = needText ? NEED_RUNS.exec(needText) : null;
  let runRate: number | null = null;
  let target: number | null = null;
  let runsRequired: number | null = null;
  let ballsRemaining: number | null = null;
  let requiredRunRate: number | null = null;

  if (current) {
    const balls = oversToBalls(current.overs);
    runRate = pickNumber(raw, ['curr_rate', 'current_run_rate', 'crr', 'run_rate']) ?? (balls > 0 ? round2((current.score * 6) / balls) : null);
    const previous = innings[innings.length - 2];
    target =
      pickNumber(raw, ['target']) ??
      (need ? current.score + Number(need[1]) : oversLimit !== null && current.inning === 2 && previous ? previous.score + 1 : null);
    runsRequired = pickNumber(raw, ['run_need', 'runs_need', 'need_runs']) ?? (need ? Number(need[1]) : target !== null ? Math.max(0, target - current.score) : null);
    ballsRemaining =
      pickNumber(raw, ['ball_rem', 'balls_rem', 'remaining_balls']) ??
      (need ? Number(need[2]) : oversLimit !== null && target !== null ? Math.max(0, oversToBalls(oversLimit) - balls) : null);
    requiredRunRate =
      pickNumber(raw, ['rr_rate', 'required_run_rate', 'rrr']) ??
      (ballsRemaining !== null && ballsRemaining > 0 && runsRequired !== null ? round2((runsRequired * 6) / ballsRemaining) : null);
  }

  const seriesName = pickText(raw, ['series', 'series_name', 'seriesName']);
  const seriesId = pickNumber(raw, ['series_id', 'seriesId']) ?? (seriesName ? syntheticId(seriesName) : null);
  const venueName = pickText(raw, ['venue', 'venue_name', 'ground']);

  return {
    matchId: options.matchId ?? null,
    sportmonksId: id,
    league: seriesId !== null ? { sportmonksId: seriesId, name: seriesName, code: null, imageUrl: pickText(raw, ['series_img', 'series_image']) } : null,
    season: seriesId !== null ? { sportmonksId: seriesId, name: seriesName } : null,
    matchType,
    round: pickText(raw, ['matchs', 'match_number', 'match_no', 'matchNo']),
    status: statusInfo.status,
    statusDetail,
    isLive: statusInfo.isLive,
    isFinished: statusInfo.isFinished,
    note: pickText(raw, ['result']) ?? needText ?? pickText(raw, ['trail_lead', 'toss']),
    startTime: startTimeOf(raw),
    venue: venueName ? { name: venueName, city: pickText(raw, ['venue_city', 'city']) } : null,
    localTeam,
    visitorTeam,
    winnerTeamSportmonksId: statusInfo.isFinished ? winnerOf(raw, localTeam, visitorTeam) : null,
    innings,
    currentInning: current?.inning ?? null,
    battingTeamSportmonksId: current?.teamSportmonksId ?? null,
    score: current?.score ?? null,
    wickets: current?.wickets ?? null,
    overs: current?.overs ?? null,
    runRate,
    target,
    runsRequired,
    ballsRemaining,
    requiredRunRate,
    batsmen: playerRecords(raw, ['batsman', 'batsmen', 'batting', 'batters'])
      .map(toBatsman)
      .filter((batsman): batsman is LiveBatsman => batsman !== null)
      .slice(0, 2),
    bowler: (() => {
      const row = pickRecord(raw, ['bolwer', 'bowler', 'bowling', 'current_bowler']);
      return row ? toBowler(row) : null;
    })(),
    lastUpdatedAt: now.toISOString(),
    stale: false,
  };
}
