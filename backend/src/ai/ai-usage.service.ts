import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prefixRedisKey, RedisKey } from '../common/constants/redis-keys';
import { logEvent } from '../common/utils/structured-log';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

export const USAGE_FIELDS = [
  'requests',
  'answered',
  'refusedDisabled',
  'refusedQuota',
  'refusedBudget',
  'refusedBusy',
  'errors',
  'timeouts',
  'promptTokens',
  'completionTokens',
  'toolCalls',
  'languageEn',
  'languageHi',
  'latencyMsTotal',
  'costMicros',
] as const;

export type UsageField = (typeof USAGE_FIELDS)[number];
export type UsageIncrements = Partial<Record<UsageField, number>>;

const USAGE_TTL_SECONDS = 8 * 24 * 3600;
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const FLUSH_LOCK_MS = 60_000;

export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);
const encodeCombo = (provider: string, model: string) => Buffer.from(`${provider}|${model}`).toString('base64url');
const decodeCombo = (combo: string) => {
  const [provider, ...rest] = Buffer.from(combo, 'base64url').toString('utf8').split('|');
  return { provider, model: rest.join('|') };
};

export interface UsageDay {
  day: string;
  provider: string;
  model: string;
  counters: Record<Exclude<UsageField, 'costMicros'>, number>;
  estimatedCost: number;
}

/**
 * Privacy-safe usage metrics: integer counters per UTC day, provider and model. Counted in
 * Redis on the hot path and copied to MySQL (ai_usage_daily) with absolute values, so a
 * flush can run any number of times from any instance.
 */
@Injectable()
export class AiUsageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiUsageService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.config.aiEnabled) return;
    this.timer = setInterval(() => void this.flushWithLock(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Never throws: metrics must not break a request. */
  async record(provider: string, model: string, increments: UsageIncrements, now = new Date()): Promise<void> {
    const day = utcDay(now);
    const combo = encodeCombo(provider, model);
    const entries = Object.entries(increments).filter(([, value]) => value && value > 0) as Array<[UsageField, number]>;
    try {
      await this.redis.incrementByWithTtl(RedisKey.aiUsage(day, combo, 'requests'), 0, USAGE_TTL_SECONDS);
      await Promise.all(
        entries.map(([field, value]) => this.redis.incrementByWithTtl(RedisKey.aiUsage(day, combo, field), value, USAGE_TTL_SECONDS)),
      );
    } catch {
      logEvent(this.logger, 'warn', 'ai-usage-record-failed');
    }
  }

  async tokensUsedToday(now = new Date()): Promise<number> {
    return Number((await this.redis.get(RedisKey.aiTokens(utcDay(now)))) ?? 0);
  }

  async addTokens(tokens: number, now = new Date()): Promise<void> {
    if (tokens > 0) await this.redis.incrementByWithTtl(RedisKey.aiTokens(utcDay(now)), tokens, 2 * 24 * 3600);
  }

  /** Counters for one day straight from Redis. */
  async readDay(day: string): Promise<UsageDay[]> {
    const marker = ':requests';
    const prefix = prefixRedisKey(`ai:usage:${day}:`);
    const keys = await this.redis.scanKeys(`ai:usage:${day}:*${marker}`);
    const combos = [...new Set(keys.map((key) => key.slice(prefix.length, key.length - marker.length)))];
    const days: UsageDay[] = [];
    for (const combo of combos) {
      const values = await this.redis.getManyJson<number>(USAGE_FIELDS.map((field) => RedisKey.aiUsage(day, combo, field)));
      const byField = Object.fromEntries(USAGE_FIELDS.map((field, i) => [field, Number(values[i] ?? 0)])) as Record<UsageField, number>;
      const { costMicros, ...counters } = byField;
      days.push({ day, ...decodeCombo(combo), counters, estimatedCost: costMicros / 1_000_000 });
    }
    return days;
  }

  /** Copies today's and yesterday's counters to MySQL. Idempotent. */
  async flush(now = new Date()): Promise<number> {
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
    let written = 0;
    for (const day of [utcDay(yesterday), utcDay(now)]) {
      for (const row of await this.readDay(day)) {
        const data = { ...row.counters, estimatedCost: new Prisma.Decimal(row.estimatedCost.toFixed(4)) };
        const key = { day: new Date(`${row.day}T00:00:00.000Z`), provider: row.provider.slice(0, 32), model: row.model.slice(0, 64) };
        await this.prisma.aiUsageDaily.upsert({
          where: { day_provider_model: key },
          create: { ...key, ...data },
          update: data,
        });
        written++;
      }
    }
    return written;
  }

  async flushWithLock(): Promise<void> {
    const token = randomUUID();
    try {
      if (!(await this.redis.acquireLock(RedisKey.aiUsageFlushLock(), token, FLUSH_LOCK_MS))) return;
      try {
        await this.flush();
      } finally {
        await this.redis.releaseLock(RedisKey.aiUsageFlushLock(), token);
      }
    } catch {
      logEvent(this.logger, 'warn', 'ai-usage-flush-failed');
    }
  }

  /** Stored daily rows (newest first) after a best-effort flush. */
  async history(days: number, now = new Date()) {
    await this.flushWithLock();
    const since = new Date(`${utcDay(new Date(now.getTime() - (days - 1) * 24 * 3600 * 1000))}T00:00:00.000Z`);
    const rows = await this.prisma.aiUsageDaily.findMany({
      where: { day: { gte: since } },
      orderBy: [{ day: 'desc' }, { provider: 'asc' }],
    });
    return rows.map((row) => ({
      ...row,
      day: utcDay(row.day),
      estimatedCost: Number(row.estimatedCost),
    }));
  }
}
