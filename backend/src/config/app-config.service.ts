import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV') ?? 'development';
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.config.get<number>('PORT') ?? 3000;
  }

  get databaseUrl(): string {
    return this.config.getOrThrow<string>('DATABASE_URL');
  }

  /** Separate Cricsheet history DB when set; otherwise history tools use DATABASE_URL. */
  get historyDatabaseUrl(): string {
    return this.config.get<string>('HISTORY_DATABASE_URL') ?? '';
  }

  get redisHost(): string {
    return this.config.get<string>('REDIS_HOST') ?? '127.0.0.1';
  }

  get redisPort(): number {
    return this.config.get<number>('REDIS_PORT') ?? 6379;
  }

  get redisPassword(): string {
    return this.config.get<string>('REDIS_PASSWORD') ?? '';
  }

  get latiyalApiUrl(): string {
    return this.config.get<string>('LATIYAL_API_URL') ?? 'https://api.latiyalinfotech.com/apiv5';
  }

  get latiyalApiToken(): string {
    return this.config.get<string>('LATIYAL_API_TOKEN') ?? '';
  }

  // Defaults for the Latiyal settings live in env.validation.ts only.
  get latiyalIdleIntervalMs(): number {
    return Number(this.config.getOrThrow('LATIYAL_IDLE_INTERVAL_MS'));
  }

  get latiyalLiveIntervalMs(): number {
    return Number(this.config.getOrThrow('LATIYAL_LIVE_INTERVAL_MS'));
  }

  get latiyalActiveIntervalMs(): number {
    return Number(this.config.getOrThrow('LATIYAL_ACTIVE_INTERVAL_MS'));
  }

  /** How long one liveMatchList response is reused by the worker. 0 fetches it every cycle. */
  get latiyalListIntervalMs(): number {
    return Number(this.config.getOrThrow('LATIYAL_LIST_INTERVAL_MS'));
  }

  /** 0 means unlimited (the Latiyal plan has no call limit). */
  get latiyalMaxCallsPerHour(): number {
    return Number(this.config.getOrThrow('LATIYAL_MAX_CALLS_PER_HOUR'));
  }

  get latiyalTimeoutMs(): number {
    return Number(this.config.getOrThrow('LATIYAL_TIMEOUT_MS'));
  }

  get latiyalMaxRetries(): number {
    return Number(this.config.getOrThrow('LATIYAL_MAX_RETRIES'));
  }

  /** Hourly cap for user-driven requests (scorecard, commentary, data feeds). 0 means unlimited. */
  get latiyalOnDemandMaxCallsPerHour(): number {
    return Number(this.config.getOrThrow('LATIYAL_ON_DEMAND_MAX_CALLS_PER_HOUR'));
  }

  get rateLimitPerMinute(): number {
    return Number(this.config.getOrThrow('RATE_LIMIT_PER_MINUTE'));
  }

  get rateLimitBurstPerSecond(): number {
    return Number(this.config.getOrThrow('RATE_LIMIT_BURST_PER_SECOND'));
  }

  get liveScoreWorkerEnabled(): boolean {
    const value = this.config.getOrThrow<boolean | string>('LIVE_SCORE_WORKER_ENABLED');
    return value === true || value === 'true';
  }

  get firebaseProjectId(): string {
    return this.config.get<string>('FIREBASE_PROJECT_ID') ?? '';
  }

  get firebaseClientEmail(): string {
    return this.config.get<string>('FIREBASE_CLIENT_EMAIL') ?? '';
  }

  get firebasePrivateKey(): string {
    return this.config.get<string>('FIREBASE_PRIVATE_KEY') ?? '';
  }

  get jwtSecret(): string {
    return this.config.getOrThrow<string>('JWT_SECRET');
  }

  get jwtExpiresIn(): string {
    return this.config.get<string>('JWT_EXPIRES_IN') ?? '8h';
  }

  get corsOrigin(): string {
    return this.config.get<string>('CORS_ORIGIN') ?? '*';
  }

  /** Bearer token for GET /metrics (Prometheus). Empty disables the endpoint. */
  get metricsToken(): string {
    return this.config.get<string>('METRICS_TOKEN') ?? '';
  }

  get swaggerEnabled(): boolean {
    const value = this.config.get<boolean | string>('SWAGGER_ENABLED') ?? true;
    return value === true || value === 'true';
  }

  // Cricket AI assistant. Defaults live in env.validation.ts.
  get aiEnabled(): boolean {
    const value = this.config.get<boolean | string>('AI_ENABLED') ?? false;
    return value === true || value === 'true';
  }

  get llmProvider(): 'mock' | 'openai-compatible' {
    return this.config.get<string>('LLM_PROVIDER') === 'openai-compatible' ? 'openai-compatible' : 'mock';
  }

  get llmBaseUrl(): string {
    return this.config.get<string>('LLM_BASE_URL') ?? '';
  }

  get llmApiKey(): string {
    return this.config.get<string>('LLM_API_KEY') ?? '';
  }

  get llmModel(): string {
    return this.config.get<string>('LLM_MODEL') ?? '';
  }

  get llmTimeoutMs(): number {
    return Number(this.config.getOrThrow('LLM_TIMEOUT_MS'));
  }

  get llmMaxOutputTokens(): number {
    return Number(this.config.getOrThrow('LLM_MAX_OUTPUT_TOKENS'));
  }

  get llmCostPer1kInputTokens(): number {
    return Number(this.config.getOrThrow('LLM_COST_PER_1K_INPUT_TOKENS'));
  }

  get llmCostPer1kOutputTokens(): number {
    return Number(this.config.getOrThrow('LLM_COST_PER_1K_OUTPUT_TOKENS'));
  }

  /** Tokens per UTC day across all instances. 0 blocks real providers; the mock ignores it. */
  get aiDailyTokenBudget(): number {
    return Number(this.config.getOrThrow('AI_DAILY_TOKEN_BUDGET'));
  }

  /** Concurrent AI requests per API process. */
  get aiMaxConcurrent(): number {
    return Number(this.config.getOrThrow('AI_MAX_CONCURRENT'));
  }

  get aiRequestsPerDevicePerMinute(): number {
    return Number(this.config.getOrThrow('AI_REQUESTS_PER_DEVICE_PER_MINUTE'));
  }

  get aiRequestsPerDevicePerDay(): number {
    return Number(this.config.getOrThrow('AI_REQUESTS_PER_DEVICE_PER_DAY'));
  }

  get aiRequestsPerIpPerMinute(): number {
    return Number(this.config.getOrThrow('AI_REQUESTS_PER_IP_PER_MINUTE'));
  }

  get aiRequestTimeoutMs(): number {
    return Number(this.config.getOrThrow('AI_REQUEST_TIMEOUT_MS'));
  }

  /** Cricsheet history tools for the AI. Enable after hist_* import (HISTORY_DATABASE_URL or DATABASE_URL). */
  get aiHistoryEnabled(): boolean {
    const value = this.config.get<boolean | string>('AI_HISTORY_ENABLED') ?? false;
    return value === true || value === 'true';
  }
}
