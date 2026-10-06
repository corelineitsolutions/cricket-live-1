import { ApiProperty } from '@nestjs/swagger';
import { METRIC_DEFINITIONS } from '../monitoring.service';

export class MetricsDto {
  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number', nullable: true },
    description: `Null when the source is unavailable. Names: ${Object.keys(METRIC_DEFINITIONS).join(', ')}.`,
    example: { 'provider.calls.hour': 412, 'provider.calls.remaining': 19588, 'worker.status': 1, 'websocket.connected': 1250 },
  })
  metrics!: Record<string, number | null>;
}

export class MetricsEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: MetricsDto })
  data!: MetricsDto;
}
