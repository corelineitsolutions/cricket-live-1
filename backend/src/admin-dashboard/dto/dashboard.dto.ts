import { ApiProperty } from '@nestjs/swagger';

export class DashboardMatchesDto {
  @ApiProperty({ type: Number, nullable: true, example: 3, description: 'Matches in the live feed. Null when Redis is unavailable.' })
  liveCount!: number | null;
}

export class DashboardRealtimeDto {
  @ApiProperty({ example: 1250, description: 'Socket.IO connections across all API instances.' })
  connectedClients!: number;

  @ApiProperty({ example: 3, description: 'Matches with at least one subscriber.' })
  activeMatchRooms!: number;

  @ApiProperty({ example: 1610, description: 'Total match subscriptions (a client may follow several matches).' })
  subscriptions!: number;

  @ApiProperty({ example: 2, description: 'API instances that reported in the last 45 seconds.' })
  instances!: number;
}

export class DashboardDevicesDto {
  @ApiProperty({ type: Number, nullable: true, example: 48210 })
  registered!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 45102 })
  active!: number | null;
}

export class DashboardAdsDto {
  @ApiProperty({ type: Number, nullable: true, example: 12 })
  total!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 6, description: 'isActive=true, regardless of schedule.' })
  enabled!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 4, description: 'Served by GET /api/v1/ads right now.' })
  visibleNow!: number | null;
}

export class DashboardPollIntervalsDto {
  @ApiProperty({ example: 60000 })
  idle!: number;

  @ApiProperty({ example: 10000 })
  live!: number;

  @ApiProperty({ example: 5000 })
  active!: number;
}

export class DashboardLastSuccessDto {
  @ApiProperty({ format: 'date-time' })
  at!: string;

  @ApiProperty({ example: 412 })
  durationMs!: number;

  @ApiProperty({ example: 3 })
  liveMatches!: number;
}

export class DashboardLastErrorDto {
  @ApiProperty({ format: 'date-time' })
  at!: string;

  @ApiProperty({ example: 'timeout' })
  kind!: string;

  @ApiProperty({ type: Number, nullable: true, example: 503 })
  status!: number | null;

  @ApiProperty({ example: 'Latiyal request timed out after 8000ms' })
  message!: string;
}

export class DashboardProviderDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'live',
    description: 'starting, disabled, idle, live, backoff, rate-limited or quota-exhausted. Null if the worker never reported.',
  })
  workerState!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Polling 3 live matches' })
  workerMessage!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  workerUpdatedAt!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 10000, description: 'Interval the worker chose for its next poll.' })
  pollingIntervalMs!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextPollAt!: string | null;

  @ApiProperty({ type: DashboardPollIntervalsDto, description: 'Configured intervals.' })
  configuredIntervalsMs!: DashboardPollIntervalsDto;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Last successful Latiyal poll.' })
  lastSuccessAt!: string | null;

  @ApiProperty({ type: DashboardLastSuccessDto, nullable: true })
  lastSuccess!: DashboardLastSuccessDto | null;

  @ApiProperty({ type: DashboardLastErrorDto, nullable: true })
  lastError!: DashboardLastErrorDto | null;

  @ApiProperty({ type: Number, nullable: true, example: 412, description: 'Latiyal calls counted this clock hour (all callers).' })
  callsThisHour!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null, description: 'LATIYAL_MAX_CALLS_PER_HOUR. Null when unlimited (the default).' })
  hourlyLimit!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description: 'Calls still allowed this hour (the stricter of our limit and any API rate-limit headers). Null when unlimited or unknown.',
  })
  remainingQuota!: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'local', description: '"api" when the API sent rate-limit headers, else "local".' })
  quotaSource!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  quotaResetsAt!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 37, description: 'Scorecard, commentary and data-feed calls this hour.' })
  onDemandCallsThisHour!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null, description: 'LATIYAL_ON_DEMAND_MAX_CALLS_PER_HOUR. Null when unlimited (the default).' })
  onDemandHourlyLimit!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 0, description: 'HTTP 429 responses received from Latiyal (kept with the quota state, about 1 hour).' })
  count429!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  last429At!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 200, description: 'HTTP status of the latest Latiyal response.' })
  lastStatus!: number | null;
}

export const WORKER_HEALTH = ['up', 'down', 'disabled', 'unknown'] as const;
export type WorkerHealth = (typeof WORKER_HEALTH)[number];

export class DashboardDependenciesDto {
  @ApiProperty({ enum: ['up'], description: 'This API process (it answered the request).' })
  api!: 'up';

  @ApiProperty({
    enum: WORKER_HEALTH,
    description:
      '"up": the live-score worker reported recently. "down": no report for longer than expected (crashed or stuck). "disabled": no Latiyal token. "unknown": never reported or Redis unavailable.',
  })
  worker!: WorkerHealth;

  @ApiProperty({ enum: ['up', 'down'] })
  redis!: 'up' | 'down';

  @ApiProperty({ enum: ['up', 'down'] })
  mysql!: 'up' | 'down';
}

export class DashboardDto {
  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({ type: DashboardMatchesDto })
  matches!: DashboardMatchesDto;

  @ApiProperty({ type: DashboardRealtimeDto })
  realtime!: DashboardRealtimeDto;

  @ApiProperty({ type: DashboardDevicesDto })
  devices!: DashboardDevicesDto;

  @ApiProperty({ type: DashboardAdsDto })
  ads!: DashboardAdsDto;

  @ApiProperty({ type: DashboardProviderDto })
  provider!: DashboardProviderDto;

  @ApiProperty({ type: DashboardDependenciesDto })
  dependencies!: DashboardDependenciesDto;
}

export class DashboardEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: DashboardDto })
  data!: DashboardDto;
}
