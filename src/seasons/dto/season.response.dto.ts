import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination.dto';

export class LeagueSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sportmonksId!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  code!: string | null;
}

export class SeasonResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sportmonksId!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  startDate!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  endDate!: string | null;

  @ApiProperty()
  isCurrent!: boolean;

  @ApiProperty({ type: LeagueSummaryDto })
  league!: LeagueSummaryDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class SeasonListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [SeasonResponseDto] })
  data!: SeasonResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class SeasonDetailsResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: SeasonResponseDto })
  data!: SeasonResponseDto;
}
