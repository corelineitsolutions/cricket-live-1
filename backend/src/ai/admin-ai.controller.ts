import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AdminOnly } from '../common/guards/admin-auth.guard';
import { AppConfigService } from '../config/app-config.service';
import { AiService } from './ai.service';
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

@ApiTags('Admin AI')
@AdminOnly()
@Controller({ path: 'admin/ai', version: '1' })
export class AdminAiController {
  constructor(
    private readonly ai: AiService,
    private readonly usage: AiUsageService,
    private readonly config: AppConfigService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary: 'AI assistant status and aggregate usage',
    description: 'Configuration status, limits and daily counters only. No questions, answers or device data exist to show.',
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
}
