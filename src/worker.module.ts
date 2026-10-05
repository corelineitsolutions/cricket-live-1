import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { LiveScoreModule } from './live-score/live-score.module';
import { RedisModule } from './redis/redis.module';

/** Standalone live-score worker process: no HTTP server, no WebSocket gateway. */
@Module({
  imports: [AppConfigModule, DatabaseModule, RedisModule, LiveScoreModule],
})
export class WorkerModule {}
