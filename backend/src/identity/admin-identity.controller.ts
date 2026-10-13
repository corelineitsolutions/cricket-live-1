import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPrincipal, CurrentAdmin } from '../common/decorators/current-admin.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AdminOnly } from '../common/guards/admin-auth.guard';
import {
  CreatePlayerMapDto,
  CreateTeamMapDto,
  CreateVenueMapDto,
  HistorySearchQueryDto,
  IdentityKindParamDto,
  IdentityRowParamDto,
  ListIdentityQueryDto,
  ReviewIdentityDto,
} from './dto/identity.dto';
import { IdentityService } from './identity.service';

const CONFIRMED_NOTE = 'Only CONFIRMED mappings are used by the AI history tools.';

@ApiTags('Admin identity mapping')
@AdminOnly()
@Controller({ path: 'admin/identity', version: '1' })
export class AdminIdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Mapping counts per status, plus live and Cricsheet entity counts' })
  @ApiOkResponse({ description: 'Counts.' })
  summary() {
    return this.identity.summary();
  }

  @Post('players')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a player mapping by hand', description: CONFIRMED_NOTE })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Either side is already confirmed to someone else.' })
  createPlayer(@Body() dto: CreatePlayerMapDto, @CurrentAdmin() admin: AdminPrincipal) {
    return this.identity.createPlayer(dto, admin.id);
  }

  @Post('teams')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a team mapping by hand', description: CONFIRMED_NOTE })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  createTeam(@Body() dto: CreateTeamMapDto, @CurrentAdmin() admin: AdminPrincipal) {
    return this.identity.createTeam(dto, admin.id);
  }

  @Post('venues')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a venue mapping by hand', description: CONFIRMED_NOTE })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  createVenue(@Body() dto: CreateVenueMapDto, @CurrentAdmin() admin: AdminPrincipal) {
    return this.identity.createVenue(dto, admin.id);
  }

  @Get(':kind')
  @ApiOperation({ summary: 'List mappings for review', description: 'Ordered by confidence. `q` searches live and Cricsheet names.' })
  @ApiOkResponse({ description: 'Mappings with the names on both sides.' })
  async list(@Param() params: IdentityKindParamDto, @Query() query: ListIdentityQueryDto) {
    const result = await this.identity.list(params.kind, query);
    return { data: result.items, meta: result.meta };
  }

  @Post(':kind/propose')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Propose mappings by name matching',
    description: 'Adds PROPOSED rows and refreshes existing PROPOSED ones. Never confirms anything and never changes reviewed rows.',
  })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'A run is already in progress.' })
  propose(@Param() params: IdentityKindParamDto) {
    return this.identity.propose(params.kind);
  }

  @Get(':kind/history-search')
  @ApiOperation({ summary: 'Find Cricsheet people, teams or venues by name (for manual mapping)' })
  searchHistory(@Param() params: IdentityKindParamDto, @Query() query: HistorySearchQueryDto) {
    return this.identity.searchHistory(params.kind, query.q);
  }

  @Patch(':kind/:id')
  @ApiOperation({ summary: 'Confirm, reject or reopen a mapping', description: CONFIRMED_NOTE })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Confirming would map one entity to two others.' })
  review(@Param() params: IdentityRowParamDto, @Body() dto: ReviewIdentityDto, @CurrentAdmin() admin: AdminPrincipal) {
    return this.identity.review(params.kind, params.id, dto.status, admin.id);
  }
}
