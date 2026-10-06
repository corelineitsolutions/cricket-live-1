import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AdminDashboardModule } from './admin-dashboard/admin-dashboard.module';
import { AdminMatchesModule } from './admin-matches/admin-matches.module';
import { AdsModule } from './ads/ads.module';
import { AppCacheModule } from './cache/cache.module';
import { HttpThrottlerGuard } from './common/guards/http-throttler.guard';
import { throttlerOptions } from './common/guards/throttler.config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { DatabaseModule } from './database/database.module';
import { FcmModule } from './fcm/fcm.module';
import { FirebaseModule } from './firebase/firebase.module';
import { HealthModule } from './health/health.module';
import { LeaguesModule } from './leagues/leagues.module';
import { LiveScoreModule } from './live-score/live-score.module';
import { MatchesModule } from './matches/matches.module';
import { PlayersModule } from './players/players.module';
import { QueuesModule } from './queues/queues.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { SeasonsModule } from './seasons/seasons.module';
import { LatiyalModule } from './latiyal/latiyal.module';
import { TeamsModule } from './teams/teams.module';
import { WebsocketModule } from './websocket/websocket.module';

@Module({
  imports: [
    AppConfigModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService, RedisService],
      useFactory: throttlerOptions,
    }),
    AppCacheModule,
    DatabaseModule,
    FirebaseModule,
    QueuesModule,
    LatiyalModule,
    LiveScoreModule,
    WebsocketModule,
    HealthModule,
    AdminModule,
    MatchesModule,
    TeamsModule,
    PlayersModule,
    LeaguesModule,
    SeasonsModule,
    FcmModule,
    AdsModule,
    AdminDashboardModule,
    AdminMatchesModule,
  ],
  providers: [
    AllExceptionsFilter,
    {
      provide: APP_GUARD,
      useClass: HttpThrottlerGuard,
    },
  ],
})
export class AppModule {}
