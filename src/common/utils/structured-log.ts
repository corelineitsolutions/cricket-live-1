import { Logger } from '@nestjs/common';

export type LogLevel = 'log' | 'warn' | 'error' | 'debug';

/** Writes `[tag] {"key":"value"}` so log lines can be grepped by tag and parsed as JSON. */
export function logEvent(
  logger: Logger,
  level: LogLevel,
  tag: string,
  fields: Record<string, unknown> = {},
): void {
  logger[level](`[${tag}] ${JSON.stringify(fields)}`);
}
