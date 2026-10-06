import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AdminOnly } from '../common/guards/admin-auth.guard';
import { MatchIdParamDto } from '../matches/dto/match-id.param.dto';
import { AdminMatchesService } from './admin-matches.service';
import { AdminLiveBoardEnvelopeDto, AdminMatchDetailEnvelopeDto } from './dto/admin-match.dto';

@ApiTags('Admin matches')
@AdminOnly()
@Controller({ path: 'admin/matches', version: '1' })
export class AdminMatchesController {
  constructor(private readonly matches: AdminMatchesService) {}

  @Get('live')
  @ApiOperation({
    summary: 'Live matches with internal ids and subscriber counts',
    description: 'Read-only. Scores come from Latiyal and cannot be edited.',
  })
  @ApiOkResponse({ type: AdminLiveBoardEnvelopeDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'Live data store unavailable (SERVICE_UNAVAILABLE).' })
  getLive() {
    return this.matches.getLive();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Inspect one match',
    description:
      'Accepts the Latiyal match id or the internal id. Shows the live snapshot, the MySQL row and the cache state side by side. Read-only.',
  })
  @ApiOkResponse({ type: AdminMatchDetailEnvelopeDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id (VALIDATION_ERROR).' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Unknown match (RESOURCE_NOT_FOUND).' })
  getMatch(@Param() params: MatchIdParamDto) {
    return this.matches.getMatch(params.id);
  }
}
