import { RedisKey } from '../common/constants/redis-keys';
import { FakeRedis } from '../testing/fake-redis';
import { testConfig } from '../testing/test-config';
import { LiveScoreService } from './live-score.service';
import { LiveStateRepository } from './live-state.repository';
import { WorkerStateRepository } from './worker-state.repository';

function setup() {
  const redis = new FakeRedis();
  const service = new LiveScoreService(
    new LiveStateRepository(redis.asService()),
    new WorkerStateRepository(redis.asService()),
    testConfig(),
  );
  return { redis, service };
}

describe('LiveScoreService', () => {
  it('reads snapshots by Latiyal id and the live list from Redis', async () => {
    const { redis, service } = setup();
    await redis.setJson(RedisKey.liveMatch(61521), { sportmonksId: 61521, status: 'LIVE' });
    await redis.setJson(RedisKey.liveMatchList(), [61521, 'junk', 70001]);

    await expect(service.getMatchSnapshot('61521')).resolves.toEqual({ sportmonksId: 61521, status: 'LIVE' });
    await expect(service.getMatchSnapshot('99999')).resolves.toBeNull();
    await expect(service.getMatchSnapshot('../61521')).resolves.toBeNull();
    await expect(service.getLiveMatchIds()).resolves.toEqual(['61521', '70001']);
  });

  it('marks the live board stale when the worker has not succeeded recently', async () => {
    const { redis, service } = setup();
    await redis.setJson(RedisKey.liveMatchList(), [61521]);
    await redis.setJson(RedisKey.liveMatch(61521), { sportmonksId: 61521, stale: false });

    await expect(service.getLiveBoard()).resolves.toMatchObject({ updatedAt: null, stale: true });

    const at = new Date().toISOString();
    await redis.setJson(RedisKey.providerLastSuccess(), { at });
    await expect(service.getLiveBoard()).resolves.toMatchObject({ updatedAt: at, stale: false });

    await redis.setJson(RedisKey.providerLastSuccess(), { at: new Date(Date.now() - 10 * 60_000).toISOString() });
    await expect(service.getLiveBoard()).resolves.toMatchObject({ stale: true });
  });

  it('returns empty results when Redis is unavailable', async () => {
    const { redis, service } = setup();
    redis.down = true;

    await expect(service.getLiveMatchIds()).resolves.toEqual([]);
    await expect(service.getMatchSnapshot('61521')).resolves.toBeNull();
  });
});
