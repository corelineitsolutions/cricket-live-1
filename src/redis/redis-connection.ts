import { Logger } from '@nestjs/common';
import type { RedisOptions } from 'ioredis';
import type Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

const MAX_RETRY_DELAY_MS = 5000;

export function redisRetryDelay(attempt: number): number {
  return Math.min(attempt * 200, MAX_RETRY_DELAY_MS);
}

/**
 * Shared connection options. Commands fail fast while Redis is down
 * (no offline queue), and the client keeps reconnecting with backoff.
 */
export function buildRedisOptions(config: AppConfigService, connectionName: string): RedisOptions {
  return {
    host: config.redisHost,
    port: config.redisPort,
    password: config.redisPassword || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    connectionName,
    retryStrategy: redisRetryDelay,
  };
}

/** Logs one error when a connection drops and one message when it recovers. */
export function attachConnectionLogging(client: Redis, logger: Logger, label: string): void {
  let down = false;

  client.on('error', (error: Error) => {
    if (!down) {
      down = true;
      logger.error(`${label} unavailable: ${error.message}`);
    }
  });

  client.on('ready', () => {
    if (down) {
      down = false;
      logger.log(`${label} reconnected`);
    }
  });
}
