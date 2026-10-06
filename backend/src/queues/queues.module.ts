import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppConfigService } from '../config/app-config.service';
import { redisRetryDelay } from '../redis/redis-connection';
import { QueueEventsListener } from './queue-events.listener';
import { LIVE_SCORE_QUEUE } from './queue.constants';

/**
 * BullMQ connection and the live-score queue.
 * No processor and no repeatable job are registered. Latiyal polling is a later phase.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: {
          host: config.redisHost,
          port: config.redisPort,
          password: config.redisPassword || undefined,
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
          connectTimeout: 2000,
          retryStrategy: redisRetryDelay,
        },
      }),
    }),
    BullModule.registerQueue({ name: LIVE_SCORE_QUEUE }),
  ],
  providers: [QueueEventsListener],
})
export class QueuesModule {}
