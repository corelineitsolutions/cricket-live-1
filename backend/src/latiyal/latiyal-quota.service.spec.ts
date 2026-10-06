import { captureLogs } from '../testing/capture-logs';
import { FakeRedis } from '../testing/fake-redis';
import { testConfig } from '../testing/test-config';
import { hourBucket, LatiyalQuotaService } from './latiyal-quota.service';

const START = Date.parse('2026-10-01T12:30:00Z');

function setup(maxCallsPerHour = 1600) {
  const redis = new FakeRedis();
  const quota = new LatiyalQuotaService(redis.asService(), testConfig({ latiyalMaxCallsPerHour: maxCallsPerHour }));
  const logs = captureLogs();
  return { redis, quota, logs };
}

describe('LatiyalQuotaService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses one Redis counter per UTC hour', () => {
    expect(hourBucket(START)).toBe('2026100112');
  });

  it('stops at LATIYAL_MAX_CALLS_PER_HOUR and resumes in the next hour', async () => {
    const { quota, logs } = setup(3);

    for (let i = 0; i < 3; i += 1) {
      expect((await quota.tryConsume()).allowed).toBe(true);
    }
    const refused = await quota.tryConsume();

    expect(refused).toEqual({ allowed: false, remaining: 0, retryInMs: 30 * 60_000 });
    expect(logs.tagged('rate-limit').some((line) => line.includes('"allowed":false'))).toBe(true);

    vi.setSystemTime(Date.parse('2026-10-01T13:00:01Z'));
    expect((await quota.tryConsume()).allowed).toBe(true);
  });

  it('shares the hourly budget between workers through Redis', async () => {
    const redis = new FakeRedis();
    const config = testConfig({ latiyalMaxCallsPerHour: 2 });
    captureLogs();
    const workerA = new LatiyalQuotaService(redis.asService(), config);
    const workerB = new LatiyalQuotaService(redis.asService(), config);

    expect((await workerA.tryConsume()).allowed).toBe(true);
    expect((await workerB.tryConsume()).allowed).toBe(true);
    expect((await workerA.tryConsume()).allowed).toBe(false);
  });

  it('treats API rate-limit metadata as authoritative, keeping the configured safety margin', async () => {
    const { quota } = setup(1600);
    const resetAt = new Date(START + 20 * 60_000).toISOString();

    await quota.recordResponse(200, { limit: 2000, remaining: 450, resetAt });
    expect(await quota.getBudget()).toEqual({ remaining: 50, msUntilReset: 20 * 60_000 });

    await quota.recordResponse(200, { limit: 2000, remaining: 400, resetAt });
    const refused = await quota.tryConsume();
    expect(refused.allowed).toBe(false);
    expect(refused.retryInMs).toBe(20 * 60_000);
    expect((await quota.getState()).source).toBe('api');

    vi.setSystemTime(START + 21 * 60_000);
    expect((await quota.tryConsume()).allowed).toBe(true);
  });

  it('blocks every call after a 429 until Retry-After has passed', async () => {
    const { quota } = setup();

    const state = await quota.record429(60_000, null);
    expect(state.count429).toBe(1);
    expect((await quota.tryConsume()).allowed).toBe(false);
    expect(await quota.getBudget()).toEqual({ remaining: 0, msUntilReset: 60_000 });

    vi.setSystemTime(START + 61_000);
    expect((await quota.tryConsume()).allowed).toBe(true);
  });

  it('warns once when 20% or less of the hourly budget is left', async () => {
    const { quota, logs } = setup(10);

    for (let i = 0; i < 9; i += 1) {
      await quota.tryConsume();
    }

    expect(logs.tagged('rate-limit-warning')).toHaveLength(1);
  });
});
