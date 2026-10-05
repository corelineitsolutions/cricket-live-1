import { MatchStatus } from '@prisma/client';
import type { LiveMatch } from '../live-score/live-match.types';
import type { MatchDto } from './dto/match.dto';
import type { MatchWithRelations } from './matches.mapper';

const FINISHED_STATUSES: ReadonlySet<MatchStatus> = new Set([
  MatchStatus.COMPLETED,
  MatchStatus.ABANDONED,
  MatchStatus.CANCELLED,
  MatchStatus.POSTPONED,
]);
const LIVE_STATUSES: ReadonlySet<MatchStatus> = new Set([MatchStatus.LIVE, MatchStatus.INTERRUPTED]);

/** Public shape of a live-feed match. The internal MySQL id is not exposed. */
export function toPublicMatch(live: LiveMatch): MatchDto {
  const { matchId: _internalId, sportmonksId, ...rest } = live;
  return { matchId: sportmonksId, source: 'live', ...rest };
}

/** Public shape of a stored match. There is no live data, so score fields stay empty. */
export function storedToPublicMatch(row: MatchWithRelations): MatchDto {
  const team = (value: MatchWithRelations['localTeam']) => ({
    sportmonksId: value.sportmonksId,
    name: value.name,
    shortName: value.shortName,
    imageUrl: value.imageUrl,
  });
  const isLive = LIVE_STATUSES.has(row.status);

  return {
    matchId: row.sportmonksId,
    source: 'stored',
    league: {
      sportmonksId: row.league.sportmonksId,
      name: row.league.name,
      code: row.league.code,
      imageUrl: row.league.imageUrl,
    },
    season: { sportmonksId: row.season.sportmonksId, name: row.season.name },
    matchType: row.matchType,
    round: row.round,
    status: row.status,
    statusDetail: row.statusDetail,
    isLive,
    isFinished: FINISHED_STATUSES.has(row.status),
    note: row.resultSummary,
    startTime: row.startTime.toISOString(),
    venue: row.venueName || row.venueCity ? { name: row.venueName, city: row.venueCity } : null,
    localTeam: team(row.localTeam),
    visitorTeam: team(row.visitorTeam),
    winnerTeamSportmonksId: row.winnerTeam?.sportmonksId ?? null,
    innings: [],
    currentInning: null,
    battingTeamSportmonksId: null,
    score: null,
    wickets: null,
    overs: null,
    runRate: null,
    target: null,
    runsRequired: null,
    ballsRemaining: null,
    requiredRunRate: null,
    batsmen: [],
    bowler: null,
    lastUpdatedAt: row.updatedAt.toISOString(),
    // A stored row that says "live" means the live feed has no fresh data for it.
    stale: isLive,
  };
}
