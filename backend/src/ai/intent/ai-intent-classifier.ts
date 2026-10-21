import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { logEvent } from '../../common/utils/structured-log';
import { AppConfigService } from '../../config/app-config.service';
import { LLM_FETCH } from '../ai.constants';
import { LlmFetch, validateLlmBaseUrl } from '../llm/openai-compatible.provider';
import { AI_INTENTS, AiIntentClassifyOutcome } from './ai-intent.types';
import { parseIntentPayload } from './parse-intent-json';

const CLASSIFIER_SYSTEM = `You classify cricket Ask questions for a live score app. Reply with ONLY one JSON object, no markdown, no thinking.
Schema:
{"domain":"cricket"|"other","intent":"<name>","parameters":{},"needs_match":true|false,"confidence":0.0-1.0}
Allowed intent values: ${AI_INTENTS.join(', ')}.
Rules:
- domain=other and intent=out_of_domain for non-cricket topics.
- needs_match=true when the question is about the current/selected match (RRR, chase, win chance, target, next overs, commentary, scorecard).
- Do NOT invent match ids, player ids, scores, or statistics.
- parameters may include only: playerName, event, year, format (T20|ODI|Test), gender (male|female), leaderKind, team1, team2, overs (1-20), runsNeeded, oversRemaining, ballsRemaining.
- Use intent=needs_match when cricket live context is required but no match is selected.
- English, Hindi, and Hinglish are all cricket if about a match or cricket stats.`;

@Injectable()
export class AiIntentClassifier {
  private readonly logger = new Logger(AiIntentClassifier.name);
  private inFlight = 0;

  constructor(
    private readonly config: AppConfigService,
    @Optional() @Inject(LLM_FETCH) private readonly fetchFn: LlmFetch | null,
  ) {}

  get enabled(): boolean {
    return this.config.aiIntentClassifierEnabled && !!this.baseUrl;
  }

  private get baseUrl(): string | null {
    return validateLlmBaseUrl(this.config.aiLocalModelUrl);
  }

  private get fetchImpl(): LlmFetch {
    return this.fetchFn ?? ((input, init) => fetch(input, init));
  }

  /**
   * Classify question intent via local llama.cpp / OpenAI-compatible chat.
   * Never throws; failures return ok:false for deterministic fallback.
   */
  async classify(input: {
    question: string;
    language: 'en' | 'hi';
    matchId: string | null;
    signal: AbortSignal;
  }): Promise<AiIntentClassifyOutcome> {
    const started = Date.now();
    if (!this.enabled) return { ok: false, reason: 'disabled', latencyMs: 0 };

    const maxConcurrent = this.config.aiIntentMaxConcurrent;
    if (this.inFlight >= maxConcurrent) {
      logEvent(this.logger, 'warn', 'ai-intent-busy', { inFlight: this.inFlight });
      return { ok: false, reason: 'busy', latencyMs: Date.now() - started };
    }

    this.inFlight++;
    try {
      const base = this.baseUrl!;
      const timeoutMs = this.config.aiLocalModelTimeoutMs;
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = AbortSignal.any([input.signal, timeout]);
      const user = [
        `language=${input.language}`,
        `match_selected=${input.matchId ? 'yes' : 'no'}`,
        // Never send the numeric match id to the classifier — it must not invent ids.
        `question=${input.question.slice(0, 500)}`,
      ].join('\n');

      const body = {
        model: this.config.aiLocalModelName || 'qwen',
        temperature: 0,
        max_tokens: this.config.aiIntentMaxOutputTokens,
        messages: [
          { role: 'system', content: CLASSIFIER_SYSTEM },
          { role: 'user', content: user },
        ],
        // Qwen3 / llama.cpp: disable lengthy thinking when supported.
        chat_template_kwargs: { enable_thinking: false },
        reasoning_format: 'none',
      };

      let response: Response;
      try {
        response = await this.fetchImpl(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
          redirect: 'error',
        });
      } catch {
        const reason = timeout.aborted || input.signal.aborted ? 'timeout' : 'unavailable';
        logEvent(this.logger, 'warn', 'ai-intent-classify-failed', { reason });
        return { ok: false, reason, latencyMs: Date.now() - started };
      }

      if (!response.ok) {
        logEvent(this.logger, 'warn', 'ai-intent-classify-failed', { reason: 'unavailable', status: response.status });
        return { ok: false, reason: 'unavailable', latencyMs: Date.now() - started };
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { ok: false, reason: 'invalid_json', latencyMs: Date.now() - started };
      }

      const content = extractAssistantContent(payload);
      if (!content) return { ok: false, reason: 'invalid_json', latencyMs: Date.now() - started };

      const parsed = parseIntentPayload(content);
      if (!parsed) return { ok: false, reason: 'invalid_intent', latencyMs: Date.now() - started };

      const min = this.config.aiIntentMinConfidence;
      if (parsed.intent !== 'out_of_domain' && parsed.confidence < min) {
        return { ok: false, reason: 'invalid_intent', latencyMs: Date.now() - started };
      }

      return { ok: true, result: parsed, latencyMs: Date.now() - started };
    } finally {
      this.inFlight--;
    }
  }
}

function extractAssistantContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } })?.message;
  if (!message) return null;
  if (typeof message.content === 'string') return message.content;
  // Some servers return content as array of parts.
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  return null;
}
