import { prefixRedisKey, REDIS_KEY_PREFIX, RedisChannel, RedisKey } from './redis-keys';

describe('redis keys', () => {
  it('prefixes logical keys once', () => {
    expect(prefixRedisKey('live:matches')).toBe(`${REDIS_KEY_PREFIX}live:matches`);
    expect(prefixRedisKey(`${REDIS_KEY_PREFIX}live:matches`)).toBe(`${REDIS_KEY_PREFIX}live:matches`);
  });

  it('uses predictable live-state and worker keys', () => {
    expect(RedisKey.liveMatchList()).toBe('live:matches');
    expect(RedisKey.liveMatch(123)).toBe('live:match:123');
    expect(RedisKey.liveMatchUpdated(123)).toBe('live:match:123:updated');
    expect(RedisKey.sportmonksLastPoll()).toBe('sportmonks:last-poll');
    expect(RedisKey.sportmonksLastSuccess()).toBe('sportmonks:last-success');
    expect(RedisKey.sportmonksLastError()).toBe('sportmonks:last-error');
    expect(RedisKey.sportmonksRateLimit()).toBe('sportmonks:rate-limit');
    expect(RedisKey.sportmonksWorkerStatus()).toBe('sportmonks:worker-status');
    expect(RedisKey.pollLock()).toBe('sportmonks:live-score:poll-lock');
    expect(RedisKey.adsActive(3)).toBe('ads:active:v3');
    expect(RedisKey.adsActiveVersion()).toBe('ads:active:version');
    expect(RedisKey.adminLoginFailures('abc')).toBe('auth:admin-login:failures:abc');
    expect(RedisKey.matchScorecard(123)).toBe('cache:match:123:scorecard');
    expect(RedisKey.stale(RedisKey.matchCommentary(123))).toBe('cache:match:123:commentary:stale');
    expect(RedisKey.cacheLock(RedisKey.matchScorecard(123))).toBe('lock:cache:match:123:scorecard');
    expect(RedisKey.wsInstanceMetrics('api-1')).toBe('metrics:ws:instance:api-1');
    expect(RedisChannel.liveScoreUpdates()).toBe('live-score-updates');
  });
});
