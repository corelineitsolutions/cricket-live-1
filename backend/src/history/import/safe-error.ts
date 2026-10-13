const CONNECTION_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi;
const SECRET_PAIR = /\b(password|pwd|token|secret|api[_-]?key|authorization)\s*[=:]\s*[^\s,;'"]+/gi;

/** Short error text that is safe to log or store: no connection strings or credentials. */
export function safeErrorMessage(error: unknown, maxLength = 300): string {
  const name = error instanceof Error ? error.name : 'Error';
  const code = typeof (error as { code?: unknown })?.code === 'string' ? ` ${(error as { code: string }).code}` : '';
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw
    .replace(CONNECTION_URL, '[redacted-url]')
    .replace(SECRET_PAIR, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return `${name}${code}: ${message}`.slice(0, maxLength);
}
