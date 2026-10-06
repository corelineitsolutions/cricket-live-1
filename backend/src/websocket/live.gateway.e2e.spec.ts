import { MatchStatus } from '@prisma/client';
import { RedisChannel } from '../common/constants/redis-keys';
import { ApiTestApp, collect, createApiTestApp, emitWithAck, nextEvent, settle } from '../testing/api-test-app';
import { FakeDb, matchRow } from '../testing/fake-db';
import { FakeRedis } from '../testing/fake-redis';
import { liveScoreHarness } from '../testing/live-score-harness';
import { LOCAL_TEAM_ID, latiyalMatch, VISITOR_TEAM_ID } from '../testing/latiyal-fixtures';
import { RealtimeMetricsService } from './realtime-metrics.service';
import { SOCKET_LIMITS } from './realtime.contract';

const MATCH_A = 61521;
const MATCH_B = 61522;
const STORED = 61530;

const chase = (id: number, score: number, overs: number) =>
  latiyalMatch({
    id,
    runs: [
      [1, LOCAL_TEAM_ID, 180, 6, 20],
      [2, VISITOR_TEAM_ID, score, 3, overs],
    ],
  });

interface MatchEvent {
  matchId: number;
  type: string;
  changedFields: string[];
  match: { matchId: number; score: number | null; status: string; isFinished: boolean };
  updatedAt: string;
}

describe('Live WebSocket gateway (e2e)', () => {
  let redis: FakeRedis;
  let db: FakeDb;
  let api: ApiTestApp;
  let worker: ReturnType<typeof liveScoreHarness>;

  /** Runs one worker cycle against the shared Redis, which publishes to live-score-updates. */
  async function poll(...fixtures: Array<Record<string, unknown>>) {
    worker.live(...fixtures);
    await worker.sync.runCycle('test-worker');
    await settle();
  }

  beforeEach(async () => {
    redis = new FakeRedis();
    db = new FakeDb();
    db.rows.match.push(matchRow(STORED));
    worker = liveScoreHarness({}, redis);
    api = await createApiTestApp({ redis, db });
  });

  afterEach(async () => {
    await api.close();
  });

  it('connects anonymously to the /live namespace', async () => {
    const socket = await api.connect();
    expect(socket.connected).toBe(true);
  });

  it('subscribe joins the match room, acks, and sends the Redis snapshot immediately', async () => {
    await poll(chase(MATCH_A, 120, 15.2));
    const socket = await api.connect();
    const snapshot = nextEvent<{ matchId: number; match: MatchEvent['match']; serverTime: string }>(socket, 'match:snapshot');

    const ack = await emitWithAck(socket, 'match:subscribe', { matchId: MATCH_A });

    expect(ack).toEqual({ ok: true, matchId: MATCH_A, room: `match:${MATCH_A}`, subscriptions: 1 });
    const event = await snapshot;
    expect(event.matchId).toBe(MATCH_A);
    expect(event.match).toMatchObject({ matchId: MATCH_A, source: 'live', score: 120 });
    expect(event.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sends a stored snapshot for a match that is not live, and null for an unknown one', async () => {
    const socket = await api.connect();

    const stored = nextEvent<{ match: { source: string; status: string } }>(socket, 'match:snapshot');
    await emitWithAck(socket, 'match:subscribe', { matchId: STORED });
    expect((await stored).match).toMatchObject({ source: 'stored', status: MatchStatus.SCHEDULED });

    const unknown = nextEvent<{ matchId: number; match: unknown }>(socket, 'match:snapshot');
    await emitWithAck(socket, 'match:subscribe', { matchId: 424242 });
    expect(await unknown).toMatchObject({ matchId: 424242, match: null });
  });

  it('delivers worker updates through Redis Pub/Sub only to subscribers of that match', async () => {
    await poll(chase(MATCH_A, 120, 15.2), chase(MATCH_B, 50, 6));
    const fanA = await api.connect();
    const fanB = await api.connect();
    const idle = await api.connect();
    await emitWithAck(fanA, 'match:subscribe', { matchId: MATCH_A });
    await emitWithAck(fanB, 'match:subscribe', { matchId: MATCH_B });
    const seenA = collect<MatchEvent>(fanA, 'match:updated');
    const seenB = collect<MatchEvent>(fanB, 'match:updated');
    const seenIdle = collect<MatchEvent>(idle, 'match:updated');

    await poll(chase(MATCH_A, 124, 15.3), chase(MATCH_B, 50, 6));

    expect(redis.published.some((entry) => entry.channel.endsWith(RedisChannel.liveScoreUpdates()))).toBe(true);
    expect(seenA).toHaveLength(1);
    expect(seenA[0]).toMatchObject({ matchId: MATCH_A, type: 'MATCH_UPDATED', match: { matchId: MATCH_A, score: 124 } });
    expect(seenA[0].changedFields).toEqual(expect.arrayContaining(['score', 'overs']));
    expect(JSON.stringify(seenA[0])).not.toContain('cm_match_1');
    expect(seenB).toHaveLength(0);
    expect(seenIdle).toHaveLength(0);
  });

  it('emits match:started and match:finished to the room', async () => {
    const socket = await api.connect();
    await emitWithAck(socket, 'match:subscribe', { matchId: MATCH_A });
    const started = nextEvent<MatchEvent>(socket, 'match:started');
    await poll(chase(MATCH_A, 10, 1));
    expect(await started).toMatchObject({ type: 'MATCH_STARTED', match: { status: 'LIVE' } });

    const finished = nextEvent<MatchEvent>(socket, 'match:finished');
    await poll(
      latiyalMatch({
        id: MATCH_A,
        status: 'Finished',
        winnerTeamId: LOCAL_TEAM_ID,
        result: 'Mumbai Strikers won by 20 runs',
        runs: [
          [1, LOCAL_TEAM_ID, 180, 6, 20],
          [2, VISITOR_TEAM_ID, 160, 8, 20],
        ],
      }),
    );
    expect(await finished).toMatchObject({ type: 'MATCH_FINISHED', match: { isFinished: true, status: 'COMPLETED' } });
  });

  it('unsubscribe leaves the room so no further updates arrive', async () => {
    await poll(chase(MATCH_A, 120, 15.2));
    const socket = await api.connect();
    await emitWithAck(socket, 'match:subscribe', { matchId: MATCH_A });
    const seen = collect<MatchEvent>(socket, 'match:updated');

    const ack = await emitWithAck(socket, 'match:unsubscribe', { matchId: MATCH_A });
    await poll(chase(MATCH_A, 130, 16));

    expect(ack).toEqual({ ok: true, matchId: MATCH_A, room: `match:${MATCH_A}`, subscriptions: 0 });
    expect(seen).toHaveLength(0);
  });

  it('fans one update out to many clients of the same match', async () => {
    await poll(chase(MATCH_A, 120, 15.2));
    const clients = await Promise.all(Array.from({ length: 5 }, () => api.connect()));
    await Promise.all(clients.map((client) => emitWithAck(client, 'match:subscribe', { matchId: MATCH_A })));
    const seen = clients.map((client) => collect<MatchEvent>(client, 'match:updated'));

    await poll(chase(MATCH_A, 126, 15.4));

    expect(seen.map((events) => events.length)).toEqual([1, 1, 1, 1, 1]);
    expect(seen.every((events) => events[0].match.score === 126)).toBe(true);
  });

  it('delivers each update exactly once per client across several API instances', async () => {
    const second = await createApiTestApp({ redis, db });
    try {
      await poll(chase(MATCH_A, 120, 15.2));
      const onFirst = await api.connect();
      const onSecond = await second.connect();
      await emitWithAck(onFirst, 'match:subscribe', { matchId: MATCH_A });
      await emitWithAck(onSecond, 'match:subscribe', { matchId: MATCH_A });
      const seenFirst = collect<MatchEvent>(onFirst, 'match:updated');
      const seenSecond = collect<MatchEvent>(onSecond, 'match:updated');

      await poll(chase(MATCH_A, 128, 15.5));

      expect(seenFirst).toHaveLength(1);
      expect(seenSecond).toHaveLength(1);
      expect(seenSecond[0].match.score).toBe(128);
    } finally {
      await second.close();
    }
  });

  it('subscribing twice to the same match does not duplicate events', async () => {
    await poll(chase(MATCH_A, 120, 15.2));
    const socket = await api.connect();
    await emitWithAck(socket, 'match:subscribe', { matchId: MATCH_A });
    const again = await emitWithAck(socket, 'match:subscribe', { matchId: MATCH_A });
    const seen = collect<MatchEvent>(socket, 'match:updated');

    await poll(chase(MATCH_A, 121, 15.3));

    expect(again).toMatchObject({ ok: true, subscriptions: 1 });
    expect(seen).toHaveLength(1);
  });

  describe('validation and abuse protection', () => {
    it.each([
      ['a non-object payload', 'hello', 'INVALID_PAYLOAD'],
      ['an array payload', [1, 2], 'INVALID_PAYLOAD'],
      ['a missing matchId', {}, 'INVALID_MATCH_ID'],
      ['a negative matchId', { matchId: -1 }, 'INVALID_MATCH_ID'],
      ['a fractional matchId', { matchId: 1.5 }, 'INVALID_MATCH_ID'],
      ['a non-numeric string', { matchId: 'abc' }, 'INVALID_MATCH_ID'],
      ['an oversized matchId', { matchId: 1e15 }, 'INVALID_MATCH_ID'],
    ])('rejects %s with an error ack and server:error', async (_label, payload, code) => {
      const socket = await api.connect();
      const serverError = nextEvent<{ code: string; event: string }>(socket, 'server:error');
      const snapshots = collect(socket, 'match:snapshot');

      const ack = await emitWithAck<{ ok: boolean; code: string }>(socket, 'match:subscribe', payload);

      expect(ack).toMatchObject({ ok: false, code });
      expect(await serverError).toMatchObject({ code, event: 'match:subscribe' });
      expect(snapshots).toHaveLength(0);
    });

    it('accepts a numeric string matchId', async () => {
      const socket = await api.connect();
      const ack = await emitWithAck(socket, 'match:subscribe', { matchId: String(STORED) });
      expect(ack).toMatchObject({ ok: true, matchId: STORED });
    });

    it('limits subscriptions per connection', async () => {
      const socket = await api.connect();
      for (let i = 1; i <= SOCKET_LIMITS.maxSubscriptionsPerSocket; i += 1) {
        await emitWithAck(socket, 'match:subscribe', { matchId: 1000 + i });
      }
      // The burst is spent; wait for one token so the subscription limit, not the rate limit, answers.
      await settle(1000 / SOCKET_LIMITS.eventsPerSecond + 50);
      const ack = await emitWithAck(socket, 'match:subscribe', { matchId: 5000 });
      expect(ack).toMatchObject({ ok: false, code: 'TOO_MANY_SUBSCRIPTIONS' });
    });

    it('rate limits event floods and disconnects abusive sockets', async () => {
      const socket = await api.connect();
      const errors = collect<{ code: string }>(socket, 'server:error');
      const disconnected = new Promise<string>((resolve) => socket.once('disconnect', resolve));

      for (let i = 0; i < SOCKET_LIMITS.eventBurst + SOCKET_LIMITS.maxRejectedEvents + 5; i += 1) {
        socket.emit('match:unsubscribe', { matchId: 1 });
      }

      expect(await disconnected).toBe('io server disconnect');
      expect(errors.some((error) => error.code === 'RATE_LIMITED')).toBe(true);
    });

    it('answers a rate-limited event through its ack instead of leaving the client waiting', async () => {
      const socket = await api.connect();
      for (let i = 0; i < SOCKET_LIMITS.eventBurst; i += 1) {
        socket.emit('match:unsubscribe', { matchId: 1 });
      }
      const ack = await emitWithAck(socket, 'match:subscribe', { matchId: STORED });
      expect(ack).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    });
  });

  it('reports connections and subscriptions per match across instances', async () => {
    const second = await createApiTestApp({ redis, db });
    try {
      await poll(chase(MATCH_A, 120, 15.2), chase(MATCH_B, 50, 6));
      const a1 = await api.connect();
      const a2 = await api.connect();
      const b1 = await second.connect();
      await emitWithAck(a1, 'match:subscribe', { matchId: MATCH_A });
      await emitWithAck(a2, 'match:subscribe', { matchId: MATCH_A });
      await emitWithAck(a2, 'match:subscribe', { matchId: MATCH_B });
      await emitWithAck(b1, 'match:subscribe', { matchId: MATCH_A });

      await second.app.get(RealtimeMetricsService).publish();
      const metrics = await api.app.get(RealtimeMetricsService).cluster();

      expect(metrics).toMatchObject({
        instances: 2,
        connections: 3,
        activeRooms: 2,
        subscriptions: 4,
        subscriptionsPerMatch: [
          { matchId: MATCH_A, subscribers: 3 },
          { matchId: MATCH_B, subscribers: 1 },
        ],
      });
      // Live matches: connections, subscriptions and metrics never touch MySQL.
      expect(db.queryCount()).toBe(0);
    } finally {
      await second.close();
    }
  });
});
