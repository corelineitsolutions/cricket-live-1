import { Injectable } from '@nestjs/common';
import { AdsService } from '../ads/ads.service';
import { RedisKey } from '../common/constants/redis-keys';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { FcmService } from '../fcm/fcm.service';
import { LiveScoreService } from '../live-score/live-score.service';
import { WorkerStateRepository, WorkerStatus } from '../live-score/worker-state.repository';
import { RedisService } from '../redis/redis.service';
import { hourBucket, SportmonksQuotaService } from '../sportmonks/sportmonks-quota.service';
import { RealtimeMetricsService } from '../websocket/realtime-metrics.service';
import type { DashboardDto, DashboardSportmonksDto, WorkerHealth } from './dto/dashboard.dto';

/** The worker writes its status at least once per poll; idle polls are at most SPORTMONKS_IDLE_INTERVAL_MS apart. */
const WORKER_SILENCE_FACTOR = 3;
const MIN_WORKER_SILENCE_MS = 120_000;

const orNull = <T>(promise: Promise<T>): Promise<T | null> => promise.catch(() => null);

export function workerHealth(status: WorkerStatus | null, idleIntervalMs: number, now = Date.now()): WorkerHealth {
  if (!status) {
    return 'unknown';
  }
  if (status.state === 'disabled') {
    return 'disabled';
  }
  const expectedGapMs = Math.max(status.nextIntervalMs ?? 0, idleIntervalMs);
  const silentForMs = now - Date.parse(status.updatedAt);
  return silentForMs > Math.max(expectedGapMs * WORKER_SILENCE_FACTOR, MIN_WORKER_SILENCE_MS) ? 'down' : 'up';
}

/**
 * Read-only operational summary. Every source is read independently, so one failing
 * dependency shows up as nulls and "down" instead of failing the whole dashboard.
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly liveScore: LiveScoreService,
    private readonly workerState: WorkerStateRepository,
    private readonly quota: SportmonksQuotaService,
    private readonly realtime: RealtimeMetricsService,
    private readonly devices: FcmService,
    private readonly ads: AdsService,
  ) {}

  async getDashboard(): Promise<DashboardDto> {
    const [redisStatus, mysqlStatus, liveCount, realtime, devices, ads, status] = await Promise.all([
      this.redis.ping(),
      this.prisma.ping(),
      orNull(this.liveScore.getLiveBoard().then((board) => board.matches.length)),
      this.realtime.cluster(),
      orNull(this.devices.countSummary()),
      orNull(this.ads.countSummary()),
      orNull(this.workerState.getStatus()),
    ]);
    const sportmonks = await this.sportmonks(status);

    return {
      generatedAt: new Date().toISOString(),
      matches: { liveCount },
      realtime: {
        connectedClients: realtime.connections,
        activeMatchRooms: realtime.activeRooms,
        subscriptions: realtime.subscriptions,
        instances: realtime.instances,
      },
      devices: { registered: devices?.registered ?? null, active: devices?.active ?? null },
      ads: { total: ads?.total ?? null, enabled: ads?.enabled ?? null, visibleNow: ads?.visibleNow ?? null },
      sportmonks,
      dependencies: {
        api: 'up',
        worker: workerHealth(status, this.config.sportmonksIdleIntervalMs),
        redis: redisStatus,
        mysql: mysqlStatus,
      },
    };
  }

  private async sportmonks(status: WorkerStatus | null): Promise<DashboardSportmonksDto> {
    const [lastSuccess, lastError, quota, onDemandCalls] = await Promise.all([
      orNull(this.workerState.getLastSuccess()),
      orNull(this.workerState.getLastError()),
      orNull(this.quota.getState()),
      orNull(this.redis.get(RedisKey.sportmonksOnDemandQuota(hourBucket(Date.now())))),
    ]);

    return {
      workerState: status?.state ?? null,
      workerMessage: status?.message ? this.redact(status.message) : null,
      workerUpdatedAt: status?.updatedAt ?? null,
      pollingIntervalMs: status?.nextIntervalMs ?? null,
      nextPollAt: status?.nextPollAt ?? null,
      configuredIntervalsMs: {
        idle: this.config.sportmonksIdleIntervalMs,
        live: this.config.sportmonksLiveIntervalMs,
        active: this.config.sportmonksActiveIntervalMs,
      },
      lastSuccessAt: lastSuccess?.at ?? null,
      lastSuccess: lastSuccess
        ? { at: lastSuccess.at, durationMs: lastSuccess.durationMs, liveMatches: lastSuccess.liveMatches }
        : null,
      lastError: lastError
        ? { at: lastError.at, kind: lastError.kind, status: lastError.status, message: this.redact(lastError.message) }
        : null,
      callsThisHour: quota?.callsThisHour ?? null,
      hourlyLimit: this.config.sportmonksMaxCallsPerHour,
      remainingQuota: quota?.effectiveRemaining ?? null,
      quotaSource: quota?.source ?? null,
      quotaResetsAt: quota ? (quota.source === 'api' && quota.apiResetAt ? quota.apiResetAt : quota.windowResetAt) : null,
      onDemandCallsThisHour: onDemandCalls === null ? (quota ? 0 : null) : Number(onDemandCalls),
      onDemandHourlyLimit: this.config.sportmonksOnDemandMaxCallsPerHour,
      count429: quota?.count429 ?? null,
      last429At: quota?.last429At ?? null,
      lastStatus: quota?.lastStatus ?? null,
    };
  }

  /** Error text comes from upstream responses; make sure the API token can never be echoed. */
  private redact(message: string): string {
    const token = this.config.sportmonksApiToken;
    return token ? message.split(token).join('[redacted]') : message;
  }
}
