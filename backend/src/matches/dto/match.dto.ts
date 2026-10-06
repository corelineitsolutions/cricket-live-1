import { ApiProperty } from '@nestjs/swagger';
import { MatchStatus } from '@prisma/client';
import { PaginationMetaDto } from '../../common/dto/pagination.dto';

export class MatchTeamDto {
  @ApiProperty({ type: Number, nullable: true, example: 101, description: 'Team id. Use with GET /api/v1/teams/{id}.' })
  sportmonksId!: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'Mumbai Strikers' })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'MUM', description: 'Short code for compact layouts.' })
  shortName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'https://cdn.sportmonks.com/images/cricket/teams/5/101.png' })
  imageUrl!: string | null;
}

export class MatchLeagueDto {
  @ApiProperty({ example: 3, description: 'League id. Use with GET /api/v1/leagues/{id}.' })
  sportmonksId!: number;

  @ApiProperty({ type: String, nullable: true, example: 'Premier T20' })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'PT20' })
  code!: string | null;

  @ApiProperty({ type: String, nullable: true })
  imageUrl!: string | null;
}

export class MatchSeasonDto {
  @ApiProperty({ example: 1689 })
  sportmonksId!: number;

  @ApiProperty({ type: String, nullable: true, example: '2026' })
  name!: string | null;
}

export class MatchVenueDto {
  @ApiProperty({ type: String, nullable: true, example: 'Wankhede Stadium' })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Mumbai' })
  city!: string | null;
}

export class InningsScoreDto {
  @ApiProperty({ example: 1, description: 'Innings number: 1 and 2 in limited overs, up to 4 in Tests, 3+ for super overs.' })
  inning!: number;

  @ApiProperty({ example: 101, description: 'sportmonksId of the batting team.' })
  teamSportmonksId!: number;

  @ApiProperty({ example: 180 })
  score!: number;

  @ApiProperty({ example: 6 })
  wickets!: number;

  @ApiProperty({ example: 20, description: 'Overs in cricket notation: 15.2 means 15 overs and 2 balls.' })
  overs!: number;
}

export class BatsmanDto {
  @ApiProperty({ example: 9002, description: 'Player id. Use with GET /api/v1/players/{id}.' })
  sportmonksId!: number;

  @ApiProperty({ type: String, nullable: true, example: 'Rohan Mehta' })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  imageUrl!: string | null;

  @ApiProperty({ example: 54 })
  runs!: number;

  @ApiProperty({ example: 38 })
  balls!: number;

  @ApiProperty({ example: 5 })
  fours!: number;

  @ApiProperty({ example: 2 })
  sixes!: number;

  @ApiProperty({ type: Number, nullable: true, example: 142.11 })
  strikeRate!: number | null;
}

export class BowlerDto {
  @ApiProperty({ example: 7002, description: 'Player id. Use with GET /api/v1/players/{id}.' })
  sportmonksId!: number;

  @ApiProperty({ type: String, nullable: true, example: 'Kiran Patel' })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  imageUrl!: string | null;

  @ApiProperty({ example: 3.2, description: 'Overs in cricket notation.' })
  overs!: number;

  @ApiProperty({ example: 0 })
  maidens!: number;

  @ApiProperty({ example: 24 })
  runs!: number;

  @ApiProperty({ example: 2 })
  wickets!: number;

  @ApiProperty({ type: Number, nullable: true, example: 7.2 })
  economy!: number | null;
}

export const MATCH_SOURCES = ['live', 'stored'] as const;
export type MatchSource = (typeof MATCH_SOURCES)[number];

/** The match object returned by every match endpoint and every match socket event. */
export class MatchDto {
  @ApiProperty({
    example: 61521,
    description:
      'Public match id (the Latiyal match id). Use it for every match endpoint and for socket subscriptions.',
  })
  matchId!: number;

  @ApiProperty({
    enum: MATCH_SOURCES,
    example: 'live',
    description:
      '"live": from the live feed, scores are filled in. "stored": from saved match data only; score fields are null and lists are empty.',
  })
  source!: MatchSource;

  @ApiProperty({ type: MatchLeagueDto, nullable: true })
  league!: MatchLeagueDto | null;

  @ApiProperty({ type: MatchSeasonDto, nullable: true })
  season!: MatchSeasonDto | null;

  @ApiProperty({ type: String, nullable: true, example: 'T20', description: 'T20, T20I, ODI, T10, Test/5day, ...' })
  matchType!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '12th Match' })
  round!: string | null;

  @ApiProperty({ enum: MatchStatus, example: MatchStatus.LIVE, description: 'Normalized status. Drive UI state from this field.' })
  status!: MatchStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2nd Innings',
    description: 'Raw provider status for display, e.g. "1st Innings", "Innings Break", "Stump Day 2", "Finished".',
  })
  statusDetail!: string | null;

  @ApiProperty({ example: true, description: 'True while the match is in play (including breaks and interruptions).' })
  isLive!: boolean;

  @ApiProperty({ example: false, description: 'True once play is over: completed, abandoned, cancelled or postponed.' })
  isFinished!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Delhi Royals need 61 runs from 28 balls',
    description: 'Provider note. After the match this is the result text.',
  })
  note!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-01T14:00:00.000Z' })
  startTime!: string | null;

  @ApiProperty({ type: MatchVenueDto, nullable: true })
  venue!: MatchVenueDto | null;

  @ApiProperty({ type: MatchTeamDto })
  localTeam!: MatchTeamDto;

  @ApiProperty({ type: MatchTeamDto })
  visitorTeam!: MatchTeamDto;

  @ApiProperty({ type: Number, nullable: true, example: null, description: 'sportmonksId of the winning team, once known.' })
  winnerTeamSportmonksId!: number | null;

  @ApiProperty({ type: [InningsScoreDto], description: 'Every innings so far, oldest first. Empty before the first ball.' })
  innings!: InningsScoreDto[];

  @ApiProperty({ type: Number, nullable: true, example: 2 })
  currentInning!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 202, description: 'sportmonksId of the team batting now.' })
  battingTeamSportmonksId!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 120, description: 'Runs in the current innings.' })
  score!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 3, description: 'Wickets in the current innings.' })
  wickets!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 15.2, description: 'Overs in the current innings, cricket notation.' })
  overs!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 7.83, description: 'Current run rate (runs per over).' })
  runRate!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 181, description: 'Runs needed to win. Only during a chase.' })
  target!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 61, description: 'Runs still needed. Only during a chase.' })
  runsRequired!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 28, description: 'Legal balls left. Only in a limited-overs chase.' })
  ballsRemaining!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 13.07, description: 'Required run rate. Only in a limited-overs chase.' })
  requiredRunRate!: number | null;

  @ApiProperty({ type: [BatsmanDto], description: 'Batsmen at the crease (0 to 2).' })
  batsmen!: BatsmanDto[];

  @ApiProperty({ type: BowlerDto, nullable: true, description: 'Current (or most recent) bowler.' })
  bowler!: BowlerDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T16:25:00.000Z', description: 'When this match data last changed.' })
  lastUpdatedAt!: string;

  @ApiProperty({
    example: false,
    description: 'True when the backend could not refresh this match recently. Show the data with a "may be delayed" hint.',
  })
  stale!: boolean;
}

export class LiveMatchesDto {
  @ApiProperty({ type: [MatchDto], description: 'Matches in play right now. Empty when nothing is live.' })
  matches!: MatchDto[];

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Last time the backend successfully refreshed live data. Null if it never has.',
  })
  updatedAt!: string | null;

  @ApiProperty({ example: false, description: 'True when the live feed is delayed. The list may be out of date.' })
  stale!: boolean;
}

export class LiveMatchesResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: LiveMatchesDto })
  data!: LiveMatchesDto;
}

export class MatchListEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [MatchDto] })
  data!: MatchDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class MatchEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: MatchDto })
  data!: MatchDto;
}
