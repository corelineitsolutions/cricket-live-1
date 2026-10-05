import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfigService } from '../../config/app-config.service';
import type { RedisService } from '../../redis/redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Per client IP and endpoint: a sustained per-minute limit and a short burst limit.
 * Generous on purpose; many mobile users can share one carrier IP.
 */
export function throttlerOptions(config: AppConfigService, redis: RedisService): ThrottlerModuleOptions {
  return {
    throttlers: [
      { name: 'default', ttl: 60_000, limit: config.rateLimitPerMinute },
      { name: 'burst', ttl: 1_000, limit: config.rateLimitBurstPerSecond },
    ],
    storage: new RedisThrottlerStorage(redis),
  };
}
