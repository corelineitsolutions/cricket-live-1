import { AppConfigService } from '../config/app-config.service';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  const config = {
    redisHost: '127.0.0.1',
    redisPort: 6379,
    redisPassword: '',
  } as AppConfigService;

  function serviceWith(client: Record<string, ReturnType<typeof vi.fn>>): RedisService {
    const service = new RedisService(config);
    (service as unknown as { client: Record<string, ReturnType<typeof vi.fn>> }).client = client;
    return service;
  }

  it('stores JSON under the shared prefix and reads it back', async () => {
    const store = new Map<string, string>();
    const client = {
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      get: vi.fn(async (key: string) => store.get(key) ?? null),
    };
    const service = serviceWith(client);

    await service.setJson('ads:active:HOME_BANNER', [{ id: 'ad-1' }], 60);
    await expect(service.getJson('ads:active:HOME_BANNER')).resolves.toEqual([{ id: 'ad-1' }]);
    expect(client.set).toHaveBeenCalledWith('cricket:v1:ads:active:HOME_BANNER', '[{"id":"ad-1"}]', 'EX', 60);
  });

  it('stores sub-second TTLs in milliseconds', async () => {
    const client = { set: vi.fn().mockResolvedValue('OK') };
    const service = serviceWith(client);

    await service.set('cache:feed:liveMatch:match_id=1', '{}', 0.5);
    expect(client.set).toHaveBeenCalledWith('cricket:v1:cache:feed:liveMatch:match_id=1', '{}', 'PX', 500);
  });

  it('releases a lock only when the token matches', async () => {
    const evalMock = vi.fn().mockResolvedValue(1);
    const service = serviceWith({ eval: evalMock });

    await expect(service.releaseLock('lock:worker', 'token-1')).resolves.toBe(true);
    expect(evalMock).toHaveBeenCalledWith(expect.any(String), 1, 'cricket:v1:lock:worker', 'token-1');
  });

  it('returns null for invalid JSON', async () => {
    const service = serviceWith({
      get: vi.fn().mockResolvedValue('{'),
    });

    await expect(service.getJson('match:snapshot:1')).resolves.toBeNull();
  });
});
