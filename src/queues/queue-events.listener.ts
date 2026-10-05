import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { LIVE_SCORE_QUEUE } from './queue.constants';

const ERROR_LOG_INTERVAL_MS = 60_000;

/** Handles queue connection errors so they are logged once a minute at most. */
@Injectable()
export class QueueEventsListener implements OnModuleInit {
  private readonly logger = new Logger(QueueEventsListener.name);
  private lastErrorLoggedAt = 0;

  constructor(@InjectQueue(LIVE_SCORE_QUEUE) private readonly liveScoreQueue: Queue) {}

  onModuleInit(): void {
    this.liveScoreQueue.on('error', (error: Error) => {
      const now = Date.now();
      if (now - this.lastErrorLoggedAt >= ERROR_LOG_INTERVAL_MS) {
        this.lastErrorLoggedAt = now;
        this.logger.error(`${LIVE_SCORE_QUEUE} queue Redis error: ${error.message}`);
      }
    });
  }
}
