import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { EntityIdParamDto } from '../common/dto/entity-id.param.dto';
import { SearchQueryDto } from '../common/dto/search-query.dto';
import { LeagueDetailsResponseDto, LeagueListResponseDto } from './dto/league.response.dto';
import { LeaguesService } from './leagues.service';

@ApiTags('Leagues')
@ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limit exceeded (code TOO_MANY_REQUESTS).' })
@Controller({ path: 'leagues', version: '1' })
export class LeaguesController {
  constructor(private readonly leagues: LeaguesService) {}

  @Get()
  @ApiOperation({ summary: 'List leagues' })
  @ApiOkResponse({ type: LeagueListResponseDto })
  async list(@Query() query: SearchQueryDto) {
    const result = await this.leagues.list(query);
    return { data: result.items, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a league', description: 'id is league.sportmonksId from match responses. Cached for up to 10 minutes.' })
  @ApiOkResponse({ type: LeagueDetailsResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id (VALIDATION_ERROR).' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  getById(@Param() params: EntityIdParamDto) {
    return this.leagues.getById(params.id);
  }
}
