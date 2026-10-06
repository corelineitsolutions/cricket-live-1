import { HttpException, Injectable, Logger } from '@nestjs/common';
import { SingleFlightCache } from '../cache/single-flight-cache.service';
import { RedisKey } from '../common/constants/redis-keys';
import { notFound, serviceUnavailable, validationError } from '../common/utils/http-errors';
import { logEvent } from '../common/utils/structured-log';
import { FeedDefinition, findFeed, LATIYAL_FEEDS } from '../latiyal/latiyal-catalog';
import { isLatiyalError } from '../latiyal/latiyal.errors';
import { LatiyalService } from '../latiyal/latiyal.service';
import type { FeedDefinitionDto, FeedDto } from './dto/feed.dto';

/** Every Latiyal id and type code is a non-negative integer. */
const PARAM_VALUE = /^\d{1,10}$/;
/** An empty answer (`status:false`) is retried sooner than real data. */
const EMPTY_TTL_SECONDS = 60;
/** The last good copy is kept this long so failures can be answered with stale data. */
export const FEED_STALE_TTL_SECONDS = 7 * 24 * 60 * 60;

interface FeedPayload {
  data: unknown;
  message: string | null;
}

/**
 * Read-through access to every catalogued Latiyal endpoint. However many app users ask,
 * each endpoint + params combination reaches Latiyal at most once per refresh period.
 */
@Injectable()
export class FeedsService {
  private readonly logger = new Logger(FeedsService.name);

  constructor(
    private readonly latiyal: LatiyalService,
    private readonly cache: SingleFlightCache,
  ) {}

  catalog(): FeedDefinitionDto[] {
    return LATIYAL_FEEDS.map((feed) => ({
      endpoint: feed.endpoint,
      group: feed.group,
      summary: feed.summary,
      params: feed.params.map((param) => ({ ...param })),
      refreshSeconds: feed.ttlSeconds,
      v5Only: feed.v5Only ?? false,
    }));
  }

  async get(endpoint: string, query: Record<string, unknown>): Promise<FeedDto> {
    const feed = findFeed(endpoint);
    if (!feed) {
      throw notFound('Unknown feed. GET /api/v1/feeds lists the available feeds.');
    }
    const params = this.validate(feed, query);
    if (!this.latiyal.isConfigured()) {
      throw serviceUnavailable('Cricket data is not configured on this server.');
    }

    const key = RedisKey.feed(feed.endpoint, paramsKey(params));
    try {
      const result = await this.cache.getOrLoad<FeedPayload>(
        key,
        {
          ttlSeconds: (value) => (value.data === null ? Math.min(feed.ttlSeconds, EMPTY_TTL_SECONDS) : feed.ttlSeconds),
          staleTtlSeconds: FEED_STALE_TTL_SECONDS,
          protectsUpstream: true,
        },
        async () => {
          const response = await this.latiyal.getFeed(feed.endpoint, params);
          return response.ok ? { data: response.data, message: null } : { data: null, message: response.message };
        },
      );
      return {
        endpoint: feed.endpoint,
        params,
        data: result.value.data,
        message: result.value.message,
        updatedAt: result.cachedAt,
        stale: result.stale,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      logEvent(this.logger, 'warn', 'feed-unavailable', {
        endpoint: feed.endpoint,
        kind: isLatiyalError(error) ? error.kind : error instanceof Error ? error.name : 'unknown',
      });
      throw serviceUnavailable('This data is temporarily unavailable. Try again shortly.');
    }
  }

  private validate(feed: FeedDefinition, query: Record<string, unknown>): Record<string, string> {
    const allowed = new Set<string>(feed.params.map((param) => param.name));
    const allowedList = feed.params.map((param) => param.name).join(', ') || 'none';
    for (const name of Object.keys(query)) {
      if (!allowed.has(name)) {
        throw validationError(`${feed.endpoint} accepts these parameters: ${allowedList}.`);
      }
    }

    const params: Record<string, string> = {};
    for (const param of feed.params) {
      const raw = query[param.name];
      if (raw === undefined || raw === '') {
        if (param.required) {
          throw validationError(`${param.name} is required for ${feed.endpoint}.`);
        }
        if (param.default !== undefined) {
          params[param.name] = param.default;
        }
        continue;
      }
      if (typeof raw !== 'string' || !PARAM_VALUE.test(raw)) {
        throw validationError(`${param.name} must be a whole number.`);
      }
      params[param.name] = String(Number(raw));
    }
    return params;
  }
}

function paramsKey(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((name) => `${name}=${params[name]}`)
    .join('&');
}
