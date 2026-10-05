import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { RedisKey } from '../constants/redis-keys';
import type { RedisService } from '../../redis/redis.service';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Fixed-window counters in Redis so every API instance enforces the same limit.
 * If Redis is unavailable requests are allowed: rate limiting must not take the API down.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private lastWarningAt = 0;

  constructor(private readonly redis: RedisService) {}

  async increment(key: string, ttl: number, limit: number, _blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    try {
      const { hits, ttlMs } = await this.redis.throttleIncrement(RedisKey.throttle(`${throttlerName}:${key}`), ttl);
      const seconds = Math.max(1, Math.ceil(ttlMs / 1000));
      const isBlocked = hits > limit;
      return { totalHits: hits, timeToExpire: seconds, isBlocked, timeToBlockExpire: isBlocked ? seconds : 0 };
    } catch {
      if (Date.now() - this.lastWarningAt > 60_000) {
        this.lastWarningAt = Date.now();
        this.logger.warn('Rate limiting skipped: Redis unavailable');
      }
      return { totalHits: 0, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
