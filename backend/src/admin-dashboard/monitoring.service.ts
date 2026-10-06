import { Injectable } from '@nestjs/common';
import { AdminDashboardService } from './admin-dashboard.service';
import type { DashboardDto } from './dto/dashboard.dto';

/** Metric names are stable: alerting rules and dashboards depend on them. */
export const METRIC_DEFINITIONS = {
  'provider.calls.hour': 'Latiyal calls counted in the current clock hour',
  'provider.calls.remaining': 'Latiyal calls still allowed this hour',
  'provider.calls.limit': 'Configured LATIYAL_MAX_CALLS_PER_HOUR',
  'provider.last_success': 'Unix time (seconds) of the last successful poll',
  'provider.last_error': 'Unix time (seconds) of the last failed poll',
  'provider.poll_interval': 'Delay before the next poll, in milliseconds',
  'provider.live_matches': 'Live matches seen in the last successful poll',
  'provider.429': 'HTTP 429 responses from Latiyal in the current quota window',
  'worker.status': '1 when the live-score worker reported recently, else 0',
  'redis.status': '1 when Redis answers PING, else 0',
  'mysql.status': '1 when MySQL answers, else 0',
  'websocket.connected': 'Socket.IO connections across all API instances',
  'websocket.rooms': 'Match rooms with at least one subscriber',
  'devices.total': 'Registered devices',
  'devices.active': 'Devices that can receive pushes',
  'ads.active': 'Ads served by GET /api/v1/ads right now',
} as const;

export type MetricName = keyof typeof METRIC_DEFINITIONS;
export type Metrics = Record<MetricName, number | null>;

const PROMETHEUS_PREFIX = 'cricket_live_';

const seconds = (iso: string | null | undefined) => (iso ? Math.floor(Date.parse(iso) / 1000) : null);
const flag = (up: boolean) => (up ? 1 : 0);

export function toMetrics(dashboard: DashboardDto): Metrics {
  const { provider, dependencies } = dashboard;
  return {
    'provider.calls.hour': provider.callsThisHour,
    'provider.calls.remaining': provider.remainingQuota,
    'provider.calls.limit': provider.hourlyLimit,
    'provider.last_success': seconds(provider.lastSuccessAt),
    'provider.last_error': seconds(provider.lastError?.at),
    'provider.poll_interval': provider.pollingIntervalMs,
    'provider.live_matches': provider.lastSuccess?.liveMatches ?? null,
    'provider.429': provider.count429,
    'worker.status': flag(dependencies.worker === 'up'),
    'redis.status': flag(dependencies.redis === 'up'),
    'mysql.status': flag(dependencies.mysql === 'up'),
    'websocket.connected': dashboard.realtime.connectedClients,
    'websocket.rooms': dashboard.realtime.activeMatchRooms,
    'devices.total': dashboard.devices.registered,
    'devices.active': dashboard.devices.active,
    'ads.active': dashboard.ads.visibleNow,
  };
}

/** Prometheus text exposition format 0.0.4. Unknown values are omitted rather than reported as 0. */
export function toPrometheus(metrics: Metrics, workerHealth: string): string {
  const lines: string[] = [];
  for (const [name, help] of Object.entries(METRIC_DEFINITIONS) as Array<[MetricName, string]>) {
    const value = metrics[name];
    if (value === null) {
      continue;
    }
    const id = PROMETHEUS_PREFIX + name.replace(/\./g, '_');
    lines.push(`# HELP ${id} ${help}`, `# TYPE ${id} gauge`, `${id} ${value}`);
  }
  lines.push(
    `# HELP ${PROMETHEUS_PREFIX}worker_health Worker health as a label (up, down, disabled, unknown)`,
    `# TYPE ${PROMETHEUS_PREFIX}worker_health gauge`,
    `${PROMETHEUS_PREFIX}worker_health{health="${workerHealth}"} 1`,
  );
  return `${lines.join('\n')}\n`;
}

@Injectable()
export class MonitoringService {
  constructor(private readonly dashboard: AdminDashboardService) {}

  async collect(): Promise<{ generatedAt: string; metrics: Metrics; workerHealth: string }> {
    const dashboard = await this.dashboard.getDashboard();
    return { generatedAt: dashboard.generatedAt, metrics: toMetrics(dashboard), workerHealth: dashboard.dependencies.worker };
  }
}
