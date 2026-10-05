import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CommentaryEnvelopeDto, CommentaryQueryDto } from './dto/commentary.dto';
import { ListMatchesQueryDto } from './dto/list-matches.query.dto';
import { MatchIdParamDto } from './dto/match-id.param.dto';
import { LiveMatchesResponseDto, MatchEnvelopeDto, MatchListEnvelopeDto } from './dto/match.dto';
import { ScorecardEnvelopeDto } from './dto/scorecard.dto';
import { MatchDetailService } from './match-detail.service';
import { MatchesService } from './matches.service';

@ApiTags('Matches')
@ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limit exceeded (code TOO_MANY_REQUESTS).' })
@Controller({ path: 'matches', version: '1' })
export class MatchesController {
  constructor(
    private readonly matches: MatchesService,
    private readonly details: MatchDetailService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List stored matches',
    description: 'Matches the backend has saved (live or finished), newest first. Score fields are not filled in; use GET /matches/{id}.',
  })
  @ApiOkResponse({ type: MatchListEnvelopeDto })
  async list(@Query() query: ListMatchesQueryDto) {
    const result = await this.matches.list(query);
    return { data: result.items, meta: result.meta };
  }

  @Get('live')
  @ApiOperation({
    summary: 'Matches in play right now',
    description:
      'Served from Redis, refreshed by the live-score worker every 5–60 seconds. For updates, subscribe to each match over Socket.IO instead of polling this endpoint quickly.',
  })
  @ApiOkResponse({ type: LiveMatchesResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'Live data store unavailable (SERVICE_UNAVAILABLE).' })
  getLive() {
    return this.matches.getLive();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One match',
    description: 'Live data while the match is live or recently finished (source "live"); otherwise stored data (source "stored").',
  })
  @ApiOkResponse({ type: MatchEnvelopeDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id (VALIDATION_ERROR).' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Unknown match (RESOURCE_NOT_FOUND).' })
  getById(@Param() params: MatchIdParamDto) {
    return this.matches.getMatch(params.id);
  }

  @Get(':id/scorecard')
  @ApiOperation({
    summary: 'Full scorecard',
    description:
      'Batting, bowling and extras per innings. Cached: refreshed at most every 30 s while live, kept 24 h once finished. Empty before the match starts.',
  })
  @ApiOkResponse({ type: ScorecardEnvelopeDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'Scorecard cannot be loaded and no copy is cached.' })
  getScorecard(@Param() params: MatchIdParamDto) {
    return this.details.getScorecard(params.id);
  }

  @Get(':id/commentary')
  @ApiOperation({
    summary: 'Ball-by-ball commentary',
    description: 'Latest balls first. Cached: refreshed at most every 30 s while live. Empty before the match starts.',
  })
  @ApiOkResponse({ type: CommentaryEnvelopeDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'Commentary cannot be loaded and no copy is cached.' })
  getCommentary(@Param() params: MatchIdParamDto, @Query() query: CommentaryQueryDto) {
    return this.details.getCommentary(params.id, query.limit);
  }
}
