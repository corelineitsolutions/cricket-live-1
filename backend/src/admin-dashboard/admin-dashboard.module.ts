import { Module } from '@nestjs/common';
import { AdsModule } from '../ads/ads.module';
import { FcmModule } from '../fcm/fcm.module';
import { LiveScoreModule } from '../live-score/live-score.module';
import { SportmonksModule } from '../sportmonks/sportmonks.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { MonitoringService } from './monitoring.service';
import { MetricsTokenGuard, PrometheusController } from './prometheus.controller';

@Module({
  imports: [LiveScoreModule, SportmonksModule, WebsocketModule, FcmModule, AdsModule],
  controllers: [AdminDashboardController, PrometheusController],
  providers: [AdminDashboardService, MonitoringService, MetricsTokenGuard],
})
export class AdminDashboardModule {}
