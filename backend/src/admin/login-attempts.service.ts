import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ErrorCode } from '../common/constants/error-codes';
import { RedisKey } from '../common/constants/redis-keys';
import { apiError } from '../common/utils/http-errors';
import { logEvent } from '../common/utils/structured-log';
import { RedisService } from '../redis/redis.service';

export const ADMIN_LOGIN_MAX_FAILURES = 5;
export const ADMIN_LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;

/**
 * Per-account brute-force protection, shared by all instances through Redis. Keyed by a
 * hash of the email whether or not the account exists, so lockouts reveal nothing.
 * Per-IP limits are applied separately by the throttler.
 */
@Injectable()
export class LoginAttemptsService {
  private readonly logger = new Logger(LoginAttemptsService.name);

  constructor(private readonly redis: RedisService) {}

  static subject(email: string): string {
    return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
  }

  async assertNotLocked(email: string): Promise<void> {
    const key = RedisKey.adminLoginFailures(LoginAttemptsService.subject(email));
    let failures: number;
    let ttlMs: number | null;
    try {
      [failures, ttlMs] = await Promise.all([this.redis.get(key).then(Number), this.redis.ttlMs(key)]);
    } catch {
      logEvent(this.logger, 'warn', 'admin-login-lockout-unavailable', { reason: 'redis_unavailable' });
      return;
    }
    if (failures >= ADMIN_LOGIN_MAX_FAILURES) {
      const retryAfterSeconds = Math.max(1, Math.ceil((ttlMs ?? ADMIN_LOGIN_LOCK_WINDOW_MS) / 1000));
      logEvent(this.logger, 'warn', 'admin-login-failed', {
        subject: LoginAttemptsService.subject(email),
        reason: 'locked',
        retryAfterSeconds,
      });
      const error = apiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'Too many failed login attempts. Try again later.',
        ErrorCode.TOO_MANY_REQUESTS,
      );
      (error.getResponse() as Record<string, unknown>).retryAfterSeconds = retryAfterSeconds;
      throw error;
    }
  }

  async recordFailure(email: string): Promise<number | null> {
    try {
      const { hits } = await this.redis.throttleIncrement(
        RedisKey.adminLoginFailures(LoginAttemptsService.subject(email)),
        ADMIN_LOGIN_LOCK_WINDOW_MS,
      );
      return hits;
    } catch {
      return null;
    }
  }

  async clear(email: string): Promise<void> {
    await this.redis.del(RedisKey.adminLoginFailures(LoginAttemptsService.subject(email))).catch(() => undefined);
  }
}
