import type { SmBall } from '../sportmonks/sportmonks.types';
import { COMMENTARY_MAX_ITEMS, CommentaryItemDto, ExtraType } from './dto/commentary.dto';

function inningOf(scoreboard: string | null): number | null {
  const match = scoreboard ? /^S(\d+)$/.exec(scoreboard) : null;
  return match ? Number(match[1]) : null;
}

function extraOf(ball: SmBall): { type: ExtraType | null; runs: number } {
  const score = ball.score;
  if (!score) {
    return { type: null, runs: 0 };
  }
  if (score.noball > 0) {
    return { type: 'noball', runs: score.noball + score.noball_runs };
  }
  if (score.bye > 0) {
    return { type: 'bye', runs: score.bye };
  }
  if (score.leg_bye > 0) {
    return { type: 'legbye', runs: score.leg_bye };
  }
  if (score.ball === false) {
    return { type: 'wide', runs: Math.max(1, score.runs) };
  }
  return { type: null, runs: 0 };
}

function describe(ball: SmBall, extraType: ExtraType | null): string {
  const score = ball.score;
  const bowler = ball.bowler?.fullname ?? 'Bowler';
  const batsman = ball.batsman?.fullname ?? 'batsman';
  let outcome: string;
  if (!score) {
    outcome = 'no details';
  } else if (score.is_wicket || score.out) {
    outcome = score.name ? `OUT (${score.name})` : 'OUT';
  } else if (score.six) {
    outcome = 'SIX';
  } else if (score.four) {
    outcome = 'FOUR';
  } else if (extraType === 'wide') {
    outcome = 'wide';
  } else if (extraType === 'noball') {
    outcome = 'no ball';
  } else if (score.runs === 0 && !extraType) {
    outcome = 'no run';
  } else {
    outcome = score.name ?? `${score.runs} run${score.runs === 1 ? '' : 's'}`;
  }
  return `${bowler} to ${batsman}, ${outcome}`;
}

/** Latest balls first, capped to what the API can return. */
export function buildCommentary(balls: SmBall[]): CommentaryItemDto[] {
  return balls
    .map((ball) => {
      const extra = extraOf(ball);
      return {
        id: ball.id,
        inning: inningOf(ball.scoreboard),
        over: ball.ball,
        teamSportmonksId: ball.team_id,
        batsman: { sportmonksId: ball.batsman?.id ?? null, name: ball.batsman?.fullname ?? null },
        bowler: { sportmonksId: ball.bowler?.id ?? null, name: ball.bowler?.fullname ?? null },
        runs: ball.score?.runs ?? 0,
        isFour: ball.score?.four ?? false,
        isSix: ball.score?.six ?? false,
        isWicket: Boolean(ball.score?.is_wicket || ball.score?.out),
        extraType: extra.type,
        extraRuns: extra.runs,
        result: ball.score?.name ?? null,
        text: describe(ball, extra.type),
      };
    })
    .sort((a, b) => (b.inning ?? 0) - (a.inning ?? 0) || b.over - a.over || b.id - a.id)
    .slice(0, COMMENTARY_MAX_ITEMS);
}
