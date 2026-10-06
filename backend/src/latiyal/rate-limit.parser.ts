export interface ApiRateLimit {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
}

const EPOCH_SECONDS_THRESHOLD = 1_000_000_000;

function headerNumber(headers: Headers, names: string[]): number | null {
  for (const name of names) {
    const raw = headers.get(name);
    if (raw === null || raw.trim() === '') {
      continue;
    }
    const value = Number(raw);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function resetFromValue(value: number | null, now: number): string | null {
  if (value === null || value < 0) {
    return null;
  }
  // Large values are a Unix timestamp. Small values are seconds until reset.
  const ms = value >= EPOCH_SECONDS_THRESHOLD ? value * 1000 : now + value * 1000;
  return new Date(ms).toISOString();
}

/**
 * Reads rate-limit metadata from the response headers or the `rate_limit` body field.
 * Returns null when the API did not send any.
 */
export function parseRateLimit(headers: Headers, body: unknown, now = Date.now()): ApiRateLimit | null {
  const limit = headerNumber(headers, ['x-ratelimit-limit', 'ratelimit-limit']);
  let remaining = headerNumber(headers, ['x-ratelimit-remaining', 'ratelimit-remaining']);
  let resetAt = resetFromValue(headerNumber(headers, ['x-ratelimit-reset', 'ratelimit-reset']), now);

  if (body && typeof body === 'object' && 'rate_limit' in body) {
    const rateLimit = (body as { rate_limit?: unknown }).rate_limit;
    if (rateLimit && typeof rateLimit === 'object') {
      const record = rateLimit as Record<string, unknown>;
      const bodyRemaining = Number(record.remaining);
      const resetsIn = Number(record.resets_in_seconds);
      if (remaining === null && Number.isFinite(bodyRemaining)) {
        remaining = bodyRemaining;
      }
      if (resetAt === null && Number.isFinite(resetsIn)) {
        resetAt = resetFromValue(resetsIn, now);
      }
    }
  }

  if (limit === null && remaining === null && resetAt === null) {
    return null;
  }
  return { limit, remaining, resetAt };
}

/** Parses Retry-After as seconds or as an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }

  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return null;
  }
  return Math.max(0, date - now);
}
