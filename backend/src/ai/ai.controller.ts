import { Body, Controller, Get, HttpCode, Ip, Post, Query } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AiService } from './ai.service';
import { AI_LANGUAGES, AiStatusDto, AskDto, AskEnvelopeDto, SuggestionsEnvelopeDto } from './dto/ask.dto';

@ApiTags('AI assistant')
@Controller({ path: 'ai', version: '1' })
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  @ApiOperation({ summary: 'Whether the AI assistant can be used', description: 'Show the AI entry point only when available is true.' })
  @ApiOkResponse({ type: AiStatusDto })
  status() {
    return this.ai.status();
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'Suggested Ask chips for the UI',
    description:
      'Pass matchId on a match screen for format + innings-aware chips (no target/RRR in the 1st innings). ' +
      'Omit matchId for general IPL / World Cup / player chips.',
  })
  @ApiQuery({ name: 'matchId', required: false, example: '14193' })
  @ApiQuery({ name: 'language', required: false, enum: AI_LANGUAGES })
  @ApiOkResponse({ type: SuggestionsEnvelopeDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  suggestions(
    @Query('matchId') matchId?: string,
    @Query('language') language?: (typeof AI_LANGUAGES)[number],
  ) {
    const id = matchId && /^\d{1,10}$/.test(matchId) ? matchId : null;
    const lang = language === 'hi' ? 'hi' : 'en';
    return this.ai.suggestions(id, lang);
  }

  @Post('ask')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Ask the cricket assistant',
    description:
      'Answers cricket questions from live app data. Questions and answers are not stored or logged. Limits: per device 5/min and 50/day, per IP 20/min (configurable).',
  })
  @ApiOkResponse({ type: AskEnvelopeDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid body (VALIDATION_ERROR).' })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Question limit reached (AI_QUOTA_EXCEEDED).' })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'AI_DISABLED, AI_NOT_CONFIGURED, AI_BUDGET_EXHAUSTED, AI_BUSY or AI_TIMEOUT.',
  })
  @ApiBadGatewayResponse({ type: ErrorResponseDto, description: 'The AI provider failed (AI_PROVIDER_ERROR).' })
  ask(@Body() body: AskDto, @Ip() ip: string) {
    return this.ai.ask(body, ip);
  }
}
