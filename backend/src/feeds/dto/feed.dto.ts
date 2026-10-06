import { ApiProperty } from '@nestjs/swagger';
import { FEED_PARAM_NAMES } from '../../latiyal/latiyal-catalog';

export class FeedParamDto {
  @ApiProperty({ enum: FEED_PARAM_NAMES, example: 'match_id' })
  name!: string;

  @ApiProperty({ example: true })
  required!: boolean;

  @ApiProperty({ required: false, example: '0', description: 'Value sent when the parameter is omitted.' })
  default?: string;
}

export class FeedDefinitionDto {
  @ApiProperty({ example: 'scorecardByMatchId' })
  endpoint!: string;

  @ApiProperty({ example: 'live', enum: ['home', 'series', 'matches', 'live', 'news', 'rankings', 'players', 'teams', 'venues'] })
  group!: string;

  @ApiProperty({ example: 'Full scorecard of a match' })
  summary!: string;

  @ApiProperty({ type: [FeedParamDto], description: 'Query parameters, using Latiyal names.' })
  params!: FeedParamDto[];

  @ApiProperty({ example: 15, description: 'Seconds a response is cached before Latiyal is asked again.' })
  refreshSeconds!: number;

  @ApiProperty({ example: false, description: 'Only available on the Latiyal V5 plan.' })
  v5Only!: boolean;
}

export class FeedCatalogEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [FeedDefinitionDto] })
  data!: FeedDefinitionDto[];
}

export class FeedDto {
  @ApiProperty({ example: 'scorecardByMatchId' })
  endpoint!: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, example: { match_id: '4012' } })
  params!: Record<string, string>;

  @ApiProperty({
    nullable: true,
    description: 'The Latiyal `data` payload, unchanged. Null when Latiyal has nothing for these params (see `message`).',
    oneOf: [{ type: 'object' }, { type: 'array', items: {} }],
  })
  data!: unknown;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Latiyal message when `data` is null.' })
  message!: string | null;

  @ApiProperty({ type: String, format: 'date-time', description: 'When this response was fetched from Latiyal.' })
  updatedAt!: string;

  @ApiProperty({ description: 'True when a refresh failed and this is the last good copy.' })
  stale!: boolean;
}

export class FeedEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: FeedDto })
  data!: FeedDto;
}
