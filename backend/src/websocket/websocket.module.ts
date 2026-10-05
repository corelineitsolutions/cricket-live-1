import { Module } from '@nestjs/common';
import { LiveScoreModule } from '../live-score/live-score.module';
import { MatchesModule } from '../matches/matches.module';
import { LiveGateway } from './live.gateway';
import { LiveUpdatesSubscriber } from './live-updates.subscriber';
import { RealtimeController } from './realtime.controller';
import { RealtimeMetricsService } from './realtime-metrics.service';

@Module({
  imports: [LiveScoreModule, MatchesModule],
  controllers: [RealtimeController],
  providers: [LiveGateway, LiveUpdatesSubscriber, RealtimeMetricsService],
  exports: [RealtimeMetricsService],
})
export class WebsocketModule {}
