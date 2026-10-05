/** Socket.IO contract for anonymous mobile clients. Mirrored in docs/API_CONTRACT.md. */

export const LIVE_NAMESPACE = '/live';
export const SOCKET_PATH = '/socket.io';

export const ClientEvent = {
  subscribe: 'match:subscribe',
  unsubscribe: 'match:unsubscribe',
} as const;

export const ServerEvent = {
  snapshot: 'match:snapshot',
  updated: 'match:updated',
  started: 'match:started',
  finished: 'match:finished',
  error: 'server:error',
} as const;

export const SocketErrorCode = {
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  INVALID_MATCH_ID: 'INVALID_MATCH_ID',
  TOO_MANY_SUBSCRIPTIONS: 'TOO_MANY_SUBSCRIPTIONS',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type SocketErrorCodeValue = (typeof SocketErrorCode)[keyof typeof SocketErrorCode];

export const SOCKET_LIMITS = {
  maxSubscriptionsPerSocket: 20,
  /** Token bucket: burst size and sustained events per second, per socket. */
  eventBurst: 20,
  eventsPerSecond: 2,
  /** Rejected events tolerated before the server disconnects the socket. */
  maxRejectedEvents: 40,
  maxPayloadBytes: 16 * 1024,
} as const;

const MAX_MATCH_ID = 999_999_999_999;

export function matchRoom(matchId: number): string {
  return `match:${matchId}`;
}

export type SubscriptionParse =
  | { ok: true; matchId: number }
  | { ok: false; code: SocketErrorCodeValue; message: string };

/** Accepts `{ "matchId": 123 }`. A numeric string ("123") is tolerated. */
export function parseMatchSubscription(payload: unknown): SubscriptionParse {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, code: SocketErrorCode.INVALID_PAYLOAD, message: 'Payload must be an object like {"matchId": 123}' };
  }
  const raw = (payload as { matchId?: unknown }).matchId;
  const matchId = typeof raw === 'string' && /^[1-9]\d{0,11}$/.test(raw) ? Number(raw) : raw;
  if (typeof matchId !== 'number' || !Number.isInteger(matchId) || matchId < 1 || matchId > MAX_MATCH_ID) {
    return { ok: false, code: SocketErrorCode.INVALID_MATCH_ID, message: 'matchId must be a positive integer' };
  }
  return { ok: true, matchId };
}
