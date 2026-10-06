export const REDIS_KEY_PREFIX = 'cricket:v1:';

export function prefixRedisKey(key: string): string {
  if (key.startsWith(REDIS_KEY_PREFIX)) {
    return key;
  }

  return `${REDIS_KEY_PREFIX}${key}`;
}

/**
 * Logical key names. RedisService adds REDIS_KEY_PREFIX to every key and channel.
 * Live match keys use the provider's match id so the hot path never depends on MySQL.
 */
export const RedisKey = {
  liveMatchList: () => 'live:matches',
  liveMatch: (sportmonksId: number | string) => `live:match:${sportmonksId}`,
  liveMatchUpdated: (sportmonksId: number | string) => `live:match:${sportmonksId}:updated`,
  liveMatchMissing: (sportmonksId: number | string) => `live:match:${sportmonksId}:missing`,
  providerLastPoll: () => 'provider:last-poll',
  providerLastSuccess: () => 'provider:last-success',
  providerLastError: () => 'provider:last-error',
  providerRateLimit: () => 'provider:rate-limit',
  providerWorkerStatus: () => 'provider:worker-status',
  providerQuota: (hourBucket: string) => `provider:quota:${hourBucket}`,
  pollLock: () => 'provider:live-score:poll-lock',
  nextPollAt: () => 'provider:live-score:next-poll-at',
  pollFailures: () => 'provider:live-score:failures',
  providerOnDemandQuota: (hourBucket: string) => `provider:quota:on-demand:${hourBucket}`,
  matchDetails: (sportmonksId: number) => `cache:match:${sportmonksId}`,
  matchScorecard: (sportmonksId: number) => `cache:match:${sportmonksId}:scorecard`,
  matchCommentary: (sportmonksId: number) => `cache:match:${sportmonksId}:commentary`,
  entity: (kind: 'team' | 'player' | 'league', id: string) => `cache:${kind}:${id}`,
  /** Last good copy of a cached value, kept longer so it can be served stale. */
  stale: (cacheKey: string) => `${cacheKey}:stale`,
  cacheLock: (cacheKey: string) => `lock:${cacheKey}`,
  playersPersisted: () => 'players:persisted',
  throttle: (key: string) => `throttle:${key}`,
  wsInstanceMetrics: (instanceId: string) => `metrics:ws:instance:${instanceId}`,
  /** Every ad with isActive=true. The version changes on each admin edit, so old copies are never read again. */
  adsActive: (version: number) => `ads:active:v${version}`,
  adsActiveVersion: () => 'ads:active:version',
  adminLoginFailures: (subject: string) => `auth:admin-login:failures:${subject}`,
  metric: (name: string) => `metrics:${name}`,
};

export const RedisChannel = {
  liveScoreUpdates: () => 'live-score-updates',
};
