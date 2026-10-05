import { Controller, Get } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AdminOnly } from '../common/guards/admin-auth.guard';
import {
  ClientEvent,
  LIVE_NAMESPACE,
  ServerEvent,
  SOCKET_LIMITS,
  SOCKET_PATH,
  SocketErrorCode,
} from './realtime.contract';
import {
  MatchChangeEventDto,
  MatchSnapshotEventDto,
  MatchSubscribePayloadDto,
  ServerErrorEventDto,
  SocketErrorAckDto,
  SubscribeAckDto,
} from './realtime.dto';
import { RealtimeMetricsService } from './realtime-metrics.service';

export const REALTIME_CONTRACT = {
  transport: 'socket.io v4',
  url: `https://<api-host>${LIVE_NAMESPACE}`,
  namespace: LIVE_NAMESPACE,
  path: SOCKET_PATH,
  recommendedTransports: ['websocket'],
  auth: 'none',
  rooms: 'match:{matchId}',
  clientToServer: [
    {
      event: ClientEvent.subscribe,
      payload: { matchId: 61521 },
      ack: 'SubscribeAck on success, SocketErrorAck on failure',
      effect: `Joins match:{matchId}, then the server emits ${ServerEvent.snapshot} to this socket.`,
    },
    {
      event: ClientEvent.unsubscribe,
      payload: { matchId: 61521 },
      ack: 'SubscribeAck on success, SocketErrorAck on failure',
      effect: 'Leaves match:{matchId}. No further events for that match.',
    },
  ],
  serverToClient: [
    { event: ServerEvent.snapshot, payload: 'MatchSnapshotEvent', when: 'Right after each successful subscribe.' },
    { event: ServerEvent.started, payload: 'MatchChangeEvent', when: 'A followed match goes live.' },
    { event: ServerEvent.updated, payload: 'MatchChangeEvent', when: 'Score or state of a followed match changed, or it became stale.' },
    { event: ServerEvent.finished, payload: 'MatchChangeEvent', when: 'A followed match finished. Final state.' },
    { event: ServerEvent.error, payload: 'ServerErrorEvent', when: 'A client event was rejected.' },
  ],
  errorCodes: Object.values(SocketErrorCode),
  limits: SOCKET_LIMITS,
} as const;

@ApiTags('Realtime')
@ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limit exceeded (code TOO_MANY_REQUESTS).' })
@ApiExtraModels(
  MatchSubscribePayloadDto,
  SubscribeAckDto,
  SocketErrorAckDto,
  MatchSnapshotEventDto,
  MatchChangeEventDto,
  ServerErrorEventDto,
)
@Controller({ path: 'realtime', version: '1' })
export class RealtimeController {
  constructor(private readonly metrics: RealtimeMetricsService) {}

  @Get()
  @ApiOperation({
    summary: 'Socket.IO contract',
    description: [
      `Connect with a Socket.IO v4 client to \`https://<api-host>${LIVE_NAMESPACE}\` (path \`${SOCKET_PATH}\`, transport \`websocket\`). No authentication.`,
      '',
      `Client → server: \`${ClientEvent.subscribe}\` and \`${ClientEvent.unsubscribe}\` with payload MatchSubscribePayloadDto. Both return an acknowledgement (SubscribeAckDto or SocketErrorAckDto).`,
      '',
      `Server → client: \`${ServerEvent.snapshot}\` (MatchSnapshotEventDto), \`${ServerEvent.started}\`, \`${ServerEvent.updated}\`, \`${ServerEvent.finished}\` (MatchChangeEventDto), \`${ServerEvent.error}\` (ServerErrorEventDto).`,
      '',
      'Payload schemas are listed under Schemas at the bottom of this page.',
    ].join('\n'),
  })
  @ApiOkResponse({
    description: 'Machine-readable summary of the socket contract.',
    schema: {
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'object', example: REALTIME_CONTRACT },
      },
    },
  })
  contract() {
    return REALTIME_CONTRACT;
  }

  @Get('metrics')
  @AdminOnly()
  @ApiOperation({ summary: 'WebSocket connections and subscriptions across all API instances (admin)' })
  metricsSummary() {
    return this.metrics.cluster();
  }
}
