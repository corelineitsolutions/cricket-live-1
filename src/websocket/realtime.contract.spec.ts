import { RedisChannel } from '../common/constants/redis-keys';
import { REALTIME_CONTRACT } from './realtime.controller';
import { ClientEvent, LIVE_NAMESPACE, matchRoom, parseMatchSubscription, ServerEvent, SocketErrorCode } from './realtime.contract';
import { parseLiveScoreEvent } from './live-updates.subscriber';
import { SocketRateLimiter } from './socket-rate-limiter';

describe('realtime contract', () => {
  it('keeps the names the mobile app depends on', () => {
    expect(LIVE_NAMESPACE).toBe('/live');
    expect(ClientEvent).toEqual({ subscribe: 'match:subscribe', unsubscribe: 'match:unsubscribe' });
    expect(ServerEvent).toEqual({
      snapshot: 'match:snapshot',
      updated: 'match:updated',
      started: 'match:started',
      finished: 'match:finished',
      error: 'server:error',
    });
    expect(matchRoom(61521)).toBe('match:61521');
    expect(RedisChannel.liveScoreUpdates()).toBe('live-score-updates');
    expect(REALTIME_CONTRACT).toMatchObject({ namespace: '/live', path: '/socket.io', auth: 'none' });
  });

  it.each([
    [{ matchId: 61521 }, { ok: true, matchId: 61521 }],
    [{ matchId: '61521' }, { ok: true, matchId: 61521 }],
    [{ matchId: 999_999_999_999 }, { ok: true, matchId: 999_999_999_999 }],
  ])('accepts %j', (payload, expected) => {
    expect(parseMatchSubscription(payload)).toEqual(expected);
  });

  it.each([
    [null, SocketErrorCode.INVALID_PAYLOAD],
    [undefined, SocketErrorCode.INVALID_PAYLOAD],
    [61521, SocketErrorCode.INVALID_PAYLOAD],
    [[61521], SocketErrorCode.INVALID_PAYLOAD],
    [{}, SocketErrorCode.INVALID_MATCH_ID],
    [{ matchId: 0 }, SocketErrorCode.INVALID_MATCH_ID],
    [{ matchId: -3 }, SocketErrorCode.INVALID_MATCH_ID],
    [{ matchId: 2.5 }, SocketErrorCode.INVALID_MATCH_ID],
    [{ matchId: Number.NaN }, SocketErrorCode.INVALID_MATCH_ID],
    [{ matchId: 1_000_000_000_000 }, SocketErrorCode.INVALID_MATCH_ID],
    [{ matchId: '0123' }, SocketErrorCode.INVALID_MATCH_ID],
    [{ matchId: '1e5' }, SocketErrorCode.INVALID_MATCH_ID],
    [{ matchId: { $gt: 1 } }, SocketErrorCode.INVALID_MATCH_ID],
  ])('rejects %j with %s', (payload, code) => {
    expect(parseMatchSubscription(payload)).toMatchObject({ ok: false, code });
  });
});

describe('SocketRateLimiter', () => {
  it('allows a burst, then refills at the sustained rate', () => {
    let now = 0;
    const limiter = new SocketRateLimiter(3, 2, () => now);

    expect([limiter.take(), limiter.take(), limiter.take(), limiter.take()]).toEqual([true, true, true, false]);
    expect(limiter.rejected).toBe(1);

    now += 500;
    expect(limiter.take()).toBe(true);
    expect(limiter.take()).toBe(false);

    now += 60_000;
    expect([limiter.take(), limiter.take(), limiter.take(), limiter.take()]).toEqual([true, true, true, false]);
  });
});

describe('parseLiveScoreEvent', () => {
  const valid = {
    type: 'MATCH_UPDATED',
    matchId: 'cm1',
    sportmonksId: 61521,
    changedFields: ['score'],
    updatedAt: '2026-10-01T16:25:00.000Z',
    data: { sportmonksId: 61521 },
  };

  it('accepts worker events', () => {
    expect(parseLiveScoreEvent(JSON.stringify(valid))).toMatchObject({ type: 'MATCH_UPDATED', sportmonksId: 61521 });
  });

  it.each([
    ['not json', '{'],
    ['an unknown type', JSON.stringify({ ...valid, type: 'MATCH_DELETED' })],
    ['a missing sportmonksId', JSON.stringify({ ...valid, sportmonksId: undefined })],
    ['missing data', JSON.stringify({ ...valid, data: null })],
    ['a primitive', '42'],
  ])('drops %s', (_label, message) => {
    expect(parseLiveScoreEvent(message)).toBeNull();
  });
});
