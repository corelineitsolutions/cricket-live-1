import { redisRetryDelay } from './redis-connection';

describe('redisRetryDelay', () => {
  it('backs off and caps the delay so Redis reconnects after a restart', () => {
    expect(redisRetryDelay(1)).toBe(200);
    expect(redisRetryDelay(10)).toBe(2000);
    expect(redisRetryDelay(1000)).toBe(5000);
  });
});
