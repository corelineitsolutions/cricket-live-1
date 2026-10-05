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
import { TeamDetailsResponseDto, TeamListResponseDto } from './dto/team.response.dto';
import { TeamsService } from './teams.service';

@ApiTags('Teams')
@ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limit exceeded (code TOO_MANY_REQUESTS).' })
@Controller({ path: 'teams', version: '1' })
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @ApiOperation({ summary: 'List teams' })
  @ApiOkResponse({ type: TeamListResponseDto })
  async list(@Query() query: SearchQueryDto) {
    const result = await this.teams.list(query);
    return { data: result.items, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a team', description: 'id is the team sportmonksId from match responses. Cached for up to 10 minutes.' })
  @ApiOkResponse({ type: TeamDetailsResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id (VALIDATION_ERROR).' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  getById(@Param() params: EntityIdParamDto) {
    return this.teams.getById(params.id);
  }
}
