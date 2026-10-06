import { Inject, Injectable, Logger } from '@nestjs/common';
import { logEvent } from '../common/utils/structured-log';
import { AppConfigService } from '../config/app-config.service';
import { LATIYAL_FETCH, RETRY_BASE_DELAY_MS } from './latiyal.constants';
import { isLatiyalError, LatiyalError, redactSecret } from './latiyal.errors';
import { QuotaBudgetKind, LatiyalQuotaService } from './latiyal-quota.service';
import { parseRateLimit, parseRetryAfter } from './rate-limit.parser';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Latiyal wraps every payload as `{ status, msg, data }` and reports most errors with HTTP 200. */
export interface LatiyalResponse {
  httpStatus: number;
  ok: boolean;
  message: string | null;
  data: unknown;
}

export interface LatiyalRequestOptions {
  matchId?: number;
  /** Form fields. Any field (or `matchId`) turns the request into a POST. */
  params?: Record<string, string | number>;
  budget?: QuotaBudgetKind;
}

const AUTH_FAILURE = /token|unauthori[sz]ed|auth|api ?key|expired|subscri|plan|access denied|invalid user/i;

function envelopeOk(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === '1';
}

/**
 * The only place that sends HTTP requests to Latiyal. The token is part of the URL path,
 * so URLs are never logged. Every attempt, including retries, consumes one call from the
 * shared quota.
 */
@Injectable()
export class LatiyalHttpClient {
  private readonly logger = new Logger(LatiyalHttpClient.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly quota: LatiyalQuotaService,
    @Inject(LATIYAL_FETCH) private readonly fetchFn: FetchFn,
  ) {}

  async request(endpoint: string, options: LatiyalRequestOptions = {}): Promise<LatiyalResponse> {
    const budget = options.budget ?? 'live';
    const token = this.config.latiyalApiToken.trim();
    if (!token) {
      throw new LatiyalError('not_configured', 'LATIYAL_API_TOKEN is not set');
    }
    const form: Record<string, string> = {};
    for (const [key, value] of Object.entries(options.params ?? {})) {
      form[key] = String(value);
    }
    if (options.matchId !== undefined) {
      form.match_id = String(options.matchId);
    }

    const maxRetries = this.config.latiyalMaxRetries;
    let lastError: LatiyalError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }

      try {
        return await this.attempt(endpoint, form, token, attempt, budget);
      } catch (error) {
        const latiyalError = isLatiyalError(error)
          ? error
          : new LatiyalError('network', 'Unexpected Latiyal client failure', { retryable: true });
        lastError = latiyalError;

        if (!latiyalError.retryable || attempt === maxRetries) {
          throw latiyalError;
        }
        logEvent(this.logger, 'warn', 'poll-error', {
          endpoint,
          attempt: attempt + 1,
          kind: latiyalError.kind,
          status: latiyalError.status,
          retrying: true,
        });
      }
    }

    throw lastError ?? new LatiyalError('network', 'Latiyal request failed');
  }

  private async attempt(
    endpoint: string,
    fields: Record<string, string>,
    token: string,
    attempt: number,
    budget: QuotaBudgetKind,
  ): Promise<LatiyalResponse> {
    const decision = await this.quota.tryConsume(budget);
    if (!decision.allowed) {
      throw new LatiyalError('quota_exhausted', 'Latiyal call budget exhausted', {
        retryAfterMs: decision.retryInMs,
      });
    }

    const url = `${this.config.latiyalApiUrl.replace(/\/+$/, '')}/${endpoint}/${encodeURIComponent(token)}`;
    const init: RequestInit = { headers: { Accept: 'application/json' } };
    const entries = Object.entries(fields);
    if (entries.length === 0) {
      init.method = 'GET';
    } else {
      const form = new FormData();
      for (const [key, value] of entries) {
        form.append(key, value);
      }
      init.method = 'POST';
      init.body = form;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.latiyalTimeoutMs);
    const startedAt = Date.now();
    let response: Response;

    try {
      response = await this.fetchFn(url, { ...init, signal: controller.signal });
    } catch (error) {
      await this.quota.recordFailure();
      if (controller.signal.aborted) {
        throw new LatiyalError('timeout', `Latiyal request timed out after ${this.config.latiyalTimeoutMs}ms`, {
          retryable: true,
        });
      }
      const message = error instanceof Error ? redactSecret(error.message, token) : 'Network error';
      throw new LatiyalError('network', message, { retryable: true });
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
        endpoint,
        attempt: attempt + 1,
        retryAfterMs,
        resetAt: state.apiResetAt,
        count429: state.count429,
      });
      throw new LatiyalError('rate_limited', 'Latiyal rate limit reached', { status: 429, retryAfterMs });
    }

    await this.quota.recordResponse(response.status, rateLimit);

    if (response.status === 401 || response.status === 403) {
      throw new LatiyalError('unauthorized', `Latiyal rejected the token (${response.status})`, {
        status: response.status,
      });
    }
    if (response.status >= 500) {
      throw new LatiyalError('http', `Latiyal responded with ${response.status}`, {
        status: response.status,
        retryable: true,
      });
    }
    if (response.status >= 400) {
      throw new LatiyalError('http', `Latiyal responded with ${response.status}`, { status: response.status });
    }
    if (body === undefined || typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new LatiyalError('invalid_response', 'Latiyal returned a body that is not a JSON object', {
        status: response.status,
      });
    }

    const envelope = body as Record<string, unknown>;
    const message = typeof envelope.msg === 'string' ? redactSecret(envelope.msg, token) : null;
    const ok = envelopeOk(envelope.status);
    if (!ok && message && AUTH_FAILURE.test(message)) {
      throw new LatiyalError('unauthorized', `Latiyal refused the request: ${message}`, { status: response.status });
    }

    logEvent(this.logger, 'debug', 'latiyal-request', { endpoint, status: response.status, ok, durationMs });
    return { httpStatus: response.status, ok, message, data: ok ? (envelope.data ?? null) : null };
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
