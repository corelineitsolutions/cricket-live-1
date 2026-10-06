import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { FEED_PARAM_NAMES, LATIYAL_FEEDS } from '../latiyal/latiyal-catalog';
import { FeedCatalogEnvelopeDto, FeedEnvelopeDto } from './dto/feed.dto';
import { FeedsService } from './feeds.service';

@ApiTags('Feeds')
@ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limit exceeded (code TOO_MANY_REQUESTS).' })
@Controller({ path: 'feeds', version: '1' })
export class FeedsController {
  constructor(private readonly feeds: FeedsService) {}

  @Get()
  @ApiOperation({
    summary: 'List every cricket data feed',
    description: 'All Latiyal endpoints this API serves, with their parameters and how often each is refreshed.',
  })
  @ApiOkResponse({ type: FeedCatalogEnvelopeDto })
  catalog() {
    return this.feeds.catalog();
  }

  @Get(':endpoint')
  @ApiOperation({
    summary: 'One cricket data feed',
    description:
      'Latiyal data passed through unchanged in `data`, cached for the feed\'s refresh period (1 s for liveMatch up to 24 h for reference data). ' +
      'Parameters use the Latiyal names, e.g. `/feeds/scorecardByMatchId?match_id=4012` or `/feeds/seriesStatsBySeriesId?series_id=418&type=1&sub_type=1`.',
  })
  @ApiParam({ name: 'endpoint', enum: LATIYAL_FEEDS.map((feed) => feed.endpoint) })
  @ApiQuery({ name: 'params', required: false, description: 'Only the parameters the feed lists are accepted.', schema: { type: 'object' }, style: 'form', explode: true })
  @ApiOkResponse({ type: FeedEnvelopeDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: `Missing, unknown or non-numeric parameter (VALIDATION_ERROR). Parameters: ${FEED_PARAM_NAMES.join(', ')}.` })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Unknown feed (RESOURCE_NOT_FOUND).' })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'Latiyal is unavailable and no copy is cached (SERVICE_UNAVAILABLE).' })
  get(@Param('endpoint') endpoint: string, @Query() query: Record<string, unknown>) {
    return this.feeds.get(endpoint, query);
  }
}
