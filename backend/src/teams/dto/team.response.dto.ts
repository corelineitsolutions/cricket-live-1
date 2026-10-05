import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination.dto';

export class TeamResponseDto {
  @ApiProperty({ example: 'clx1team0000000000000001', description: 'Internal backend id. Prefer sportmonksId.' })
  id!: string;

  @ApiProperty({ example: 101, description: 'Public team id, as used in match responses (localTeam.sportmonksId).' })
  sportmonksId!: number;

  @ApiProperty({ example: 'Mumbai Strikers' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'MUM', description: 'Short code for compact layouts.' })
  shortName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'https://cdn.sportmonks.com/images/cricket/teams/5/101.png' })
  imageUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'India' })
  country!: string | null;

  @ApiProperty({ format: 'date-time', description: 'When the backend first stored this team.' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', description: 'When the backend last changed this team.' })
  updatedAt!: string;
}

export class TeamListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [TeamResponseDto] })
  data!: TeamResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class TeamDetailsResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: TeamResponseDto })
  data!: TeamResponseDto;
}
