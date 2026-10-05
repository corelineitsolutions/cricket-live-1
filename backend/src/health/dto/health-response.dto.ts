import { ApiProperty } from '@nestjs/swagger';

export class HealthChecksDto {
  @ApiProperty({ example: 'up' })
  api!: 'up';

  @ApiProperty({ enum: ['up', 'down'] })
  mysql!: 'up' | 'down';

  @ApiProperty({ enum: ['up', 'down'] })
  redis!: 'up' | 'down';
}

export class HealthDataDto {
  @ApiProperty({ enum: ['ok', 'degraded'] })
  status!: 'ok' | 'degraded';

  @ApiProperty({ type: HealthChecksDto })
  checks!: HealthChecksDto;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;
}

export class HealthSuccessResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: HealthDataDto })
  data!: HealthDataDto;
}

export class HealthFailureResponseDto {
  @ApiProperty({ example: false })
  success!: boolean;

  @ApiProperty()
  message!: string;

  @ApiProperty({ example: 'SERVICE_UNAVAILABLE' })
  code!: string;

  @ApiProperty({ type: HealthChecksDto })
  checks!: HealthChecksDto;
}
