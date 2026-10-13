import { HttpException } from '@nestjs/common';
import { LlmToolDefinition } from '../llm/llm.types';
import { AiTool, ToolArgs, ToolResult } from './ai-tool.types';

export const MAX_TOOL_RESULT_CHARS = 6000;
const TOOL_TIMEOUT_MS = 8000;

function describeFailure(error: unknown): string {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status === 404) return 'not found';
    if (status === 400) return 'invalid request';
    if (status === 503) return 'temporarily unavailable';
  }
  if (error instanceof Error && error.message === 'tool timeout') return 'timed out';
  return 'failed';
}

/** Serialises a result and keeps it under the size limit by trimming the largest arrays. */
export function boundedJson(value: unknown, maxChars = MAX_TOOL_RESULT_CHARS): string {
  let text = JSON.stringify(value);
  if (text.length <= maxChars) return text;
  const copy = JSON.parse(text) as unknown;
  const arrays: unknown[][] = [];
  const collect = (node: unknown) => {
    if (Array.isArray(node)) {
      arrays.push(node);
      node.forEach(collect);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(collect);
    }
  };
  collect(copy);
  arrays.sort((a, b) => b.length - a.length);
  for (const array of arrays) {
    while (array.length > 1 && text.length > maxChars) {
      array.splice(Math.ceil(array.length / 2));
      text = JSON.stringify(copy);
    }
  }
  return text.length <= maxChars ? text : JSON.stringify({ truncated: true, preview: text.slice(0, maxChars - 40) });
}

/**
 * The only things the model can do. Every tool is read-only, takes validated arguments and
 * goes through existing services (never SQL or URLs built from model output).
 */
export class AiToolRegistry {
  private readonly tools = new Map<string, AiTool>();

  constructor(tools: AiTool[]) {
    for (const tool of tools) this.tools.set(tool.definition.name, tool);
  }

  definitions(): LlmToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, rawArguments: string): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return this.failure(name, 'unknown tool');

    let raw: unknown;
    try {
      raw = rawArguments.trim() === '' ? {} : JSON.parse(rawArguments);
    } catch {
      return this.failure(name, 'arguments must be a JSON object');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return this.failure(name, 'arguments must be a JSON object');

    const args = tool.parse(raw as ToolArgs);
    if (typeof args === 'string') return this.failure(name, args);

    try {
      const data = await withTimeout(tool.run(args), TOOL_TIMEOUT_MS);
      return { name, ok: true, content: boundedJson(data), data, label: tool.label(args) };
    } catch (error) {
      return this.failure(name, describeFailure(error));
    }
  }

  private failure(name: string, error: string): ToolResult {
    const data = { error };
    return { name, ok: false, content: JSON.stringify(data), data, label: null };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('tool timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
