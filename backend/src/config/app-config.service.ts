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
}
