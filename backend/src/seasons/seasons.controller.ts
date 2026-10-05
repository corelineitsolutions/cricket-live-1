import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { IdParamDto } from '../common/dto/id-param.dto';
import { ListSeasonsQueryDto } from './dto/list-seasons.query.dto';
import { SeasonDetailsResponseDto, SeasonListResponseDto } from './dto/season.response.dto';
import { SeasonsService } from './seasons.service';

@ApiTags('Seasons')
@Controller({ path: 'seasons', version: '1' })
export class SeasonsController {
  constructor(private readonly seasons: SeasonsService) {}

  @Get()
  @ApiOperation({ summary: 'List seasons' })
  @ApiOkResponse({ type: SeasonListResponseDto })
  async list(@Query() query: ListSeasonsQueryDto) {
    const result = await this.seasons.list(query);
    return { data: result.items, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a season' })
  @ApiOkResponse({ type: SeasonDetailsResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  getById(@Param() params: IdParamDto) {
    return this.seasons.getById(params.id);
  }
}
