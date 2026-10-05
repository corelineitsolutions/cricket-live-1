import { AdPlacement } from '@prisma/client';
import request from 'supertest';
import { adminAuthHeader, seedAdmin } from '../testing/admin-auth';
import { ApiTestApp, createApiTestApp } from '../testing/api-test-app';
import { adRow, FakeDb } from '../testing/fake-db';
import { FakeRedis } from '../testing/fake-redis';

const HOUR = 3_600_000;

const newAd = (overrides: Record<string, unknown> = {}) => ({
  title: 'Season sponsor',
  imageUrl: 'https://cdn.example.com/banner.png',
  clickUrl: 'https://sponsor.example.com',
  placement: AdPlacement.HOME_BANNER,
  priority: 10,
  isActive: true,
  ...overrides,
});

describe('Ads (e2e)', () => {
  let api: ApiTestApp;
  let db: FakeDb;
  let redis: FakeRedis;
  let auth: string;

  beforeEach(async () => {
    db = new FakeDb();
    redis = new FakeRedis();
    await seedAdmin(db);
    api = await createApiTestApp({ db, redis });
    auth = await adminAuthHeader(api);
  });

  afterEach(async () => {
    await api.close();
  });

  const publicIds = async (query = '') =>
    (await request(api.http).get(`/api/v1/ads${query}`).expect(200)).body.data.map((ad: { id: string }) => ad.id);

  describe('admin CRUD', () => {
    it('creates, reads, updates, lists and deletes an ad', async () => {
      const created = await request(api.http).post('/api/v1/admin/ads').set('Authorization', auth).send(newAd()).expect(201);
      const id = created.body.data.id as string;
      expect(created.body.data).toMatchObject({ title: 'Season sponsor', isActive: true, isVisibleNow: true, startAt: null, endAt: null });

      const fetched = await request(api.http).get(`/api/v1/admin/ads/${id}`).set('Authorization', auth).expect(200);
      expect(fetched.body.data.id).toBe(id);

      const updated = await request(api.http)
        .patch(`/api/v1/admin/ads/${id}`)
        .set('Authorization', auth)
        .send({ title: 'Renamed', priority: 50 })
        .expect(200);
      expect(updated.body.data).toMatchObject({ title: 'Renamed', priority: 50, clickUrl: 'https://sponsor.example.com' });

      const list = await request(api.http).get('/api/v1/admin/ads?placement=HOME_BANNER').set('Authorization', auth).expect(200);
      expect(list.body.meta.total).toBe(1);

      const deleted = await request(api.http).delete(`/api/v1/admin/ads/${id}`).set('Authorization', auth).expect(200);
      expect(deleted.body.data).toEqual({ id });
      await request(api.http).get(`/api/v1/admin/ads/${id}`).set('Authorization', auth).expect(404);
    });

    it('lists inactive and expired ads for admins', async () => {
      db.rows.ad.push(
        adRow('off', AdPlacement.SPLASH, 0, { isActive: false }),
        adRow('expired', AdPlacement.SPLASH, 0, { isActive: true, endAt: new Date(Date.now() - HOUR) }),
      );
      const res = await request(api.http).get('/api/v1/admin/ads').set('Authorization', auth).expect(200);
      const byId = Object.fromEntries(res.body.data.map((ad: { id: string; isVisibleNow: boolean }) => [ad.id, ad.isVisibleNow]));
      expect(byId).toEqual({ off: false, expired: false });

      const inactive = await request(api.http).get('/api/v1/admin/ads?isActive=false').set('Authorization', auth).expect(200);
      expect(inactive.body.data.map((ad: { id: string }) => ad.id)).toEqual(['off']);
    });

    it.each([
      ['javascript: URL', { clickUrl: 'javascript:alert(1)' }],
      ['unknown placement', { placement: 'POPUP' }],
      ['negative priority', { priority: -1 }],
      ['endAt before startAt', { startAt: '2026-10-02T00:00:00Z', endAt: '2026-10-01T00:00:00Z' }],
      ['unknown field', { clicks: 5 }],
    ])('rejects %s', async (_label, overrides) => {
      const res = await request(api.http).post('/api/v1/admin/ads').set('Authorization', auth).send(newAd(overrides)).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('clears a schedule with null, as the admin panel sends for empty dates', async () => {
      const start = new Date(Date.now() + HOUR).toISOString();
      const created = await request(api.http)
        .post('/api/v1/admin/ads')
        .set('Authorization', auth)
        .send(newAd({ startAt: start, endAt: null }))
        .expect(201);
      expect(created.body.data).toMatchObject({ startAt: start, endAt: null, isVisibleNow: false });

      const cleared = await request(api.http)
        .patch(`/api/v1/admin/ads/${created.body.data.id}`)
        .set('Authorization', auth)
        .send({ startAt: null, endAt: null })
        .expect(200);

      expect(cleared.body.data).toMatchObject({ startAt: null, endAt: null, isVisibleNow: true });
      expect(await publicIds()).toEqual([created.body.data.id]);
    });

    it('returns 404 for unknown ads', async () => {
      await request(api.http).patch('/api/v1/admin/ads/missing/activate').set('Authorization', auth).expect(404);
      await request(api.http).delete('/api/v1/admin/ads/missing').set('Authorization', auth).expect(404);
    });
  });

  describe('public GET /api/v1/ads', () => {
    it('returns only active ads inside their schedule, by priority', async () => {
      const now = Date.now();
      db.rows.ad.push(
        adRow('home-low', AdPlacement.HOME_BANNER, 1, { isActive: true }),
        adRow('home-high', AdPlacement.HOME_BANNER, 9, { isActive: true, startAt: new Date(now - HOUR), endAt: new Date(now + HOUR) }),
        adRow('inactive', AdPlacement.HOME_BANNER, 5, { isActive: false }),
        adRow('future', AdPlacement.HOME_BANNER, 5, { isActive: true, startAt: new Date(now + HOUR) }),
        adRow('expired', AdPlacement.HOME_BANNER, 5, { isActive: true, endAt: new Date(now - HOUR) }),
        adRow('list', AdPlacement.MATCH_LIST, 3, { isActive: true }),
      );

      expect(await publicIds('?placement=HOME_BANNER')).toEqual(['home-high', 'home-low']);
      expect(await publicIds()).toEqual(['home-high', 'list', 'home-low']);
      await request(api.http).get('/api/v1/ads?placement=NOPE').expect(400);
    });
  });

  describe('cache', () => {
    it('reflects activation and deactivation immediately on every instance', async () => {
      const other = await createApiTestApp({ db, redis });
      try {
        const created = await request(api.http)
          .post('/api/v1/admin/ads')
          .set('Authorization', auth)
          .send(newAd({ isActive: false }))
          .expect(201);
        const id = created.body.data.id as string;
        const otherIds = async () => (await request(other.http).get('/api/v1/ads').expect(200)).body.data.map((ad: { id: string }) => ad.id);

        expect(await otherIds()).toEqual([]);

        await request(api.http).patch(`/api/v1/admin/ads/${id}/activate`).set('Authorization', auth).expect(200);
        expect(await otherIds()).toEqual([id]);

        await request(api.http).patch(`/api/v1/admin/ads/${id}/deactivate`).set('Authorization', auth).expect(200);
        expect(await otherIds()).toEqual([]);
      } finally {
        await other.close();
      }
    });

    it('serves repeat reads from Redis until an admin change', async () => {
      db.rows.ad.push(adRow('a', AdPlacement.SPLASH, 0, { isActive: true }));
      await publicIds();
      await publicIds('?placement=SPLASH');
      expect(db.ad.findMany).toHaveBeenCalledTimes(1);

      await request(api.http).patch('/api/v1/admin/ads/a').set('Authorization', auth).send({ title: 'New title' }).expect(200);
      const res = await request(api.http).get('/api/v1/ads').expect(200);
      expect(res.body.data[0].title).toBe('New title');
      expect(db.ad.findMany).toHaveBeenCalledTimes(2);
    });
  });
});
