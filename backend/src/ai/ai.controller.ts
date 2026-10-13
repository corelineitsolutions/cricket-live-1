import { Body, Controller, Get, HttpCode, Ip, Post } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AiService } from './ai.service';
import { AiStatusDto, AskDto, AskEnvelopeDto } from './dto/ask.dto';

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
