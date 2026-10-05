import { RedisKey } from '../common/constants/redis-keys';
import { captureLogs } from '../testing/capture-logs';
import { FakeRedis } from '../testing/fake-redis';
import { CacheUnavailableError, SingleFlightCache } from './single-flight-cache.service';

const KEY = 'cache:test:1';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('SingleFlightCache', () => {
  beforeEach(() => {
    captureLogs();
  });

  it('runs the loader once for concurrent callers and caches the value with its TTL', async () => {
    const redis = new FakeRedis();
    const cache = new SingleFlightCache(redis.asService());
    const gate = deferred<string>();
    const loader = vi.fn(() => gate.promise);

    const pending = Array.from({ length: 50 }, () => cache.getOrLoad(KEY, { ttlSeconds: 30 }, loader));
    gate.resolve('value');
    const results = await Promise.all(pending);
    const later = await cache.getOrLoad(KEY, { ttlSeconds: 30 }, loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.value === 'value' && !result.stale)).toBe(true);
    expect(later.value).toBe('value');
    expect(redis.ttlSeconds(KEY)).toBe(30);
  });

  it('coalesces across instances: a second process waits for the lock owner instead of loading', async () => {
    const redis = new FakeRedis();
    const first = new SingleFlightCache(redis.asService());
    const second = new SingleFlightCache(redis.asService());
    const gate = deferred<string>();
    const firstLoader = vi.fn(() => gate.promise);
    const secondLoader = vi.fn(async () => 'should not run');

    const owner = first.getOrLoad(KEY, { ttlSeconds: 30 }, firstLoader);
    await new Promise((resolve) => setImmediate(resolve));
    const waiter = second.getOrLoad(KEY, { ttlSeconds: 30 }, secondLoader);
    gate.resolve('from owner');

    expect((await owner).value).toBe('from owner');
    expect((await waiter).value).toBe('from owner');
    expect(secondLoader).not.toHaveBeenCalled();
  });

  it('chooses the TTL from the loaded value (negative caching)', async () => {
    const redis = new FakeRedis();
    const cache = new SingleFlightCache(redis.asService());

    await cache.getOrLoad<string | null>(KEY, { ttlSeconds: (v) => (v ? 300 : 15) }, async () => null);

    expect(redis.ttlSeconds(KEY)).toBe(15);
    const loader = vi.fn(async () => 'x');
    expect((await cache.getOrLoad<string | null>(KEY, { ttlSeconds: 300 }, loader)).value).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it('falls back to the stale copy when the loader fails', async () => {
    const redis = new FakeRedis();
    const cache = new SingleFlightCache(redis.asService());
    const options = { ttlSeconds: 30, staleTtlSeconds: 3600 };
    await cache.getOrLoad(KEY, options, async () => 'good');
    await redis.del(KEY);

    const result = await cache.getOrLoad(KEY, options, async () => {
      throw new Error('upstream down');
    });

    expect(result).toMatchObject({ value: 'good', stale: true });
    expect(redis.ttlSeconds(RedisKey.stale(KEY))).toBe(3600);
  });

  it('rethrows loader errors when there is no stale copy', async () => {
    const cache = new SingleFlightCache(new FakeRedis().asService());
    await expect(
      cache.getOrLoad(KEY, { ttlSeconds: 30 }, async () => {
        throw new Error('upstream down');
      }),
    ).rejects.toThrow('upstream down');
  });

  it('refuses to reach a protected upstream when Redis is down', async () => {
    const redis = new FakeRedis();
    redis.down = true;
    const cache = new SingleFlightCache(redis.asService());
    const loader = vi.fn(async () => 'x');

    await expect(cache.getOrLoad(KEY, { ttlSeconds: 30, protectsUpstream: true }, loader)).rejects.toBeInstanceOf(
      CacheUnavailableError,
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it('loads directly from an unprotected source (MySQL) when Redis is down', async () => {
    const redis = new FakeRedis();
    redis.down = true;
    const cache = new SingleFlightCache(redis.asService());
    expect((await cache.getOrLoad(KEY, { ttlSeconds: 30 }, async () => 'db')).value).toBe('db');
  });

  it('times out waiting for a stuck lock owner and serves the stale copy if there is one', async () => {
    const redis = new FakeRedis();
    const cache = new SingleFlightCache(redis.asService());
    await redis.setJson(RedisKey.stale(KEY), { value: 'old', cachedAt: '2026-10-01T00:00:00.000Z' });
    await redis.acquireLock(RedisKey.cacheLock(KEY), 'someone-else', 30_000);
    const loader = vi.fn(async () => 'new');

    const result = await cache.getOrLoad(KEY, { ttlSeconds: 30, staleTtlSeconds: 60, waitTimeoutMs: 250 }, loader);

    expect(result).toEqual({ value: 'old', cachedAt: '2026-10-01T00:00:00.000Z', stale: true });
    expect(loader).not.toHaveBeenCalled();
  });
});
