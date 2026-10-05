import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IdParamDto } from '../common/dto/id-param.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AdminOnly } from '../common/guards/admin-auth.guard';
import { AdsService } from './ads.service';
import { AdListResponseDto, AdminAdDetailsResponseDto, DeletedAdEnvelopeDto } from './dto/ad.response.dto';
import { CreateAdDto } from './dto/create-ad.dto';
import { ListAdsQueryDto } from './dto/list-ads.query.dto';
import { UpdateAdDto } from './dto/update-ad.dto';

const CACHE_NOTE = 'The public GET /api/v1/ads reflects the change immediately (the Redis cache is invalidated).';

@ApiTags('Admin ads')
@AdminOnly()
@Controller({ path: 'admin/ads', version: '1' })
export class AdminAdsController {
  constructor(private readonly ads: AdsService) {}

  @Get()
  @ApiOperation({ summary: 'List ads, including inactive, scheduled and expired ones' })
  @ApiOkResponse({ type: AdListResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async list(@Query() query: ListAdsQueryDto) {
    const result = await this.ads.list(query);
    return { data: result.items, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an ad' })
  @ApiOkResponse({ type: AdminAdDetailsResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  getById(@Param() params: IdParamDto) {
    return this.ads.getById(params.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create an ad', description: CACHE_NOTE })
  @ApiOkResponse({ type: AdminAdDetailsResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid fields or endAt before startAt (VALIDATION_ERROR).' })
  create(@Body() dto: CreateAdDto) {
    return this.ads.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an ad (partial)', description: CACHE_NOTE })
  @ApiOkResponse({ type: AdminAdDetailsResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  update(@Param() params: IdParamDto, @Body() dto: UpdateAdDto) {
    return this.ads.update(params.id, dto);
  }

  @Patch(':id/activate')
  @ApiOperation({ summary: 'Activate an ad', description: `Sets isActive=true. It is served while inside startAt/endAt. ${CACHE_NOTE}` })
  @ApiOkResponse({ type: AdminAdDetailsResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  activate(@Param() params: IdParamDto) {
    return this.ads.setActive(params.id, true);
  }

  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate an ad', description: `Sets isActive=false. ${CACHE_NOTE}` })
  @ApiOkResponse({ type: AdminAdDetailsResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  deactivate(@Param() params: IdParamDto) {
    return this.ads.setActive(params.id, false);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an ad permanently', description: `Prefer deactivate to keep history. ${CACHE_NOTE}` })
  @ApiOkResponse({ type: DeletedAdEnvelopeDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  remove(@Param() params: IdParamDto) {
    return this.ads.remove(params.id);
  }
}
