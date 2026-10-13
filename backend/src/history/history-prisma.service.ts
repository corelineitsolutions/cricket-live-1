import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';

/**
 * Prisma client for hist_* (and identity_*) tables. Uses HISTORY_DATABASE_URL when set,
 * otherwise the main DATABASE_URL client. Live score tables stay on PrismaService.
 */
@Injectable()
export class HistoryPrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HistoryPrismaService.name);
  private readonly separate: boolean;
  /** Prefer this over casting; same surface as PrismaService for hist_* models. */
  readonly client: PrismaClient;

  constructor(config: AppConfigService, main: PrismaService) {
    const historyUrl = config.historyDatabaseUrl.trim();
    if (historyUrl) {
      this.client = new PrismaClient({ datasources: { db: { url: historyUrl } } });
      this.separate = true;
      this.logger.log('History queries use HISTORY_DATABASE_URL (separate from live DATABASE_URL)');
    } else {
      this.client = main;
      this.separate = false;
    }
  }

  get isSeparate(): boolean {
    return this.separate;
  }

  async onModuleInit(): Promise<void> {
    if (!this.separate) return;
    try {
      await this.client.$connect();
    } catch {
      this.logger.error('History MySQL connection failed at startup (HISTORY_DATABASE_URL)');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.separate) await this.client.$disconnect();
  }

  async ping(): Promise<'up' | 'down'> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      this.logger.error('History MySQL ping failed');
      return 'down';
    }
  }
}
