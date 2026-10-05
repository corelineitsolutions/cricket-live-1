import { captureLogs } from '../testing/capture-logs';
import { FakeRedis } from '../testing/fake-redis';
import { jsonResponse, rawFixture } from '../testing/sportmonks-fixtures';
import { testConfig } from '../testing/test-config';
import { FetchFn, SportmonksHttpClient } from './sportmonks-http.client';
import { SportmonksQuotaService } from './sportmonks-quota.service';
import { SportmonksService } from './sportmonks.service';

function setup(fetchFn: FetchFn, token = 'secret-token') {
  const config = testConfig({ sportmonksApiToken: token, sportmonksMaxRetries: 0 });
  const quota = new SportmonksQuotaService(new FakeRedis().asService(), config);
  const fetchMock = vi.fn(fetchFn);
  const service = new SportmonksService(config, new SportmonksHttpClient(config, quota, fetchMock));
  const logs = captureLogs();
  return { service, fetchMock, logs };
}

describe('SportmonksService', () => {
  it('does not treat a blank token as configured', () => {
    const { service } = setup(async () => jsonResponse({ data: [] }), '   ');
    expect(service.isConfigured()).toBe(false);
  });

  it('exposes worker limits without the API token', () => {
    const { service } = setup(async () => jsonResponse({ data: [] }));
    expect(service.isConfigured()).toBe(true);
    expect(service.getLimits()).toEqual({
      apiUrl: 'https://cricket.sportmonks.com/api/v2.0',
      idleIntervalMs: 60000,
      liveIntervalMs: 10000,
      activeIntervalMs: 5000,
      maxCallsPerHour: 1600,
    });
    expect(JSON.stringify(service.getLimits())).not.toContain('secret-token');
  });

  it('requests /livescores with only the live includes and validates each fixture', async () => {
    const { service, fetchMock, logs } = setup(async () =>
      jsonResponse({ data: [rawFixture(), { id: 'not-a-number' }] }),
    );

    const fixtures = await service.getLivescores();

    expect(fixtures.map((fixture) => fixture.id)).toEqual([61521]);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/v2.0/livescores');
    expect(url.searchParams.get('include')).toBe(
      'localteam,visitorteam,league,season,venue,runs,batting.batsman,bowling.bowler',
    );
    expect(url.searchParams.get('include')).not.toMatch(/balls|commentary|lineup/);
    expect(logs.tagged('poll-error').some((line) => line.includes('"rejected":1'))).toBe(true);
  });

  it('rejects a livescores body without a data array', async () => {
    const { service } = setup(async () => jsonResponse({ message: 'unexpected' }));

    await expect(service.getLivescores()).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('returns null for a fixture Sportmonks no longer has', async () => {
    const { service } = setup(async () => jsonResponse({ message: 'not found' }, 404));

    await expect(service.getFixture(61521)).resolves.toBeNull();
  });
});
