import { Injectable, Logger } from '@nestjs/common';
import { SingleFlightCache } from '../cache/single-flight-cache.service';
import { RedisKey } from '../common/constants/redis-keys';
import { notFound, serviceUnavailable } from '../common/utils/http-errors';
import { buildPagination } from '../common/utils/pagination';
import { logEvent } from '../common/utils/structured-log';
import { LiveScoreService } from '../live-score/live-score.service';
import { ListMatchesQueryDto } from './dto/list-matches.query.dto';
import { SPORTMONKS_ID_PATTERN } from './dto/match-id.param.dto';
import type { LiveMatchesDto, MatchDto } from './dto/match.dto';
import { MatchesRepository } from './matches.repository';
import { storedToPublicMatch, toPublicMatch } from './public-match.mapper';

const STORED_MATCH_TTL_SECONDS = 300;
const UNKNOWN_MATCH_TTL_SECONDS = 30;

/**
 * Match reads. Live matches come from Redis (written by the worker); other matches come
 * from MySQL through a short Redis cache. Nothing here calls Sportmonks.
 */
@Injectable()
export class MatchesService {
  private readonly logger = new Logger(MatchesService.name);

  constructor(
    private readonly matches: MatchesRepository,
    private readonly liveScore: LiveScoreService,
    private readonly cache: SingleFlightCache,
  ) {}

  async list(query: ListMatchesQueryDto) {
    const { items, total } = await this.matches.list(query);
    return {
      items: items.map(storedToPublicMatch),
      meta: buildPagination(query.page, query.limit, total),
    };
  }

  async getLive(): Promise<LiveMatchesDto> {
    try {
      const board = await this.liveScore.getLiveBoard();
      return { matches: board.matches.map(toPublicMatch), updatedAt: board.updatedAt, stale: board.stale };
    } catch {
      logEvent(this.logger, 'error', 'live-read-error', { reason: 'redis_unavailable' });
      throw serviceUnavailable('Live scores are temporarily unavailable. Try again shortly.');
    }
  }

  /** Live snapshot when the feed has one, otherwise stored data. Throws 404 for unknown matches. */
  async getMatch(id: string): Promise<MatchDto> {
    const sportmonksId = await this.resolveSportmonksId(id);
    const live = await this.liveScore.getMatchSnapshot(sportmonksId);
    if (live) {
      return toPublicMatch(live);
    }

    const { value } = await this.cache.getOrLoad<MatchDto | null>(
      RedisKey.matchDetails(sportmonksId),
      { ttlSeconds: (match) => (match ? STORED_MATCH_TTL_SECONDS : UNKNOWN_MATCH_TTL_SECONDS) },
      async () => {
        const row = await this.matches.findBySportmonksId(sportmonksId);
        return row ? storedToPublicMatch(row) : null;
      },
    );
    if (!value) {
      throw notFound('Match not found');
    }
    return value;
  }

  private async resolveSportmonksId(id: string): Promise<number> {
    if (SPORTMONKS_ID_PATTERN.test(id)) {
      return Number(id);
    }
    const row = await this.matches.findById(id);
    if (!row) {
      throw notFound('Match not found');
    }
    return row.sportmonksId;
  }
}
