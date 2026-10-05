import type {
  SmBall,
  SmBallScore,
  SmBattingDetail,
  SmBowlingDetail,
  SmDismissalResult,
  SmScoreboard,
  SmScorecard,
} from './sportmonks.types';
import { batting, bool, bowling, int, isObject, list, num, player, run, str, team, unwrap } from './sportmonks.validation';

function dismissalResult(value: unknown): SmDismissalResult | null {
  const raw = unwrap(value);
  if (!isObject(raw)) {
    return null;
  }
  return { name: str(raw.name), is_wicket: bool(raw.is_wicket) };
}

function battingDetail(value: unknown): SmBattingDetail | null {
  const base = batting(value);
  if (!base || !isObject(value)) {
    return null;
  }
  return {
    ...base,
    fow_score: int(value.fow_score),
    fow_balls: num(value.fow_balls),
    bowler: player(value.bowler),
    catchstump: player(value.catchstump),
    runoutby: player(value.runoutby),
    result: dismissalResult(value.result),
  };
}

function bowlingDetail(value: unknown): SmBowlingDetail | null {
  const base = bowling(value);
  if (!base || !isObject(value)) {
    return null;
  }
  return { ...base, wide: int(value.wide) ?? 0, noball: int(value.noball) ?? 0 };
}

function scoreboard(value: unknown): SmScoreboard | null {
  if (!isObject(value)) {
    return null;
  }
  return {
    scoreboard: str(value.scoreboard),
    team_id: int(value.team_id),
    type: str(value.type),
    wide: int(value.wide) ?? 0,
    noball_runs: int(value.noball_runs) ?? 0,
    bye: int(value.bye) ?? 0,
    leg_bye: int(value.leg_bye) ?? 0,
    penalty: int(value.penalty) ?? 0,
    total: int(value.total) ?? 0,
    overs: num(value.overs) ?? 0,
    wickets: int(value.wickets) ?? 0,
  };
}

function ballScore(value: unknown): SmBallScore | null {
  const raw = unwrap(value);
  if (!isObject(raw)) {
    return null;
  }
  return {
    name: str(raw.name),
    runs: int(raw.runs) ?? 0,
    four: bool(raw.four) ?? false,
    six: bool(raw.six) ?? false,
    bye: int(raw.bye) ?? 0,
    leg_bye: int(raw.leg_bye) ?? 0,
    noball: int(raw.noball) ?? 0,
    noball_runs: int(raw.noball_runs) ?? 0,
    is_wicket: bool(raw.is_wicket) ?? false,
    out: bool(raw.out) ?? false,
    ball: bool(raw.ball),
  };
}

function ball(value: unknown): SmBall | null {
  if (!isObject(value)) {
    return null;
  }
  const id = int(value.id);
  const over = num(value.ball);
  if (id === null || over === null) {
    return null;
  }
  return {
    id,
    team_id: int(value.team_id),
    ball: over,
    scoreboard: str(value.scoreboard),
    updated_at: str(value.updated_at),
    batsman: player(value.batsman),
    bowler: player(value.bowler),
    score: ballScore(value.score),
  };
}

function fixtureData(body: unknown): Record<string, unknown> | null | undefined {
  if (!isObject(body) || !('data' in body)) {
    return undefined;
  }
  if (body.data === null) {
    return null;
  }
  return isObject(body.data) && int(body.data.id) !== null ? body.data : undefined;
}

/** null: Sportmonks has no such fixture. undefined: the body is invalid. */
export function parseScorecard(body: unknown): SmScorecard | null | undefined {
  const data = fixtureData(body);
  if (!data) {
    return data;
  }
  return {
    id: int(data.id)!,
    status: str(data.status),
    live: bool(data.live),
    localteam: team(data.localteam),
    visitorteam: team(data.visitorteam),
    runs: list(data.runs, run),
    scoreboards: list(data.scoreboards, scoreboard),
    batting: list(data.batting, battingDetail),
    bowling: list(data.bowling, bowlingDetail),
  };
}

/** null: Sportmonks has no such fixture. undefined: the body is invalid. */
export function parseBalls(body: unknown): SmBall[] | null | undefined {
  const data = fixtureData(body);
  if (!data) {
    return data;
  }
  return list(data.balls, ball);
}
