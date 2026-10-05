import { Injectable, Logger } from '@nestjs/common';
import { logEvent } from '../common/utils/structured-log';
import { AppConfigService } from '../config/app-config.service';
import { isSportmonksError, redactSecret, SportmonksError } from '../sportmonks/sportmonks.errors';
import { SportmonksQuotaService } from '../sportmonks/sportmonks-quota.service';
import { SportmonksService } from '../sportmonks/sportmonks.service';
import { detectChange } from './change-detection';
import { normalizeFixture } from './live-match.normalizer';
import type { LiveMatch, LiveScoreEventType } from './live-match.types';
import { FINISHED_MATCH_TTL_SECONDS, LiveStateRepository } from './live-state.repository';
import { MatchPersistenceService } from './match-persistence.service';
import { computeNextPoll, PollingDecision, PollingIntervals } from './polling-policy';
import { WorkerState, WorkerStateRepository } from './worker-state.repository';

/** Live matches missing from /livescores are looked up individually, at most this many per cycle. */
export const MAX_MISSING_LOOKUPS_PER_CYCLE = 3;
/** After this many failed lookups a missing match is removed from the live list. */
export const MAX_MISSING_ATTEMPTS = 3;

/**
 * One polling cycle: fetch, normalize, compare with Redis, store and publish changes.
 * Must only run while holding the poll lock (see LiveScoreWorker).
 */
@Injectable()
export class LiveScoreSyncService {
  private readonly logger = new Logger(LiveScoreSyncService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly sportmonks: SportmonksService,
    private readonly quota: SportmonksQuotaService,
    private readonly liveState: LiveStateRepository,
    private readonly workerState: WorkerStateRepository,
    private readonly persistence: MatchPersistenceService,
  ) {}

  intervals(): PollingIntervals {
    return {
      idleMs: this.config.sportmonksIdleIntervalMs,
      liveMs: this.config.sportmonksLiveIntervalMs,
      activeMs: this.config.sportmonksActiveIntervalMs,
    };
  }

  async runCycle(instanceId: string): Promise<PollingDecision> {
    const startedAt = Date.now();
    await this.workerState.writeLastPoll({ at: new Date(startedAt).toISOString(), instanceId });
    logEvent(this.logger, 'debug', 'poll', { instanceId });

    let fixtures;
    try {
      fixtures = await this.sportmonks.getLivescores();
    } catch (error) {
      return this.handleFailure(error, instanceId);
    }

    await this.workerState.resetFailures();
    const now = new Date();
    const previousLiveIds = await this.liveState.getLiveIds();
    const current = fixtures
      .map((fixture) => normalizeFixture(fixture, now))
      .filter((match) => match.isLive || match.isFinished);
    const currentIds = new Set(current.map((match) => match.sportmonksId));
    const previous = await this.liveState.getMatches([...previousLiveIds, ...currentIds]);

    const liveMatches: LiveMatch[] = [];
    for (const match of current) {
      const stored = await this.apply(match, previous.get(match.sportmonksId) ?? null);
      if (stored.isLive) {
        liveMatches.push(stored);
      }
    }

    const missing = previousLiveIds.filter((id) => !currentIds.has(id));
    let lookups = 0;
    for (const id of missing) {
      const prev = previous.get(id) ?? null;
      if (lookups >= MAX_MISSING_LOOKUPS_PER_CYCLE) {
        if (prev) liveMatches.push(prev);
        continue;
      }
      lookups += 1;
      const resolved = await this.resolveMissing(id, prev);
      if (resolved?.isLive) {
        liveMatches.push(resolved);
      }
    }

    await this.liveState.setLiveIds(liveMatches.map((match) => match.sportmonksId));

    const decision = computeNextPoll({
      liveMatches,
      intervals: this.intervals(),
      quota: await this.quota.getBudget(),
    });
    const durationMs = Date.now() - startedAt;
    await this.workerState.writeLastSuccess({
      at: now.toISOString(),
      instanceId,
      durationMs,
      fixtures: fixtures.length,
      liveMatches: liveMatches.length,
    });
    await this.writeStatus(instanceId, liveMatches.length > 0 ? 'live' : 'idle', decision, liveMatches.length, 0);
    logEvent(this.logger, 'log', 'poll-success', {
      instanceId,
      durationMs,
      fixtures: fixtures.length,
      liveMatches: liveMatches.length,
      mode: decision.mode,
      nextIntervalMs: decision.intervalMs,
      reason: decision.reason,
    });
    return decision;
  }

  /** Stores and publishes `next` if it differs from `previous`. Returns the state now in Redis. */
  private async apply(next: LiveMatch, previous: LiveMatch | null): Promise<LiveMatch> {
    next.matchId = previous?.matchId ?? null;
    if (this.persistence.shouldPersist(previous, next)) {
      next.matchId = (await this.persistence.persist(next)) ?? next.matchId;
    }

    const change = detectChange(previous, next);
    if (!change.changed) {
      return previous!;
    }

    const finishedNow = next.isFinished && !previous?.isFinished;
    const startedNow = next.isLive && !next.isFinished && !previous?.isLive && !previous?.isFinished;
    const updatedAt = await this.liveState.saveMatch(next, next.isFinished ? FINISHED_MATCH_TTL_SECONDS : undefined);
    const type: LiveScoreEventType = finishedNow ? 'MATCH_FINISHED' : startedNow ? 'MATCH_STARTED' : 'MATCH_UPDATED';
    await this.liveState.publish({
      type,
      matchId: next.matchId,
      sportmonksId: next.sportmonksId,
      changedFields: change.changedFields,
      data: next,
      updatedAt,
    });
    await this.persistence.persistPlayers([...next.batsmen, ...(next.bowler ? [next.bowler] : [])]);

    if (finishedNow) {
      await this.liveState.clearMissing(next.sportmonksId);
      logEvent(this.logger, 'log', 'match-finished', {
        sportmonksId: next.sportmonksId,
        matchId: next.matchId,
        status: next.status,
        note: next.note,
      });
    } else {
      logEvent(this.logger, 'log', 'match-changed', {
        sportmonksId: next.sportmonksId,
        reason: change.reason,
        fields: change.changedFields,
      });
    }
    return next;
  }

  /** A live match vanished from /livescores. Fetch it once to capture the final state. */
  private async resolveMissing(id: number, previous: LiveMatch | null): Promise<LiveMatch | null> {
    if (!previous) {
      return null;
    }

    try {
      const fixture = await this.sportmonks.getFixture(id);
      if (fixture) {
        const next = normalizeFixture(fixture, new Date());
        const stored = await this.apply(next, previous);
        if (!stored.isLive) {
          await this.liveState.clearMissing(id);
        }
        return stored;
      }
    } catch (error) {
      const attempts = await this.liveState.incrementMissing(id);
      logEvent(this.logger, 'warn', 'poll-error', {
        sportmonksId: id,
        kind: isSportmonksError(error) ? error.kind : 'unknown',
        missingAttempts: attempts,
      });
      if (attempts < MAX_MISSING_ATTEMPTS) {
        return previous;
      }
    }

    const removed: LiveMatch = { ...previous, isLive: false, stale: true };
    const updatedAt = await this.liveState.saveMatch(removed, FINISHED_MATCH_TTL_SECONDS);
    await this.liveState.clearMissing(id);
    await this.liveState.publish({
      type: 'MATCH_REMOVED',
      matchId: removed.matchId,
      sportmonksId: id,
      changedFields: ['isLive'],
      data: removed,
      updatedAt,
    });
    logEvent(this.logger, 'warn', 'match-finished', { sportmonksId: id, removed: true, reason: 'missing' });
    return removed;
  }

  private async handleFailure(error: unknown, instanceId: string): Promise<PollingDecision> {
    const sportmonksError = isSportmonksError(error)
      ? error
      : new SportmonksError('network', error instanceof Error ? error.message : 'Unknown error');
    const quotaExhausted = sportmonksError.kind === 'quota_exhausted';
    const rateLimited = sportmonksError.kind === 'rate_limited';
    const message = redactSecret(sportmonksError.message, this.config.sportmonksApiToken);

    const failures = quotaExhausted ? await this.workerState.getFailures() : await this.workerState.incrementFailures();
    await this.workerState.writeLastError({
      at: new Date().toISOString(),
      instanceId,
      kind: sportmonksError.kind,
      status: sportmonksError.status,
      message,
      retryAfterMs: sportmonksError.retryAfterMs,
    });
    logEvent(this.logger, rateLimited || quotaExhausted ? 'warn' : 'error', 'poll-error', {
      instanceId,
      kind: sportmonksError.kind,
      status: sportmonksError.status,
      retryAfterMs: sportmonksError.retryAfterMs,
      consecutiveFailures: failures,
      message,
    });

    const liveMatches = await this.markStale();
    const decision = computeNextPoll({
      liveMatches,
      intervals: this.intervals(),
      consecutiveFailures: quotaExhausted ? 0 : failures,
      retryAfterMs: sportmonksError.retryAfterMs,
      quota: await this.quota.getBudget(),
    });
    const state: WorkerState = rateLimited ? 'rate-limited' : quotaExhausted ? 'quota-exhausted' : 'backoff';
    await this.writeStatus(instanceId, state, decision, liveMatches.length, failures, message);
    return decision;
  }

  /** Keeps the last valid snapshots but flags them stale, publishing once per match. */
  private async markStale(): Promise<LiveMatch[]> {
    const ids = await this.liveState.getLiveIds();
    const matches = await this.liveState.getMatches(ids);
    const result: LiveMatch[] = [];

    for (const match of matches.values()) {
      if (match.stale) {
        result.push(match);
        continue;
      }
      const stale: LiveMatch = { ...match, stale: true };
      const updatedAt = await this.liveState.saveMatch(stale);
      await this.liveState.publish({
        type: 'MATCH_STALE',
        matchId: stale.matchId,
        sportmonksId: stale.sportmonksId,
        changedFields: ['stale'],
        data: stale,
        updatedAt,
      });
      result.push(stale);
    }
    return result;
  }

  private async writeStatus(
    instanceId: string,
    state: WorkerState,
    decision: PollingDecision,
    liveMatchCount: number,
    consecutiveFailures: number,
    message: string | null = null,
  ): Promise<void> {
    await this.workerState.writeStatus({
      state,
      instanceId,
      mode: decision.mode,
      reason: decision.reason,
      nextIntervalMs: decision.intervalMs,
      nextPollAt: new Date(Date.now() + decision.intervalMs).toISOString(),
      liveMatchCount,
      consecutiveFailures,
      message,
      updatedAt: new Date().toISOString(),
    });
  }
}
