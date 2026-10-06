import { RedisKey } from '../common/constants/redis-keys';
import { captureLogs } from '../testing/capture-logs';
import { FakeRedis } from '../testing/fake-redis';
import { envelope, jsonResponse, matchIdOf, refusal } from '../testing/latiyal-fixtures';
import { TEST_LATIYAL_TOKEN, testConfig, TestConfigOverrides } from '../testing/test-config';
import { LatiyalError } from './latiyal.errors';
import { FetchFn, LatiyalHttpClient } from './latiyal-http.client';
import { LatiyalQuotaService, RateLimitState } from './latiyal-quota.service';
import { parseRetryAfter } from './rate-limit.parser';

class InstantRetryClient extends LatiyalHttpClient {
  readonly sleeps: number[] = [];

  protected override sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    return Promise.resolve();
  }
}

function setup(fetchFn: FetchFn, overrides: TestConfigOverrides = {}) {
  const config = testConfig(overrides);
  const redis = new FakeRedis();
  const quota = new LatiyalQuotaService(redis.asService(), config);
  const fetchMock = vi.fn(fetchFn);
  const client = new InstantRetryClient(config, quota, fetchMock);
  const logs = captureLogs();
  const rateLimit = () => redis.peekJson<RateLimitState>(RedisKey.providerRateLimit());
  return { client, fetchMock, redis, quota, logs, rateLimit };
}

async function failure(promise: Promise<unknown>): Promise<LatiyalError> {
  try {
    await promise;
  } catch (error) {
    return error as LatiyalError;
  }
  throw new Error('Expected the request to fail');
}

describe('LatiyalHttpClient', () => {
  it('GETs list endpoints with the token as the last path segment and never logs it', async () => {
    const { client, fetchMock, logs, rateLimit } = setup(async () => envelope([]));

    const response = await client.request('liveMatchList');

    expect(response).toEqual({ httpStatus: 200, ok: true, message: 'Success', data: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.latiyalinfotech.com/apiv5/liveMatchList/${TEST_LATIYAL_TOKEN}`);
    expect(init?.method).toBe('GET');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(rateLimit()!.callsThisHour).toBe(1);
    expect(rateLimit()!.lastStatus).toBe(200);
    expect(logs.text()).not.toContain(TEST_LATIYAL_TOKEN);
  });

  it('POSTs match_id as form data for per-match endpoints', async () => {
    const { client, fetchMock } = setup(async () => envelope({ match_id: 61521 }));

    await client.request('liveMatch', { matchId: 61521 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.latiyalinfotech.com/apiv5/liveMatch/${TEST_LATIYAL_TOKEN}`);
    expect(init?.method).toBe('POST');
    expect(matchIdOf(init)).toBe(61521);
  });

  it('returns status:false answers as not ok, without data', async () => {
    const { client } = setup(async () => refusal('Data not found'));

    await expect(client.request('liveMatch', { matchId: 1 })).resolves.toEqual({
      httpStatus: 200,
      ok: false,
      message: 'Data not found',
      data: null,
    });
  });

  it('treats a token refusal reported with HTTP 200 as unauthorized and does not retry it', async () => {
    const { client, fetchMock } = setup(async () => refusal('Invalid API token'));

    const error = await failure(client.request('liveMatchList'));

    expect(error).toMatchObject({ kind: 'unauthorized', retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to call Latiyal without a token', async () => {
    const { client, fetchMock } = setup(async () => envelope([]), { latiyalApiToken: '  ' });

    const error = await failure(client.request('liveMatchList'));

    expect(error.kind).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts slow requests and retries with exponential backoff, counting every attempt', async () => {
    const hang: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const { client, fetchMock, logs, rateLimit } = setup(hang, { latiyalTimeoutMs: 20, latiyalMaxRetries: 2 });

    const error = await failure(client.request('liveMatchList'));

    expect(error.kind).toBe('timeout');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(client.sleeps).toEqual([500, 1000]);
    expect(rateLimit()!.callsThisHour).toBe(3);
    expect(logs.tagged('poll-error')).toHaveLength(2);
  });

  it('retries a 500 and returns the next successful response', async () => {
    const { client, fetchMock } = setup(async () => jsonResponse({}, 500));
    fetchMock.mockImplementationOnce(async () => jsonResponse({ message: 'down' }, 500));
    fetchMock.mockImplementationOnce(async () => envelope([]));

    await expect(client.request('liveMatchList')).resolves.toMatchObject({ ok: true, data: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the configured retries on repeated 500s', async () => {
    const { client, fetchMock, rateLimit } = setup(async () => jsonResponse({ message: 'down' }, 503), {
      latiyalMaxRetries: 1,
    });

    const error = await failure(client.request('liveMatchList'));

    expect(error).toMatchObject({ kind: 'http', status: 503, retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rateLimit()!.lastErrorAt).not.toBeNull();
  });

  it('does not retry 4xx responses', async () => {
    const { client, fetchMock } = setup(async () => jsonResponse({ message: 'unauthorized' }, 401));

    const error = await failure(client.request('liveMatchList'));

    expect(error).toMatchObject({ kind: 'unauthorized', status: 401, retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries a 429, honours Retry-After and blocks later calls until it passes', async () => {
    const { client, fetchMock, logs, rateLimit } = setup(async () =>
      jsonResponse({ message: 'Too Many Attempts.' }, 429, { 'retry-after': '120' }),
    );

    const error = await failure(client.request('liveMatchList'));

    expect(error).toMatchObject({ kind: 'rate_limited', status: 429, retryAfterMs: 120_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.sleeps).toEqual([]);
    expect(logs.tagged('429')).toHaveLength(1);
    const state = rateLimit()!;
    expect(state.count429).toBe(1);
    expect(state.apiRemaining).toBe(0);
    expect(Date.parse(state.apiResetAt!) - Date.now()).toBeGreaterThan(110_000);

    const blocked = await failure(client.request('liveMatchList'));
    expect(blocked.kind).toBe('quota_exhausted');
    expect(blocked.retryAfterMs).toBeGreaterThan(110_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a successful response whose body is not a JSON object', async () => {
    const { client } = setup(async () => new Response('<html>maintenance</html>', { status: 200 }));

    const error = await failure(client.request('liveMatchList'));

    expect(error.kind).toBe('invalid_response');
  });

  it('redacts the token from network error messages', async () => {
    const { client, logs } = setup(
      async (url) => {
        throw new Error(`getaddrinfo ENOTFOUND ${url}`);
      },
      { latiyalMaxRetries: 0 },
    );

    const error = await failure(client.request('liveMatchList'));

    expect(error.kind).toBe('network');
    expect(error.message).not.toContain(TEST_LATIYAL_TOKEN);
    expect(logs.text()).not.toContain(TEST_LATIYAL_TOKEN);
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
