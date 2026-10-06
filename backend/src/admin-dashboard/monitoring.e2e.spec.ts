import request from 'supertest';
import { adminAuthHeader, seedAdmin } from '../testing/admin-auth';
import { ApiTestApp, createApiTestApp } from '../testing/api-test-app';
import { FakeDb } from '../testing/fake-db';
import { FakeRedis } from '../testing/fake-redis';
import { liveScoreHarness } from '../testing/live-score-harness';
import { latiyalMatch } from '../testing/latiyal-fixtures';
import { TEST_LATIYAL_TOKEN } from '../testing/test-config';
import { METRIC_DEFINITIONS } from './monitoring.service';

const METRICS_TOKEN = 'm'.repeat(40);

describe('Monitoring metrics (e2e)', () => {
  let api: ApiTestApp;
  let db: FakeDb;
  let redis: FakeRedis;

  async function start(metricsToken: string) {
    db = new FakeDb();
    redis = new FakeRedis();
    await seedAdmin(db);
    const worker = liveScoreHarness({}, redis);
    worker.live(latiyalMatch({ id: 61521 }));
    await worker.sync.runCycle('test-worker');
    api = await createApiTestApp({ db, redis, config: { metricsToken } });
  }

  afterEach(async () => {
    await api.close();
  });

  describe('GET /api/v1/admin/metrics', () => {
    beforeEach(() => start(''));

    it('requires an admin token', async () => {
      await request(api.http).get('/api/v1/admin/metrics').expect(401);
    });

    it('returns every monitoring metric by name', async () => {
      const res = await request(api.http).get('/api/v1/admin/metrics').set('Authorization', await adminAuthHeader(api)).expect(200);

      expect(res.body.success).toBe(true);
      expect(Object.keys(res.body.data.metrics).sort()).toEqual(Object.keys(METRIC_DEFINITIONS).sort());
      expect(res.body.data.metrics).toMatchObject({
        'provider.calls.limit': 1_600,
        'provider.live_matches': 1,
        'provider.429': 0,
        'worker.status': 1,
        'redis.status': 1,
        'mysql.status': 1,
        'websocket.connected': 0,
      });
      expect(res.body.data.metrics['provider.calls.hour']).toBeGreaterThanOrEqual(1);
      expect(res.body.data.metrics['provider.last_success']).toBeGreaterThan(1_700_000_000);
      expect(JSON.stringify(res.body)).not.toContain(TEST_LATIYAL_TOKEN);
    });

    it('reports dependencies as 0 when Redis and MySQL are down', async () => {
      const auth = await adminAuthHeader(api);
      redis.down = true;
      db.down = true;

      const res = await request(api.http).get('/api/v1/admin/metrics').set('Authorization', auth).expect(200);

      expect(res.body.data.metrics).toMatchObject({ 'redis.status': 0, 'mysql.status': 0, 'worker.status': 0, 'provider.calls.hour': null });
    });
  });

  describe('GET /metrics (Prometheus)', () => {
    it('does not exist while METRICS_TOKEN is empty', async () => {
      await start('');
      await request(api.http).get('/metrics').expect(404);
      await request(api.http).get('/metrics').set('Authorization', `Bearer ${METRICS_TOKEN}`).expect(404);
    });

    it('rejects a missing or wrong token', async () => {
      await start(METRICS_TOKEN);
      await request(api.http).get('/metrics').expect(401);
      await request(api.http).get('/metrics').set('Authorization', 'Bearer wrong-token').expect(401);
      await request(api.http).get('/metrics').set('Authorization', await adminAuthHeader(api)).expect(401);
    });

    it('serves the Prometheus text format with the right token', async () => {
      await start(METRICS_TOKEN);

      const res = await request(api.http).get('/metrics').set('Authorization', `Bearer ${METRICS_TOKEN}`).expect(200);

      expect(res.headers['content-type']).toMatch(/^text\/plain;.*version=0\.0\.4/);
      expect(res.text).toContain('cricket_live_provider_calls_limit 1600\n');
      expect(res.text).toContain('cricket_live_redis_status 1\n');
      expect(res.text).toContain('cricket_live_worker_health{health="up"} 1\n');
      expect(res.text).not.toContain(TEST_LATIYAL_TOKEN);
    });

    it('is not under the /api/v1 prefix', async () => {
      await start(METRICS_TOKEN);
      await request(api.http).get('/api/v1/metrics').set('Authorization', `Bearer ${METRICS_TOKEN}`).expect(404);
    });
  });
});
