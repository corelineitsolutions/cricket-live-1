import { describe, expect, it, vi } from 'vitest';
import { AppConfigService } from '../../config/app-config.service';
import { AiIntentClassifier } from './ai-intent-classifier';

function config(overrides: Partial<Record<string, unknown>> = {}): AppConfigService {
  const values: Record<string, unknown> = {
    AI_INTENT_CLASSIFIER: 'local',
    AI_LOCAL_MODEL_URL: 'http://127.0.0.1:8081',
    AI_LOCAL_MODEL_NAME: 'qwen',
    AI_LOCAL_MODEL_TIMEOUT_MS: 2000,
    AI_INTENT_MIN_CONFIDENCE: 0.45,
    AI_INTENT_MAX_OUTPUT_TOKENS: 120,
    AI_INTENT_MAX_CONCURRENT: 2,
    ...overrides,
  };
  return {
    aiIntentClassifierEnabled: values.AI_INTENT_CLASSIFIER === 'local',
    aiLocalModelUrl: String(values.AI_LOCAL_MODEL_URL ?? ''),
    aiLocalModelName: String(values.AI_LOCAL_MODEL_NAME ?? ''),
    aiLocalModelTimeoutMs: Number(values.AI_LOCAL_MODEL_TIMEOUT_MS),
    aiIntentMinConfidence: Number(values.AI_INTENT_MIN_CONFIDENCE),
    aiIntentMaxOutputTokens: Number(values.AI_INTENT_MAX_OUTPUT_TOKENS),
    aiIntentMaxConcurrent: Number(values.AI_INTENT_MAX_CONCURRENT),
  } as unknown as AppConfigService;
}

describe('AiIntentClassifier', () => {
  it('is disabled when AI_INTENT_CLASSIFIER is off', async () => {
    const classifier = new AiIntentClassifier(config({ AI_INTENT_CLASSIFIER: 'off' }), null);
    const result = await classifier.classify({
      question: 'who wins',
      language: 'en',
      matchId: '1',
      signal: AbortSignal.timeout(1000),
    });
    expect(result).toMatchObject({ ok: false, reason: 'disabled' });
  });

  it('parses a successful local model response', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  domain: 'cricket',
                  intent: 'required_run_rate',
                  parameters: {},
                  needs_match: true,
                  confidence: 0.91,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const classifier = new AiIntentClassifier(config(), fetchFn);
    const result = await classifier.classify({
      question: "What's the required run rate?",
      language: 'en',
      matchId: '14193',
      signal: AbortSignal.timeout(2000),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.intent).toBe('required_run_rate');
    expect(fetchFn).toHaveBeenCalled();
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(String(init.body)).not.toContain('14193');
  });

  it('returns unavailable on HTTP failure without throwing', async () => {
    const fetchFn = vi.fn(async () => new Response('down', { status: 503 }));
    const classifier = new AiIntentClassifier(config(), fetchFn);
    const result = await classifier.classify({
      question: 'who wins',
      language: 'en',
      matchId: null,
      signal: AbortSignal.timeout(1000),
    });
    expect(result).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('returns invalid_json for malformed model content', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'not-json-at-all' } }] }), { status: 200 }),
    );
    const classifier = new AiIntentClassifier(config(), fetchFn);
    const result = await classifier.classify({
      question: 'hi',
      language: 'en',
      matchId: null,
      signal: AbortSignal.timeout(1000),
    });
    expect(result).toMatchObject({ ok: false, reason: 'invalid_intent' });
  });

  it('returns timeout when the fetch aborts', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
      return new Response('{}');
    });
    const classifier = new AiIntentClassifier(config({ AI_LOCAL_MODEL_TIMEOUT_MS: 50 }), fetchFn);
    const result = await classifier.classify({
      question: 'who wins',
      language: 'en',
      matchId: null,
      signal: AbortSignal.timeout(5000),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['timeout', 'unavailable']).toContain(result.reason);
  });
});
