import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RedisChannel } from '../common/constants/redis-keys';
import { logEvent } from '../common/utils/structured-log';
import type { LiveScoreEvent } from '../live-score/live-match.types';
import { RedisService } from '../redis/redis.service';
import { LiveGateway } from './live.gateway';

const EVENT_TYPES = new Set(['MATCH_STARTED', 'MATCH_UPDATED', 'MATCH_FINISHED', 'MATCH_STALE', 'MATCH_REMOVED']);

export function parseLiveScoreEvent(message: string): LiveScoreEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const event = value as Partial<LiveScoreEvent>;
  if (
    typeof event.type !== 'string' ||
    !EVENT_TYPES.has(event.type) ||
    !Number.isInteger(event.sportmonksId) ||
    !event.data ||
    typeof event.data !== 'object' ||
    typeof event.updatedAt !== 'string'
  ) {
    return null;
  }
  return { ...event, changedFields: Array.isArray(event.changedFields) ? event.changedFields : [] } as LiveScoreEvent;
}

/** Bridges the worker's Redis channel to the match rooms of this API instance. */
@Injectable()
export class LiveUpdatesSubscriber implements OnModuleInit {
  private readonly logger = new Logger(LiveUpdatesSubscriber.name);

  constructor(
    private readonly redis: RedisService,
    private readonly gateway: LiveGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.subscribe(RedisChannel.liveScoreUpdates(), (message) => this.handle(message));
    } catch {
      logEvent(this.logger, 'warn', 'pubsub-subscribe-deferred', { channel: RedisChannel.liveScoreUpdates() });
    }
  }

  handle(message: string): void {
    const event = parseLiveScoreEvent(message);
    if (!event) {
      logEvent(this.logger, 'warn', 'pubsub-invalid-message', { bytes: message.length });
      return;
    }
    this.gateway.broadcast(event);
  }
}
