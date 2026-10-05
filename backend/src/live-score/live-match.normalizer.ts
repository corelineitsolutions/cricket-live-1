import type { SmBatting, SmBowling, SmFixture, SmRun, SmTeam } from '../sportmonks/sportmonks.types';
import type { LiveBatsman, LiveBowler, LiveInnings, LiveMatch, LiveTeam } from './live-match.types';
import { mapStatus } from './match-status';

const OVERS_PER_INNINGS: Record<string, number> = {
  T10: 10,
  T20: 20,
  T20I: 20,
  ODI: 50,
  'List A': 50,
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Converts cricket overs notation (12.3 = 12 overs and 3 balls) to balls. */
export function oversToBalls(overs: number): number {
  const whole = Math.trunc(overs);
  const balls = Math.round((overs - whole) * 10);
  return whole * 6 + Math.min(Math.max(balls, 0), 5);
}

function toTeam(team: SmTeam | null, fallbackId: number | null): LiveTeam {
  return {
    sportmonksId: team?.id ?? fallbackId,
    name: team?.name ?? null,
    shortName: team?.code ?? null,
    imageUrl: team?.image_path ?? null,
  };
}

function oversLimitFor(fixture: SmFixture, inning: number): number | null {
  if (fixture.super_over && inning > 2) {
    return 1;
  }
  const base = fixture.type ? (OVERS_PER_INNINGS[fixture.type] ?? null) : null;
  if (base !== null && inning === 2 && fixture.rpc_overs && fixture.rpc_overs > 0) {
    return fixture.rpc_overs;
  }
  return base;
}

function targetFor(fixture: SmFixture, runs: SmRun[], current: SmRun): number | null {
  const limitedOvers = oversLimitFor(fixture, current.inning) !== null;

  if (limitedOvers) {
    if (current.inning % 2 !== 0) {
      return null;
    }
    if (current.inning === 2 && fixture.rpc_target && fixture.rpc_target > 0) {
      return fixture.rpc_target;
    }
    const previous = runs.find((run) => run.inning === current.inning - 1);
    return previous ? previous.score + 1 : null;
  }

  if (current.inning === 4) {
    const battingTotal = runs
      .filter((run) => run.team_id === current.team_id && run.inning < 4)
      .reduce((sum, run) => sum + run.score, 0);
    const opponentTotal = runs
      .filter((run) => run.team_id !== current.team_id)
      .reduce((sum, run) => sum + run.score, 0);
    const target = opponentTotal - battingTotal + 1;
    return target > 0 ? target : null;
  }

  return null;
}

function toBatsman(row: SmBatting): LiveBatsman {
  return {
    sportmonksId: row.player_id,
    name: row.batsman?.fullname ?? null,
    imageUrl: row.batsman?.image_path ?? null,
    runs: row.score,
    balls: row.ball,
    fours: row.four_x,
    sixes: row.six_x,
    strikeRate: row.rate ?? (row.ball > 0 ? round2((row.score * 100) / row.ball) : null),
  };
}

function toBowler(row: SmBowling): LiveBowler {
  return {
    sportmonksId: row.player_id,
    name: row.bowler?.fullname ?? null,
    imageUrl: row.bowler?.image_path ?? null,
    overs: row.overs,
    maidens: row.medians,
    runs: row.runs,
    wickets: row.wickets,
    economy: row.rate,
  };
}

function currentBatsmen(fixture: SmFixture, current: SmRun): LiveBatsman[] {
  const scoreboard = `S${current.inning}`;
  const rows = fixture.batting.filter(
    (row) => row.team_id === current.team_id && (row.scoreboard === null || row.scoreboard === scoreboard),
  );
  const active = rows.filter((row) => row.active === true);
  const atCrease = active.length > 0 ? active : rows.filter((row) => !row.dismissed);
  return [...atCrease]
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .slice(-2)
    .map(toBatsman);
}

function currentBowler(fixture: SmFixture, current: SmRun): LiveBowler | null {
  const scoreboard = `S${current.inning}`;
  const rows = fixture.bowling.filter(
    (row) => row.team_id !== current.team_id && (row.scoreboard === null || row.scoreboard === scoreboard),
  );
  const active = rows.find((row) => row.active === true);
  if (active) {
    return toBowler(active);
  }
  const latest = [...rows].sort((a, b) => {
    const byTime = (a.updated_at ?? '').localeCompare(b.updated_at ?? '');
    return byTime !== 0 ? byTime : (a.sort ?? 0) - (b.sort ?? 0);
  });
  const last = latest[latest.length - 1];
  return last ? toBowler(last) : null;
}

/** Builds the backend live match from a validated Sportmonks fixture. */
export function normalizeFixture(fixture: SmFixture, now: Date, matchId: string | null = null): LiveMatch {
  const statusInfo = mapStatus(fixture.status, fixture.live);
  const runs = [...fixture.runs].sort((a, b) => a.inning - b.inning);
  const innings: LiveInnings[] = runs.map((run) => ({
    inning: run.inning,
    teamSportmonksId: run.team_id,
    score: run.score,
    wickets: run.wickets,
    overs: run.overs,
  }));
  const current = runs[runs.length - 1] ?? null;

  let runRate: number | null = null;
  let target: number | null = null;
  let runsRequired: number | null = null;
  let ballsRemaining: number | null = null;
  let requiredRunRate: number | null = null;

  if (current) {
    const balls = oversToBalls(current.overs);
    runRate = balls > 0 ? round2((current.score * 6) / balls) : null;
    target = targetFor(fixture, runs, current);
    const oversLimit = oversLimitFor(fixture, current.inning);
    if (target !== null) {
      runsRequired = Math.max(0, target - current.score);
    }
    if (oversLimit !== null && target !== null) {
      ballsRemaining = Math.max(0, oversToBalls(oversLimit) - balls);
      requiredRunRate =
        ballsRemaining > 0 && runsRequired !== null ? round2((runsRequired * 6) / ballsRemaining) : null;
    }
  }

  return {
    matchId,
    sportmonksId: fixture.id,
    league: fixture.league
      ? {
          sportmonksId: fixture.league.id,
          name: fixture.league.name,
          code: fixture.league.code,
          imageUrl: fixture.league.image_path,
        }
      : null,
    season: fixture.season ? { sportmonksId: fixture.season.id, name: fixture.season.name } : null,
    matchType: fixture.type,
    round: fixture.round,
    status: statusInfo.status,
    statusDetail: fixture.status,
    isLive: statusInfo.isLive,
    isFinished: statusInfo.isFinished,
    note: fixture.note,
    startTime: fixture.starting_at ? new Date(fixture.starting_at).toISOString() : null,
    venue: fixture.venue ? { name: fixture.venue.name, city: fixture.venue.city } : null,
    localTeam: toTeam(fixture.localteam, fixture.localteam_id),
    visitorTeam: toTeam(fixture.visitorteam, fixture.visitorteam_id),
    winnerTeamSportmonksId: fixture.winner_team_id,
    innings,
    currentInning: current?.inning ?? null,
    battingTeamSportmonksId: current?.team_id ?? null,
    score: current?.score ?? null,
    wickets: current?.wickets ?? null,
    overs: current?.overs ?? null,
    runRate,
    target,
    runsRequired,
    ballsRemaining,
    requiredRunRate,
    batsmen: current ? currentBatsmen(fixture, current) : [],
    bowler: current ? currentBowler(fixture, current) : null,
    lastUpdatedAt: now.toISOString(),
    stale: false,
  };
}
