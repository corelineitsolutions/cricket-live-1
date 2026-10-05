import { DevicePlatform } from '@prisma/client';
import request from 'supertest';
import { adminAuthHeader, seedAdmin } from '../testing/admin-auth';
import { ApiTestApp, createApiTestApp } from '../testing/api-test-app';
import { FakeDb } from '../testing/fake-db';

const TOKEN = 'fcm-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NEW_TOKEN = 'fcm-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('Devices (e2e)', () => {
  let api: ApiTestApp;
  let db: FakeDb;

  beforeEach(async () => {
    db = new FakeDb();
    await seedAdmin(db);
    api = await createApiTestApp({ db });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await api.close();
  });

  const register = (body: Record<string, unknown>) => request(api.http).post('/api/v1/devices/register').send(body);

  describe('POST /api/v1/devices/register', () => {
    it('registers a device anonymously and never echoes the token', async () => {
      const res = await register({ deviceId: 'device-123456', fcmToken: TOKEN, platform: 'android', appVersion: '1.0.0' }).expect(200);

      expect(res.body).toEqual({
        success: true,
        data: { deviceId: 'device-123456', platform: 'android', appVersion: '1.0.0', isActive: true, lastSeenAt: expect.any(String) },
      });
      expect(JSON.stringify(res.body)).not.toContain(TOKEN);
      expect(db.rows.fcmDevice).toEqual([
        expect.objectContaining({ deviceId: 'device-123456', fcmToken: TOKEN, platform: DevicePlatform.ANDROID, appVersion: '1.0.0', isActive: true }),
      ]);
    });

    it('updates the existing device on token refresh instead of duplicating it', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-01T08:00:00.000Z'));
      await register({ deviceId: 'device-123456', fcmToken: TOKEN, platform: 'android', appVersion: '1.0.0' }).expect(200);

      vi.setSystemTime(new Date('2026-10-01T09:30:00.000Z'));
      const res = await register({ deviceId: 'device-123456', fcmToken: NEW_TOKEN, platform: 'ANDROID', appVersion: '1.0.1' }).expect(200);

      expect(db.rows.fcmDevice).toHaveLength(1);
      expect(db.rows.fcmDevice[0]).toMatchObject({ fcmToken: NEW_TOKEN, appVersion: '1.0.1', lastSeenAt: new Date('2026-10-01T09:30:00.000Z') });
      expect(res.body.data).toMatchObject({ appVersion: '1.0.1', lastSeenAt: '2026-10-01T09:30:00.000Z' });
    });

    it('re-activates a deactivated device', async () => {
      await register({ deviceId: 'device-123456', fcmToken: TOKEN, platform: 'ios' }).expect(200);
      await request(api.http).post('/api/v1/devices/deactivate').send({ deviceId: 'device-123456' }).expect(200);
      expect(db.rows.fcmDevice[0]?.isActive).toBe(false);

      const res = await register({ deviceId: 'device-123456', fcmToken: TOKEN, platform: 'ios' }).expect(200);
      expect(res.body.data).toMatchObject({ isActive: true, platform: 'ios', appVersion: null });
    });

    it.each([
      ['missing token', { deviceId: 'device-123456', platform: 'android' }],
      ['unknown platform', { deviceId: 'device-123456', fcmToken: TOKEN, platform: 'windows' }],
      ['short device id', { deviceId: 'abc', fcmToken: TOKEN, platform: 'android' }],
      ['device id with spaces', { deviceId: 'device 123456', fcmToken: TOKEN, platform: 'android' }],
      ['token with whitespace', { deviceId: 'device-123456', fcmToken: 'fcm token aaaaaaaa', platform: 'android' }],
      ['bad app version', { deviceId: 'device-123456', fcmToken: TOKEN, platform: 'android', appVersion: '<script>' }],
      ['unknown field', { deviceId: 'device-123456', fcmToken: TOKEN, platform: 'android', isActive: false }],
    ])('rejects %s', async (_label, body) => {
      const res = await register(body).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(db.rows.fcmDevice).toHaveLength(0);
    });
  });

  describe('POST /api/v1/devices/deactivate', () => {
    it('marks the device inactive and keeps the record', async () => {
      await register({ deviceId: 'device-123456', fcmToken: TOKEN, platform: 'android' }).expect(200);

      const res = await request(api.http).post('/api/v1/devices/deactivate').send({ deviceId: 'device-123456' }).expect(200);

      expect(res.body.data).toMatchObject({ deviceId: 'device-123456', isActive: false });
      expect(db.rows.fcmDevice).toHaveLength(1);
    });

    it('returns 404 for an unknown device', async () => {
      const res = await request(api.http).post('/api/v1/devices/deactivate').send({ deviceId: 'device-unknown' }).expect(404);
      expect(res.body.code).toBe('RESOURCE_NOT_FOUND');
    });
  });

  describe('GET /api/v1/admin/devices', () => {
    function seedDevices() {
      const day = (n: number) => new Date(Date.UTC(2026, 8, n));
      for (let i = 1; i <= 25; i += 1) {
        db.rows.fcmDevice.push({
          id: `row-${i}`,
          deviceId: `device-${String(i).padStart(4, '0')}`,
          fcmToken: `fcm-token-${String(i).padStart(4, '0')}-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
          platform: i % 3 === 0 ? DevicePlatform.IOS : DevicePlatform.ANDROID,
          appVersion: '1.0.0',
          isActive: i % 5 !== 0,
          lastSeenAt: day(i),
          createdAt: day(i),
          updatedAt: day(i),
        });
      }
    }

    it('paginates newest activity first and masks tokens', async () => {
      seedDevices();
      const auth = await adminAuthHeader(api);

      const res = await request(api.http).get('/api/v1/admin/devices?page=2&limit=10').set('Authorization', auth).expect(200);

      expect(res.body.meta).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
      expect(res.body.data).toHaveLength(10);
      expect(res.body.data[0]).toEqual({
        id: 'row-15',
        deviceId: 'device-0015',
        platform: 'ios',
        appVersion: '1.0.0',
        isActive: false,
        lastSeenAt: '2026-09-15T00:00:00.000Z',
        fcmTokenMasked: 'fcm-to…xxxx',
        createdAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
      });
      for (const row of db.rows.fcmDevice) {
        expect(JSON.stringify(res.body)).not.toContain(row.fcmToken as string);
      }
    });

    it('filters by search, platform, status and dates', async () => {
      seedDevices();
      const auth = await adminAuthHeader(api);
      const ids = async (query: string) =>
        (await request(api.http).get(`/api/v1/admin/devices?limit=100&${query}`).set('Authorization', auth).expect(200)).body.data.map(
          (device: { deviceId: string }) => device.deviceId,
        );

      expect(await ids('search=device-001')).toHaveLength(10);
      expect(await ids('platform=IOS')).toHaveLength(8);
      expect(await ids('isActive=false')).toEqual(['device-0025', 'device-0020', 'device-0015', 'device-0010', 'device-0005']);
      expect(await ids('isActive=true')).toHaveLength(20);
      expect(await ids('lastSeenFrom=2026-09-20T00:00:00Z&lastSeenTo=2026-09-22T00:00:00Z')).toEqual([
        'device-0022',
        'device-0021',
        'device-0020',
      ]);
      expect(await ids('createdTo=2026-09-02T00:00:00Z')).toEqual(['device-0002', 'device-0001']);
      expect(await ids('platform=ios&isActive=false')).toEqual(['device-0015']);
    });

    it('rejects invalid filters', async () => {
      const auth = await adminAuthHeader(api);
      await request(api.http).get('/api/v1/admin/devices?platform=windows').set('Authorization', auth).expect(400);
      await request(api.http).get('/api/v1/admin/devices?isActive=maybe').set('Authorization', auth).expect(400);
      await request(api.http).get('/api/v1/admin/devices?lastSeenFrom=yesterday').set('Authorization', auth).expect(400);
      await request(api.http).get('/api/v1/admin/devices?limit=1000').set('Authorization', auth).expect(400);
    });
  });
});
