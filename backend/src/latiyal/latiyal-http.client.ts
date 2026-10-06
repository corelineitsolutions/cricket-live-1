import { Inject, Injectable, Logger } from '@nestjs/common';
import { logEvent } from '../common/utils/structured-log';
import { AppConfigService } from '../config/app-config.service';
import { parseRateLimit, parseRetryAfter } from './rate-limit.parser';
import { RETRY_BASE_DELAY_MS, SPORTMONKS_FETCH } from './sportmonks.constants';
import { isSportmonksError, redactSecret, SportmonksError } from './sportmonks.errors';
import { QuotaBudgetKind, SportmonksQuotaService } from './sportmonks-quota.service';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface SportmonksResponse {
  status: number;
  body: unknown;
}

/**
 * The only place that sends HTTP requests to Sportmonks.
 * Every attempt, including retries, consumes one call from the shared quota.
 */
@Injectable()
export class SportmonksHttpClient {
  private readonly logger = new Logger(SportmonksHttpClient.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly quota: SportmonksQuotaService,
    @Inject(SPORTMONKS_FETCH) private readonly fetchFn: FetchFn,
  ) {}

  async get(
    path: string,
    query: Record<string, string> = {},
    options: { budget?: QuotaBudgetKind } = {},
  ): Promise<SportmonksResponse> {
    const budget = options.budget ?? 'live';
    const token = this.config.sportmonksApiToken.trim();
    if (!token) {
      throw new SportmonksError('not_configured', 'SPORTMONKS_API_TOKEN is not set');
    }

    const maxRetries = this.config.sportmonksMaxRetries;
    let lastError: SportmonksError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }

      try {
        return await this.attempt(path, query, token, attempt, budget);
      } catch (error) {
        const sportmonksError = isSportmonksError(error)
          ? error
          : new SportmonksError('network', 'Unexpected Sportmonks client failure', { retryable: true });
        lastError = sportmonksError;

        if (!sportmonksError.retryable || attempt === maxRetries) {
          throw sportmonksError;
        }
        logEvent(this.logger, 'warn', 'poll-error', {
          path,
          attempt: attempt + 1,
          kind: sportmonksError.kind,
          status: sportmonksError.status,
          retrying: true,
        });
      }
    }

    throw lastError ?? new SportmonksError('network', 'Sportmonks request failed');
  }

  private async attempt(
    path: string,
    query: Record<string, string>,
    token: string,
    attempt: number,
    budget: QuotaBudgetKind,
  ): Promise<SportmonksResponse> {
    const decision = await this.quota.tryConsume(budget);
    if (!decision.allowed) {
      throw new SportmonksError('quota_exhausted', 'Sportmonks call budget exhausted', {
        retryAfterMs: decision.retryInMs,
      });
    }

    const url = this.buildUrl(path, query, token);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.sportmonksTimeoutMs);
    const startedAt = Date.now();
    let response: Response;

    try {
      response = await this.fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      await this.quota.recordFailure();
      if (controller.signal.aborted) {
        throw new SportmonksError('timeout', `Sportmonks request timed out after ${this.config.sportmonksTimeoutMs}ms`, {
          retryable: true,
        });
      }
      const message = error instanceof Error ? redactSecret(error.message, token) : 'Network error';
      throw new SportmonksError('network', message, { retryable: true });
    } finally {
      clearTimeout(timeout);
    }

    const durationMs = Date.now() - startedAt;
    const body = await this.readBody(response);
    const rateLimit = parseRateLimit(response.headers, body);

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      const state = await this.quota.record429(retryAfterMs, rateLimit);
      logEvent(this.logger, 'warn', '429', {
        path,
        attempt: attempt + 1,
        retryAfterMs,
        resetAt: state.apiResetAt,
        count429: state.count429,
      });
      throw new SportmonksError('rate_limited', 'Sportmonks rate limit reached', {
        status: 429,
        retryAfterMs,
      });
    }

    await this.quota.recordResponse(response.status, rateLimit);

    if (response.status >= 500) {
      throw new SportmonksError('http', `Sportmonks responded with ${response.status}`, {
        status: response.status,
        retryable: true,
      });
    }
    if (response.status >= 400) {
      throw new SportmonksError('http', `Sportmonks responded with ${response.status}`, {
        status: response.status,
      });
    }
    if (body === undefined) {
      throw new SportmonksError('invalid_response', 'Sportmonks returned a body that is not JSON', {
        status: response.status,
      });
    }

    logEvent(this.logger, 'debug', 'sportmonks-request', { path, status: response.status, durationMs });
    return { status: response.status, body };
  }

  private buildUrl(path: string, query: Record<string, string>, token: string): string {
    const base = this.config.sportmonksApiUrl.replace(/\/+$/, '');
    const params = new URLSearchParams({ ...query, api_token: token });
    return `${base}${path}?${params.toString()}`;
  }

  private async readBody(response: Response): Promise<unknown> {
    try {
      const text = await response.text();
      return text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      return undefined;
    }
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
