import { SportmonksQuotaService } from '../sportmonks/sportmonks-quota.service';
import { FakeRedis } from '../testing/fake-redis';
import { liveScoreHarness } from '../testing/live-score-harness';
import { LOCAL_TEAM_ID, rawFixture, VISITOR_TEAM_ID } from '../testing/sportmonks-fixtures';
import { testConfig } from '../testing/test-config';

const HOUR_MS = 3_600_000;
const START = Date.parse('2026-10-01T12:00:00.000Z');
const SPORTMONKS_HOURLY_LIMIT = 2_000;
const ON_DEMAND_SHARE = 400;

/** 40/1 after 5 overs chasing 181: live, not critical -> 10 s polling. */
const earlyChase = () =>
  rawFixture({
    runs: [
      [1, LOCAL_TEAM_ID, 180, 6, 20],
      [2, VISITOR_TEAM_ID, 40, 1, 5],
    ],
  });

/** Default fixture, 120/3 after 15.2 overs chasing 181: close finish -> 5 s polling. */
const closeFinish = () => rawFixture();

type Harness = ReturnType<typeof liveScoreHarness>;

/**
 * Simulates one clock hour of several worker processes sharing one Redis. Each process
 * sleeps for whatever runOnce() returns, exactly like the real timer loop. Workers that
 * wake at the same instant run concurrently, so they really compete for the lock.
 */
async function simulateHour(workers: Harness[]): Promise<number> {
  const wakeAt = workers.map(() => START);
  let now = START;
  while (now < START + HOUR_MS) {
    vi.setSystemTime(now);
    const due = workers.map((_, i) => i).filter((i) => wakeAt[i] <= now);
    const delays = await Promise.all(due.map((i) => workers[i].worker.runOnce()));
    due.forEach((i, n) => (wakeAt[i] = now + delays[n]));
    now = Math.min(...wakeAt);
  }
  return workers.reduce((sum, h) => sum + h.fetchMock.mock.calls.length, 0);
}

function workersOn(redis: FakeRedis, count: number, fixture: () => Record<string, unknown>, maxCallsPerHour?: number): Harness[] {
  return Array.from({ length: count }, () => {
    const h = liveScoreHarness(maxCallsPerHour ? { sportmonksMaxCallsPerHour: maxCallsPerHour } : {}, redis);
    h.livescores(fixture());
    return h;
  });
}

describe('Sportmonks rate-limit audit (one simulated hour)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: START });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('10 s polling: ~360 calls/hour with one worker', async () => {
    const calls = await simulateHour(workersOn(new FakeRedis(), 1, earlyChase));

    expect(calls).toBe(360);
  });

  it('5 s polling (close finish): ~720 calls/hour with one worker', async () => {
    const calls = await simulateHour(workersOn(new FakeRedis(), 1, closeFinish));

    expect(calls).toBe(720);
  });

  it('three workers on the same Redis make the same number of calls as one', async () => {
    const redis = new FakeRedis();
    const workers = workersOn(redis, 3, closeFinish);

    const calls = await simulateHour(workers);

    expect(calls).toBe(720);
    const quota = await new SportmonksQuotaService(redis.asService(), testConfig()).getState();
    expect(quota.callsThisHour).toBe(calls);
    expect(quota.count429).toBe(0);
  });

  it('idle (no live matches): 60 calls/hour', async () => {
    const workers = workersOn(new FakeRedis(), 2, earlyChase);
    workers.forEach((h) => h.respond(() => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const calls = await simulateHour(workers);

    expect(calls).toBe(60);
  });

  it('never exceeds SPORTMONKS_MAX_CALLS_PER_HOUR, however many workers run', async () => {
    const redis = new FakeRedis();
    const workers = workersOn(redis, 4, closeFinish, 300);

    const calls = await simulateHour(workers);

    expect(calls).toBeLessThanOrEqual(300);
    expect(calls).toBeGreaterThan(250);
  });

  it('worst case stays below the Sportmonks limit', () => {
    const config = testConfig();
    const worstCaseWorker = HOUR_MS / config.sportmonksActiveIntervalMs;

    expect(worstCaseWorker).toBe(720);
    expect(worstCaseWorker + ON_DEMAND_SHARE).toBeLessThanOrEqual(config.sportmonksMaxCallsPerHour);
    expect(config.sportmonksMaxCallsPerHour).toBeLessThan(SPORTMONKS_HOURLY_LIMIT);
  });
});
