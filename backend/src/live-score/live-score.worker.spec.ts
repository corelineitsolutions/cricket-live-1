import { RedisKey } from '../common/constants/redis-keys';
import { FakeRedis } from '../testing/fake-redis';
import { liveScoreHarness } from '../testing/live-score-harness';
import { LOCAL_TEAM_ID, rawFixture, VISITOR_TEAM_ID } from '../testing/sportmonks-fixtures';

const earlyChase = () =>
  rawFixture({
    runs: [
      [1, LOCAL_TEAM_ID, 180, 6, 20],
      [2, VISITOR_TEAM_ID, 40, 1, 5],
    ],
  });

describe('LiveScoreWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls once, schedules the next poll globally and releases the lock', async () => {
    const h = liveScoreHarness();
    h.livescores(earlyChase());

    const delay = await h.worker.runOnce();

    expect(delay).toBe(10_000);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(await h.redis.get(RedisKey.pollLock())).toBeNull();
    const nextPollAt = Number(await h.redis.get(RedisKey.nextPollAt()));
    expect(nextPollAt - Date.now()).toBeGreaterThan(9_000);
  });

  it('does not poll again before next-poll-at, whichever process asks', async () => {
    const h = liveScoreHarness();
    h.livescores(earlyChase());
    await h.worker.runOnce();

    const wait = await h.worker.runOnce();

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(10_000);
  });

  it('lets only one of several workers poll Sportmonks per cycle', async () => {
    const redis = new FakeRedis();
    const workers = [liveScoreHarness({}, redis), liveScoreHarness({}, redis), liveScoreHarness({}, redis)];
    for (const h of workers) {
      h.livescores(earlyChase());
    }

    await Promise.all(workers.map((h) => h.worker.runOnce()));
    await Promise.all(workers.map((h) => h.worker.runOnce()));

    const calls = workers.reduce((sum, h) => sum + h.fetchMock.mock.calls.length, 0);
    expect(calls).toBe(1);
    expect(workers[0].events()).toHaveLength(1);
  });

  it('skips the cycle while another worker holds the lock and recovers after it expires', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-01T12:00:00Z') });
    const h = liveScoreHarness();
    h.livescores(earlyChase());
    await h.redis.acquireLock(RedisKey.pollLock(), 'crashed-worker', 30_000);

    const delay = await h.worker.runOnce();

    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(delay).toBe(5_000);
    expect(h.logs.tagged('worker-lock').some((line) => line.includes('"acquired":false'))).toBe(true);

    vi.setSystemTime(Date.parse('2026-10-01T12:00:31Z'));
    await h.worker.runOnce();
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not call Sportmonks or throw when Redis is unavailable', async () => {
    const h = liveScoreHarness();
    h.livescores(earlyChase());
    h.redis.down = true;

    await expect(h.worker.runOnce()).resolves.toBe(10_000);
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.logs.tagged('poll-error').some((line) => line.includes('redis_unavailable'))).toBe(true);

    await expect(h.reader.getLiveMatchIds()).resolves.toEqual([]);
    await expect(h.reader.getMatchSnapshot('61521')).resolves.toBeNull();
  });

  it('relies on the lock expiry when Redis drops in the middle of a cycle', async () => {
    const h = liveScoreHarness();
    h.respond(() => {
      h.redis.down = true;
      throw new Error('socket hang up');
    });

    await expect(h.worker.runOnce()).rejects.toThrow();

    h.redis.down = false;
    expect(h.redis.ttlSeconds(RedisKey.pollLock())).toBeLessThanOrEqual(h.worker.lockTtlMs() / 1000);
    expect(h.redis.ttlSeconds(RedisKey.pollLock())).toBeGreaterThan(0);
  });

  it('sizes the lock to outlive a full cycle with retries', () => {
    const h = liveScoreHarness({ sportmonksTimeoutMs: 8_000, sportmonksMaxRetries: 2 });
    expect(h.worker.lockTtlMs()).toBe(8_000 * 3 * 4 + 15_000);
  });

  it('records a disabled status instead of polling when no token is configured', async () => {
    const h = liveScoreHarness({ sportmonksApiToken: '' });

    h.worker.onApplicationBootstrap();
    await vi.waitFor(() => expect(h.status()).toMatchObject({ state: 'disabled' }));
    h.worker.onApplicationShutdown();

    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('stays off in processes where LIVE_SCORE_WORKER_ENABLED=false', () => {
    vi.useFakeTimers();
    const h = liveScoreHarness({ liveScoreWorkerEnabled: false });
    h.livescores(earlyChase());

    h.worker.onApplicationBootstrap();
    vi.advanceTimersByTime(120_000);

    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.status()).toBeNull();
  });
});
