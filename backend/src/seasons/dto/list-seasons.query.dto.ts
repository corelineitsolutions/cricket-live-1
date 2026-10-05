import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SearchQueryDto } from '../../common/dto/search-query.dto';

export class ListSeasonsQueryDto extends SearchQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  leagueId?: string;
}
