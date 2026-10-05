import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../common/guards/admin-auth.guard';
import { AdminDashboardService } from './admin-dashboard.service';
import { DashboardEnvelopeDto } from './dto/dashboard.dto';
import { MetricsEnvelopeDto } from './dto/metrics.dto';
import { MonitoringService } from './monitoring.service';

@ApiTags('Admin dashboard')
@AdminOnly()
@Controller({ path: 'admin', version: '1' })
export class AdminDashboardController {
  constructor(
    private readonly dashboard: AdminDashboardService,
    private readonly monitoring: MonitoringService,
  ) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Operational summary',
    description:
      'Live matches, WebSocket clients and rooms (all instances), devices, ads, Sportmonks worker and quota, and the status of the API, worker, Redis and MySQL. When a dependency is down its figures are null and dependencies shows "down"; the endpoint still answers 200.',
  })
  @ApiOkResponse({ type: DashboardEnvelopeDto })
  getDashboard() {
    return this.dashboard.getDashboard();
  }

  @Get('metrics')
  @ApiOperation({
    summary: 'Monitoring metrics (flat names)',
    description: 'Same data as the dashboard as stable metric names. For Prometheus use GET /metrics with METRICS_TOKEN.',
  })
  @ApiOkResponse({ type: MetricsEnvelopeDto })
  async getMetrics() {
    const { generatedAt, metrics } = await this.monitoring.collect();
    return { generatedAt, metrics };
  }
}
