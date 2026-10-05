import { RedisKey } from '../common/constants/redis-keys';
import { liveScoreHarness } from '../testing/live-score-harness';
import { jsonResponse, LOCAL_TEAM_ID, rawFixture, VISITOR_TEAM_ID } from '../testing/sportmonks-fixtures';
import { TEST_SPORTMONKS_TOKEN } from '../testing/test-config';

const ID = 61521;
const INSTANCE = 'test-host:1:abcd1234';

const chase = (score: number, overs: number) =>
  rawFixture({
    runs: [
      [1, LOCAL_TEAM_ID, 180, 6, 20],
      [2, VISITOR_TEAM_ID, score, 3, overs],
    ],
  });

const finished = () =>
  rawFixture({
    status: 'Finished',
    live: false,
    winnerTeamId: LOCAL_TEAM_ID,
    note: 'Mumbai Strikers won by 20 runs',
    runs: [
      [1, LOCAL_TEAM_ID, 180, 6, 20],
      [2, VISITOR_TEAM_ID, 160, 8, 20],
    ],
  });

describe('LiveScoreSyncService', () => {
  it('stores, persists and publishes a new live match', async () => {
    const h = liveScoreHarness();
    h.livescores(chase(120, 15.2));

    const decision = await h.sync.runCycle(INSTANCE);

    expect(decision).toEqual({ intervalMs: 5_000, mode: 'active', reason: 'active' });
    expect(h.liveIds()).toEqual([ID]);
    expect(h.match(ID)).toMatchObject({ matchId: 'cm_match_1', score: 120, stale: false, isLive: true });
    expect(h.redis.peekJson(RedisKey.sportmonksLastSuccess())).toMatchObject({ instanceId: INSTANCE, liveMatches: 1 });
    expect(await h.redis.get(RedisKey.liveMatchUpdated(ID))).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(h.status()).toMatchObject({ state: 'live', mode: 'active', nextIntervalMs: 5_000 });

    const [event] = h.events();
    expect(event).toMatchObject({ type: 'MATCH_STARTED', matchId: 'cm_match_1', sportmonksId: ID });
    expect(event.data.score).toBe(120);
    expect(h.logs.tagged('match-changed')).toHaveLength(1);
    expect(h.logs.tagged('poll-success')).toHaveLength(1);
    expect(h.logs.text()).not.toContain(TEST_SPORTMONKS_TOKEN);
  });

  it('publishes nothing and writes no MySQL rows when the data did not change', async () => {
    const h = liveScoreHarness();
    h.livescores(chase(120, 15.2));
    await h.sync.runCycle(INSTANCE);
    const updatedAt = h.match(ID)!.lastUpdatedAt;

    await h.sync.runCycle(INSTANCE);
    await h.sync.runCycle(INSTANCE);

    expect(h.events()).toHaveLength(1);
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.match(ID)!.lastUpdatedAt).toBe(updatedAt);
  });

  it('stores each player in MySQL only the first time they appear', async () => {
    const h = liveScoreHarness();
    h.livescores(chase(50, 8));
    await h.sync.runCycle(INSTANCE);
    h.livescores(chase(54, 8.1));
    await h.sync.runCycle(INSTANCE);

    const ids = h.playerUpsert.mock.calls.map((call) => (call as unknown as [{ where: { sportmonksId: number } }])[0].where.sportmonksId);
    expect(ids.sort()).toEqual([7002, 9002, 9003]);
  });

  it('publishes only the changed fields when the score moves, without another MySQL write', async () => {
    const h = liveScoreHarness();
    h.livescores(chase(50, 8));
    await h.sync.runCycle(INSTANCE);

    h.livescores(chase(54, 8.1));
    await h.sync.runCycle(INSTANCE);

    const events = h.events();
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('MATCH_UPDATED');
    expect(events[1].changedFields).toEqual(expect.arrayContaining(['score', 'overs']));
    expect(events[1].data.score).toBe(54);
    expect(h.transaction).toHaveBeenCalledTimes(1);
  });

  it('keeps the last snapshot as stale when Sportmonks fails, then clears it on fresh data', async () => {
    const h = liveScoreHarness();
    h.livescores(chase(50, 8));
    await h.sync.runCycle(INSTANCE);

    h.respond(() => jsonResponse({ message: 'error' }, 500));
    const first = await h.sync.runCycle(INSTANCE);
    await h.sync.runCycle(INSTANCE);

    expect(h.match(ID)).toMatchObject({ score: 50, stale: true });
    expect(await h.reader.getMatchSnapshot(String(ID))).toMatchObject({ score: 50, stale: true });
    expect(h.events().filter((event) => event.type === 'MATCH_STALE')).toHaveLength(1);
    expect(first.mode).toBe('live');
    expect(h.status()).toMatchObject({ state: 'backoff', consecutiveFailures: 2, reason: 'backoff', nextIntervalMs: 20_000 });
    expect(h.redis.peekJson(RedisKey.sportmonksLastError())).toMatchObject({ kind: 'http', status: 500 });

    h.livescores(chase(50, 8));
    await h.sync.runCycle(INSTANCE);

    expect(h.match(ID)).toMatchObject({ score: 50, stale: false });
    expect(h.events().at(-1)).toMatchObject({ type: 'MATCH_UPDATED', changedFields: ['stale'] });
    expect(h.status()).toMatchObject({ state: 'live', consecutiveFailures: 0 });
  });

  it('on 429 keeps serving Redis data and waits for Retry-After', async () => {
    const h = liveScoreHarness();
    h.livescores(chase(50, 8));
    await h.sync.runCycle(INSTANCE);

    h.respond(() => jsonResponse({ message: 'Too Many Attempts.' }, 429, { 'retry-after': '120' }));
    const decision = await h.sync.runCycle(INSTANCE);

    expect(decision).toMatchObject({ intervalMs: 120_000, reason: 'retry-after' });
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    expect(h.status()).toMatchObject({ state: 'rate-limited' });
    expect(h.logs.tagged('429')).toHaveLength(1);
    expect(await h.reader.getMatchSnapshot(String(ID))).toMatchObject({ score: 50, stale: true });
    expect(await h.reader.getLiveMatchIds()).toEqual([String(ID)]);

    const blocked = await h.sync.runCycle(INSTANCE);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    expect(blocked.intervalMs).toBeGreaterThan(100_000);
    expect(h.status()).toMatchObject({ state: 'quota-exhausted' });
  });

  it('stops calling Sportmonks once the hourly budget is used up', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-01T12:30:00Z') });
    try {
      const h = liveScoreHarness({ sportmonksMaxCallsPerHour: 2 });
      h.livescores(chase(50, 8));

      await h.sync.runCycle(INSTANCE);
      await h.sync.runCycle(INSTANCE);
      const decision = await h.sync.runCycle(INSTANCE);

      expect(h.fetchMock).toHaveBeenCalledTimes(2);
      expect(decision.intervalMs).toBe(30 * 60_000);
      expect(h.status()).toMatchObject({ state: 'quota-exhausted', consecutiveFailures: 0 });
      expect(h.logs.tagged('rate-limit').some((line) => line.includes('"allowed":false'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stores the final state once, leaves the live list and drops to idle polling', async () => {
    const h = liveScoreHarness();
    h.livescores(chase(150, 19));
    await h.sync.runCycle(INSTANCE);

    h.livescores(finished());
    const decision = await h.sync.runCycle(INSTANCE);

    const final = h.events().at(-1)!;
    expect(final).toMatchObject({ type: 'MATCH_FINISHED', sportmonksId: ID, matchId: 'cm_match_1' });
    expect(final.data).toMatchObject({ status: 'COMPLETED', isLive: false, isFinished: true, winnerTeamSportmonksId: LOCAL_TEAM_ID });
    expect(h.liveIds()).toEqual([]);
    expect(h.redis.ttlSeconds(RedisKey.liveMatch(ID))).toBe(86_400);
    expect(h.transaction).toHaveBeenCalledTimes(2);
    expect(decision).toMatchObject({ mode: 'idle', intervalMs: 60_000 });
    expect(h.logs.tagged('match-finished')).toHaveLength(1);

    await h.sync.runCycle(INSTANCE);
    expect(h.events().filter((event) => event.type === 'MATCH_FINISHED')).toHaveLength(1);
  });

  it('fetches a match once when it disappears from /livescores to capture its final state', async () => {
    const h = liveScoreHarness();
    h.livescores(chase(150, 19));
    await h.sync.runCycle(INSTANCE);

    h.respond((url) =>
      url.pathname.endsWith(`/fixtures/${ID}`) ? jsonResponse({ data: finished() }) : jsonResponse({ data: [] }),
    );
    await h.sync.runCycle(INSTANCE);

    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    expect(h.events().at(-1)).toMatchObject({ type: 'MATCH_FINISHED', sportmonksId: ID });
    expect(h.liveIds()).toEqual([]);

    await h.sync.runCycle(INSTANCE);
    expect(h.fetchMock).toHaveBeenCalledTimes(4);
  });

  it('removes a vanished match that Sportmonks no longer knows', async () => {
    const h = liveScoreHarness();
    h.livescores(chase(150, 19));
    await h.sync.runCycle(INSTANCE);

    h.respond((url) =>
      url.pathname.includes('/fixtures/') ? jsonResponse({ message: 'not found' }, 404) : jsonResponse({ data: [] }),
    );
    await h.sync.runCycle(INSTANCE);

    expect(h.events().at(-1)).toMatchObject({ type: 'MATCH_REMOVED', sportmonksId: ID });
    expect(h.match(ID)).toMatchObject({ isLive: false, stale: true, score: 150 });
    expect(h.liveIds()).toEqual([]);
  });

  it('ignores fixtures that have not started', async () => {
    const h = liveScoreHarness();
    h.livescores(rawFixture({ status: 'NS', live: false, runs: [] }));

    const decision = await h.sync.runCycle(INSTANCE);

    expect(h.events()).toEqual([]);
    expect(h.liveIds()).toEqual([]);
    expect(decision.mode).toBe('idle');
  });
});
