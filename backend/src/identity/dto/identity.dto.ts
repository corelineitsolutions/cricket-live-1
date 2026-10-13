import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IdentityMapStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { SearchQueryDto } from '../../common/dto/search-query.dto';

export const IDENTITY_KINDS = ['players', 'teams', 'venues'] as const;
export type IdentityKind = (typeof IDENTITY_KINDS)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class IdentityKindParamDto {
  @ApiProperty({ enum: IDENTITY_KINDS })
  @IsIn(IDENTITY_KINDS)
  kind!: IdentityKind;
}

export class IdentityRowParamDto extends IdentityKindParamDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  id!: string;
}

export class ListIdentityQueryDto extends SearchQueryDto {
  @ApiPropertyOptional({ enum: IdentityMapStatus })
  @IsOptional()
  @IsIn(Object.values(IdentityMapStatus))
  status?: IdentityMapStatus;
}

export class HistorySearchQueryDto {
  @ApiProperty({ description: 'Name contains this text (Cricsheet spelling)' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  q!: string;
}

export class ReviewIdentityDto {
  @ApiProperty({ enum: IdentityMapStatus, description: 'CONFIRMED rows are used by the AI history tools.' })
  @IsIn(Object.values(IdentityMapStatus))
  status!: IdentityMapStatus;
}

export class CreatePlayerMapDto {
  @ApiProperty({ description: 'Latiyal player id (sportmonksId of a player in the live database)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  latiyalPlayerId!: number;

  @ApiProperty({ example: 'ba607b88', description: 'Cricsheet person id' })
  @IsString()
  @Matches(/^[0-9a-f]{8}$/, { message: 'histPersonId must be an 8-character Cricsheet id' })
  histPersonId!: string;
}

export class CreateTeamMapDto {
  @ApiProperty({ description: 'Latiyal team id (sportmonksId of a team in the live database)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  latiyalTeamId!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  histTeamId!: number;

  @ApiProperty({ enum: ['male', 'female'] })
  @IsIn(['male', 'female'])
  gender!: 'male' | 'female';
}

export class CreateVenueMapDto {
  @ApiProperty({ description: 'Venue name exactly as shown on live matches' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  liveVenueName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  liveVenueCity?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  histVenueId!: number;
}
