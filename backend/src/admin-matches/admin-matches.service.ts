import { Injectable } from '@nestjs/common';
import { RedisKey } from '../common/constants/redis-keys';
import { notFound, serviceUnavailable } from '../common/utils/http-errors';
import type { LiveMatch } from '../live-score/live-match.types';
import { LiveScoreService } from '../live-score/live-score.service';
import { WorkerStateRepository } from '../live-score/worker-state.repository';
import { SPORTMONKS_ID_PATTERN } from '../matches/dto/match-id.param.dto';
import { MatchesRepository } from '../matches/matches.repository';
import { storedToPublicMatch, toPublicMatch } from '../matches/public-match.mapper';
import { RedisService } from '../redis/redis.service';
import { RealtimeMetricsService } from '../websocket/realtime-metrics.service';
import type {
  AdminLiveBoardDto,
  AdminLiveMatchDto,
  AdminMatchDetailDto,
  CacheEntryDto,
  MatchCacheStateDto,
} from './dto/admin-match.dto';

/**
 * Read-only match inspection for operators. Sportmonks is the source of truth:
 * nothing here writes match data or calls Sportmonks.
 */
@Injectable()
export class AdminMatchesService {
  constructor(
    private readonly liveScore: LiveScoreService,
    private readonly workerState: WorkerStateRepository,
    private readonly matches: MatchesRepository,
    private readonly redis: RedisService,
    private readonly realtime: RealtimeMetricsService,
  ) {}

  async getLive(): Promise<AdminLiveBoardDto> {
    let board;
    try {
      board = await this.liveScore.getLiveBoard();
    } catch {
      throw serviceUnavailable('Live data store unavailable');
    }
    const [subscribers, status] = await Promise.all([
      this.subscribersByMatch(),
      this.workerState.getStatus().catch(() => null),
    ]);
    return {
      matches: board.matches.map((match) => this.toAdminLive(match, subscribers)),
      updatedAt: board.updatedAt,
      stale: board.stale,
      workerState: status?.state ?? null,
    };
  }

  async getMatch(id: string): Promise<AdminMatchDetailDto> {
    const row = SPORTMONKS_ID_PATTERN.test(id)
      ? await this.matches.findBySportmonksId(Number(id))
      : await this.matches.findById(id);
    const sportmonksId = row?.sportmonksId ?? (SPORTMONKS_ID_PATTERN.test(id) ? Number(id) : null);
    if (sportmonksId === null) {
      throw notFound('Match not found');
    }

    const [live, liveIds, liveWrittenAt, subscribers, cache] = await Promise.all([
      this.liveScore.getMatchSnapshot(sportmonksId),
      this.liveScore.getLiveMatchIds(),
      this.redis.get(RedisKey.liveMatchUpdated(sportmonksId)).catch(() => null),
      this.subscribersByMatch(),
      this.cacheState(sportmonksId),
    ]);
    if (!live && !row) {
      throw notFound('Match not found');
    }

    return {
      matchId: sportmonksId,
      internalId: row?.id ?? live?.matchId ?? null,
      inLiveFeed: liveIds.includes(String(sportmonksId)),
      live: live ? this.toAdminLive(live, subscribers) : null,
      liveWrittenAt,
      stored: row
        ? {
            ...storedToPublicMatch(row),
            internalId: row.id,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          }
        : null,
      cache,
    };
  }

  private toAdminLive(match: LiveMatch, subscribers: Map<number, number>): AdminLiveMatchDto {
    return {
      ...toPublicMatch(match),
      internalId: match.matchId,
      subscribers: subscribers.get(match.sportmonksId) ?? 0,
    };
  }

  private async subscribersByMatch(): Promise<Map<number, number>> {
    const metrics = await this.realtime.cluster();
    return new Map(metrics.subscriptionsPerMatch.map((entry) => [entry.matchId, entry.subscribers]));
  }

  private async cacheState(sportmonksId: number): Promise<MatchCacheStateDto | null> {
    try {
      const [details, scorecard, commentary] = await Promise.all([
        this.cacheEntry(RedisKey.matchDetails(sportmonksId)),
        this.cacheEntry(RedisKey.matchScorecard(sportmonksId)),
        this.cacheEntry(RedisKey.matchCommentary(sportmonksId)),
      ]);
      return { details, scorecard, commentary };
    } catch {
      return null;
    }
  }

  private async cacheEntry(key: string): Promise<CacheEntryDto> {
    const [envelope, ttlMs] = await Promise.all([
      this.redis.getJson<{ cachedAt?: string }>(key),
      this.redis.ttlMs(key),
    ]);
    return {
      cached: envelope !== null,
      cachedAt: envelope?.cachedAt ?? null,
      expiresInSeconds: envelope !== null && ttlMs !== null ? Math.ceil(ttlMs / 1000) : null,
    };
  }
}
