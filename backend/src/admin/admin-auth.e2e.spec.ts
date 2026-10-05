import { JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { adminAuthHeader, seedAdmin, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from '../testing/admin-auth';
import { ApiTestApp, createApiTestApp } from '../testing/api-test-app';
import { FakeDb } from '../testing/fake-db';
import { FakeRedis } from '../testing/fake-redis';
import { ADMIN_JWT } from './admin-jwt.constants';
import { ADMIN_LOGIN_MAX_FAILURES } from './login-attempts.service';

const LOGIN = '/api/v1/admin/auth/login';
/** Each login runs bcrypt at cost 12 (~250 ms, more under a parallel test run). */
const BCRYPT_HEAVY_TIMEOUT_MS = 20_000;

describe('Admin authentication (e2e)', () => {
  let api: ApiTestApp;
  let db: FakeDb;
  let redis: FakeRedis;

  beforeEach(async () => {
    db = new FakeDb();
    redis = new FakeRedis();
    await seedAdmin(db);
    api = await createApiTestApp({ db, redis });
  });

  afterEach(async () => {
    await api.close();
  });

  describe('POST /api/v1/admin/auth/login', () => {
    it('returns a signed HS256 JWT for valid credentials', async () => {
      const res = await request(api.http)
        .post(LOGIN)
        .send({ email: ' Admin@Example.com ', password: TEST_ADMIN_PASSWORD })
        .expect(200);

      expect(res.body).toEqual({
        success: true,
        data: { accessToken: expect.any(String), tokenType: 'Bearer', expiresIn: '1h' },
      });
      const decoded = new JwtService().decode(res.body.data.accessToken, { complete: true }) as {
        header: { alg: string };
        payload: Record<string, unknown>;
      };
      expect(decoded.header.alg).toBe('HS256');
      expect(decoded.payload).toMatchObject({ sub: 'admin-1', iss: ADMIN_JWT.issuer, aud: ADMIN_JWT.audience });
      expect(decoded.payload).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(res.body)).not.toContain(TEST_ADMIN_PASSWORD);
    });

    it('rejects a wrong password and an unknown email with the same 401', async () => {
      const wrong = await request(api.http).post(LOGIN).send({ email: TEST_ADMIN_EMAIL, password: 'wrong-password' }).expect(401);
      const unknown = await request(api.http)
        .post(LOGIN)
        .set('X-Forwarded-For', '10.0.0.2')
        .send({ email: 'nobody@example.com', password: 'wrong-password' })
        .expect(401);

      expect(wrong.body).toEqual({ success: false, message: 'Invalid email or password', code: 'UNAUTHORIZED' });
      expect(unknown.body).toEqual(wrong.body);
    });

    it('rejects a disabled admin', async () => {
      db.rows.admin[0]!.isActive = false;
      await request(api.http).post(LOGIN).send({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }).expect(401);
    });

    it('validates the body', async () => {
      const res = await request(api.http).post(LOGIN).send({ email: 'not-an-email', password: '' }).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('locks the account after repeated failures, from any IP, and reports Retry-After', async () => {
      for (let i = 0; i < ADMIN_LOGIN_MAX_FAILURES; i += 1) {
        await request(api.http)
          .post(LOGIN)
          .set('X-Forwarded-For', `10.0.1.${i}`)
          .send({ email: TEST_ADMIN_EMAIL, password: `wrong-password-${i}` })
          .expect(401);
      }

      const locked = await request(api.http)
        .post(LOGIN)
        .set('X-Forwarded-For', '10.0.2.1')
        .send({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
        .expect(429);

      expect(locked.body).toEqual({
        success: false,
        message: 'Too many failed login attempts. Try again later.',
        code: 'TOO_MANY_REQUESTS',
      });
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(800);
      expect(Number(locked.headers['retry-after'])).toBeLessThanOrEqual(900);
    }, BCRYPT_HEAVY_TIMEOUT_MS);

    it('resets the failure count after a successful login', async () => {
      const attempt = (ip: string, password: string) =>
        request(api.http).post(LOGIN).set('X-Forwarded-For', ip).send({ email: TEST_ADMIN_EMAIL, password });

      for (let round = 0; round < 2; round += 1) {
        for (let i = 0; i < ADMIN_LOGIN_MAX_FAILURES - 1; i += 1) {
          await attempt(`10.0.${3 + round}.${i}`, 'wrong-password').expect(401);
        }
        await attempt(`10.0.${3 + round}.200`, TEST_ADMIN_PASSWORD).expect(200);
      }
    }, BCRYPT_HEAVY_TIMEOUT_MS);

    it('throttles rapid attempts from one IP', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        statuses.push((await request(api.http).post(LOGIN).set('X-Forwarded-For', '10.0.5.1').send({})).status);
      }
      expect(statuses).toEqual([400, 400, 400, 429]);
    });
  });

  describe('AdminAuthGuard', () => {
    const sign = (payload: Record<string, unknown>, options: Record<string, unknown> = {}) =>
      new JwtService().signAsync(payload, {
        secret: api.config.jwtSecret,
        algorithm: 'HS256',
        issuer: ADMIN_JWT.issuer,
        audience: ADMIN_JWT.audience,
        ...options,
      });

    it('protects every /api/v1/admin route except login', async () => {
      const document = SwaggerModule.createDocument(api.app, new DocumentBuilder().build());
      const routes = Object.entries(document.paths)
        .filter(([path]) => path.startsWith('/api/v1/admin/') && path !== LOGIN)
        .flatMap(([path, item]) =>
          (['get', 'post', 'patch', 'put', 'delete'] as const)
            .filter((method) => item[method])
            .map((method) => ({ method, path: path.replace(/\{[^}]+\}/g, 'abc123') })),
        );
      expect(routes.length).toBeGreaterThanOrEqual(12);

      for (const { method, path } of routes) {
        const res = await request(api.http)[method](path);
        expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
        expect(res.body).toEqual({ success: false, message: 'Admin authentication required', code: 'UNAUTHORIZED' });
      }
      expect(document.paths['/api/v1/admin/dashboard']!.get!.security).toEqual([{ 'admin-jwt': [] }]);
      expect(document.paths[LOGIN]!.post!.security).toBeUndefined();
    });

    it('accepts a token from login', async () => {
      const res = await request(api.http).get('/api/v1/admin/auth/me').set('Authorization', await adminAuthHeader(api)).expect(200);
      expect(res.body.data).toEqual({ id: 'admin-1', email: TEST_ADMIN_EMAIL, isActive: true });
    });

    it.each([
      ['a wrong secret', () => sign({ sub: 'admin-1' }, { secret: 'some-other-secret-value-1234567890' })],
      ['a wrong audience', () => sign({ sub: 'admin-1' }, { audience: 'mobile-app' })],
      ['a wrong issuer', () => sign({ sub: 'admin-1' }, { issuer: 'someone-else' })],
      ['an expired token', () => sign({ sub: 'admin-1', exp: Math.floor(Date.now() / 1000) - 60 })],
      ['an unknown admin', () => sign({ sub: 'admin-404' })],
      [
        'alg=none',
        async () => {
          const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
          return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: 'admin-1', iss: ADMIN_JWT.issuer, aud: ADMIN_JWT.audience })}.`;
        },
      ],
    ])('rejects %s', async (_label, token) => {
      await request(api.http)
        .get('/api/v1/admin/dashboard')
        .set('Authorization', `Bearer ${await token()}`)
        .expect(401);
    });

    it('rejects a valid token once the admin is disabled', async () => {
      const header = await adminAuthHeader(api);
      db.rows.admin[0]!.isActive = false;
      await request(api.http).get('/api/v1/admin/dashboard').set('Authorization', header).expect(401);
    });

    it('leaves mobile endpoints open', async () => {
      await request(api.http).get('/api/v1/ads').expect(200);
      await request(api.http)
        .post('/api/v1/devices/register')
        .send({ deviceId: 'device-123456', fcmToken: 'fcm-token-aaaaaaaaaaaaaaaa', platform: 'android' })
        .expect(200);
    });
  });
});
