import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';
import { prefixRedisKey } from '../common/constants/redis-keys';
import { attachConnectionLogging, buildRedisOptions } from './redis-connection';

const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const INCREMENT_WITH_TTL_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return current
`;

const INCREMENT_IF_BELOW_SCRIPT = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
if current >= tonumber(ARGV[1]) then
  return -1
end
current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[2])
end
return current
`;

const THROTTLE_INCREMENT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { current, ttl }
`;

type MessageHandler = (message: string) => void;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private subscriber!: Redis;
  private readonly subscriptions = new Map<string, MessageHandler>();

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    this.client = new Redis(buildRedisOptions(this.config, 'cricket-live-api'));
    this.subscriber = new Redis(buildRedisOptions(this.config, 'cricket-live-subscriber'));
    attachConnectionLogging(this.client, this.logger, 'Redis');
    attachConnectionLogging(this.subscriber, this.logger, 'Redis subscriber');
    this.subscriber.on('message', (channel: string, message: string) => {
      this.subscriptions.get(channel)?.(message);
    });
    // Channels registered while Redis was unreachable are subscribed once it is ready.
    this.subscriber.on('ready', () => {
      for (const channel of this.subscriptions.keys()) {
        this.subscriber.subscribe(channel).catch(() => undefined);
      }
    });

    // Failure here is not fatal. The clients keep reconnecting and /health reports Redis as down.
    await Promise.allSettled([this.client.connect(), this.subscriber.connect()]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
    await this.subscriber?.quit().catch(() => undefined);
  }

  async ping(): Promise<'up' | 'down'> {
    if (this.client?.status !== 'ready') {
      return 'down';
    }

    try {
      const result = await this.client.ping();
      return result === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(prefixRedisKey(key));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const redisKey = prefixRedisKey(key);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(redisKey, value, 'EX', ttlSeconds);
      return;
    }
    await this.client.set(redisKey, value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(prefixRedisKey(key));
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (raw === null) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async getManyJson<T>(keys: string[]): Promise<Array<T | null>> {
    if (keys.length === 0) {
      return [];
    }

    const values = await this.client.mget(...keys.map(prefixRedisKey));
    return values.map((raw) => {
      if (raw === null) {
        return null;
      }
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    });
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(prefixRedisKey(key));
  }

  async publish(channel: string, message: unknown): Promise<number> {
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    return this.client.publish(prefixRedisKey(channel), payload);
  }

  /** Registers the handler now and subscribes immediately, or as soon as Redis is ready. */
  async subscribe(channel: string, handler: MessageHandler): Promise<void> {
    const redisChannel = prefixRedisKey(channel);
    this.subscriptions.set(redisChannel, handler);
    if (this.subscriber?.status === 'ready') {
      await this.subscriber.subscribe(redisChannel);
    }
  }

  async scanKeys(pattern: string): Promise<string[]> {
    const match = prefixRedisKey(pattern);
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', match, 'COUNT', 100);
      cursor = next;
      found.push(...keys);
    } while (cursor !== '0');
    return found;
  }

  /** Returns true when the member was not in the set yet. */
  async addToSet(key: string, member: string): Promise<boolean> {
    return (await this.client.sadd(prefixRedisKey(key), member)) === 1;
  }

  async removeFromSet(key: string, member: string): Promise<void> {
    await this.client.srem(prefixRedisKey(key), member);
  }

  /** Fixed-window counter: increments and returns the hit count and the window's remaining ms. */
  async throttleIncrement(key: string, windowMs: number): Promise<{ hits: number; ttlMs: number }> {
    const [hits, ttlMs] = (await this.client.eval(
      THROTTLE_INCREMENT_SCRIPT,
      1,
      prefixRedisKey(key),
      String(windowMs),
    )) as [number, number];
    return { hits: Number(hits), ttlMs: Number(ttlMs) };
  }

  /** Remaining time to live in ms. Null when the key does not exist or never expires. */
  async ttlMs(key: string): Promise<number | null> {
    const ttl = await this.client.pttl(prefixRedisKey(key));
    return ttl >= 0 ? ttl : null;
  }

  async acquireLock(key: string, token: string, ttlMs: number): Promise<boolean> {
    const result = await this.client.set(prefixRedisKey(key), token, 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string, token: string): Promise<boolean> {
    const released = await this.client.eval(RELEASE_LOCK_SCRIPT, 1, prefixRedisKey(key), token);
    return released === 1;
  }

  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.eval(
      INCREMENT_WITH_TTL_SCRIPT,
      1,
      prefixRedisKey(key),
      String(ttlSeconds),
    );
    return Number(count);
  }

  /** Atomically increments the counter unless it already reached `max`. Returns null when refused. */
  async incrementIfBelow(key: string, max: number, ttlSeconds: number): Promise<number | null> {
    const result = Number(
      await this.client.eval(
        INCREMENT_IF_BELOW_SCRIPT,
        1,
        prefixRedisKey(key),
        String(max),
        String(ttlSeconds),
      ),
    );
    return result < 0 ? null : result;
  }

  async deleteByPattern(pattern: string): Promise<number> {
    const match = prefixRedisKey(pattern);
    let cursor = '0';
    let deleted = 0;

    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', match, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        deleted += await this.client.del(...keys);
      }
    } while (cursor !== '0');

    return deleted;
  }
}
