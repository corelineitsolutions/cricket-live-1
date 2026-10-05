import { RedisKey } from '../common/constants/redis-keys';
import { captureLogs } from '../testing/capture-logs';
import { FakeRedis } from '../testing/fake-redis';
import { jsonResponse } from '../testing/sportmonks-fixtures';
import { TEST_SPORTMONKS_TOKEN, testConfig, TestConfigOverrides } from '../testing/test-config';
import { parseRetryAfter } from './rate-limit.parser';
import { FetchFn, SportmonksHttpClient } from './sportmonks-http.client';
import { SportmonksError } from './sportmonks.errors';
import { RateLimitState, SportmonksQuotaService } from './sportmonks-quota.service';

class InstantRetryClient extends SportmonksHttpClient {
  readonly sleeps: number[] = [];

  protected override sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    return Promise.resolve();
  }
}

function setup(fetchFn: FetchFn, overrides: TestConfigOverrides = {}) {
  const config = testConfig(overrides);
  const redis = new FakeRedis();
  const quota = new SportmonksQuotaService(redis.asService(), config);
  const fetchMock = vi.fn(fetchFn);
  const client = new InstantRetryClient(config, quota, fetchMock);
  const logs = captureLogs();
  const rateLimit = () => redis.peekJson<RateLimitState>(RedisKey.sportmonksRateLimit());
  return { client, fetchMock, redis, quota, logs, rateLimit };
}

async function failure(promise: Promise<unknown>): Promise<SportmonksError> {
  try {
    await promise;
  } catch (error) {
    return error as SportmonksError;
  }
  throw new Error('Expected the request to fail');
}

describe('SportmonksHttpClient', () => {
  it('returns the body, records rate-limit headers and never logs the token', async () => {
    const { client, fetchMock, logs, rateLimit } = setup(async () =>
      jsonResponse({ data: [] }, 200, {
        'x-ratelimit-limit': '2000',
        'x-ratelimit-remaining': '1500',
        'x-ratelimit-reset': '1800',
      }),
    );

    const response = await client.get('/livescores', { include: 'runs' });

    expect(response).toEqual({ status: 200, body: { data: [] } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('https://cricket.sportmonks.com/api/v2.0/livescores?');
    expect(url).toContain('include=runs');
    expect(url).toContain(`api_token=${TEST_SPORTMONKS_TOKEN}`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    const state = rateLimit()!;
    expect(state.apiLimit).toBe(2000);
    expect(state.apiRemaining).toBe(1500);
    expect(state.callsThisHour).toBe(1);
    expect(state.source).toBe('api');
    expect(state.lastStatus).toBe(200);
    expect(logs.text()).not.toContain(TEST_SPORTMONKS_TOKEN);
  });

  it('refuses to call Sportmonks without a token', async () => {
    const { client, fetchMock } = setup(async () => jsonResponse({ data: [] }), { sportmonksApiToken: '  ' });

    const error = await failure(client.get('/livescores'));

    expect(error.kind).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts slow requests and retries with exponential backoff, counting every attempt', async () => {
    const hang: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const { client, fetchMock, logs, rateLimit } = setup(hang, { sportmonksTimeoutMs: 20, sportmonksMaxRetries: 2 });

    const error = await failure(client.get('/livescores'));

    expect(error.kind).toBe('timeout');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(client.sleeps).toEqual([500, 1000]);
    expect(rateLimit()!.callsThisHour).toBe(3);
    expect(logs.tagged('poll-error')).toHaveLength(2);
  });

  it('retries a 500 and returns the next successful response', async () => {
    const { client, fetchMock } = setup(async () => jsonResponse({}, 500));
    fetchMock.mockImplementationOnce(async () => jsonResponse({ message: 'down' }, 500));
    fetchMock.mockImplementationOnce(async () => jsonResponse({ data: [] }));

    await expect(client.get('/livescores')).resolves.toEqual({ status: 200, body: { data: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the configured retries on repeated 500s', async () => {
    const { client, fetchMock, rateLimit } = setup(async () => jsonResponse({ message: 'down' }, 503), {
      sportmonksMaxRetries: 1,
    });

    const error = await failure(client.get('/livescores'));

    expect(error).toMatchObject({ kind: 'http', status: 503, retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rateLimit()!.lastErrorAt).not.toBeNull();
  });

  it('does not retry other 4xx responses', async () => {
    const { client, fetchMock } = setup(async () => jsonResponse({ message: 'unauthorized' }, 401));

    const error = await failure(client.get('/livescores'));

    expect(error).toMatchObject({ kind: 'http', status: 401, retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries a 429, honours Retry-After and blocks later calls until it passes', async () => {
    const { client, fetchMock, logs, rateLimit } = setup(async () =>
      jsonResponse({ message: 'Too Many Attempts.' }, 429, { 'retry-after': '120' }),
    );

    const error = await failure(client.get('/livescores'));

    expect(error).toMatchObject({ kind: 'rate_limited', status: 429, retryAfterMs: 120_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.sleeps).toEqual([]);
    expect(logs.tagged('429')).toHaveLength(1);
    const state = rateLimit()!;
    expect(state.count429).toBe(1);
    expect(state.apiRemaining).toBe(0);
    expect(Date.parse(state.apiResetAt!) - Date.now()).toBeGreaterThan(110_000);

    const blocked = await failure(client.get('/livescores'));
    expect(blocked.kind).toBe('quota_exhausted');
    expect(blocked.retryAfterMs).toBeGreaterThan(110_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a successful response whose body is not JSON', async () => {
    const { client } = setup(async () => new Response('<html>maintenance</html>', { status: 200 }));

    const error = await failure(client.get('/livescores'));

    expect(error.kind).toBe('invalid_response');
  });

  it('redacts the token from network error messages', async () => {
    const { client, logs } = setup(
      async (url) => {
        throw new Error(`getaddrinfo ENOTFOUND ${url}`);
      },
      { sportmonksMaxRetries: 0 },
    );

    const error = await failure(client.get('/livescores'));

    expect(error.kind).toBe('network');
    expect(error.message).not.toContain(TEST_SPORTMONKS_TOKEN);
    expect(logs.text()).not.toContain(TEST_SPORTMONKS_TOKEN);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');

  it('accepts delta seconds', () => {
    expect(parseRetryAfter('30', now)).toBe(30_000);
  });

  it('accepts an HTTP date', () => {
    expect(parseRetryAfter('Thu, 01 Oct 2026 12:01:30 GMT', now)).toBe(90_000);
  });

  it('ignores missing or malformed values', () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
  });
});
