import { estimateTokens, LlmChatRequest, LlmChatResponse, LlmMessage, LlmProvider, LlmProviderError, LlmToolCall } from './llm.types';

export type LlmFetch = (input: string, init: RequestInit) => Promise<Response>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Accepts only an operator-configured base URL: https (or http to a local host such as
 * Ollama), no credentials, no query or fragment. Returns null when the URL is unacceptable.
 */
export function validateLlmBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return url.toString().replace(/\/+$/, '');
}

interface OpenAiChoiceMessage {
  content?: string | null;
  tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
}

function toOpenAiMessage(message: LlmMessage): Record<string, unknown> {
  switch (message.role) {
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content ?? '',
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    default:
      return { role: message.role, content: message.content };
  }
}

/** Any server that implements POST {base}/chat/completions with OpenAI-style tool calls. */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible' as const;
  readonly mocked = false;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
    private readonly fetchFn: LlmFetch,
  ) {}

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([request.signal, timeout]);
    const body = {
      model: this.model,
      messages: request.messages.map(toOpenAiMessage),
      max_tokens: request.maxOutputTokens,
      temperature: 0.2,
      ...(request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              type: 'function',
              function: { name: tool.name, description: tool.description, parameters: tool.parameters },
            })),
            tool_choice: 'auto',
          }
        : {}),
    };

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
        redirect: 'error',
      });
    } catch {
      throw new LlmProviderError(timeout.aborted || request.signal.aborted ? 'timeout' : 'network');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new LlmProviderError('http', response.status);
    }

    let json: {
      choices?: Array<{ message?: OpenAiChoiceMessage }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      json = (await response.json()) as typeof json;
    } catch {
      throw new LlmProviderError(timeout.aborted ? 'timeout' : 'invalid_response');
    }
    const message = json.choices?.[0]?.message;
    if (!message) throw new LlmProviderError('invalid_response');

    const toolCalls: LlmToolCall[] = (message.tool_calls ?? [])
      .filter((call) => call.function?.name)
      .map((call, index) => ({
        id: call.id || `call_${index}`,
        name: String(call.function!.name),
        arguments: typeof call.function!.arguments === 'string' ? call.function!.arguments : '{}',
      }));
    const content = typeof message.content === 'string' ? message.content : null;
    const promptText = JSON.stringify(body.messages);
    return {
      content,
      toolCalls,
      usage: {
        promptTokens: Number(json.usage?.prompt_tokens) || estimateTokens(promptText),
        completionTokens: Number(json.usage?.completion_tokens) || estimateTokens(content ?? JSON.stringify(toolCalls)),
      },
    };
  }
}
