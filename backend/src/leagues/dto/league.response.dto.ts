import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination.dto';

export class LeagueResponseDto {
  @ApiProperty({ example: 'clx1league0000000000001', description: 'Internal backend id. Prefer sportmonksId.' })
  id!: string;

  @ApiProperty({ example: 3, description: 'Public league id, as used in match responses (league.sportmonksId).' })
  sportmonksId!: number;

  @ApiProperty({ example: 'Premier T20' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'PT20' })
  code!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'https://cdn.sportmonks.com/images/cricket/leagues/3.png' })
  imageUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'India' })
  country!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'league', description: 'Provider competition type.' })
  type!: string | null;

  @ApiProperty({ format: 'date-time', description: 'When the backend first stored this league.' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', description: 'When the backend last changed this league.' })
  updatedAt!: string;
}

export class LeagueListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [LeagueResponseDto] })
  data!: LeagueResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class LeagueDetailsResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: LeagueResponseDto })
  data!: LeagueResponseDto;
}
