import { Logger } from '@nestjs/common';

const LEVELS = ['log', 'warn', 'error', 'debug', 'verbose'] as const;

/** Silences Nest loggers and records every line so tests can assert on tags and redaction. */
export function captureLogs(): { lines: string[]; text: () => string; tagged: (tag: string) => string[] } {
  const lines: string[] = [];
  for (const level of LEVELS) {
    vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown, ...rest: unknown[]) => {
      lines.push([message, ...rest].map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' '));
    });
  }
  return {
    lines,
    text: () => lines.join('\n'),
    tagged: (tag: string) => lines.filter((line) => line.startsWith(`[${tag}]`)),
  };
}
