import request from 'supertest';
import { hashPassword } from '../common/utils/password';
import type { ApiTestApp } from './api-test-app';
import type { FakeDb } from './fake-db';

export const TEST_ADMIN_EMAIL = 'admin@example.com';
export const TEST_ADMIN_PASSWORD = 'correct-horse-battery-staple';

let hash: Promise<string> | undefined;

/** Adds the test admin with a real bcrypt hash (computed once per test file). */
export async function seedAdmin(db: FakeDb, overrides: Record<string, unknown> = {}) {
  hash ??= hashPassword(TEST_ADMIN_PASSWORD);
  const row = {
    id: 'admin-1',
    email: TEST_ADMIN_EMAIL,
    passwordHash: await hash,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  db.rows.admin.push(row);
  return row;
}

/** Logs in through the real endpoint and returns an Authorization header value. */
export async function adminAuthHeader(api: ApiTestApp): Promise<string> {
  const res = await request(api.http)
    .post('/api/v1/admin/auth/login')
    .send({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
    .expect(200);
  return `Bearer ${res.body.data.accessToken as string}`;
}
