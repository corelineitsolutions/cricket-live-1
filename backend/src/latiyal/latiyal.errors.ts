export type LatiyalErrorKind =
  | 'not_configured'
  | 'unauthorized'
  | 'timeout'
  | 'network'
  | 'http'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'invalid_response';

export interface LatiyalErrorOptions {
  status?: number;
  retryAfterMs?: number | null;
  retryable?: boolean;
}

export class LatiyalError extends Error {
  readonly kind: LatiyalErrorKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly retryable: boolean;

  constructor(kind: LatiyalErrorKind, message: string, options: LatiyalErrorOptions = {}) {
    super(message);
    this.name = 'LatiyalError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.retryable = options.retryable ?? false;
  }
}

export function isLatiyalError(error: unknown): error is LatiyalError {
  return error instanceof LatiyalError;
}

/** Removes the API token from any text before it is logged or stored. */
export function redactSecret(text: string, secret: string): string {
  if (!secret) {
    return text;
  }
  return text.split(secret).join('[REDACTED]');
}
