import type {
  SmBatting,
  SmBowling,
  SmFixture,
  SmLeague,
  SmPlayer,
  SmRun,
  SmSeason,
  SmTeam,
  SmVenue,
} from './sportmonks.types';

type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Includes may arrive either inline or wrapped as `{ data: ... }`. */
export function unwrap(value: unknown): unknown {
  if (isObject(value) && 'data' in value && Object.keys(value).length === 1) {
    return value.data;
  }
  return value;
}

export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function int(value: unknown): number | null {
  const parsed = num(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

export function str(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 1 || value === '1' || value === 'true') {
    return true;
  }
  if (value === 0 || value === '0' || value === 'false') {
    return false;
  }
  return null;
}

export function list<T>(value: unknown, parse: (item: unknown) => T | null): T[] {
  const raw = unwrap(value);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(parse).filter((item): item is T => item !== null);
}

export function team(value: unknown): SmTeam | null {
  const raw = unwrap(value);
  if (!isObject(raw) || int(raw.id) === null) {
    return null;
  }
  return {
    id: int(raw.id)!,
    name: str(raw.name),
    code: str(raw.code),
    image_path: str(raw.image_path),
  };
}

function league(value: unknown): SmLeague | null {
  const raw = unwrap(value);
  if (!isObject(raw) || int(raw.id) === null) {
    return null;
  }
  return {
    id: int(raw.id)!,
    name: str(raw.name),
    code: str(raw.code),
    image_path: str(raw.image_path),
    type: str(raw.type),
  };
}

function season(value: unknown): SmSeason | null {
  const raw = unwrap(value);
  if (!isObject(raw) || int(raw.id) === null) {
    return null;
  }
  return { id: int(raw.id)!, name: str(raw.name) };
}

function venue(value: unknown): SmVenue | null {
  const raw = unwrap(value);
  if (!isObject(raw) || int(raw.id) === null) {
    return null;
  }
  return { id: int(raw.id)!, name: str(raw.name), city: str(raw.city) };
}

export function player(value: unknown): SmPlayer | null {
  const raw = unwrap(value);
  if (!isObject(raw) || int(raw.id) === null) {
    return null;
  }
  const fullname =
    str(raw.fullname) ?? ([str(raw.firstname), str(raw.lastname)].filter(Boolean).join(' ') || null);
  return { id: int(raw.id)!, fullname, image_path: str(raw.image_path) };
}

export function run(value: unknown): SmRun | null {
  if (!isObject(value)) {
    return null;
  }
  const teamId = int(value.team_id);
  const inning = int(value.inning);
  if (teamId === null || inning === null) {
    return null;
  }
  return {
    team_id: teamId,
    inning,
    score: int(value.score) ?? 0,
    wickets: int(value.wickets) ?? 0,
    overs: num(value.overs) ?? 0,
  };
}

export function batting(value: unknown): SmBatting | null {
  if (!isObject(value)) {
    return null;
  }
  const teamId = int(value.team_id);
  const playerId = int(value.player_id);
  if (teamId === null || playerId === null) {
    return null;
  }
  const dismissed = ['catch_stump_player_id', 'runout_by_id', 'batsmanout_id', 'bowling_player_id'].some(
    (field) => int(value[field]) !== null,
  );
  return {
    team_id: teamId,
    player_id: playerId,
    scoreboard: str(value.scoreboard),
    active: bool(value.active),
    dismissed,
    sort: int(value.sort),
    score: int(value.score) ?? 0,
    ball: int(value.ball) ?? 0,
    four_x: int(value.four_x) ?? 0,
    six_x: int(value.six_x) ?? 0,
    rate: num(value.rate),
    batsman: player(value.batsman),
  };
}

export function bowling(value: unknown): SmBowling | null {
  if (!isObject(value)) {
    return null;
  }
  const teamId = int(value.team_id);
  const playerId = int(value.player_id);
  if (teamId === null || playerId === null) {
    return null;
  }
  return {
    team_id: teamId,
    player_id: playerId,
    scoreboard: str(value.scoreboard),
    active: bool(value.active),
    sort: int(value.sort),
    updated_at: str(value.updated_at),
    overs: num(value.overs) ?? 0,
    medians: int(value.medians) ?? 0,
    runs: int(value.runs) ?? 0,
    wickets: int(value.wickets) ?? 0,
    rate: num(value.rate),
    bowler: player(value.bowler),
  };
}

/** Returns null when the fixture lacks an integer id. Optional fields degrade to null or []. */
export function parseFixture(value: unknown): SmFixture | null {
  if (!isObject(value)) {
    return null;
  }
  const id = int(value.id);
  if (id === null) {
    return null;
  }

  return {
    id,
    league_id: int(value.league_id),
    season_id: int(value.season_id),
    round: str(value.round),
    localteam_id: int(value.localteam_id),
    visitorteam_id: int(value.visitorteam_id),
    starting_at: str(value.starting_at),
    type: str(value.type),
    live: bool(value.live),
    status: str(value.status),
    note: str(value.note),
    winner_team_id: int(value.winner_team_id),
    super_over: bool(value.super_over),
    rpc_target: int(value.rpc_target),
    rpc_overs: num(value.rpc_overs),
    localteam: team(value.localteam),
    visitorteam: team(value.visitorteam),
    league: league(value.league),
    season: season(value.season),
    venue: venue(value.venue),
    runs: list(value.runs, run),
    batting: list(value.batting, batting),
    bowling: list(value.bowling, bowling),
  };
}

export interface FixtureListResult {
  fixtures: SmFixture[];
  rejected: number;
}

/** Validates a `{ data: [...] }` envelope. Returns null when the envelope itself is invalid. */
export function parseFixtureList(body: unknown): FixtureListResult | null {
  if (!isObject(body) || !Array.isArray(body.data)) {
    return null;
  }
  const fixtures: SmFixture[] = [];
  let rejected = 0;
  for (const item of body.data) {
    const fixture = parseFixture(item);
    if (fixture) {
      fixtures.push(fixture);
    } else {
      rejected += 1;
    }
  }
  return { fixtures, rejected };
}

/** Validates a `{ data: {...} }` envelope for a single fixture. */
export function parseSingleFixture(body: unknown): SmFixture | null | undefined {
  if (!isObject(body) || !('data' in body)) {
    return undefined;
  }
  if (body.data === null) {
    return null;
  }
  return parseFixture(body.data) ?? undefined;
}
