import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { logEvent } from '../common/utils/structured-log';
import type { LiveScoreEvent } from '../live-score/live-match.types';
import { LiveScoreService } from '../live-score/live-score.service';
import type { MatchDto } from '../matches/dto/match.dto';
import { MatchesService } from '../matches/matches.service';
import { toPublicMatch } from '../matches/public-match.mapper';
import {
  ClientEvent,
  LIVE_NAMESPACE,
  matchRoom,
  parseMatchSubscription,
  ServerEvent,
  SOCKET_LIMITS,
  SocketErrorCode,
  SocketErrorCodeValue,
} from './realtime.contract';
import { RealtimeMetricsService } from './realtime-metrics.service';
import { SocketRateLimiter } from './socket-rate-limiter';

interface SocketState {
  matches: Set<number>;
  limiter: SocketRateLimiter;
}

type Ack =
  | { ok: true; matchId: number; room: string; subscriptions: number }
  | { ok: false; code: SocketErrorCodeValue; message: string };

const CHANGE_EVENTS: Record<LiveScoreEvent['type'], string> = {
  MATCH_STARTED: ServerEvent.started,
  MATCH_FINISHED: ServerEvent.finished,
  MATCH_UPDATED: ServerEvent.updated,
  MATCH_STALE: ServerEvent.updated,
  MATCH_REMOVED: ServerEvent.updated,
};

@WebSocketGateway({
  namespace: LIVE_NAMESPACE,
  cors: { origin: true, credentials: false },
  maxHttpBufferSize: SOCKET_LIMITS.maxPayloadBytes,
})
export class LiveGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LiveGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly liveScore: LiveScoreService,
    private readonly matches: MatchesService,
    private readonly metrics: RealtimeMetricsService,
  ) {}

  afterInit(server: Namespace): void {
    this.metrics.attachRooms(() => server.adapter.rooms);
  }

  handleConnection(client: Socket): void {
    const state: SocketState = {
      matches: new Set(),
      limiter: new SocketRateLimiter(SOCKET_LIMITS.eventBurst, SOCKET_LIMITS.eventsPerSecond),
    };
    client.data = state;
    this.metrics.connected();

    client.use((packet, next) => {
      if (state.limiter.take()) {
        next();
        return;
      }
      const [event] = packet;
      const message = 'Too many events. Slow down.';
      const ack = packet[packet.length - 1] as unknown;
      if (typeof ack === 'function') {
        (ack as (response: Ack) => void)({ ok: false, code: SocketErrorCode.RATE_LIMITED, message });
      }
      this.sendError(client, SocketErrorCode.RATE_LIMITED, message, String(event));
      if (state.limiter.rejected >= SOCKET_LIMITS.maxRejectedEvents) {
        logEvent(this.logger, 'warn', 'ws-abuse', { socketId: client.id, rejected: state.limiter.rejected });
        client.disconnect(true);
      }
    });
  }

  handleDisconnect(client: Socket): void {
    this.metrics.disconnected();
    (client.data as SocketState | undefined)?.matches.clear();
  }

  @SubscribeMessage(ClientEvent.subscribe)
  async subscribe(client: Socket, payload: unknown): Promise<Ack> {
    const parsed = parseMatchSubscription(payload);
    if (!parsed.ok) {
      return this.reject(client, parsed.code, parsed.message, ClientEvent.subscribe);
    }

    const state = client.data as SocketState;
    const { matchId } = parsed;
    if (!state.matches.has(matchId) && state.matches.size >= SOCKET_LIMITS.maxSubscriptionsPerSocket) {
      return this.reject(
        client,
        SocketErrorCode.TOO_MANY_SUBSCRIPTIONS,
        `A connection can follow at most ${SOCKET_LIMITS.maxSubscriptionsPerSocket} matches`,
        ClientEvent.subscribe,
      );
    }

    const room = matchRoom(matchId);
    await client.join(room);
    state.matches.add(matchId);

    client.emit(ServerEvent.snapshot, {
      matchId,
      match: await this.snapshot(matchId),
      serverTime: new Date().toISOString(),
    });
    return { ok: true, matchId, room, subscriptions: state.matches.size };
  }

  @SubscribeMessage(ClientEvent.unsubscribe)
  async unsubscribe(client: Socket, payload: unknown): Promise<Ack> {
    const parsed = parseMatchSubscription(payload);
    if (!parsed.ok) {
      return this.reject(client, parsed.code, parsed.message, ClientEvent.unsubscribe);
    }

    const state = client.data as SocketState;
    const room = matchRoom(parsed.matchId);
    await client.leave(room);
    state.matches.delete(parsed.matchId);
    return { ok: true, matchId: parsed.matchId, room, subscriptions: state.matches.size };
  }

  /**
   * Sends a worker event to subscribers of that match on this instance only. Every API
   * instance receives the Redis message itself, so a cluster-wide emit would duplicate it.
   */
  broadcast(event: LiveScoreEvent): void {
    const name = CHANGE_EVENTS[event.type];
    if (!name || !this.server) {
      return;
    }
    this.server.local.to(matchRoom(event.sportmonksId)).emit(name, {
      matchId: event.sportmonksId,
      type: event.type,
      changedFields: event.changedFields,
      match: toPublicMatch(event.data),
      updatedAt: event.updatedAt,
    });
  }

  private async snapshot(matchId: number): Promise<MatchDto | null> {
    const live = await this.liveScore.getMatchSnapshot(matchId);
    if (live) {
      return toPublicMatch(live);
    }
    try {
      return await this.matches.getMatch(String(matchId));
    } catch {
      return null;
    }
  }

  private reject(client: Socket, code: SocketErrorCodeValue, message: string, event: string): Ack {
    this.sendError(client, code, message, event);
    return { ok: false, code, message };
  }

  private sendError(client: Socket, code: SocketErrorCodeValue, message: string, event: string | null): void {
    client.emit(ServerEvent.error, { code, message, event });
  }
}
