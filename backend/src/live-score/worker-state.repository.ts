import { Injectable } from '@nestjs/common';
import { RedisKey } from '../common/constants/redis-keys';
import { RedisService } from '../redis/redis.service';
import type { PollMode, PollReason } from './polling-policy';

export type WorkerState =
  | 'starting'
  | 'disabled'
  | 'idle'
  | 'live'
  | 'backoff'
  | 'rate-limited'
  | 'quota-exhausted';

export interface WorkerStatus {
  state: WorkerState;
  instanceId: string;
  mode: PollMode | null;
  reason: PollReason | null;
  nextIntervalMs: number | null;
  nextPollAt: string | null;
  liveMatchCount: number;
  consecutiveFailures: number;
  message: string | null;
  updatedAt: string;
}

export interface PollRecord {
  at: string;
  instanceId: string;
}

export interface SuccessRecord extends PollRecord {
  durationMs: number;
  fixtures: number;
  liveMatches: number;
}

export interface ErrorRecord extends PollRecord {
  kind: string;
  status: number | null;
  message: string;
  retryAfterMs: number | null;
}

/** Redis keys that coordinate workers: lock, schedule, failures and status. */
@Injectable()
export class WorkerStateRepository {
  constructor(private readonly redis: RedisService) {}

  acquireLock(token: string, ttlMs: number): Promise<boolean> {
    return this.redis.acquireLock(RedisKey.pollLock(), token, ttlMs);
  }

  releaseLock(token: string): Promise<boolean> {
    return this.redis.releaseLock(RedisKey.pollLock(), token);
  }

  async getNextPollAt(): Promise<number | null> {
    const raw = await this.redis.get(RedisKey.nextPollAt());
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  async setNextPollAt(epochMs: number): Promise<void> {
    await this.redis.set(RedisKey.nextPollAt(), String(epochMs));
  }

  async incrementFailures(): Promise<number> {
    return this.redis.incr(RedisKey.pollFailures());
  }

  async getFailures(): Promise<number> {
    const raw = await this.redis.get(RedisKey.pollFailures());
    return raw === null ? 0 : Number(raw) || 0;
  }

  async resetFailures(): Promise<void> {
    await this.redis.del(RedisKey.pollFailures());
  }

  async writeLastPoll(record: PollRecord): Promise<void> {
    await this.redis.setJson(RedisKey.providerLastPoll(), record);
  }

  async writeLastSuccess(record: SuccessRecord): Promise<void> {
    await this.redis.setJson(RedisKey.providerLastSuccess(), record);
  }

  async writeLastError(record: ErrorRecord): Promise<void> {
    await this.redis.setJson(RedisKey.providerLastError(), record);
  }

  async writeStatus(status: WorkerStatus): Promise<void> {
    await this.redis.setJson(RedisKey.providerWorkerStatus(), status);
  }

  getLastSuccess(): Promise<SuccessRecord | null> {
    return this.redis.getJson<SuccessRecord>(RedisKey.providerLastSuccess());
  }

  getLastError(): Promise<ErrorRecord | null> {
    return this.redis.getJson<ErrorRecord>(RedisKey.providerLastError());
  }

  async getStatus(): Promise<WorkerStatus | null> {
    return this.redis.getJson<WorkerStatus>(RedisKey.providerWorkerStatus());
  }
}
