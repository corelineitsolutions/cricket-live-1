import request from 'supertest';
import { RedisKey } from '../common/constants/redis-keys';
import { LATIYAL_FEEDS } from '../latiyal/latiyal-catalog';
import { ApiTestApp, createApiTestApp } from '../testing/api-test-app';
import { FakeRedis } from '../testing/fake-redis';
import { endpointOf, envelope, jsonResponse, refusal } from '../testing/latiyal-fixtures';
import { TEST_LATIYAL_TOKEN } from '../testing/test-config';

function formOf(init?: RequestInit): Record<string, string> | null {
  if (!(init?.body instanceof FormData)) {
    return null;
  }
  return Object.fromEntries([...init.body.entries()].map(([key, value]) => [key, String(value)]));
}

describe('Cricket data feeds (e2e)', () => {
  let api: ApiTestApp;
  let redis: FakeRedis;

  beforeEach(async () => {
    redis = new FakeRedis();
    api = await createApiTestApp({ redis });
  });

  afterEach(async () => {
    await api.close();
  });

  const lastCall = () => {
    const [url, init] = api.fetchMock.mock.calls.at(-1)!;
    return { endpoint: endpointOf(new URL(String(url))), method: init?.method, form: formOf(init) };
  };

  it('lists all 51 Latiyal endpoints with their params and refresh period', async () => {
    const res = await request(api.http).get('/api/v1/feeds').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(51);
    expect(new Set(res.body.data.map((feed: { endpoint: string }) => feed.endpoint)).size).toBe(51);
    expect(res.body.data.find((feed: { endpoint: string }) => feed.endpoint === 'seriesStatsBySeriesId')).toEqual({
      endpoint: 'seriesStatsBySeriesId',
      group: 'series',
      summary: expect.any(String),
      params: [
        { name: 'series_id', required: true },
        { name: 'type', required: true },
        { name: 'sub_type', required: true },
      ],
      refreshSeconds: 21_600,
      v5Only: false,
    });
    expect(api.fetchMock).not.toHaveBeenCalled();
  });

  it('serves a parameterless feed with GET and caches it for its refresh period', async () => {
    api.respond(() => envelope([{ series_id: 418, series: 'Premier T20 2026' }]));

    const res = await request(api.http).get('/api/v1/feeds/seriesList').expect(200);
    await request(api.http).get('/api/v1/feeds/seriesList').expect(200);

    expect(res.body.data).toMatchObject({
      endpoint: 'seriesList',
      params: {},
      data: [{ series_id: 418, series: 'Premier T20 2026' }],
      message: null,
      stale: false,
    });
    expect(res.body.data.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(api.fetchMock).toHaveBeenCalledTimes(1);
    expect(lastCall()).toEqual({ endpoint: 'seriesList', method: 'GET', form: null });
    expect(redis.ttlSeconds(RedisKey.feed('seriesList', ''))).toBe(21_600);
  });

  it('sends params as form-data with POST, using the Latiyal names', async () => {
    api.respond(() => envelope({ batting: [] }));

    await request(api.http).get('/api/v1/feeds/seriesStatsBySeriesId?series_id=418&type=1&sub_type=2').expect(200);

    expect(lastCall()).toEqual({
      endpoint: 'seriesStatsBySeriesId',
      method: 'POST',
      form: { series_id: '418', type: '1', sub_type: '2' },
    });
    expect(redis.ttlSeconds(RedisKey.feed('seriesStatsBySeriesId', 'series_id=418&sub_type=2&type=1'))).toBe(21_600);
  });

  it('caches each params combination separately and coalesces concurrent requests', async () => {
    api.respond(async (_url, init) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return envelope({ match_id: Number(formOf(init)?.match_id) });
    });

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => request(api.http).get(`/api/v1/feeds/scorecardByMatchId?match_id=${i % 2 === 0 ? 4012 : 4013}`)),
    );

    expect(responses.every((res) => res.status === 200)).toBe(true);
    expect(api.fetchMock).toHaveBeenCalledTimes(2);
    expect(responses[0].body.data.data).toEqual({ match_id: 4012 });
    expect(responses[1].body.data.data).toEqual({ match_id: 4013 });
    expect(redis.ttlSeconds(RedisKey.feed('scorecardByMatchId', 'match_id=4012'))).toBe(15);
  });

  it('matches endpoint names case-insensitively', async () => {
    api.respond(() => envelope({ score: '120/3' }));

    const res = await request(api.http).get('/api/v1/feeds/livematch?match_id=4012').expect(200);

    expect(res.body.data.endpoint).toBe('liveMatch');
    expect(lastCall().endpoint).toBe('liveMatch');
    expect(redis.ttlSeconds(RedisKey.feed('liveMatch', 'match_id=4012'))).toBe(1);
  });

  it('sends the default for an omitted optional param (playerList paginate=0)', async () => {
    api.respond(() => envelope([]));

    await request(api.http).get('/api/v1/feeds/playerList').expect(200);

    expect(lastCall()).toEqual({ endpoint: 'playerList', method: 'POST', form: { paginate: '0' } });
  });

  it.each([
    ['/api/v1/feeds/scorecardByMatchId', 400, 'match_id is required for scorecardByMatchId.'],
    ['/api/v1/feeds/scorecardByMatchId?match_id=abc', 400, 'match_id must be a whole number.'],
    ['/api/v1/feeds/scorecardByMatchId?match_id=-1', 400, 'match_id must be a whole number.'],
    ['/api/v1/feeds/scorecardByMatchId?match_id=1&match_id=2', 400, 'match_id must be a whole number.'],
    ['/api/v1/feeds/scorecardByMatchId?match_id=1&series_id=2', 400, 'scorecardByMatchId accepts these parameters: match_id.'],
    ['/api/v1/feeds/seriesList?foo=1', 400, 'seriesList accepts these parameters: none.'],
    ['/api/v1/feeds/notAnEndpoint', 404, 'Unknown feed. GET /api/v1/feeds lists the available feeds.'],
  ])('rejects %s without calling Latiyal', async (path, status, message) => {
    const res = await request(api.http).get(path).expect(status);

    expect(res.body).toMatchObject({ success: false, message });
    expect(api.fetchMock).not.toHaveBeenCalled();
  });

  it('returns data null with the Latiyal message when there is nothing for these params', async () => {
    api.respond(() => refusal('Data not found'));

    const res = await request(api.http).get('/api/v1/feeds/squadsByMatchId?match_id=4012').expect(200);

    expect(res.body.data).toMatchObject({ data: null, message: 'Data not found', stale: false });
    expect(redis.ttlSeconds(RedisKey.feed('squadsByMatchId', 'match_id=4012'))).toBe(60);
  });

  it('serves the last good copy marked stale when a refresh fails', async () => {
    api.respond(() => envelope({ table: [1, 2, 3] }));
    await request(api.http).get('/api/v1/feeds/pointsTable?series_id=418').expect(200);
    await redis.del(RedisKey.feed('pointsTable', 'series_id=418'));
    api.respond(() => jsonResponse({ message: 'boom' }, 500));

    const res = await request(api.http).get('/api/v1/feeds/pointsTable?series_id=418').expect(200);

    expect(res.body.data).toMatchObject({ data: { table: [1, 2, 3] }, stale: true });
  });

  it('answers 503 when Latiyal fails and nothing is cached', async () => {
    api.respond(() => jsonResponse({ message: 'boom' }, 500));

    const res = await request(api.http).get('/api/v1/feeds/news').expect(503);

    expect(res.body).toEqual({
      success: false,
      message: 'This data is temporarily unavailable. Try again shortly.',
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('never calls Latiyal when Redis is down', async () => {
    redis.down = true;
    await request(api.http).get('/api/v1/feeds/news').expect(503);
    expect(api.fetchMock).not.toHaveBeenCalled();
  });

  it('never exposes the Latiyal token', async () => {
    api.respond(() => refusal(`Bad request for ${TEST_LATIYAL_TOKEN}`));

    const res = await request(api.http).get('/api/v1/feeds/news').expect(200);

    expect(JSON.stringify(res.body)).not.toContain(TEST_LATIYAL_TOKEN);
  });

  it('answers every catalogued feed', async () => {
    api.respond(() => envelope({ ok: true }));
    for (const feed of LATIYAL_FEEDS) {
      const query = feed.params
        .filter((param) => param.required)
        .map((param) => `${param.name}=1`)
        .join('&');
      const res = await request(api.http).get(`/api/v1/feeds/${feed.endpoint}${query ? `?${query}` : ''}`);
      expect({ endpoint: feed.endpoint, status: res.status }).toEqual({ endpoint: feed.endpoint, status: 200 });
      expect(lastCall().endpoint).toBe(feed.endpoint);
    }
    expect(api.fetchMock).toHaveBeenCalledTimes(51);
  });
});
