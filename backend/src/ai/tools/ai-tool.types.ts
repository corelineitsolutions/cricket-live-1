import { LlmToolDefinition } from '../llm/llm.types';

export type ToolArgs = Record<string, unknown>;

/** A read-only tool the model may call. Arguments are validated by `parse` before `run`. */
export interface AiTool<A extends ToolArgs = ToolArgs> {
  definition: LlmToolDefinition;
  /** Returns validated arguments, or an error message for the model. */
  parse(raw: ToolArgs): A | string;
  run(args: A): Promise<unknown>;
  /** Short human label for the response's `sources` list. */
  label(args: A): string;
}

export interface ToolResult {
  name: string;
  ok: boolean;
  /** JSON text given back to the model, already size-limited. */
  content: string;
  /** Parsed result for providers that work on structured data (the mock). */
  data: unknown;
  label: string | null;
}

const MATCH_ID = /^\d{1,10}$/;

export function parseMatchId(raw: unknown): string | null {
  const value = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  return MATCH_ID.test(value) ? value : null;
}

export function parseIntInRange(raw: unknown, min: number, max: number): number | null {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}
