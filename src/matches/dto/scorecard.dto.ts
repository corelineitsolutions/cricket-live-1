import { ApiProperty } from '@nestjs/swagger';
import { MatchStatus } from '@prisma/client';
import { MatchTeamDto } from './match.dto';

export class DismissalDto {
  @ApiProperty({ type: String, nullable: true, example: 'Catch Out', description: 'Provider dismissal type.' })
  type!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Kiran Patel' })
  bowlerName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Arjun Singh', description: 'Catcher, stumper or run-out fielder.' })
  fielderName!: string | null;
}

export class FallOfWicketDto {
  @ApiProperty({ example: 34, description: 'Team score when the wicket fell.' })
  score!: number;

  @ApiProperty({ type: Number, nullable: true, example: 4.3, description: 'Over when the wicket fell, cricket notation.' })
  overs!: number | null;
}

export class ScorecardBattingDto {
  @ApiProperty({ example: 9002 })
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

  @ApiProperty({ example: false })
  isOut!: boolean;

  @ApiProperty({ example: true, description: 'True while the batsman is at the crease.' })
  atCrease!: boolean;

  @ApiProperty({ type: DismissalDto, nullable: true, description: 'Null while not out.' })
  dismissal!: DismissalDto | null;

  @ApiProperty({ type: FallOfWicketDto, nullable: true })
  fallOfWicket!: FallOfWicketDto | null;
}

export class ScorecardBowlingDto {
  @ApiProperty({ example: 7002 })
  sportmonksId!: number;

  @ApiProperty({ type: String, nullable: true, example: 'Kiran Patel' })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  imageUrl!: string | null;

  @ApiProperty({ example: 3.2 })
  overs!: number;

  @ApiProperty({ example: 0 })
  maidens!: number;

  @ApiProperty({ example: 24 })
  runs!: number;

  @ApiProperty({ example: 2 })
  wickets!: number;

  @ApiProperty({ example: 1 })
  wides!: number;

  @ApiProperty({ example: 0 })
  noBalls!: number;

  @ApiProperty({ type: Number, nullable: true, example: 7.2 })
  economy!: number | null;

  @ApiProperty({ example: true, description: 'True for the bowler currently bowling.' })
  active!: boolean;
}

export class ExtrasDto {
  @ApiProperty({ example: 9 })
  total!: number;

  @ApiProperty({ example: 4 })
  wides!: number;

  @ApiProperty({ example: 1 })
  noBalls!: number;

  @ApiProperty({ example: 2 })
  byes!: number;

  @ApiProperty({ example: 2 })
  legByes!: number;

  @ApiProperty({ example: 0 })
  penalty!: number;
}

export class ScorecardInningsDto {
  @ApiProperty({ example: 1 })
  inning!: number;

  @ApiProperty({ type: MatchTeamDto, description: 'Batting team.' })
  team!: MatchTeamDto;

  @ApiProperty({ example: 180 })
  score!: number;

  @ApiProperty({ example: 6 })
  wickets!: number;

  @ApiProperty({ example: 20 })
  overs!: number;

  @ApiProperty({ type: ExtrasDto, nullable: true })
  extras!: ExtrasDto | null;

  @ApiProperty({ type: [ScorecardBattingDto], description: 'Batting order.' })
  batting!: ScorecardBattingDto[];

  @ApiProperty({ type: [ScorecardBowlingDto], description: 'Bowlers in the order they came on.' })
  bowling!: ScorecardBowlingDto[];
}

export class ScorecardDto {
  @ApiProperty({ example: 61521 })
  matchId!: number;

  @ApiProperty({ enum: MatchStatus })
  status!: MatchStatus;

  @ApiProperty()
  isLive!: boolean;

  @ApiProperty()
  isFinished!: boolean;

  @ApiProperty({ type: [ScorecardInningsDto], description: 'Empty before the match starts.' })
  innings!: ScorecardInningsDto[];

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When this scorecard was fetched. Null when nothing has been fetched (match not started).',
  })
  updatedAt!: string | null;

  @ApiProperty({ description: 'True when a refresh failed and this is the last good copy.' })
  stale!: boolean;
}

export class ScorecardEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: ScorecardDto })
  data!: ScorecardDto;
}
