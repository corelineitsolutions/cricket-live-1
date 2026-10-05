import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination.dto';

export class PlayerResponseDto {
  @ApiProperty({ example: 'clx1player00000000000001', description: 'Internal backend id. Prefer sportmonksId.' })
  id!: string;

  @ApiProperty({ example: 9002, description: 'Public player id, as used in batsmen, bowler, scorecard and commentary.' })
  sportmonksId!: number;

  @ApiProperty({ example: 'Rohan Mehta' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'https://cdn.sportmonks.com/images/cricket/players/2/9002.png' })
  imageUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'India' })
  country!: string | null;

  @ApiProperty({ format: 'date-time', description: 'When the backend first stored this player.' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', description: 'When the backend last changed this player.' })
  updatedAt!: string;
}

export class PlayerListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [PlayerResponseDto] })
  data!: PlayerResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class PlayerDetailsResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: PlayerResponseDto })
  data!: PlayerResponseDto;
}
