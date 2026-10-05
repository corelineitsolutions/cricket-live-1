import { HttpException, Injectable, Logger } from '@nestjs/common';
import { MatchStatus } from '@prisma/client';
import { CacheOptions, SingleFlightCache } from '../cache/single-flight-cache.service';
import { RedisKey } from '../common/constants/redis-keys';
import { serviceUnavailable } from '../common/utils/http-errors';
import { logEvent } from '../common/utils/structured-log';
import { MatchPersistenceService } from '../live-score/match-persistence.service';
import { isSportmonksError } from '../sportmonks/sportmonks.errors';
import { SportmonksService } from '../sportmonks/sportmonks.service';
import { buildCommentary } from './commentary.mapper';
import type { CommentaryDto, CommentaryItemDto } from './dto/commentary.dto';
import type { MatchDto } from './dto/match.dto';
import type { ScorecardDto, ScorecardInningsDto } from './dto/scorecard.dto';
import { MatchesService } from './matches.service';
import { buildScorecardInnings, scorecardPlayers } from './scorecard.mapper';

/** Fresh period of detail caches. One upstream call per match per period, whatever the traffic. */
export const DETAIL_TTL_SECONDS = {
  live: 30,
  finished: 24 * 60 * 60,
  other: 120,
  missing: 300,
} as const;
/** The last good copy is kept this long so failures can be answered with stale data. */
export const DETAIL_STALE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Scorecard and commentary. These need data the live poll does not fetch, so they are
 * loaded from Sportmonks on demand behind a shared cache with request coalescing and a
 * separate hourly budget (SPORTMONKS_ON_DEMAND_MAX_CALLS_PER_HOUR).
 */
@Injectable()
export class MatchDetailService {
  private readonly logger = new Logger(MatchDetailService.name);

  constructor(
    private readonly matches: MatchesService,
    private readonly sportmonks: SportmonksService,
    private readonly cache: SingleFlightCache,
    private readonly persistence: MatchPersistenceService,
  ) {}

  async getScorecard(id: string): Promise<ScorecardDto> {
    const match = await this.matches.getMatch(id);
    const base = { matchId: match.matchId, status: match.status, isLive: match.isLive, isFinished: match.isFinished };
    if (!this.hasStarted(match)) {
      return { ...base, innings: [], updatedAt: null, stale: false };
    }

    const result = await this.load<ScorecardInningsDto[] | null>(
      'Scorecard',
      RedisKey.matchScorecard(match.matchId),
      this.options(match),
      async () => {
        const card = await this.sportmonks.getScorecard(match.matchId);
        if (!card) {
          return null;
        }
        await this.persistence.persistPlayers(scorecardPlayers(card));
        return buildScorecardInnings(card);
      },
    );
    return { ...base, innings: result.value ?? [], updatedAt: result.cachedAt, stale: result.stale };
  }

  async getCommentary(id: string, limit: number): Promise<CommentaryDto> {
    const match = await this.matches.getMatch(id);
    if (!this.hasStarted(match)) {
      return { matchId: match.matchId, items: [], updatedAt: null, stale: false };
    }

    const result = await this.load<CommentaryItemDto[] | null>(
      'Commentary',
      RedisKey.matchCommentary(match.matchId),
      this.options(match),
      async () => {
        const balls = await this.sportmonks.getBalls(match.matchId);
        return balls ? buildCommentary(balls) : null;
      },
    );
    return {
      matchId: match.matchId,
      items: (result.value ?? []).slice(0, limit),
      updatedAt: result.cachedAt,
      stale: result.stale,
    };
  }

  private hasStarted(match: MatchDto): boolean {
    return match.status !== MatchStatus.SCHEDULED;
  }

  private options<T>(match: MatchDto): CacheOptions<T | null> {
    const fresh = match.isLive ? DETAIL_TTL_SECONDS.live : match.isFinished ? DETAIL_TTL_SECONDS.finished : DETAIL_TTL_SECONDS.other;
    return {
      ttlSeconds: (value) => (value === null ? DETAIL_TTL_SECONDS.missing : fresh),
      staleTtlSeconds: DETAIL_STALE_TTL_SECONDS,
      protectsUpstream: true,
    };
  }

  private async load<T>(what: string, key: string, options: CacheOptions<T>, loader: () => Promise<T>) {
    try {
      return await this.cache.getOrLoad(key, options, loader);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      logEvent(this.logger, 'warn', 'detail-unavailable', {
        what,
        key,
        kind: isSportmonksError(error) ? error.kind : error instanceof Error ? error.name : 'unknown',
      });
      throw serviceUnavailable(`${what} is temporarily unavailable. Try again shortly.`);
    }
  }
}
