import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const COMMENTARY_MAX_ITEMS = 100;

export class CommentaryQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: COMMENTARY_MAX_ITEMS, description: 'Number of latest balls.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(COMMENTARY_MAX_ITEMS)
  limit: number = 30;
}

export class CommentaryPlayerDto {
  @ApiProperty({ type: Number, nullable: true, example: 9002 })
  sportmonksId!: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'Rohan Mehta' })
  name!: string | null;
}

export const EXTRA_TYPES = ['wide', 'noball', 'bye', 'legbye'] as const;
export type ExtraType = (typeof EXTRA_TYPES)[number];

export class CommentaryItemDto {
  @ApiProperty({ example: 4410023, description: 'Unique ball id. Use it to de-duplicate items.' })
  id!: number;

  @ApiProperty({ type: Number, nullable: true, example: 2 })
  inning!: number | null;

  @ApiProperty({ example: 15.2, description: 'Over and ball, cricket notation.' })
  over!: number;

  @ApiProperty({ type: Number, nullable: true, example: 202, description: 'sportmonksId of the batting team.' })
  teamSportmonksId!: number | null;

  @ApiProperty({ type: CommentaryPlayerDto })
  batsman!: CommentaryPlayerDto;

  @ApiProperty({ type: CommentaryPlayerDto })
  bowler!: CommentaryPlayerDto;

  @ApiProperty({ example: 4, description: 'Runs scored off the bat on this ball.' })
  runs!: number;

  @ApiProperty({ example: true })
  isFour!: boolean;

  @ApiProperty({ example: false })
  isSix!: boolean;

  @ApiProperty({ example: false })
  isWicket!: boolean;

  @ApiProperty({ enum: EXTRA_TYPES, nullable: true, example: null })
  extraType!: ExtraType | null;

  @ApiProperty({ example: 0 })
  extraRuns!: number;

  @ApiProperty({ type: String, nullable: true, example: 'Four', description: 'Provider result label for the ball.' })
  result!: string | null;

  @ApiProperty({ example: 'Kiran Patel to Rohan Mehta, FOUR', description: 'Ready-to-display line built from the ball data.' })
  text!: string;
}

export class CommentaryDto {
  @ApiProperty({ example: 61521 })
  matchId!: number;

  @ApiProperty({ type: [CommentaryItemDto], description: 'Newest ball first. Empty before the match starts.' })
  items!: CommentaryItemDto[];

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'When this feed was fetched.' })
  updatedAt!: string | null;

  @ApiProperty({ description: 'True when a refresh failed and this is the last good copy.' })
  stale!: boolean;
}

export class CommentaryEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: CommentaryDto })
  data!: CommentaryDto;
}
