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

  @ApiProperty({ example: 'Sportmonks request timed out' })
  message!: string;
}

export class DashboardSportmonksDto {
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

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Last successful Sportmonks poll.' })
  lastSuccessAt!: string | null;

  @ApiProperty({ type: DashboardLastSuccessDto, nullable: true })
  lastSuccess!: DashboardLastSuccessDto | null;

  @ApiProperty({ type: DashboardLastErrorDto, nullable: true })
  lastError!: DashboardLastErrorDto | null;

  @ApiProperty({ type: Number, nullable: true, example: 412, description: 'Sportmonks calls counted this clock hour (all callers).' })
  callsThisHour!: number | null;

  @ApiProperty({ example: 1600, description: 'SPORTMONKS_MAX_CALLS_PER_HOUR.' })
  hourlyLimit!: number;

  @ApiProperty({ type: Number, nullable: true, example: 1188, description: 'Calls still allowed this hour (the stricter of our limit and Sportmonks headers).' })
  remainingQuota!: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'local', description: '"api" when Sportmonks rate-limit headers are known, else "local".' })
  quotaSource!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  quotaResetsAt!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 37, description: 'Scorecard/commentary calls this hour.' })
  onDemandCallsThisHour!: number | null;

  @ApiProperty({ example: 400, description: 'SPORTMONKS_ON_DEMAND_MAX_CALLS_PER_HOUR.' })
  onDemandHourlyLimit!: number;

  @ApiProperty({ type: Number, nullable: true, example: 0, description: 'HTTP 429 responses received from Sportmonks (kept with the quota state, about 1 hour).' })
  count429!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  last429At!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 200, description: 'HTTP status of the latest Sportmonks response.' })
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
      '"up": the live-score worker reported recently. "down": no report for longer than expected (crashed or stuck). "disabled": no Sportmonks token. "unknown": never reported or Redis unavailable.',
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

  @ApiProperty({ type: DashboardSportmonksDto })
  sportmonks!: DashboardSportmonksDto;

  @ApiProperty({ type: DashboardDependenciesDto })
  dependencies!: DashboardDependenciesDto;
}

export class DashboardEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: DashboardDto })
  data!: DashboardDto;
}
