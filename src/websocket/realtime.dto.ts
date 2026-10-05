import { ApiProperty } from '@nestjs/swagger';
import { MatchDto } from '../matches/dto/match.dto';
import { SocketErrorCode } from './realtime.contract';

/** Swagger models for the Socket.IO payloads. They are documented, not used by HTTP routes. */

export class MatchSubscribePayloadDto {
  @ApiProperty({ example: 61521, description: 'matchId from any match response.' })
  matchId!: number;
}

export class SubscribeAckDto {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiProperty({ example: 61521 })
  matchId!: number;

  @ApiProperty({ example: 'match:61521' })
  room!: string;

  @ApiProperty({ example: 1, description: 'Matches this socket is subscribed to after the call.' })
  subscriptions!: number;
}

export class SocketErrorAckDto {
  @ApiProperty({ example: false })
  ok!: boolean;

  @ApiProperty({ enum: Object.values(SocketErrorCode), example: SocketErrorCode.INVALID_MATCH_ID })
  code!: string;

  @ApiProperty({ example: 'matchId must be a positive integer' })
  message!: string;
}

export class MatchSnapshotEventDto {
  @ApiProperty({ example: 61521 })
  matchId!: number;

  @ApiProperty({ type: MatchDto, nullable: true, description: 'Null when the backend has no data for this match yet.' })
  match!: MatchDto | null;

  @ApiProperty({ format: 'date-time' })
  serverTime!: string;
}

export class MatchChangeEventDto {
  @ApiProperty({ example: 61521 })
  matchId!: number;

  @ApiProperty({
    enum: ['MATCH_STARTED', 'MATCH_UPDATED', 'MATCH_FINISHED', 'MATCH_STALE', 'MATCH_REMOVED'],
    description:
      'Why the event was sent. match:updated carries MATCH_UPDATED, MATCH_STALE (feed delayed, match.stale=true) or MATCH_REMOVED (match left the live feed without a result).',
  })
  type!: string;

  @ApiProperty({ type: [String], example: ['score', 'overs', 'runRate'], description: 'Fields of `match` that changed.' })
  changedFields!: string[];

  @ApiProperty({ type: MatchDto, description: 'Complete match state. Replace your local copy with it.' })
  match!: MatchDto;

  @ApiProperty({ format: 'date-time', description: 'When the backend stored this state.' })
  updatedAt!: string;
}

export class ServerErrorEventDto {
  @ApiProperty({ enum: Object.values(SocketErrorCode), example: SocketErrorCode.RATE_LIMITED })
  code!: string;

  @ApiProperty({ example: 'Too many events. Slow down.' })
  message!: string;

  @ApiProperty({ type: String, nullable: true, example: 'match:subscribe', description: 'Client event that caused the error.' })
  event!: string | null;
}
