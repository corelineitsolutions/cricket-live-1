import request from 'supertest';
import { createApiTestApp } from '../../testing/api-test-app';
import { FakeDb, teamRow } from '../../testing/fake-db';
import { FakeRedis } from '../../testing/fake-redis';
import { envelope } from '../../testing/latiyal-fixtures';
import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('REST rate limiting (e2e)', () => {
  function seeded() {
    const db = new FakeDb();
    db.rows.team.push(teamRow(101, 'Mumbai Strikers', 'MUM'));
    return db;
  }

  it('answers 429 in the error envelope with Retry-After once the per-minute limit is hit', async () => {
    const api = await createApiTestApp({ db: seeded(), config: { rateLimitPerMinute: 3, rateLimitBurstPerSecond: 100 } });
    try {
      for (let i = 0; i < 3; i += 1) {
        await request(api.http).get('/api/v1/teams/101').expect(200);
      }
      const res = await request(api.http).get('/api/v1/teams/101').expect(429);

      expect(res.body).toEqual({ success: false, message: 'Too many requests', code: 'TOO_MANY_REQUESTS' });
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);
    } finally {
      await api.close();
    }
  });

  it('applies the short burst limit with a Retry-After header', async () => {
    const api = await createApiTestApp({ db: seeded(), config: { rateLimitPerMinute: 1000, rateLimitBurstPerSecond: 2 } });
    try {
      const statuses = [];
      for (let i = 0; i < 4; i += 1) {
        const res = await request(api.http).get('/api/v1/teams/101');
        statuses.push(res.status);
        if (res.status === 429) {
          expect(res.headers['retry-after']).toBe('1');
        }
      }
      expect(statuses.slice(0, 2)).toEqual([200, 200]);
      expect(statuses).toContain(429);
    } finally {
      await api.close();
    }
  });

  it('counts per endpoint, so a busy screen does not block other endpoints', async () => {
    const api = await createApiTestApp({ db: seeded(), config: { rateLimitPerMinute: 2, rateLimitBurstPerSecond: 100 } });
    try {
      await request(api.http).get('/api/v1/teams/101').expect(200);
      await request(api.http).get('/api/v1/teams/101').expect(200);
      await request(api.http).get('/api/v1/teams/101').expect(429);
      await request(api.http).get('/api/v1/matches/live').expect(200);
    } finally {
      await api.close();
    }
  });

  it('counts each feed separately, so polling liveMatch does not block other feeds', async () => {
    const api = await createApiTestApp({ db: seeded(), config: { rateLimitPerMinute: 2, rateLimitBurstPerSecond: 100 } });
    api.respond(() => envelope({ ok: true }));
    try {
      await request(api.http).get('/api/v1/feeds/liveMatch?match_id=1').expect(200);
      await request(api.http).get('/api/v1/feeds/liveMatch?match_id=1').expect(200);
      await request(api.http).get('/api/v1/feeds/liveMatch?match_id=1').expect(429);
      await request(api.http).get('/api/v1/feeds/LIVEMATCH?match_id=1').expect(429);
      await request(api.http).get('/api/v1/feeds/commentary?match_id=1').expect(200);
      await request(api.http).get('/api/v1/feeds/matchInfo?match_id=1').expect(200);
    } finally {
      await api.close();
    }
  });

  it('shares counters between API instances through Redis', async () => {
    const redis = new FakeRedis();
    const db = seeded();
    const config = { rateLimitPerMinute: 2, rateLimitBurstPerSecond: 100 };
    const first = await createApiTestApp({ redis, db, config });
    const second = await createApiTestApp({ redis, db, config });
    try {
      await request(first.http).get('/api/v1/teams/101').expect(200);
      await request(second.http).get('/api/v1/teams/101').expect(200);
      await request(first.http).get('/api/v1/teams/101').expect(429);
      await request(second.http).get('/api/v1/teams/101').expect(429);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('keeps serving requests when Redis is down (fails open)', async () => {
    const redis = new FakeRedis();
    const api = await createApiTestApp({ redis, db: seeded(), config: { rateLimitPerMinute: 1, rateLimitBurstPerSecond: 1 } });
    try {
      redis.down = true;
      await request(api.http).get('/api/v1/teams/101').expect(200);
      await request(api.http).get('/api/v1/teams/101').expect(200);
    } finally {
      await api.close();
    }
  });
});

describe('RedisThrottlerStorage', () => {
  it('counts hits in a fixed window and reports seconds to expiry', async () => {
    const redis = new FakeRedis();
    const storage = new RedisThrottlerStorage(redis.asService());

    const first = await storage.increment('ip-route', 60_000, 2, 0, 'default');
    await storage.increment('ip-route', 60_000, 2, 0, 'default');
    const third = await storage.increment('ip-route', 60_000, 2, 0, 'default');
    const otherThrottler = await storage.increment('ip-route', 1_000, 2, 0, 'burst');

    expect(first).toEqual({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 });
    expect(third).toMatchObject({ totalHits: 3, isBlocked: true, timeToBlockExpire: 60 });
    expect(otherThrottler).toMatchObject({ totalHits: 1, isBlocked: false });
    expect([...redis.store.keys()]).toContain('cricket:v1:throttle:default:ip-route');
  });

  it('never blocks when Redis fails', async () => {
    const redis = new FakeRedis();
    redis.down = true;
    const storage = new RedisThrottlerStorage(redis.asService());
    expect(await storage.increment('k', 1_000, 1, 0, 'default')).toMatchObject({ isBlocked: false });
  });
});
