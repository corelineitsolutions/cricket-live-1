import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { logEvent } from '../common/utils/structured-log';
import { AppConfigService } from '../config/app-config.service';
import { SportmonksService } from '../sportmonks/sportmonks.service';
import { LiveScoreSyncService, MAX_MISSING_LOOKUPS_PER_CYCLE } from './live-score-sync.service';
import { WorkerStateRepository } from './worker-state.repository';

const LOCK_MARGIN_MS = 15_000;
const MIN_LOCK_TTL_MS = 30_000;
const MAX_STARTUP_JITTER_MS = 1_000;

/**
 * The only component that polls Sportmonks on a schedule. Every process may run one,
 * but a Redis lock plus a shared next-poll timestamp let exactly one cycle run per
 * interval, whatever the number of workers or connected users.
 */
@Injectable()
export class LiveScoreWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LiveScoreWorker.name);
  readonly instanceId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly config: AppConfigService,
    private readonly sportmonks: SportmonksService,
    private readonly workerState: WorkerStateRepository,
    private readonly sync: LiveScoreSyncService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.liveScoreWorkerEnabled) {
      this.logger.log('Live-score worker disabled in this process (LIVE_SCORE_WORKER_ENABLED=false)');
      return;
    }
    if (!this.sportmonks.isConfigured()) {
      this.logger.warn('Live-score worker not started: SPORTMONKS_API_TOKEN is empty');
      void this.workerState
        .writeStatus({
          state: 'disabled',
          instanceId: this.instanceId,
          mode: null,
          reason: null,
          nextIntervalMs: null,
          nextPollAt: null,
          liveMatchCount: 0,
          consecutiveFailures: 0,
          message: 'SPORTMONKS_API_TOKEN is empty',
          updatedAt: new Date().toISOString(),
        })
        .catch(() => undefined);
      return;
    }

    logEvent(this.logger, 'log', 'worker-start', { instanceId: this.instanceId });
    this.schedule(Math.floor(Math.random() * MAX_STARTUP_JITTER_MS));
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Lock TTL covers the main request plus missing-match lookups, each with retries. */
  lockTtlMs(): number {
    const perRequest = this.config.sportmonksTimeoutMs * (this.config.sportmonksMaxRetries + 1);
    return Math.max(MIN_LOCK_TTL_MS, perRequest * (1 + MAX_MISSING_LOOKUPS_PER_CYCLE) + LOCK_MARGIN_MS);
  }

  /** Runs at most one cycle and returns the delay before this process should check again. */
  async runOnce(): Promise<number> {
    const retryDelay = this.config.sportmonksLiveIntervalMs;

    let dueAt: number | null;
    try {
      dueAt = await this.workerState.getNextPollAt();
    } catch {
      logEvent(this.logger, 'error', 'poll-error', {
        instanceId: this.instanceId,
        kind: 'redis_unavailable',
        sportmonksCalled: false,
      });
      return retryDelay;
    }
    if (dueAt !== null && dueAt > Date.now()) {
      return this.waitUntil(dueAt);
    }

    const token = randomUUID();
    let acquired: boolean;
    try {
      acquired = await this.workerState.acquireLock(token, this.lockTtlMs());
    } catch {
      logEvent(this.logger, 'error', 'worker-lock', {
        instanceId: this.instanceId,
        acquired: false,
        reason: 'redis_unavailable',
      });
      return retryDelay;
    }

    if (!acquired) {
      logEvent(this.logger, 'debug', 'worker-lock', { instanceId: this.instanceId, acquired: false });
      return this.config.sportmonksActiveIntervalMs;
    }

    logEvent(this.logger, 'debug', 'worker-lock', { instanceId: this.instanceId, acquired: true });
    try {
      const dueAgain = await this.workerState.getNextPollAt();
      if (dueAgain !== null && dueAgain > Date.now()) {
        return this.waitUntil(dueAgain);
      }

      const decision = await this.sync.runCycle(this.instanceId);
      await this.workerState.setNextPollAt(Date.now() + decision.intervalMs);
      return decision.intervalMs;
    } finally {
      await this.workerState.releaseLock(token).catch(() => undefined);
    }
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) {
      return;
    }
    this.running = true;
    let delay = this.config.sportmonksLiveIntervalMs;
    try {
      delay = await this.runOnce();
    } catch (error) {
      logEvent(this.logger, 'error', 'poll-error', {
        instanceId: this.instanceId,
        kind: 'cycle_failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.running = false;
      this.schedule(delay);
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(), Math.max(0, delayMs));
  }

  private waitUntil(epochMs: number): number {
    return Math.min(Math.max(epochMs - Date.now(), 250), this.config.sportmonksIdleIntervalMs);
  }
}
