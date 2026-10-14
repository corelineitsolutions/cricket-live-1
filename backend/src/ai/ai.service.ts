import { createHmac } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RedisKey } from '../common/constants/redis-keys';
import { apiError } from '../common/utils/http-errors';
import { logEvent } from '../common/utils/structured-log';
import { AppConfigService } from '../config/app-config.service';
import { FeedsService } from '../feeds/feeds.service';
import { HistoryQueryService } from '../history/history-query.service';
import { IdentityService } from '../identity/identity.service';
import { MatchDetailService } from '../matches/match-detail.service';
import { MatchesService } from '../matches/matches.service';
import { RedisService } from '../redis/redis.service';
import { AI_DISCLAIMER, AiErrorCode, LLM_PROVIDER } from './ai.constants';
import { AiGateway } from './ai-gateway';
import { AiUsageService, UsageIncrements, utcDay } from './ai-usage.service';
import { AI_LANGUAGES, AI_QUESTION_MAX_LENGTH, AiStatusDto, AskDto, AskResultDto } from './dto/ask.dto';
import { LlmProvider, LlmProviderError } from './llm/llm.types';
import { validateLlmBaseUrl } from './llm/openai-compatible.provider';
import { AiToolRegistry } from './tools/ai-tool.registry';
import { requiredRateTool } from './tools/calculator-tools';
import { createHistoryTools } from './tools/history-tools';
import { createLiveTools } from './tools/live-tools';
import { createPredictionTools } from './tools/prediction-tools';

export interface AiReadiness {
  ready: boolean;
  reason: string | null;
}

/** Whether the configured provider may be used. A real provider needs a URL, model, key and a token budget. */
export function aiReadiness(config: AppConfigService): AiReadiness {
  if (config.llmProvider === 'mock') return { ready: true, reason: null };
  const baseUrl = validateLlmBaseUrl(config.llmBaseUrl);
  if (!baseUrl) return { ready: false, reason: 'LLM_BASE_URL must be https (or http to localhost) without credentials or query' };
  if (!config.llmModel) return { ready: false, reason: 'LLM_MODEL is not set' };
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname);
  if (!local && !config.llmApiKey) return { ready: false, reason: 'LLM_API_KEY is not set' };
  if (config.aiDailyTokenBudget <= 0) {
    return { ready: false, reason: 'AI_DAILY_TOKEN_BUDGET must be greater than 0 before a real provider is used' };
  }
  return { ready: true, reason: null };
}

const MINUTE_TTL_SECONDS = 120;
const DAY_TTL_SECONDS = 2 * 24 * 3600;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly gateway: AiGateway | null;
  private inFlight = 0;

  constructor(
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
    private readonly usage: AiUsageService,
    matches: MatchesService,
    details: MatchDetailService,
    history: HistoryQueryService,
    identity: IdentityService,
    feeds: FeedsService,
    @Optional() @Inject(LLM_PROVIDER) private readonly provider: LlmProvider | null,
  ) {
    const tools = new AiToolRegistry([
      ...createLiveTools(matches, details),
      requiredRateTool,
      ...createPredictionTools(matches, feeds, config.aiHistoryEnabled ? { history, identity } : {}),
      ...(config.aiHistoryEnabled ? createHistoryTools(history, identity, matches) : []),
    ]);
    this.gateway = provider ? new AiGateway(provider, tools) : null;
  }

  readiness(): AiReadiness {
    if (!this.config.aiEnabled) return { ready: false, reason: 'AI_ENABLED is false' };
    const readiness = aiReadiness(this.config);
    if (readiness.ready && !this.gateway) return { ready: false, reason: 'provider could not be created' };
    return readiness;
  }

  status(): AiStatusDto {
    return { available: this.readiness().ready, languages: [...AI_LANGUAGES], maxQuestionLength: AI_QUESTION_MAX_LENGTH };
  }

  get providerName(): string {
    return this.provider?.name ?? this.config.llmProvider;
  }

  get modelName(): string {
    return this.provider?.model ?? (this.config.llmModel || 'unset');
  }

  get mocked(): boolean {
    return this.provider?.mocked ?? this.config.llmProvider === 'mock';
  }

  async ask(dto: AskDto, ip: string): Promise<AskResultDto> {
    const started = Date.now();
    const language = dto.language ?? 'en';
    const base: UsageIncrements = { requests: 1, [language === 'hi' ? 'languageHi' : 'languageEn']: 1 };
    const refuse = async (field: keyof UsageIncrements, error: HttpException, reason: string): Promise<never> => {
      await this.usage.record(this.providerName, this.modelName, { ...base, [field]: 1 });
      logEvent(this.logger, 'log', 'ai-ask', { outcome: 'refused', reason, language });
      throw error;
    };

    if (!this.config.aiEnabled) {
      return refuse('refusedDisabled', apiError(HttpStatus.SERVICE_UNAVAILABLE, 'The AI assistant is switched off', AiErrorCode.DISABLED), 'disabled');
    }
    if (!this.readiness().ready || !this.gateway || !this.provider) {
      return refuse(
        'refusedDisabled',
        apiError(HttpStatus.SERVICE_UNAVAILABLE, 'The AI assistant is not configured', AiErrorCode.NOT_CONFIGURED),
        'not_configured',
      );
    }

    let quota: 'ok' | 'ip' | 'device_minute' | 'device_day';
    try {
      quota = await this.takeQuota(dto.deviceId, ip);
    } catch {
      return refuse(
        'errors',
        apiError(HttpStatus.SERVICE_UNAVAILABLE, 'The AI assistant is temporarily unavailable', AiErrorCode.BUSY),
        'quota_store_down',
      );
    }
    if (quota !== 'ok') {
      const message = quota === 'device_day' ? 'Daily question limit reached. Try again tomorrow.' : 'Too many questions. Wait a minute and try again.';
      return refuse('refusedQuota', apiError(HttpStatus.TOO_MANY_REQUESTS, message, AiErrorCode.QUOTA_EXCEEDED), quota);
    }

    if (!this.provider.mocked) {
      const used = await this.usage.tokensUsedToday().catch(() => Number.POSITIVE_INFINITY);
      if (used >= this.config.aiDailyTokenBudget) {
        return refuse(
          'refusedBudget',
          apiError(HttpStatus.SERVICE_UNAVAILABLE, 'The AI assistant has reached its daily limit', AiErrorCode.BUDGET_EXHAUSTED),
          'budget',
        );
      }
    }

    if (this.inFlight >= this.config.aiMaxConcurrent) {
      return refuse('refusedBusy', apiError(HttpStatus.SERVICE_UNAVAILABLE, 'The AI assistant is busy. Try again shortly.', AiErrorCode.BUSY), 'busy');
    }

    this.inFlight++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.aiRequestTimeoutMs);
    try {
      const result = await this.gateway.answer({
        question: dto.question,
        language,
        matchId: dto.matchId ?? null,
        maxOutputTokens: this.config.llmMaxOutputTokens,
        signal: controller.signal,
      });
      const { promptTokens, completionTokens } = result.usage;
      if (!this.provider.mocked) await this.usage.addTokens(promptTokens + completionTokens).catch(() => undefined);
      const costMicros = this.provider.mocked
        ? 0
        : Math.round(promptTokens * this.config.llmCostPer1kInputTokens * 1000 + completionTokens * this.config.llmCostPer1kOutputTokens * 1000);
      const latencyMs = Date.now() - started;
      await this.usage.record(this.providerName, this.modelName, {
        ...base,
        answered: 1,
        promptTokens,
        completionTokens,
        toolCalls: result.toolCalls,
        latencyMsTotal: latencyMs,
        costMicros,
      });
      logEvent(this.logger, 'log', 'ai-ask', {
        outcome: 'answered',
        provider: this.providerName,
        language,
        modelCalls: result.modelCalls,
        toolCalls: result.toolCalls,
        tools: result.toolsUsed,
        promptTokens,
        completionTokens,
        latencyMs,
      });
      return {
        answer: result.answer,
        language,
        sources: result.sources,
        mocked: this.provider.mocked,
        disclaimer: AI_DISCLAIMER[language],
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      const timedOut = controller.signal.aborted || (error instanceof LlmProviderError && error.kind === 'timeout');
      await this.usage.record(this.providerName, this.modelName, { ...base, [timedOut ? 'timeouts' : 'errors']: 1 });
      logEvent(this.logger, 'warn', 'ai-ask', {
        outcome: timedOut ? 'timeout' : 'error',
        provider: this.providerName,
        kind: error instanceof LlmProviderError ? error.kind : 'internal',
        status: error instanceof LlmProviderError ? error.status : null,
        latencyMs: Date.now() - started,
      });
      throw timedOut
        ? apiError(HttpStatus.SERVICE_UNAVAILABLE, 'The AI assistant took too long. Try again.', AiErrorCode.TIMEOUT)
        : apiError(HttpStatus.BAD_GATEWAY, 'The AI assistant could not answer right now', AiErrorCode.PROVIDER_ERROR);
    } finally {
      clearTimeout(timer);
      this.inFlight--;
    }
  }

  async tokensUsedToday(): Promise<number | null> {
    return this.usage.tokensUsedToday().catch(() => null);
  }

  /** Keyed hash so neither Redis nor logs ever see a raw device id or IP address. */
  private pseudonym(kind: string, value: string): string {
    return createHmac('sha256', this.config.jwtSecret).update(`ai:${kind}:${value}`).digest('base64url').slice(0, 22);
  }

  private async takeQuota(deviceId: string, ip: string): Promise<'ok' | 'ip' | 'device_minute' | 'device_day'> {
    const minute = Math.floor(Date.now() / 60_000);
    const device = this.pseudonym('device', deviceId);
    const client = this.pseudonym('ip', ip || 'unknown');
    if ((await this.redis.incrementIfBelow(RedisKey.aiIpMinute(client, minute), this.config.aiRequestsPerIpPerMinute, MINUTE_TTL_SECONDS)) === null) {
      return 'ip';
    }
    if (
      (await this.redis.incrementIfBelow(RedisKey.aiDeviceMinute(device, minute), this.config.aiRequestsPerDevicePerMinute, MINUTE_TTL_SECONDS)) ===
      null
    ) {
      return 'device_minute';
    }
    if ((await this.redis.incrementIfBelow(RedisKey.aiDeviceDay(device, utcDay()), this.config.aiRequestsPerDevicePerDay, DAY_TTL_SECONDS)) === null) {
      return 'device_day';
    }
    return 'ok';
  }
}
