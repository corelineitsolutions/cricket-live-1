import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisKey } from '../common/constants/redis-keys';
import { logEvent } from '../common/utils/structured-log';
import { RedisService } from '../redis/redis.service';

export interface CachedResult<T> {
  value: T;
  /** When the value was loaded from its source. */
  cachedAt: string;
  /** True when the source failed and this is the last good copy. */
  stale: boolean;
}

export interface CacheOptions<T> {
  /** Seconds the value is considered fresh; below 1 it is stored with millisecond precision. May depend on the loaded value. */
  ttlSeconds: number | ((value: T) => number);
  /** Seconds the last good copy is kept for stale fallback. 0 disables it. */
  staleTtlSeconds?: number;
  /**
   * When true the loader calls a rate-limited upstream. Without Redis there is no shared
   * cache or lock, so the request fails instead of reaching the upstream.
   */
  protectsUpstream?: boolean;
  lockTtlMs?: number;
  waitTimeoutMs?: number;
}

interface Envelope<T> {
  value: T;
  cachedAt: string;
}

export class CacheUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CacheUnavailableError';
  }
}

const DEFAULT_LOCK_TTL_MS = 30_000;
const DEFAULT_WAIT_TIMEOUT_MS = 8_000;
const WAIT_POLL_MS = 100;

/**
 * Read-through cache with request coalescing. However many clients ask for the same key,
 * one loader runs per process (in-flight map) and one per cluster (Redis lock); the
 * others wait for the cached value.
 */
@Injectable()
export class SingleFlightCache {
  private readonly logger = new Logger(SingleFlightCache.name);
  private readonly inFlight = new Map<string, Promise<CachedResult<unknown>>>();

  constructor(private readonly redis: RedisService) {}

  getOrLoad<T>(key: string, options: CacheOptions<T>, loader: () => Promise<T>): Promise<CachedResult<T>> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<CachedResult<T>>;
    }
    const pending = this.resolve(key, options, loader).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  async invalidate(key: string): Promise<void> {
    await this.redis.del(key).catch(() => undefined);
  }

  private async resolve<T>(key: string, options: CacheOptions<T>, loader: () => Promise<T>): Promise<CachedResult<T>> {
    let cached: Envelope<T> | null;
    try {
      cached = await this.redis.getJson<Envelope<T>>(key);
    } catch {
      if (options.protectsUpstream) {
        throw new CacheUnavailableError('Cache unavailable');
      }
      return { value: await loader(), cachedAt: new Date().toISOString(), stale: false };
    }
    if (cached) {
      return { value: cached.value, cachedAt: cached.cachedAt, stale: false };
    }

    const token = randomUUID();
    const lockKey = RedisKey.cacheLock(key);
    const acquired = await this.redis
      .acquireLock(lockKey, token, options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS)
      .catch(() => false);

    if (!acquired) {
      return this.waitForOwner(key, options);
    }

    try {
      const filled = await this.redis.getJson<Envelope<T>>(key);
      if (filled) {
        return { value: filled.value, cachedAt: filled.cachedAt, stale: false };
      }
      return await this.load(key, options, loader);
    } finally {
      await this.redis.releaseLock(lockKey, token).catch(() => undefined);
    }
  }

  private async load<T>(key: string, options: CacheOptions<T>, loader: () => Promise<T>): Promise<CachedResult<T>> {
    let value: T;
    try {
      value = await loader();
    } catch (error) {
      const fallback = await this.readStale<T>(key, options);
      if (fallback) {
        logEvent(this.logger, 'warn', 'cache-stale', { key, reason: error instanceof Error ? error.name : 'unknown' });
        return fallback;
      }
      throw error;
    }

    const envelope: Envelope<T> = { value, cachedAt: new Date().toISOString() };
    const ttl = typeof options.ttlSeconds === 'function' ? options.ttlSeconds(value) : options.ttlSeconds;
    try {
      await this.redis.setJson(key, envelope, ttl >= 1 ? Math.round(ttl) : Math.max(0.1, ttl));
      if (options.staleTtlSeconds && value !== null) {
        await this.redis.setJson(RedisKey.stale(key), envelope, options.staleTtlSeconds);
      }
    } catch {
      logEvent(this.logger, 'warn', 'cache-write-failed', { key });
    }
    return { ...envelope, stale: false };
  }

  private async waitForOwner<T>(key: string, options: CacheOptions<T>): Promise<CachedResult<T>> {
    const deadline = Date.now() + (options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
      const cached = await this.redis.getJson<Envelope<T>>(key).catch(() => null);
      if (cached) {
        return { value: cached.value, cachedAt: cached.cachedAt, stale: false };
      }
    }
    const fallback = await this.readStale<T>(key, options);
    if (fallback) {
      return fallback;
    }
    throw new CacheUnavailableError('Timed out waiting for another request to load the value');
  }

  private async readStale<T>(key: string, options: CacheOptions<T>): Promise<CachedResult<T> | null> {
    if (!options.staleTtlSeconds) {
      return null;
    }
    const copy = await this.redis.getJson<Envelope<T>>(RedisKey.stale(key)).catch(() => null);
    return copy ? { value: copy.value, cachedAt: copy.cachedAt, stale: true } : null;
  }
}
