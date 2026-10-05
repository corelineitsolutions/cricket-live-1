import { AdPlacement } from '@prisma/client';
import { SingleFlightCache } from '../cache/single-flight-cache.service';
import { RedisKey } from '../common/constants/redis-keys';
import { RedisService } from '../redis/redis.service';
import { adRow, FakeDb } from '../testing/fake-db';
import { FakeRedis } from '../testing/fake-redis';
import { AdsRepository } from './ads.repository';
import { AdsService } from './ads.service';

function setup(redis = new FakeRedis(), db = new FakeDb()) {
  const service = (r: RedisService = redis.asService()) =>
    new AdsService(new AdsRepository(db.asPrisma()), r, new SingleFlightCache(r));
  return { redis, db, service: service(), makeInstance: service };
}

const HOUR = 3_600_000;

describe('AdsService', () => {
  it('serves enabled, in-schedule ads only, highest priority first', async () => {
    const { db, service } = setup();
    const now = Date.now();
    db.rows.ad.push(
      adRow('low', AdPlacement.HOME_BANNER, 1, { isActive: true }),
      adRow('high', AdPlacement.HOME_BANNER, 9, { isActive: true }),
      adRow('disabled', AdPlacement.HOME_BANNER, 5, { isActive: false }),
      adRow('future', AdPlacement.HOME_BANNER, 5, { isActive: true, startAt: new Date(now + HOUR) }),
      adRow('expired', AdPlacement.HOME_BANNER, 5, { isActive: true, endAt: new Date(now - HOUR) }),
      adRow('splash', AdPlacement.SPLASH, 5, { isActive: true }),
    );

    expect((await service.getActive(AdPlacement.HOME_BANNER)).map((ad) => ad.id)).toEqual(['high', 'low']);
    expect((await service.getActive()).map((ad) => ad.id)).toEqual(['high', 'splash', 'low']);
  });

  it('answers repeated reads from Redis', async () => {
    const { db, service } = setup();
    db.rows.ad.push(adRow('a', AdPlacement.SPLASH, 0, { isActive: true }));

    await service.getActive();
    await service.getActive(AdPlacement.SPLASH);

    expect(db.ad.findMany).toHaveBeenCalledTimes(1);
  });

  it('applies schedule boundaries to cached copies at read time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
      const { db, service } = setup();
      db.rows.ad.push(
        adRow('later', AdPlacement.SPLASH, 0, { isActive: true, startAt: new Date('2026-10-01T10:01:00.000Z') }),
      );
      expect(await service.getActive()).toEqual([]);

      vi.setSystemTime(new Date('2026-10-01T10:02:00.000Z'));
      expect((await service.getActive()).map((ad) => ad.id)).toEqual(['later']);
      expect(db.ad.findMany).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates the cache on every admin change, for every instance', async () => {
    const { redis, db, service, makeInstance } = setup();
    const other = makeInstance();
    await service.getActive();
    await other.getActive();

    const created = await service.create({
      title: 'Sponsor',
      imageUrl: 'https://cdn.example.com/ad.png',
      clickUrl: 'https://example.com',
      placement: AdPlacement.SPLASH,
      priority: 0,
      isActive: true,
    });
    expect((await other.getActive()).map((ad) => ad.id)).toEqual([created.id]);

    await service.setActive(created.id, false);
    expect(await other.getActive()).toEqual([]);

    await service.setActive(created.id, true);
    await service.update(created.id, { title: 'Renamed' });
    expect((await other.getActive())[0]?.title).toBe('Renamed');

    await service.remove(created.id);
    expect(await other.getActive()).toEqual([]);
    expect(db.rows.ad).toHaveLength(0);
    expect(await redis.asService().get(RedisKey.adsActiveVersion())).toBe('5');
  });

  it('falls back to MySQL when Redis is down', async () => {
    const { redis, db, service } = setup();
    db.rows.ad.push(adRow('a', AdPlacement.SPLASH, 0, { isActive: true }));
    redis.down = true;

    expect((await service.getActive()).map((ad) => ad.id)).toEqual(['a']);
  });

  it('rejects a schedule that ends before it starts', async () => {
    const { service } = setup();
    await expect(
      service.create({
        title: 'Sponsor',
        imageUrl: 'https://cdn.example.com/ad.png',
        clickUrl: 'https://example.com',
        placement: AdPlacement.SPLASH,
        priority: 0,
        isActive: true,
        startAt: new Date('2026-10-02T00:00:00.000Z'),
        endAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
  });

  it('returns 404 for unknown ads', async () => {
    const { service } = setup();
    await expect(service.setActive('missing', true)).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
  });
});
