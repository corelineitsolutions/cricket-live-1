import { prefixRedisKey } from '../common/constants/redis-keys';
import type { RedisService } from '../redis/redis.service';

interface Entry {
  value: string;
  expiresAt: number | null;
}

/**
 * In-memory stand-in for RedisService with key expiry (driven by Date.now, so it
 * follows fake timers) and a switch that makes every call fail like a dropped connection.
 */
export class FakeRedis {
  readonly store = new Map<string, Entry>();
  readonly sets = new Map<string, Set<string>>();
  readonly published: Array<{ channel: string; message: unknown }> = [];
  private readonly subscribers = new Map<string, Array<(message: string) => void>>();
  down = false;

  asService(): RedisService {
    return this as unknown as RedisService;
  }

  ttlSeconds(key: string): number | null {
    const entry = this.entry(key);
    return entry?.expiresAt ? Math.ceil((entry.expiresAt - Date.now()) / 1000) : null;
  }
  peekJson<T>(key: string): T | null {
    const entry = this.entry(key);
    return entry ? (JSON.parse(entry.value) as T) : null;
  }

  async ping(): Promise<'up' | 'down'> {
    return this.down ? 'down' : 'up';
  }

  async get(key: string): Promise<string | null> {
    this.check();
    return this.entry(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.check();
    this.write(key, value, ttlSeconds && ttlSeconds > 0 ? ttlSeconds * 1000 : null);
  }

  async del(key: string): Promise<void> {
    this.check();
    this.store.delete(prefixRedisKey(key));
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async getManyJson<T>(keys: string[]): Promise<Array<T | null>> {
    this.check();
    return keys.map((key) => {
      const entry = this.entry(key);
      return entry ? (JSON.parse(entry.value) as T) : null;
    });
  }

  async incr(key: string): Promise<number> {
    this.check();
    const entry = this.entry(key);
    const next = Number(entry?.value ?? 0) + 1;
    this.write(key, String(next), entry?.expiresAt ? entry.expiresAt - Date.now() : null);
    return next;
  }

  /** Delivers asynchronously to every subscriber, like Redis Pub/Sub across processes. */
  async publish(channel: string, message: unknown): Promise<number> {
    this.check();
    const redisChannel = prefixRedisKey(channel);
    this.published.push({ channel: redisChannel, message });
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    const handlers = this.subscribers.get(redisChannel) ?? [];
    setImmediate(() => handlers.forEach((handler) => handler(payload)));
    return handlers.length;
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    const redisChannel = prefixRedisKey(channel);
    this.subscribers.set(redisChannel, [...(this.subscribers.get(redisChannel) ?? []), handler]);
  }

  async scanKeys(pattern: string): Promise<string[]> {
    this.check();
    const source = prefixRedisKey(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(`^${source}$`);
    return [...this.store.keys()].filter((key) => regex.test(key) && this.entry(key));
  }

  async addToSet(key: string, member: string): Promise<boolean> {
    this.check();
    const redisKey = prefixRedisKey(key);
    const set = this.sets.get(redisKey) ?? new Set<string>();
    this.sets.set(redisKey, set);
    const added = !set.has(member);
    set.add(member);
    return added;
  }

  async removeFromSet(key: string, member: string): Promise<void> {
    this.check();
    this.sets.get(prefixRedisKey(key))?.delete(member);
  }

  async throttleIncrement(key: string, windowMs: number): Promise<{ hits: number; ttlMs: number }> {
    this.check();
    const entry = this.entry(key);
    const hits = Number(entry?.value ?? 0) + 1;
    const ttlMs = entry?.expiresAt ? entry.expiresAt - Date.now() : windowMs;
    this.write(key, String(hits), ttlMs);
    return { hits, ttlMs };
  }

  async ttlMs(key: string): Promise<number | null> {
    this.check();
    const entry = this.entry(key);
    return entry?.expiresAt ? entry.expiresAt - Date.now() : null;
  }

  async acquireLock(key: string, token: string, ttlMs: number): Promise<boolean> {
    this.check();
    if (this.entry(key)) {
      return false;
    }
    this.write(key, token, ttlMs);
    return true;
  }

  async releaseLock(key: string, token: string): Promise<boolean> {
    this.check();
    if (this.entry(key)?.value !== token) {
      return false;
    }
    this.store.delete(prefixRedisKey(key));
    return true;
  }

  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    this.check();
    const entry = this.entry(key);
    const next = Number(entry?.value ?? 0) + 1;
    this.write(key, String(next), entry?.expiresAt ? entry.expiresAt - Date.now() : ttlSeconds * 1000);
    return next;
  }

  async incrementIfBelow(key: string, max: number, ttlSeconds: number): Promise<number | null> {
    this.check();
    const current = Number(this.entry(key)?.value ?? 0);
    if (current >= max) {
      return null;
    }
    return this.incrementWithTtl(key, ttlSeconds);
  }

  private entry(key: string): Entry | null {
    const redisKey = prefixRedisKey(key);
    const entry = this.store.get(redisKey);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(redisKey);
      return null;
    }
    return entry;
  }

  private write(key: string, value: string, ttlMs: number | null): void {
    this.store.set(prefixRedisKey(key), { value, expiresAt: ttlMs ? Date.now() + ttlMs : null });
  }

  private check(): void {
    if (this.down) {
      throw new Error('Connection is closed.');
    }
  }
}
