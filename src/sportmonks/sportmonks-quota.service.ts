import { Injectable, Logger } from '@nestjs/common';
import { RedisKey } from '../common/constants/redis-keys';
import { logEvent } from '../common/utils/structured-log';
import { AppConfigService } from '../config/app-config.service';
import { RedisService } from '../redis/redis.service';
import type { ApiRateLimit } from './rate-limit.parser';

const HOUR_MS = 3_600_000;
const QUOTA_KEY_TTL_SECONDS = 3_700;
const WARNING_RATIO = 0.2;
const WARNING_LOG_INTERVAL_MS = 60_000;

export interface RateLimitState {
  maxCallsPerHour: number;
  callsThisHour: number;
  windowResetAt: string;
  apiLimit: number | null;
  apiRemaining: number | null;
  apiResetAt: string | null;
  source: 'api' | 'local';
  effectiveRemaining: number;
  lastRequestAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastStatus: number | null;
  count429: number;
  last429At: string | null;
  updatedAt: string;
}

export type QuotaBudgetKind = 'live' | 'on-demand';

export interface QuotaDecision {
  allowed: boolean;
  remaining: number;
  retryInMs: number;
}

export interface QuotaBudget {
  remaining: number;
  msUntilReset: number;
}

export function hourBucket(now: number): string {
  return new Date(now).toISOString().slice(0, 13).replace(/[-T]/g, '');
}

export function nextHourStart(now: number): number {
  return Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS;
}

/**
 * Hourly call budget shared by every worker through Redis.
 * The local counter enforces SPORTMONKS_MAX_CALLS_PER_HOUR. When Sportmonks reports
 * rate-limit metadata it is authoritative, minus the same safety margin.
 */
@Injectable()
export class SportmonksQuotaService {
  private readonly logger = new Logger(SportmonksQuotaService.name);
  private lastWarningAt = 0;

  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * `on-demand` calls (user-driven detail requests) must also fit in their own hourly
   * share, so they can never starve the live-score worker.
   */
  async tryConsume(budget: QuotaBudgetKind = 'live'): Promise<QuotaDecision> {
    const now = Date.now();
    if (budget === 'on-demand') {
      const max = this.config.sportmonksOnDemandMaxCallsPerHour;
      const used =
        max > 0
          ? await this.redis.incrementIfBelow(RedisKey.sportmonksOnDemandQuota(hourBucket(now)), max, QUOTA_KEY_TTL_SECONDS)
          : null;
      if (used === null) {
        logEvent(this.logger, 'warn', 'rate-limit', { allowed: false, source: 'on-demand', maxCallsPerHour: max });
        return { allowed: false, remaining: 0, retryInMs: Math.max(1000, nextHourStart(now) - now) };
      }
    }

    const state = await this.loadState(now);
    const apiRemaining = this.apiRemaining(state, now);

    if (apiRemaining !== null && apiRemaining <= 0) {
      const retryInMs = Math.max(1000, Date.parse(state.apiResetAt!) - now);
      logEvent(this.logger, 'warn', 'rate-limit', {
        allowed: false,
        source: 'api',
        apiRemaining: state.apiRemaining,
        resetAt: state.apiResetAt,
      });
      return { allowed: false, remaining: 0, retryInMs };
    }

    const max = this.config.sportmonksMaxCallsPerHour;
    const count = await this.redis.incrementIfBelow(
      RedisKey.sportmonksQuota(hourBucket(now)),
      max,
      QUOTA_KEY_TTL_SECONDS,
    );
    const windowResetAt = nextHourStart(now);

    if (count === null) {
      logEvent(this.logger, 'warn', 'rate-limit', {
        allowed: false,
        source: 'local',
        maxCallsPerHour: max,
        resetAt: new Date(windowResetAt).toISOString(),
      });
      return { allowed: false, remaining: 0, retryInMs: Math.max(1000, windowResetAt - now) };
    }

    state.callsThisHour = count;
    state.windowResetAt = new Date(windowResetAt).toISOString();
    state.lastRequestAt = new Date(now).toISOString();
    if (state.apiRemaining !== null) {
      state.apiRemaining = Math.max(0, state.apiRemaining - 1);
    }
    const remaining = this.effectiveRemaining(state, now);
    await this.saveState(state, now);
    this.warnIfLow(remaining, max);

    return { allowed: true, remaining, retryInMs: 0 };
  }

  async recordResponse(status: number, rateLimit: ApiRateLimit | null): Promise<void> {
    const now = Date.now();
    const state = await this.loadState(now);
    const iso = new Date(now).toISOString();
    state.lastStatus = status;
    if (status >= 200 && status < 300) {
      state.lastSuccessAt = iso;
    } else {
      state.lastErrorAt = iso;
    }
    if (rateLimit) {
      state.apiLimit = rateLimit.limit ?? state.apiLimit;
      state.apiRemaining = rateLimit.remaining ?? state.apiRemaining;
      state.apiResetAt = rateLimit.resetAt ?? state.apiResetAt;
      logEvent(this.logger, 'debug', 'rate-limit', {
        apiLimit: state.apiLimit,
        apiRemaining: state.apiRemaining,
        apiResetAt: state.apiResetAt,
      });
    }
    await this.saveState(state, now);
  }

  async recordFailure(): Promise<void> {
    const now = Date.now();
    const state = await this.loadState(now);
    state.lastErrorAt = new Date(now).toISOString();
    state.lastStatus = null;
    await this.saveState(state, now);
  }

  /** A 429 blocks every worker until Retry-After (or the reported reset) has passed. */
  async record429(retryAfterMs: number | null, rateLimit: ApiRateLimit | null): Promise<RateLimitState> {
    const now = Date.now();
    const state = await this.loadState(now);
    const iso = new Date(now).toISOString();
    state.count429 += 1;
    state.last429At = iso;
    state.lastErrorAt = iso;
    state.lastStatus = 429;
    state.apiLimit = rateLimit?.limit ?? state.apiLimit;
    state.apiRemaining = 0;
    if (retryAfterMs !== null) {
      state.apiResetAt = new Date(now + retryAfterMs).toISOString();
    } else if (rateLimit?.resetAt) {
      state.apiResetAt = rateLimit.resetAt;
    }
    await this.saveState(state, now);
    return state;
  }

  async getBudget(): Promise<QuotaBudget> {
    const now = Date.now();
    const state = await this.loadState(now);
    const localReset = nextHourStart(now);
    const apiRemaining = this.apiRemaining(state, now);
    const msUntilReset =
      apiRemaining !== null && state.apiResetAt
        ? Math.max(0, Date.parse(state.apiResetAt) - now)
        : Math.max(0, localReset - now);
    return { remaining: this.effectiveRemaining(state, now), msUntilReset };
  }

  async getState(): Promise<RateLimitState> {
    const now = Date.now();
    const state = await this.loadState(now);
    state.source = this.apiRemaining(state, now) !== null ? 'api' : 'local';
    state.effectiveRemaining = this.effectiveRemaining(state, now);
    return state;
  }

  private async loadState(now: number): Promise<RateLimitState> {
    const stored = await this.redis.getJson<RateLimitState>(RedisKey.sportmonksRateLimit());
    const max = this.config.sportmonksMaxCallsPerHour;
    const windowResetAt = nextHourStart(now);
    const sameWindow = stored?.windowResetAt === new Date(windowResetAt).toISOString();

    const state: RateLimitState = {
      maxCallsPerHour: max,
      callsThisHour: sameWindow ? (stored?.callsThisHour ?? 0) : 0,
      windowResetAt: new Date(windowResetAt).toISOString(),
      apiLimit: stored?.apiLimit ?? null,
      apiRemaining: stored?.apiRemaining ?? null,
      apiResetAt: stored?.apiResetAt ?? null,
      source: 'local',
      effectiveRemaining: max,
      lastRequestAt: stored?.lastRequestAt ?? null,
      lastSuccessAt: stored?.lastSuccessAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastStatus: stored?.lastStatus ?? null,
      count429: stored?.count429 ?? 0,
      last429At: stored?.last429At ?? null,
      updatedAt: stored?.updatedAt ?? new Date(now).toISOString(),
    };

    if (state.apiResetAt && Date.parse(state.apiResetAt) <= now) {
      state.apiRemaining = null;
      state.apiResetAt = null;
    }
    return state;
  }

  private async saveState(state: RateLimitState, now: number): Promise<void> {
    state.source = this.apiRemaining(state, now) !== null ? 'api' : 'local';
    state.effectiveRemaining = this.effectiveRemaining(state, now);
    state.updatedAt = new Date(now).toISOString();
    await this.redis.setJson(RedisKey.sportmonksRateLimit(), state);
  }

  /** API remaining minus the margin between the API limit and our configured maximum. */
  private apiRemaining(state: RateLimitState, now: number): number | null {
    if (state.apiRemaining === null || !state.apiResetAt || Date.parse(state.apiResetAt) <= now) {
      return null;
    }
    const reserve =
      state.apiLimit !== null ? Math.max(0, state.apiLimit - this.config.sportmonksMaxCallsPerHour) : 0;
    return state.apiRemaining - reserve;
  }

  private effectiveRemaining(state: RateLimitState, now: number): number {
    const local = Math.max(0, this.config.sportmonksMaxCallsPerHour - state.callsThisHour);
    const api = this.apiRemaining(state, now);
    return api === null ? local : Math.max(0, Math.min(local, api));
  }

  private warnIfLow(remaining: number, max: number): void {
    const now = Date.now();
    if (remaining > max * WARNING_RATIO || now - this.lastWarningAt < WARNING_LOG_INTERVAL_MS) {
      return;
    }
    this.lastWarningAt = now;
    logEvent(this.logger, 'warn', 'rate-limit-warning', { remaining, maxCallsPerHour: max });
  }
}
