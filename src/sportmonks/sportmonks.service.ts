import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { logEvent } from '../common/utils/structured-log';
import { AppConfigService } from '../config/app-config.service';
import { COMMENTARY_INCLUDES, LIVE_FIXTURE_INCLUDES, SCORECARD_INCLUDES, SportmonksPath } from './sportmonks.constants';
import { parseBalls, parseScorecard } from './sportmonks-detail.validation';
import { SportmonksError } from './sportmonks.errors';
import { SportmonksHttpClient } from './sportmonks-http.client';
import type { SmBall, SmFixture, SmScorecard } from './sportmonks.types';
import { parseFixtureList, parseSingleFixture } from './sportmonks.validation';

export interface SportmonksLimits {
  apiUrl: string;
  idleIntervalMs: number;
  liveIntervalMs: number;
  activeIntervalMs: number;
  maxCallsPerHour: number;
}

/** Typed Sportmonks operations. There is no generic passthrough to the API. */
@Injectable()
export class SportmonksService implements OnModuleInit {
  private readonly logger = new Logger(SportmonksService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly http: SportmonksHttpClient,
  ) {}

  onModuleInit(): void {
    if (!this.isConfigured()) {
      this.logger.warn('Sportmonks token is not configured. Live-score polling is disabled.');
    }
  }

  isConfigured(): boolean {
    return this.config.sportmonksApiToken.trim().length > 0;
  }

  getLimits(): SportmonksLimits {
    return {
      apiUrl: this.config.sportmonksApiUrl,
      idleIntervalMs: this.config.sportmonksIdleIntervalMs,
      liveIntervalMs: this.config.sportmonksLiveIntervalMs,
      activeIntervalMs: this.config.sportmonksActiveIntervalMs,
      maxCallsPerHour: this.config.sportmonksMaxCallsPerHour,
    };
  }

  async getLivescores(): Promise<SmFixture[]> {
    const { body } = await this.http.get(SportmonksPath.livescores, {
      include: LIVE_FIXTURE_INCLUDES.join(','),
    });
    const parsed = parseFixtureList(body);
    if (!parsed) {
      throw new SportmonksError('invalid_response', 'Livescores response has no data array');
    }
    if (parsed.rejected > 0) {
      logEvent(this.logger, 'warn', 'poll-error', {
        kind: 'invalid_fixture',
        rejected: parsed.rejected,
        accepted: parsed.fixtures.length,
      });
    }
    return parsed.fixtures;
  }

  /** Full scorecard for one fixture. Counts against the on-demand budget; callers must cache it. */
  async getScorecard(id: number): Promise<SmScorecard | null> {
    return this.getDetail(id, SCORECARD_INCLUDES, parseScorecard);
  }

  /** Ball-by-ball feed for one fixture. Counts against the on-demand budget; callers must cache it. */
  async getBalls(id: number): Promise<SmBall[] | null> {
    return this.getDetail(id, COMMENTARY_INCLUDES, parseBalls);
  }

  private async getDetail<T>(
    id: number,
    includes: readonly string[],
    parse: (body: unknown) => T | null | undefined,
  ): Promise<T | null> {
    try {
      const { body } = await this.http.get(
        SportmonksPath.fixture(id),
        { include: includes.join(',') },
        { budget: 'on-demand' },
      );
      const parsed = parse(body);
      if (parsed === undefined) {
        throw new SportmonksError('invalid_response', 'Fixture detail response is invalid');
      }
      return parsed;
    } catch (error) {
      if (error instanceof SportmonksError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /** Used once for a live match that disappeared from /livescores, to capture its final state. */
  async getFixture(id: number): Promise<SmFixture | null> {
    try {
      const { body } = await this.http.get(SportmonksPath.fixture(id), {
        include: LIVE_FIXTURE_INCLUDES.join(','),
      });
      const fixture = parseSingleFixture(body);
      if (fixture === undefined) {
        throw new SportmonksError('invalid_response', 'Fixture response is invalid');
      }
      return fixture;
    } catch (error) {
      if (error instanceof SportmonksError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }
}
