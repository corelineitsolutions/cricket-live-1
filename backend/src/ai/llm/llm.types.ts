export type AiLanguage = 'en' | 'hi';

export interface LlmToolCall {
  id: string;
  name: string;
  /** Raw JSON text produced by the model; validated by the tool registry before use. */
  arguments: string;
}

export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface LlmToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface LlmChatRequest {
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmChatResponse {
  content: string | null;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
}

export interface LlmProvider {
  readonly name: 'mock' | 'openai-compatible';
  readonly model: string;
  /** True when answers are generated without a language model. */
  readonly mocked: boolean;
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
}

/** Provider failure without any request or response content (safe to log). */
export class LlmProviderError extends Error {
  constructor(
    readonly kind: 'timeout' | 'http' | 'invalid_response' | 'network',
    readonly status: number | null = null,
  ) {
    super(`llm ${kind}${status ? ` ${status}` : ''}`);
    this.name = 'LlmProviderError';
  }
}

/** Rough token estimate (about four characters per token) for providers that report no usage. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
