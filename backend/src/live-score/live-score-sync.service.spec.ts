import { RedisKey } from '../common/constants/redis-keys';
import { liveScoreHarness } from '../testing/live-score-harness';
import {
  endpointOf,
  envelope,
  jsonResponse,
  latiyalApi,
  latiyalMatch,
  LOCAL_TEAM_ID,
  matchIdOf,
  refusal,
  VISITOR_TEAM_ID,
} from '../testing/latiyal-fixtures';
import { TEST_LATIYAL_TOKEN } from '../testing/test-config';

const ID = 61521;
const INSTANCE = 'test-host:1:abcd1234';

const chase = (score: number, overs: number) =>
  latiyalMatch({
    runs: [
      [1, LOCAL_TEAM_ID, 180, 6, 20],
      [2, VISITOR_TEAM_ID, score, 3, overs],
    ],
  });

const finished = () =>
  latiyalMatch({
    status: 'Finished',
    winnerTeamId: LOCAL_TEAM_ID,
    result: 'Mumbai Strikers won by 20 runs',
    runs: [
      [1, LOCAL_TEAM_ID, 180, 6, 20],
      [2, VISITOR_TEAM_ID, 160, 8, 20],
    ],
  });

describe('LiveScoreSyncService', () => {
  it('stores, persists and publishes a new live match', async () => {
    const h = liveScoreHarness();
    h.live(chase(120, 15.2));

    const decision = await h.sync.runCycle(INSTANCE);

    expect(decision).toEqual({ intervalMs: 5_000, mode: 'active', reason: 'active' });
    expect(h.liveIds()).toEqual([ID]);
    expect(h.match(ID)).toMatchObject({ matchId: 'cm_match_1', score: 120, stale: false, isLive: true });
    expect(h.redis.peekJson(RedisKey.providerLastSuccess())).toMatchObject({ instanceId: INSTANCE, liveMatches: 1 });
    expect(await h.redis.get(RedisKey.liveMatchUpdated(ID))).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(h.status()).toMatchObject({ state: 'live', mode: 'active', nextIntervalMs: 5_000 });

    const [event] = h.events();
    expect(event).toMatchObject({ type: 'MATCH_STARTED', matchId: 'cm_match_1', sportmonksId: ID });
    expect(event.data.score).toBe(120);
    expect(h.logs.tagged('match-changed')).toHaveLength(1);
    expect(h.logs.tagged('poll-success')).toHaveLength(1);
    expect(h.logs.text()).not.toContain(TEST_LATIYAL_TOKEN);
  });

  it('publishes nothing and writes no MySQL rows when the data did not change', async () => {
    const h = liveScoreHarness();
    h.live(chase(120, 15.2));
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
    h.live(chase(50, 8));
    await h.sync.runCycle(INSTANCE);
    h.live(chase(54, 8.1));
    await h.sync.runCycle(INSTANCE);

    const ids = h.playerUpsert.mock.calls.map((call) => (call as unknown as [{ where: { sportmonksId: number } }])[0].where.sportmonksId);
    expect(ids.sort()).toEqual([7002, 9002, 9003]);
  });

  it('publishes only the changed fields when the score moves, without another MySQL write', async () => {
    const h = liveScoreHarness();
    h.live(chase(50, 8));
    await h.sync.runCycle(INSTANCE);

    h.live(chase(54, 8.1));
    await h.sync.runCycle(INSTANCE);

    const events = h.events();
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('MATCH_UPDATED');
    expect(events[1].changedFields).toEqual(expect.arrayContaining(['score', 'overs']));
    expect(events[1].data.score).toBe(54);
    expect(h.transaction).toHaveBeenCalledTimes(1);
  });

  it('keeps the last snapshot as stale when Latiyal fails, then clears it on fresh data', async () => {
    const h = liveScoreHarness();
    h.live(chase(50, 8));
    await h.sync.runCycle(INSTANCE);

    h.respond(() => jsonResponse({ message: 'error' }, 500));
    const first = await h.sync.runCycle(INSTANCE);
    await h.sync.runCycle(INSTANCE);

    expect(h.match(ID)).toMatchObject({ score: 50, stale: true });
    expect(await h.reader.getMatchSnapshot(String(ID))).toMatchObject({ score: 50, stale: true });
    expect(h.events().filter((event) => event.type === 'MATCH_STALE')).toHaveLength(1);
    expect(first.mode).toBe('live');
    expect(h.status()).toMatchObject({ state: 'backoff', consecutiveFailures: 2, reason: 'backoff', nextIntervalMs: 20_000 });
    expect(h.redis.peekJson(RedisKey.providerLastError())).toMatchObject({ kind: 'http', status: 500 });

    h.live(chase(50, 8));
    await h.sync.runCycle(INSTANCE);

    expect(h.match(ID)).toMatchObject({ score: 50, stale: false });
    expect(h.events().at(-1)).toMatchObject({ type: 'MATCH_UPDATED', changedFields: ['stale'] });
    expect(h.status()).toMatchObject({ state: 'live', consecutiveFailures: 0 });
  });

  it('on 429 keeps serving Redis data and waits for Retry-After', async () => {
    const h = liveScoreHarness();
    h.live(chase(50, 8));
    await h.sync.runCycle(INSTANCE);

    h.respond(() => jsonResponse({ message: 'Too Many Attempts.' }, 429, { 'retry-after': '120' }));
    const decision = await h.sync.runCycle(INSTANCE);

    expect(decision).toMatchObject({ intervalMs: 120_000, reason: 'retry-after' });
    expect(h.calls()).toEqual(['liveMatchList', 'liveMatch', 'liveMatchList']);
    expect(h.status()).toMatchObject({ state: 'rate-limited' });
    expect(h.logs.tagged('429')).toHaveLength(1);
    expect(await h.reader.getMatchSnapshot(String(ID))).toMatchObject({ score: 50, stale: true });
    expect(await h.reader.getLiveMatchIds()).toEqual([String(ID)]);

    const blocked = await h.sync.runCycle(INSTANCE);
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    expect(blocked.intervalMs).toBeGreaterThan(100_000);
    expect(h.status()).toMatchObject({ state: 'quota-exhausted' });
  });

  it('stops calling Latiyal once the hourly budget is used up', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-01T12:30:00Z') });
    try {
      const h = liveScoreHarness({ latiyalMaxCallsPerHour: 2 });
      h.live(chase(50, 8));

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
    h.live(chase(150, 19));
    await h.sync.runCycle(INSTANCE);

    h.live(finished());
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

  it('fetches a match once when it disappears from liveMatchList to capture its final state', async () => {
    const h = liveScoreHarness();
    h.live(chase(150, 19));
    await h.sync.runCycle(INSTANCE);

    h.respond((url, init) =>
      endpointOf(url) === 'liveMatch' && matchIdOf(init) === ID ? envelope(finished()) : envelope([]),
    );
    await h.sync.runCycle(INSTANCE);

    expect(h.calls()).toEqual(['liveMatchList', 'liveMatch', 'liveMatchList', 'liveMatch']);
    expect(h.events().at(-1)).toMatchObject({ type: 'MATCH_FINISHED', sportmonksId: ID });
    expect(h.match(ID)).toMatchObject({ status: 'COMPLETED', winnerTeamSportmonksId: LOCAL_TEAM_ID });
    expect(h.liveIds()).toEqual([]);

    await h.sync.runCycle(INSTANCE);
    expect(h.fetchMock).toHaveBeenCalledTimes(5);
  });

  it('removes a vanished match that Latiyal no longer knows', async () => {
    const h = liveScoreHarness();
    h.live(chase(150, 19));
    await h.sync.runCycle(INSTANCE);

    h.respond((url) => (endpointOf(url) === 'liveMatch' ? refusal('Data not found') : envelope([])));
    await h.sync.runCycle(INSTANCE);

    expect(h.events().at(-1)).toMatchObject({ type: 'MATCH_REMOVED', sportmonksId: ID });
    expect(h.match(ID)).toMatchObject({ isLive: false, stale: true, score: 150 });
    expect(h.liveIds()).toEqual([]);
  });

  it('keeps the last batsmen and bowler when only the liveMatch detail call fails', async () => {
    const h = liveScoreHarness();
    h.live(chase(50, 8));
    await h.sync.runCycle(INSTANCE);

    const api = latiyalApi([chase(54, 8.1)]);
    h.respond((url, init) => (endpointOf(url) === 'liveMatch' ? jsonResponse({ message: 'down' }, 500) : api(url, init)));
    await h.sync.runCycle(INSTANCE);

    expect(h.match(ID)).toMatchObject({ score: 54, overs: 8.1, stale: false });
    expect(h.match(ID)!.batsmen.map((batsman) => batsman.name)).toEqual(['Rohan Mehta', 'Arjun Rao']);
    expect(h.match(ID)!.bowler?.name).toBe('Kiran Patel');
    expect(h.status()).toMatchObject({ state: 'live', consecutiveFailures: 0 });
    expect(h.logs.tagged('poll-error').some((line) => line.includes('"endpoint":"liveMatch"'))).toBe(true);
  });

  describe('with liveMatchList reused for LATIYAL_LIST_INTERVAL_MS', () => {
    it('fetches the list once per interval but liveMatch every cycle', async () => {
      const h = liveScoreHarness({ latiyalListIntervalMs: 60_000 });
      h.live(chase(50, 8));
      await h.sync.runCycle(INSTANCE);
      h.live(chase(54, 8.1));
      await h.sync.runCycle(INSTANCE);
      h.live(chase(58, 8.2));
      await h.sync.runCycle(INSTANCE);

      expect(h.calls()).toEqual(['liveMatchList', 'liveMatch', 'liveMatch', 'liveMatch']);
      expect(h.match(ID)).toMatchObject({ score: 58, overs: 8.2 });
      expect(h.redis.ttlSeconds(RedisKey.providerLiveList())).toBe(60);
    });

    it('fetches the list again once the cached copy expires', async () => {
      const h = liveScoreHarness({ latiyalListIntervalMs: 60_000 });
      h.live(chase(50, 8));
      await h.sync.runCycle(INSTANCE);
      await h.redis.del(RedisKey.providerLiveList());
      await h.sync.runCycle(INSTANCE);

      expect(h.calls()).toEqual(['liveMatchList', 'liveMatch', 'liveMatchList', 'liveMatch']);
    });

    it('keeps the last snapshot instead of an older cached list score when liveMatch fails', async () => {
      const h = liveScoreHarness({ latiyalListIntervalMs: 60_000 });
      h.live(chase(50, 8));
      await h.sync.runCycle(INSTANCE);
      h.live(chase(54, 8.1));
      await h.sync.runCycle(INSTANCE);

      h.respond(() => jsonResponse({ message: 'down' }, 500));
      await h.sync.runCycle(INSTANCE);

      expect(h.match(ID)).toMatchObject({ score: 54, overs: 8.1, stale: false });
      expect(h.events().filter((event) => event.type === 'MATCH_UPDATED')).toHaveLength(1);
    });
  });

  it('stores a listed match whose Latiyal status still says Upcoming and leaves idle polling', async () => {
    const h = liveScoreHarness();
    h.live(latiyalMatch({ id: 71391, status: 'Upcoming', runs: [] }));

    const decision = await h.sync.runCycle(INSTANCE);

    expect(decision).toEqual({ intervalMs: 10_000, mode: 'live', reason: 'live' });
    expect(h.liveIds()).toEqual([71391]);
    expect(h.match(71391)).toMatchObject({
      sportmonksId: 71391,
      status: 'LIVE',
      statusDetail: 'Upcoming',
      isLive: true,
      isFinished: false,
    });
    expect(h.logs.tagged('poll-success')[0]).toContain('"fixtures":1');
    expect(h.logs.tagged('poll-success')[0]).toContain('"liveMatches":1');
    expect(h.logs.tagged('poll-success')[0]).toContain('"mode":"live"');
    expect(h.logs.tagged('poll-success')[0]).toContain('"nextIntervalMs":10000');
  });

  it('stays idle when liveMatchList is empty', async () => {
    const h = liveScoreHarness();
    h.live();

    const decision = await h.sync.runCycle(INSTANCE);

    expect(decision).toEqual({ intervalMs: 60_000, mode: 'idle', reason: 'idle' });
    expect(h.liveIds()).toEqual([]);
    expect(h.calls()).toEqual(['liveMatchList']);
    expect(h.logs.tagged('poll-success')[0]).toContain('"fixtures":0');
    expect(h.logs.tagged('poll-success')[0]).toContain('"liveMatches":0');
  });

  it('stays idle when Latiyal answers status:false because nothing is live', async () => {
    const h = liveScoreHarness();
    h.respond(() => refusal('No live match found'));

    const decision = await h.sync.runCycle(INSTANCE);

    expect(decision).toEqual({ intervalMs: 60_000, mode: 'idle', reason: 'idle' });
    expect(h.status()).toMatchObject({ state: 'idle', consecutiveFailures: 0 });
  });

  it('records a token refusal as a failed poll, not as "nothing live"', async () => {
    const h = liveScoreHarness();
    h.respond(() => refusal('Invalid token'));

    await h.sync.runCycle(INSTANCE);

    expect(h.status()).toMatchObject({ state: 'backoff', consecutiveFailures: 1 });
    expect(h.redis.peekJson(RedisKey.providerLastError())).toMatchObject({ kind: 'unauthorized' });
  });
});
