import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AdsService } from './ads.service';
import { ActiveAdListResponseDto } from './dto/ad.response.dto';
import { ActiveAdsQueryDto } from './dto/list-ads.query.dto';

@ApiTags('Ads')
@ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limit exceeded (code TOO_MANY_REQUESTS).' })
@Controller({ path: 'ads', version: '1' })
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Get()
  @ApiOperation({
    summary: 'List ads that are active and inside their schedule',
    description:
      'Only ads with isActive=true whose startAt/endAt window contains the current time. Ordered by priority descending. Filter by placement, or omit it to get every active ad. Served from a Redis cache that admin changes invalidate immediately.',
  })
  @ApiOkResponse({ type: ActiveAdListResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Unknown placement (VALIDATION_ERROR).' })
  getActive(@Query() query: ActiveAdsQueryDto) {
    return this.ads.getActive(query.placement);
  }
}
