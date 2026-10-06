import type { LatiyalRecord } from '../latiyal/latiyal.types';
import { LatiyalQuotaService } from '../latiyal/latiyal-quota.service';
import { FakeRedis } from '../testing/fake-redis';
import { latiyalMatch, LOCAL_TEAM_ID, VISITOR_TEAM_ID } from '../testing/latiyal-fixtures';
import { liveScoreHarness } from '../testing/live-score-harness';
import { testConfig } from '../testing/test-config';

const HOUR_MS = 3_600_000;
const START = Date.parse('2026-10-01T12:00:00.000Z');

/** 40/1 after 5 overs chasing 181: live, not critical -> 10 s polling. */
const earlyChase = (id = 61521) =>
  latiyalMatch({
    id,
    runs: [
      [1, LOCAL_TEAM_ID, 180, 6, 20],
      [2, VISITOR_TEAM_ID, 40, 1, 5],
    ],
  });

/** Default match, 120/3 after 15.2 overs chasing 181: close finish -> 5 s polling. */
const closeFinish = () => latiyalMatch();

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

function workersOn(redis: FakeRedis, count: number, matches: () => LatiyalRecord[], maxCallsPerHour?: number): Harness[] {
  return Array.from({ length: count }, () => {
    const h = liveScoreHarness(maxCallsPerHour ? { latiyalMaxCallsPerHour: maxCallsPerHour } : {}, redis);
    h.live(...matches());
    return h;
  });
}

describe('Latiyal rate-limit audit (one simulated hour)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: START });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('10 s polling, one live match: list + detail = 720 calls/hour', async () => {
    const calls = await simulateHour(workersOn(new FakeRedis(), 1, () => [earlyChase()]));

    expect(calls).toBe(720);
  });

  it('10 s polling, two live matches: list + 2 details = 1,080 calls/hour', async () => {
    const calls = await simulateHour(workersOn(new FakeRedis(), 1, () => [earlyChase(1), earlyChase(2)], 5_000));

    expect(calls).toBe(1_080);
  });

  it('5 s polling (close finish): 1,440 calls/hour with one worker', async () => {
    const calls = await simulateHour(workersOn(new FakeRedis(), 1, () => [closeFinish()], 5_000));

    expect(calls).toBe(1_440);
  });

  it('three workers on the same Redis make the same number of calls as one', async () => {
    const redis = new FakeRedis();
    const workers = workersOn(redis, 3, () => [earlyChase()]);

    const calls = await simulateHour(workers);

    expect(calls).toBe(720);
    const quota = await new LatiyalQuotaService(redis.asService(), testConfig()).getState();
    expect(quota.callsThisHour).toBe(calls);
    expect(quota.count429).toBe(0);
  });

  it('idle (no live matches): 60 calls/hour', async () => {
    const calls = await simulateHour(workersOn(new FakeRedis(), 2, () => []));

    expect(calls).toBe(60);
  });

  it('never exceeds LATIYAL_MAX_CALLS_PER_HOUR, however many workers run', async () => {
    const redis = new FakeRedis();
    const workers = workersOn(redis, 4, () => [closeFinish()], 300);

    const calls = await simulateHour(workers);

    expect(calls).toBeLessThanOrEqual(300);
    expect(calls).toBeGreaterThan(250);
  });
});
