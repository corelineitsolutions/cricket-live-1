import { captureLogs } from '../testing/capture-logs';
import { FakeRedis } from '../testing/fake-redis';
import { envelope, latiyalMatch, listItem, refusal } from '../testing/latiyal-fixtures';
import { testConfig } from '../testing/test-config';
import { FetchFn, LatiyalHttpClient } from './latiyal-http.client';
import { LatiyalQuotaService } from './latiyal-quota.service';
import { LatiyalService } from './latiyal.service';
import { mergeRecords, parseMatchList } from './latiyal.validation';

function setup(fetchFn: FetchFn, token = 'secret-token') {
  const config = testConfig({ latiyalApiToken: token, latiyalMaxRetries: 0 });
  const quota = new LatiyalQuotaService(new FakeRedis().asService(), config);
  const fetchMock = vi.fn(fetchFn);
  const service = new LatiyalService(config, new LatiyalHttpClient(config, quota, fetchMock));
  const logs = captureLogs();
  return { service, fetchMock, logs };
}

describe('LatiyalService', () => {
  it('does not treat a blank token as configured', () => {
    const { service } = setup(async () => envelope([]), '   ');
    expect(service.isConfigured()).toBe(false);
  });

  it('exposes worker limits without the API token', () => {
    const { service } = setup(async () => envelope([]));
    expect(service.isConfigured()).toBe(true);
    expect(service.getLimits()).toEqual({
      apiUrl: 'https://api.latiyalinfotech.com/apiv5',
      idleIntervalMs: 60000,
      liveIntervalMs: 10000,
      activeIntervalMs: 5000,
      maxCallsPerHour: 1600,
    });
    expect(JSON.stringify(service.getLimits())).not.toContain('secret-token');
  });

  it('reads liveMatchList and skips items without a match id', async () => {
    const { service, fetchMock, logs } = setup(async () => envelope([listItem(latiyalMatch()), { match_id: 'x' }]));

    const matches = await service.getLiveMatches();

    expect(matches.map((match) => match.id)).toEqual([61521]);
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/apiv5/liveMatchList/secret-token');
    expect(logs.tagged('poll-error').some((line) => line.includes('"rejected":1'))).toBe(true);
  });

  it('reads status:false from liveMatchList as no live matches', async () => {
    const { service } = setup(async () => refusal('No live match found'));

    await expect(service.getLiveMatches()).resolves.toEqual([]);
  });

  it('rejects a liveMatchList payload that is not a list', async () => {
    const { service } = setup(async () => envelope('unexpected'));

    await expect(service.getLiveMatches()).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('returns null for a match Latiyal does not know', async () => {
    const { service } = setup(async () => refusal('Data not found'));

    await expect(service.getLiveMatch(61521)).resolves.toBeNull();
  });
});

describe('parseMatchList', () => {
  it('accepts arrays, index-keyed objects and nested lists', () => {
    expect(parseMatchList([{ match_id: 1 }, { match_id: '2' }])?.matches.map((m) => m.id)).toEqual([1, 2]);
    expect(parseMatchList({ 0: { match_id: 3 }, 1: { match_id: 4 } })?.matches.map((m) => m.id)).toEqual([3, 4]);
    expect(parseMatchList({ matches: [{ match_id: 5 }] })?.matches.map((m) => m.id)).toEqual([5]);
    expect(parseMatchList(null)).toEqual({ matches: [], rejected: 0 });
    expect(parseMatchList('junk')).toBeNull();
  });
});

describe('mergeRecords', () => {
  it('lets detail values win but never erases list values with blanks', () => {
    expect(mergeRecords({ a: 1, b: 'x' }, { a: 2, b: '', c: null })).toEqual({ a: 2, b: 'x' });
  });
});
