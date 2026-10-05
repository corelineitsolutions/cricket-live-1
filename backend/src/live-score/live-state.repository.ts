import { Injectable } from '@nestjs/common';
import { RedisChannel, RedisKey } from '../common/constants/redis-keys';
import { RedisService } from '../redis/redis.service';
import type { LiveMatch, LiveScoreEvent } from './live-match.types';

/** Final and removed matches stay readable for a day, then expire. Live matches never expire. */
export const FINISHED_MATCH_TTL_SECONDS = 24 * 60 * 60;
const MISSING_COUNTER_TTL_SECONDS = 60 * 60;

/** Redis access for live match data. Holds no state of its own. */
@Injectable()
export class LiveStateRepository {
  constructor(private readonly redis: RedisService) {}

  async getLiveIds(): Promise<number[]> {
    const ids = await this.redis.getJson<unknown>(RedisKey.liveMatchList());
    if (!Array.isArray(ids)) {
      return [];
    }
    return ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  }

  async setLiveIds(ids: number[]): Promise<void> {
    const unique = [...new Set(ids)].sort((a, b) => a - b);
    await this.redis.setJson(RedisKey.liveMatchList(), unique);
  }

  async getMatch(sportmonksId: number): Promise<LiveMatch | null> {
    return this.redis.getJson<LiveMatch>(RedisKey.liveMatch(sportmonksId));
  }

  async getMatches(ids: number[]): Promise<Map<number, LiveMatch>> {
    const unique = [...new Set(ids)];
    const values = await this.redis.getManyJson<LiveMatch>(unique.map((id) => RedisKey.liveMatch(id)));
    const result = new Map<number, LiveMatch>();
    values.forEach((value, index) => {
      if (value && typeof value === 'object') {
        result.set(unique[index], value);
      }
    });
    return result;
  }

  async saveMatch(match: LiveMatch, ttlSeconds?: number): Promise<string> {
    const updatedAt = new Date().toISOString();
    await this.redis.setJson(RedisKey.liveMatch(match.sportmonksId), match, ttlSeconds);
    await this.redis.set(RedisKey.liveMatchUpdated(match.sportmonksId), updatedAt, ttlSeconds);
    return updatedAt;
  }

  async publish(event: LiveScoreEvent): Promise<void> {
    await this.redis.publish(RedisChannel.liveScoreUpdates(), event);
  }

  async incrementMissing(sportmonksId: number): Promise<number> {
    return this.redis.incrementWithTtl(RedisKey.liveMatchMissing(sportmonksId), MISSING_COUNTER_TTL_SECONDS);
  }

  async clearMissing(sportmonksId: number): Promise<void> {
    await this.redis.del(RedisKey.liveMatchMissing(sportmonksId));
  }
}
