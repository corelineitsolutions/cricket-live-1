import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import type { LiveMatch } from './live-match.types';
import { LiveStateRepository } from './live-state.repository';
import { WorkerStateRepository } from './worker-state.repository';

/** The feed is stale when the worker has not succeeded for this many idle intervals. */
const STALE_AFTER_IDLE_INTERVALS = 3;

export interface LiveBoard {
  matches: LiveMatch[];
  /** Last successful Latiyal poll, or null if the worker never succeeded. */
  updatedAt: string | null;
  stale: boolean;
}

/** Read side of the live state. Never calls Latiyal. */
@Injectable()
export class LiveScoreService {
  constructor(
    private readonly liveState: LiveStateRepository,
    private readonly workerState: WorkerStateRepository,
    private readonly config: AppConfigService,
  ) {}

  async getMatchSnapshot(sportmonksId: string | number): Promise<LiveMatch | null> {
    const id = Number(sportmonksId);
    if (!Number.isInteger(id) || id <= 0) {
      return null;
    }
    try {
      return await this.liveState.getMatch(id);
    } catch {
      return null;
    }
  }

  async getLiveMatchIds(): Promise<string[]> {
    try {
      return (await this.liveState.getLiveIds()).map(String);
    } catch {
      return [];
    }
  }

  /** Every live match from Redis. Throws when Redis is unavailable. */
  async getLiveBoard(): Promise<LiveBoard> {
    const ids = await this.liveState.getLiveIds();
    const [byId, lastSuccess] = await Promise.all([this.liveState.getMatches(ids), this.workerState.getLastSuccess()]);
    const matches = ids.map((id) => byId.get(id)).filter((match): match is LiveMatch => Boolean(match));

    const updatedAt = lastSuccess?.at ?? null;
    const maxAgeMs = this.config.latiyalIdleIntervalMs * STALE_AFTER_IDLE_INTERVALS;
    const feedStale = updatedAt === null || Date.now() - Date.parse(updatedAt) > maxAgeMs;
    return { matches, updatedAt, stale: feedStale || matches.some((match) => match.stale) };
  }
}
