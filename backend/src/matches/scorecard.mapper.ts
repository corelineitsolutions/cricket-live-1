import type { PlayerSeed } from '../live-score/match-persistence.service';
import type { SmBattingDetail, SmBowlingDetail, SmScorecard, SmTeam } from '../sportmonks/sportmonks.types';
import type { MatchTeamDto } from './dto/match.dto';
import type { ScorecardBattingDto, ScorecardBowlingDto, ScorecardInningsDto } from './dto/scorecard.dto';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function teamFor(card: SmScorecard, teamId: number): MatchTeamDto {
  const team: SmTeam | null =
    card.localteam?.id === teamId ? card.localteam : card.visitorteam?.id === teamId ? card.visitorteam : null;
  return {
    sportmonksId: teamId,
    name: team?.name ?? null,
    shortName: team?.code ?? null,
    imageUrl: team?.image_path ?? null,
  };
}

const bySort = <T extends { sort: number | null }>(a: T, b: T) => (a.sort ?? 0) - (b.sort ?? 0);

function toBatting(row: SmBattingDetail): ScorecardBattingDto {
  return {
    sportmonksId: row.player_id,
    name: row.batsman?.fullname ?? null,
    imageUrl: row.batsman?.image_path ?? null,
    runs: row.score,
    balls: row.ball,
    fours: row.four_x,
    sixes: row.six_x,
    strikeRate: row.rate ?? (row.ball > 0 ? round2((row.score * 100) / row.ball) : null),
    isOut: row.dismissed,
    atCrease: row.active === true,
    dismissal: row.dismissed
      ? {
          type: row.result?.name ?? null,
          bowlerName: row.bowler?.fullname ?? null,
          fielderName: (row.catchstump ?? row.runoutby)?.fullname ?? null,
        }
      : null,
    fallOfWicket: row.dismissed && row.fow_score !== null ? { score: row.fow_score, overs: row.fow_balls } : null,
  };
}

function toBowling(row: SmBowlingDetail): ScorecardBowlingDto {
  return {
    sportmonksId: row.player_id,
    name: row.bowler?.fullname ?? null,
    imageUrl: row.bowler?.image_path ?? null,
    overs: row.overs,
    maidens: row.medians,
    runs: row.runs,
    wickets: row.wickets,
    wides: row.wide,
    noBalls: row.noball,
    economy: row.rate,
    active: row.active === true,
  };
}

/** Builds one entry per innings from a Sportmonks scorecard, oldest innings first. */
export function buildScorecardInnings(card: SmScorecard): ScorecardInningsDto[] {
  return [...card.runs]
    .sort((a, b) => a.inning - b.inning)
    .map((run) => {
      const scoreboard = `S${run.inning}`;
      const inBoard = (row: { scoreboard: string | null }) => row.scoreboard === null || row.scoreboard === scoreboard;
      const extra = card.scoreboards.find((row) => row.type === 'extra' && row.scoreboard === scoreboard);

      return {
        inning: run.inning,
        team: teamFor(card, run.team_id),
        score: run.score,
        wickets: run.wickets,
        overs: run.overs,
        extras: extra
          ? {
              total: extra.wide + extra.noball_runs + extra.bye + extra.leg_bye + extra.penalty,
              wides: extra.wide,
              noBalls: extra.noball_runs,
              byes: extra.bye,
              legByes: extra.leg_bye,
              penalty: extra.penalty,
            }
          : null,
        batting: card.batting
          .filter((row) => row.team_id === run.team_id && inBoard(row))
          .sort(bySort)
          .map(toBatting),
        bowling: card.bowling
          .filter((row) => row.team_id !== run.team_id && inBoard(row))
          .sort(bySort)
          .map(toBowling),
      };
    });
}

/** Every distinct player that appears in the scorecard, for one-time storage. */
export function scorecardPlayers(card: SmScorecard): PlayerSeed[] {
  const players = new Map<number, PlayerSeed>();
  for (const row of card.batting) {
    players.set(row.player_id, { sportmonksId: row.player_id, name: row.batsman?.fullname ?? null, imageUrl: row.batsman?.image_path ?? null });
  }
  for (const row of card.bowling) {
    players.set(row.player_id, { sportmonksId: row.player_id, name: row.bowler?.fullname ?? null, imageUrl: row.bowler?.image_path ?? null });
  }
  return [...players.values()];
}
