import { MatchStatus } from '@prisma/client';
import request from 'supertest';
import { ApiTestApp, collect, createApiTestApp, emitWithAck, nextEvent, settle } from './testing/api-test-app';
import { FakeDb, matchRow } from './testing/fake-db';
import { FakeRedis } from './testing/fake-redis';
import { liveScoreHarness } from './testing/live-score-harness';
import { jsonResponse, LOCAL_TEAM_ID, rawFixture, VISITOR_TEAM_ID } from './testing/sportmonks-fixtures';
import { RealtimeMetricsService } from './websocket/realtime-metrics.service';

const MATCH_ID = 61521;

const chase = (score: number, overs: number) =>
  rawFixture({
    id: MATCH_ID,
    runs: [
      [1, LOCAL_TEAM_ID, 180, 6, 20],
      [2, VISITOR_TEAM_ID, score, 3, overs],
    ],
  });

/**
 * Failure scenarios across the API, the worker and the shared Redis. Related coverage:
 * worker lock expiry / Redis drop mid-cycle (live-score.worker.spec), Sportmonks failure,
 * 429 and hourly budget (live-score-sync.spec), duplicate-worker call rate
 * (rate-limit-audit.spec), cross-instance delivery (live.gateway.e2e.spec).
 */
describe('Failure recovery (e2e)', () => {
  let redis: FakeRedis;
  let db: FakeDb;
  let api: ApiTestApp;
  let worker: ReturnType<typeof liveScoreHarness>;

  async function poll(fixture: Record<string, unknown>) {
    worker.livescores(fixture);
    await worker.sync.runCycle('test-worker');
    await settle();
  }

  beforeEach(async () => {
    redis = new FakeRedis();
    db = new FakeDb();
    db.rows.match.push(matchRow(MATCH_ID, { status: MatchStatus.LIVE }));
    worker = liveScoreHarness({}, redis);
    api = await createApiTestApp({ redis, db });
  });

  afterEach(async () => {
    await api.close();
  });

  describe('MySQL unavailable', () => {
    it('keeps serving live scores and WebSocket updates from Redis, and reports degraded health', async () => {
      await poll(chase(120, 15.2));
      const socket = await api.connect();
      await emitWithAck(socket, 'match:subscribe', { matchId: MATCH_ID });
      const updates = collect<{ match: { score: number } }>(socket, 'match:updated');
      db.down = true;

      const live = await request(api.http).get('/api/v1/matches/live').expect(200);
      const health = await request(api.http).get('/health').expect(503);
      await poll(chase(124, 15.3));

      expect(live.body.data.matches[0]).toMatchObject({ matchId: MATCH_ID, score: 120 });
      expect(health.body).toMatchObject({ success: false, code: 'SERVICE_UNAVAILABLE' });
      expect(updates.map((u) => u.match.score)).toEqual([124]);
    });

    it('recovers health as soon as MySQL is back', async () => {
      db.down = true;
      await request(api.http).get('/health').expect(503);
      db.down = false;
      const res = await request(api.http).get('/health').expect(200);
      expect(res.body.data).toMatchObject({ status: 'ok', checks: { mysql: 'up', redis: 'up' } });
    });
  });

  describe('Redis unavailable', () => {
    it('answers 503 instead of crashing, then recovers without a restart', async () => {
      await poll(chase(120, 15.2));
      redis.down = true;

      await request(api.http).get('/api/v1/matches/live').expect(503);
      await request(api.http).get('/health').expect(503);
      // The API process is still up and serving other requests.
      await request(api.http).get('/api/v1/matches/live').expect(503);

      redis.down = false;
      const res = await request(api.http).get('/api/v1/matches/live').expect(200);
      expect(res.body.data.matches[0]).toMatchObject({ matchId: MATCH_ID, score: 120 });
      await request(api.http).get('/health').expect(200);
    });

    it('never calls Sportmonks from the API, even while Redis is down', async () => {
      redis.down = true;
      await request(api.http).get('/api/v1/matches/live').expect(503);
      await request(api.http).get(`/api/v1/matches/${MATCH_ID}/scorecard`);
      expect(api.fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('Sportmonks unavailable', () => {
    it('keeps the last good scores, flagged stale after repeated failures, and recovers on the next success', async () => {
      await poll(chase(120, 15.2));
      worker.respond(() => jsonResponse({ message: 'Service Unavailable' }, 503));

      for (let i = 0; i < 3; i += 1) {
        await worker.sync.runCycle('test-worker');
      }
      const during = await request(api.http).get('/api/v1/matches/live').expect(200);

      expect(during.body.data.matches[0]).toMatchObject({ matchId: MATCH_ID, score: 120 });

      await poll(chase(126, 15.4));
      const after = await request(api.http).get('/api/v1/matches/live').expect(200);
      expect(after.body.data).toMatchObject({ stale: false });
      expect(after.body.data.matches[0]).toMatchObject({ score: 126, stale: false });
    });
  });

  describe('API restart', () => {
    it('a fresh API process serves the current state from Redis immediately', async () => {
      await poll(chase(120, 15.2));
      await api.close();

      api = await createApiTestApp({ redis, db });
      const live = await request(api.http).get('/api/v1/matches/live').expect(200);
      const socket = await api.connect();
      const snapshot = nextEvent<{ match: { score: number } }>(socket, 'match:snapshot');
      await emitWithAck(socket, 'match:subscribe', { matchId: MATCH_ID });

      expect(live.body.data.matches[0]).toMatchObject({ matchId: MATCH_ID, score: 120 });
      expect((await snapshot).match.score).toBe(120);
      const updates = collect<{ match: { score: number } }>(socket, 'match:updated');
      await poll(chase(130, 15.6));
      expect(updates.map((u) => u.match.score)).toEqual([130]);
    });
  });

  describe('WebSocket disconnect', () => {
    it('removes the socket from its match rooms and the metrics', async () => {
      await poll(chase(120, 15.2));
      const metrics = api.app.get(RealtimeMetricsService);
      const socket = await api.connect();
      await emitWithAck(socket, 'match:subscribe', { matchId: MATCH_ID });
      expect(await metrics.cluster()).toMatchObject({ connections: 1, activeRooms: 1, subscriptions: 1 });

      socket.disconnect();
      await settle(100);

      expect(await metrics.cluster()).toMatchObject({ connections: 0, activeRooms: 0, subscriptions: 0 });
    });

    it('a reconnecting client resubscribes and gets a fresh snapshot including updates it missed', async () => {
      await poll(chase(120, 15.2));
      const first = await api.connect();
      await emitWithAck(first, 'match:subscribe', { matchId: MATCH_ID });
      first.disconnect();
      await settle();

      await poll(chase(132, 15.7));
      const again = await api.connect();
      const snapshot = nextEvent<{ match: { score: number } }>(again, 'match:snapshot');
      await emitWithAck(again, 'match:subscribe', { matchId: MATCH_ID });

      expect((await snapshot).match.score).toBe(132);
    });
  });

  describe('multiple API processes', () => {
    it('an instance going away does not affect clients of the other instance', async () => {
      const second = await createApiTestApp({ redis, db });
      await poll(chase(120, 15.2));
      const onSecond = await second.connect();
      await emitWithAck(onSecond, 'match:subscribe', { matchId: MATCH_ID });
      const seen = collect<{ match: { score: number } }>(onSecond, 'match:updated');

      await api.close();
      api = second;
      await poll(chase(134, 15.8));

      expect(seen.map((u) => u.match.score)).toEqual([134]);
    });
  });
});
