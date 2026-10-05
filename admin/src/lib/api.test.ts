import { describe, expect, it } from 'vitest';
import { ApiError, buildUrl, parseResponse } from './api';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('buildUrl', () => {
  it('appends defined query values only', () => {
    expect(buildUrl('/admin/devices', { page: 2, search: '', platform: undefined, isActive: false, x: null }, 'https://api.example.com/api/v1')).toBe(
      'https://api.example.com/api/v1/admin/devices?page=2&isActive=false',
    );
    expect(buildUrl('/admin/dashboard', {}, 'https://api.example.com/api/v1')).toBe('https://api.example.com/api/v1/admin/dashboard');
  });

  it('encodes query values', () => {
    expect(buildUrl('/a', { search: 'a b&c' }, 'http://h')).toBe('http://h/a?search=a+b%26c');
  });
});

describe('parseResponse', () => {
  it('unwraps the success envelope', async () => {
    await expect(parseResponse(json({ success: true, data: [1], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } }))).resolves.toEqual({
      data: [1],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  it('turns the error envelope into an ApiError', async () => {
    const error = await parseResponse(json({ success: false, message: 'Validation failed', code: 'VALIDATION_ERROR', errors: ['title should not be empty'] }, 400)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', errors: ['title should not be empty'] });
    expect((error as ApiError).describe()).toBe('Validation failed: title should not be empty');
  });

  it('reads Retry-After on 429', async () => {
    const error = (await parseResponse(json({ success: false, message: 'Too many', code: 'TOO_MANY_REQUESTS' }, 429, { 'Retry-After': '900' })).catch((e: unknown) => e)) as ApiError;
    expect(error.retryAfterSeconds).toBe(900);
  });

  it('handles non-JSON and non-envelope responses', async () => {
    const html = (await parseResponse(new Response('<html>Bad gateway</html>', { status: 502 })).catch((e: unknown) => e)) as ApiError;
    expect(html).toMatchObject({ status: 502, code: 'HTTP_502', message: 'Request failed (502)' });
    const odd = (await parseResponse(json({ hello: 'world' })).catch((e: unknown) => e)) as ApiError;
    expect(odd.code).toBe('INVALID_RESPONSE');
  });
});
