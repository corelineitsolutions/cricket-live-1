import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { logEvent } from '../common/utils/structured-log';
import { AppConfigService } from '../config/app-config.service';
import { LatiyalEndpoint, LatiyalEndpointName } from './latiyal.constants';
import { LatiyalError } from './latiyal.errors';
import { LatiyalHttpClient } from './latiyal-http.client';
import type { LatiyalMatch, LatiyalRecord } from './latiyal.types';
import { parseMatchDetail, parseMatchList } from './latiyal.validation';

export interface LatiyalLimits {
  apiUrl: string;
  idleIntervalMs: number;
  liveIntervalMs: number;
  activeIntervalMs: number;
  maxCallsPerHour: number;
}

/** Latiyal operations. Feeds are limited to the endpoints in LATIYAL_FEEDS. */
@Injectable()
export class LatiyalService implements OnModuleInit {
  private readonly logger = new Logger(LatiyalService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly http: LatiyalHttpClient,
  ) {}

  onModuleInit(): void {
    if (!this.isConfigured()) {
      this.logger.warn('Latiyal token is not configured. Live-score polling is disabled.');
    }
  }

  isConfigured(): boolean {
    return this.config.latiyalApiToken.trim().length > 0;
  }

  getLimits(): LatiyalLimits {
    return {
      apiUrl: this.config.latiyalApiUrl,
      idleIntervalMs: this.config.latiyalIdleIntervalMs,
      liveIntervalMs: this.config.latiyalLiveIntervalMs,
      activeIntervalMs: this.config.latiyalActiveIntervalMs,
      maxCallsPerHour: this.config.latiyalMaxCallsPerHour,
    };
  }

  /** liveMatchList. Latiyal answers `status:false` when nothing is live, which is an empty list here. */
  async getLiveMatches(): Promise<LatiyalMatch[]> {
    const response = await this.http.request(LatiyalEndpoint.liveMatchList);
    if (!response.ok) {
      return [];
    }
    const parsed = parseMatchList(response.data);
    if (!parsed) {
      throw new LatiyalError('invalid_response', 'liveMatchList response has no match list');
    }
    if (parsed.rejected > 0) {
      logEvent(this.logger, 'warn', 'poll-error', {
        kind: 'invalid_match',
        rejected: parsed.rejected,
        accepted: parsed.matches.length,
      });
    }
    return parsed.matches;
  }

  /** liveMatch: score, batsmen and bowler for one match. Null when Latiyal has no such match. */
  async getLiveMatch(id: number): Promise<LatiyalRecord | null> {
    const response = await this.http.request(LatiyalEndpoint.liveMatch, { matchId: id });
    return response.ok ? parseMatchDetail(response.data) : null;
  }

  /** Full scorecard for one match. Counts against the on-demand budget; callers must cache it. */
  getScorecard(id: number): Promise<unknown> {
    return this.getDetail(LatiyalEndpoint.scorecard, id);
  }

  /** Commentary feed for one match. Counts against the on-demand budget; callers must cache it. */
  getCommentary(id: number): Promise<unknown> {
    return this.getDetail(LatiyalEndpoint.commentary, id);
  }

  /**
   * Any catalogued data feed (see latiyal-catalog.ts), passed through unparsed. Callers must
   * validate the endpoint and params against the catalog and cache the result.
   */
  async getFeed(endpoint: string, params: Record<string, string>): Promise<{ ok: boolean; message: string | null; data: unknown }> {
    const response = await this.http.request(endpoint, { params, budget: 'on-demand' });
    return { ok: response.ok, message: response.message, data: response.data };
  }

  private async getDetail(endpoint: LatiyalEndpointName, id: number): Promise<unknown> {
    try {
      const response = await this.http.request(endpoint, { matchId: id, budget: 'on-demand' });
      return response.ok ? response.data : null;
    } catch (error) {
      if (error instanceof LatiyalError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }
}
