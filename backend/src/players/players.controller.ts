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
import { PlayerDetailsResponseDto, PlayerListResponseDto } from './dto/player.response.dto';
import { PlayersService } from './players.service';

@ApiTags('Players')
@ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limit exceeded (code TOO_MANY_REQUESTS).' })
@Controller({ path: 'players', version: '1' })
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Get()
  @ApiOperation({ summary: 'List players' })
  @ApiOkResponse({ type: PlayerListResponseDto })
  async list(@Query() query: SearchQueryDto) {
    const result = await this.players.list(query);
    return { data: result.items, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a player',
    description:
      'id is the player sportmonksId from batsmen, bowler, scorecard or commentary. Players are stored once seen in a live match or scorecard. Cached for up to 10 minutes.',
  })
  @ApiOkResponse({ type: PlayerDetailsResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id (VALIDATION_ERROR).' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  getById(@Param() params: EntityIdParamDto) {
    return this.players.getById(params.id);
  }
}
