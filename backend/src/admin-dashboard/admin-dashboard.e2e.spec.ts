import { AdPlacement, DevicePlatform, MatchStatus } from '@prisma/client';
import request from 'supertest';
import { RedisKey } from '../common/constants/redis-keys';
import { adminAuthHeader, seedAdmin, TEST_ADMIN_PASSWORD } from '../testing/admin-auth';
import { ApiTestApp, createApiTestApp, emitWithAck, settle } from '../testing/api-test-app';
import { adRow, FakeDb, matchRow } from '../testing/fake-db';
import { FakeRedis } from '../testing/fake-redis';
import { liveScoreHarness } from '../testing/live-score-harness';
import { rawFixture } from '../testing/sportmonks-fixtures';
import { TEST_SPORTMONKS_TOKEN } from '../testing/test-config';

const LIVE_ID = 61521;
const STORED_ID = 61530;
const DEVICE_TOKEN = 'fcm-token-secret-value-aaaaaaaaaaaaaaaa';

describe('Admin dashboard and match monitoring (e2e)', () => {
  let api: ApiTestApp;
  let db: FakeDb;
  let redis: FakeRedis;
  let auth: string;

  async function runWorker(...fixtures: Array<Record<string, unknown>>) {
    const worker = liveScoreHarness({}, redis);
    worker.livescores(...fixtures);
    await worker.sync.runCycle('test-worker');
    return worker;
  }

  beforeEach(async () => {
    db = new FakeDb();
    redis = new FakeRedis();
    await seedAdmin(db);
    db.rows.match.push(matchRow(STORED_ID), matchRow(LIVE_ID, { status: MatchStatus.LIVE }));
    db.rows.fcmDevice.push(
      { id: 'd1', deviceId: 'device-000001', fcmToken: DEVICE_TOKEN, platform: DevicePlatform.ANDROID, isActive: true },
      { id: 'd2', deviceId: 'device-000002', fcmToken: 'fcm-token-2222222222222222', platform: DevicePlatform.IOS, isActive: true },
      { id: 'd3', deviceId: 'device-000003', fcmToken: 'fcm-token-3333333333333333', platform: DevicePlatform.IOS, isActive: false },
    );
    db.rows.ad.push(
      adRow('visible', AdPlacement.SPLASH, 0, { isActive: true }),
      adRow('scheduled', AdPlacement.SPLASH, 0, { isActive: true, startAt: new Date(Date.now() + 3_600_000) }),
      adRow('off', AdPlacement.SPLASH, 0, { isActive: false }),
    );
    api = await createApiTestApp({ db, redis });
    auth = await adminAuthHeader(api);
  });

  afterEach(async () => {
    await api.close();
  });

  const dashboard = async () => (await request(api.http).get('/api/v1/admin/dashboard').set('Authorization', auth).expect(200)).body;

  describe('GET /api/v1/admin/dashboard', () => {
    it('summarises live matches, sockets, devices, ads, Sportmonks and dependencies', async () => {
      await runWorker(rawFixture({ id: LIVE_ID }));
      const socket = await api.connect();
      await emitWithAck(socket, 'match:subscribe', { matchId: LIVE_ID });
      await settle();

      const body = await dashboard();

      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        generatedAt: expect.any(String),
        matches: { liveCount: 1 },
        realtime: { connectedClients: 1, activeMatchRooms: 1, subscriptions: 1, instances: 1 },
        devices: { registered: 3, active: 2 },
        ads: { total: 3, enabled: 2, visibleNow: 1 },
        dependencies: { api: 'up', worker: 'up', redis: 'up', mysql: 'up' },
      });
      const sportmonks = body.data.sportmonks;
      expect(sportmonks).toMatchObject({
        workerState: 'live',
        pollingIntervalMs: expect.any(Number),
        configuredIntervalsMs: { idle: 60_000, live: 10_000, active: 5_000 },
        lastSuccessAt: expect.any(String),
        lastSuccess: { liveMatches: 1 },
        lastError: null,
        hourlyLimit: 1_600,
        quotaSource: 'local',
        onDemandCallsThisHour: 0,
        onDemandHourlyLimit: 400,
        count429: 0,
        last429At: null,
        lastStatus: 200,
      });
      expect(sportmonks.callsThisHour).toBeGreaterThanOrEqual(1);
      expect(sportmonks.remainingQuota).toBeLessThan(1_600);
    });

    it('never exposes secrets', async () => {
      await runWorker(rawFixture({ id: LIVE_ID }));
      await redis.asService().setJson(RedisKey.sportmonksLastError(), {
        at: new Date().toISOString(),
        instanceId: 'test',
        kind: 'http',
        status: 401,
        message: `Unauthorized for api_token=${TEST_SPORTMONKS_TOKEN}`,
        retryAfterMs: null,
      });

      const body = await dashboard();
      const text = JSON.stringify(body);

      expect(body.data.sportmonks.lastError).toMatchObject({ kind: 'http', status: 401, message: 'Unauthorized for api_token=[redacted]' });
      for (const secret of [TEST_SPORTMONKS_TOKEN, api.config.jwtSecret, TEST_ADMIN_PASSWORD, DEVICE_TOKEN, db.rows.admin[0]!.passwordHash as string]) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toMatch(/password|privateKey|api_token=(?!\[redacted\])/i);
    });

    it('still answers when Redis and MySQL are down', async () => {
      redis.down = true;
      db.down = true;

      const body = await dashboard();

      expect(body.data.dependencies).toEqual({ api: 'up', worker: 'unknown', redis: 'down', mysql: 'down' });
      expect(body.data.matches.liveCount).toBeNull();
      expect(body.data.sportmonks).toMatchObject({ workerState: null, callsThisHour: null, remainingQuota: null, hourlyLimit: 1_600, count429: null });
    });
  });

  describe('GET /api/v1/admin/matches', () => {
    it('lists live matches with internal ids and subscriber counts', async () => {
      await runWorker(rawFixture({ id: LIVE_ID }));
      const socket = await api.connect();
      await emitWithAck(socket, 'match:subscribe', { matchId: LIVE_ID });
      await settle();

      const res = await request(api.http).get('/api/v1/admin/matches/live').set('Authorization', auth).expect(200);

      expect(res.body.data).toMatchObject({ stale: false, workerState: 'live', updatedAt: expect.any(String) });
      expect(res.body.data.matches).toHaveLength(1);
      expect(res.body.data.matches[0]).toMatchObject({ matchId: LIVE_ID, internalId: 'cm_match_1', subscribers: 1, source: 'live' });
    });

    it('shows the live snapshot, the stored row and cache state side by side', async () => {
      await runWorker(rawFixture({ id: LIVE_ID }));

      const res = await request(api.http).get(`/api/v1/admin/matches/${LIVE_ID}`).set('Authorization', auth).expect(200);

      expect(res.body.data).toMatchObject({
        matchId: LIVE_ID,
        inLiveFeed: true,
        liveWrittenAt: expect.any(String),
        live: { matchId: LIVE_ID, source: 'live', subscribers: 0 },
        stored: { matchId: LIVE_ID, source: 'stored', internalId: expect.any(String), createdAt: expect.any(String) },
        cache: {
          details: { cached: false, cachedAt: null, expiresInSeconds: null },
          scorecard: { cached: false },
          commentary: { cached: false },
        },
      });
    });

    it('accepts the internal id and reports cached copies', async () => {
      await request(api.http).get(`/api/v1/matches/${STORED_ID}`).expect(200);
      const internalId = db.rows.match[0]!.id as string;

      const res = await request(api.http).get(`/api/v1/admin/matches/${internalId}`).set('Authorization', auth).expect(200);

      expect(res.body.data).toMatchObject({ matchId: STORED_ID, internalId, inLiveFeed: false, live: null });
      expect(res.body.data.cache.details).toMatchObject({ cached: true, cachedAt: expect.any(String), expiresInSeconds: expect.any(Number) });
    });

    it('returns 404 for unknown matches and 400 for invalid ids', async () => {
      await request(api.http).get('/api/v1/admin/matches/999999').set('Authorization', auth).expect(404);
      await request(api.http).get('/api/v1/admin/matches/not-an-id').set('Authorization', auth).expect(400);
    });

    it('is read-only: no write methods exist for admin matches', async () => {
      for (const method of ['post', 'patch', 'put', 'delete'] as const) {
        const res = await request(api.http)[method](`/api/v1/admin/matches/${LIVE_ID}`).set('Authorization', auth).send({ score: 999 });
        expect(res.status, method).toBe(404);
      }
    });
  });
});
