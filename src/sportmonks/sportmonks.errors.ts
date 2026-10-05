export type SportmonksErrorKind =
  | 'not_configured'
  | 'timeout'
  | 'network'
  | 'http'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'invalid_response';

export interface SportmonksErrorOptions {
  status?: number;
  retryAfterMs?: number | null;
  retryable?: boolean;
}

export class SportmonksError extends Error {
  readonly kind: SportmonksErrorKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly retryable: boolean;

  constructor(kind: SportmonksErrorKind, message: string, options: SportmonksErrorOptions = {}) {
    super(message);
    this.name = 'SportmonksError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.retryable = options.retryable ?? false;
  }
}

export function isSportmonksError(error: unknown): error is SportmonksError {
  return error instanceof SportmonksError;
}

/** Removes the API token from any text before it is logged or stored. */
export function redactSecret(text: string, secret: string): string {
  if (!secret) {
    return text;
  }
  return text.split(secret).join('[REDACTED]');
}
