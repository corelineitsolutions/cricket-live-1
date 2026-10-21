import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AdminOnly } from '../common/guards/admin-auth.guard';
import { AppConfigService } from '../config/app-config.service';
import { AiService } from './ai.service';
import { AiTrainingService } from './ai-training.service';
import { AiUsageService, utcDay } from './ai-usage.service';

class AiUsageQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days: number = 30;
}

class AiTrainingQueryDto {
  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 100;

  @ApiPropertyOptional({ description: 'Only rows marked needsReview' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  needsReview?: boolean;
}

@ApiTags('Admin AI')
@AdminOnly()
@Controller({ path: 'admin/ai', version: '1' })
export class AdminAiController {
  constructor(
    private readonly ai: AiService,
    private readonly usage: AiUsageService,
    private readonly training: AiTrainingService,
    private readonly config: AppConfigService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary: 'AI assistant status and aggregate usage',
    description:
      'Configuration status, limits and daily counters. Question text is only available via GET /admin/ai/training-questions when AI_LOG_QUESTIONS=true.',
  })
  @ApiOkResponse({ description: 'Status, limits, today and daily history.' })
  async overview(@Query() query: AiUsageQueryDto) {
    const readiness = this.ai.readiness();
    const [tokensUsedToday, today, history] = await Promise.all([
      this.ai.tokensUsedToday(),
      this.usage.readDay(utcDay()).catch(() => null),
      this.usage.history(query.days).catch(() => null),
    ]);
    return {
      status: {
        enabled: this.config.aiEnabled,
        ready: readiness.ready,
        reason: readiness.reason,
        provider: this.ai.providerName,
        model: this.ai.modelName,
        mocked: this.ai.mocked,
        logQuestions: this.config.aiLogQuestions,
        dailyTokenBudget: this.config.aiDailyTokenBudget,
        tokensUsedToday,
        costPer1kInputTokens: this.config.llmCostPer1kInputTokens,
        costPer1kOutputTokens: this.config.llmCostPer1kOutputTokens,
      },
      limits: {
        perDevicePerMinute: this.config.aiRequestsPerDevicePerMinute,
        perDevicePerDay: this.config.aiRequestsPerDevicePerDay,
        perIpPerMinute: this.config.aiRequestsPerIpPerMinute,
        maxConcurrentPerInstance: this.config.aiMaxConcurrent,
        requestTimeoutMs: this.config.aiRequestTimeoutMs,
        maxOutputTokens: this.config.llmMaxOutputTokens,
      },
      today,
      history,
    };
  }

  @Get('training-questions')
  @ApiOperation({
    summary: 'Recent Ask questions for routing training',
    description: 'Requires AI_LOG_QUESTIONS=true on the API. Newest first.',
  })
  @ApiOkResponse({ description: 'Logged questions and review flags.' })
  async trainingQuestions(@Query() query: AiTrainingQueryDto) {
    return this.training.list({ limit: query.limit, needsReviewOnly: query.needsReview === true });
  }
}
