import { describe, expect, it, vi } from 'vitest';
import type { AiIntentClassifier } from './ai-intent-classifier';
import { resolveAskPlan, shouldPreferIntentClassifier } from './resolve-ask-plan';

const available = new Set([
  'calculate_required_rate',
  'get_match',
  'get_recent_commentary',
  'get_win_probability',
  'get_toss_prediction',
  'get_player_history',
  'get_head_to_head',
  'project_next_overs',
  'project_score',
]);

const signal = () => AbortSignal.timeout(5000);

function mockClassifier(impl: AiIntentClassifier['classify']): AiIntentClassifier {
  return {
    enabled: true,
    classify: impl,
  } as unknown as AiIntentClassifier;
}

describe('shouldPreferIntentClassifier', () => {
  it('skips classifier for exact arithmetic text', () => {
    expect(shouldPreferIntentClassifier('We need 100 runs in 6 overs')).toBe(false);
  });

  it('skips classifier for clear live patterns; still prefers it for vague short asks', () => {
    expect(shouldPreferIntentClassifier('Can they chase this?')).toBe(false);
    expect(shouldPreferIntentClassifier('Ab kitne run per over chahiye?')).toBe(false);
    expect(shouldPreferIntentClassifier('explain this please')).toBe(true);
  });
});

describe('resolveAskPlan', () => {
  it('keeps exact arithmetic deterministic without calling the classifier', async () => {
    const classify = vi.fn();
    const plan = await resolveAskPlan({
      question: 'We need 100 runs in 6 overs, what rate?',
      language: 'en',
      matchId: '1',
      available,
      signal: signal(),
      classifier: mockClassifier(classify),
    });
    expect(plan.source).toBe('arithmetic');
    expect(plan.calls[0]?.name).toBe('calculate_required_rate');
    expect(classify).not.toHaveBeenCalled();
  });

  it('keeps projected-score asks on live tools even if classifier returns player_history', async () => {
    const plan = await resolveAskPlan({
      question: 'What is the projected score for BAN?',
      language: 'en',
      matchId: '15292',
      available,
      signal: signal(),
      classifier: mockClassifier(async () => ({
        ok: true,
        latencyMs: 10,
        result: {
          domain: 'cricket',
          intent: 'player_history',
          parameters: { playerName: 'Might BAN Reach' },
          needsMatch: false,
          confidence: 0.9,
        },
      })),
    });
    expect(plan.calls[0]?.name).toBe('project_score');
    expect(plan.source).toBe('deterministic');
  });

  it('routes chase questions to live win_probability without waiting on the classifier', async () => {
    const classify = vi.fn();
    const plan = await resolveAskPlan({
      question: 'Can they chase this?',
      language: 'en',
      matchId: '14193',
      available,
      signal: signal(),
      classifier: mockClassifier(classify),
    });
    expect(plan.source).toBe('deterministic');
    expect(plan.calls[0]?.name).toBe('get_win_probability');
    expect(classify).not.toHaveBeenCalled();
  });

  it('maps Hinglish required rate via classifier', async () => {
    const plan = await resolveAskPlan({
      question: 'Ab kitne run per over chahiye?',
      language: 'hi',
      matchId: '14193',
      available,
      signal: signal(),
      classifier: mockClassifier(async () => ({
        ok: true,
        latencyMs: 20,
        result: {
          domain: 'cricket',
          intent: 'required_run_rate',
          parameters: {},
          needsMatch: true,
          confidence: 0.88,
        },
      })),
    });
    expect(plan.calls[0]?.name).toBe('get_match');
  });

  it('maps next-wicket intent', async () => {
    const plan = await resolveAskPlan({
      question: 'Agla wicket kab gir sakta hai?',
      language: 'hi',
      matchId: '9',
      available,
      signal: signal(),
      classifier: mockClassifier(async () => ({
        ok: true,
        latencyMs: 15,
        result: {
          domain: 'cricket',
          intent: 'next_wicket',
          parameters: {},
          needsMatch: true,
          confidence: 0.92,
        },
      })),
    });
    expect(plan.calls.map((c) => c.name)).toEqual(['get_match', 'get_recent_commentary']);
  });

  it('maps historical player stats', async () => {
    const plan = await resolveAskPlan({
      question: 'What did this player score in the last World Cup?',
      language: 'en',
      matchId: null,
      available,
      signal: signal(),
      classifier: mockClassifier(async () => ({
        ok: true,
        latencyMs: 30,
        result: {
          domain: 'cricket',
          intent: 'player_history',
          parameters: { playerName: 'Virat Kohli', event: 'World Cup', format: 'ODI' },
          needsMatch: false,
          confidence: 0.85,
        },
      })),
    });
    expect(plan.calls[0]?.name).toBe('get_player_history');
  });

  it('maps head-to-head', async () => {
    const plan = await resolveAskPlan({
      question: 'Show the head-to-head record.',
      language: 'en',
      matchId: '12',
      available,
      signal: signal(),
      classifier: mockClassifier(async () => ({
        ok: true,
        latencyMs: 18,
        result: {
          domain: 'cricket',
          intent: 'head_to_head',
          parameters: {},
          needsMatch: true,
          confidence: 0.8,
        },
      })),
    });
    expect(plan.calls[0]?.name).toBe('get_head_to_head');
  });

  it('refuses out-of-domain questions', async () => {
    const plan = await resolveAskPlan({
      question: 'What is the weather in Delhi?',
      language: 'en',
      matchId: null,
      available,
      signal: signal(),
      classifier: mockClassifier(async () => ({
        ok: true,
        latencyMs: 10,
        result: {
          domain: 'other',
          intent: 'out_of_domain',
          parameters: {},
          needsMatch: false,
          confidence: 0.99,
        },
      })),
    });
    expect(plan.refuse).toBe('out_of_domain');
    expect(plan.calls).toEqual([]);
  });

  it('refuses live intents when matchId is missing', async () => {
    const plan = await resolveAskPlan({
      question: 'What is the target?',
      language: 'en',
      matchId: null,
      available,
      signal: signal(),
      classifier: mockClassifier(async () => ({
        ok: true,
        latencyMs: 11,
        result: {
          domain: 'cricket',
          intent: 'project_score',
          parameters: {},
          needsMatch: true,
          confidence: 0.9,
        },
      })),
    });
    expect(plan.refuse).toBe('needs_match');
  });

  it('falls back to deterministic plan when classifier times out', async () => {
    const plan = await resolveAskPlan({
      question: 'who will win',
      language: 'en',
      matchId: '14193',
      available,
      signal: signal(),
      classifier: mockClassifier(async () => ({ ok: false, reason: 'timeout', latencyMs: 5000 })),
    });
    // "who will win" is strong deterministic WIN_PROB when matchId present — may prefer classifier
    // but on failure falls through; if preferClassifier was true and deterministic still has plan:
    expect(plan.calls[0]?.name).toBe('get_win_probability');
    expect(plan.source).toBe('deterministic');
  });

  it('falls back when classifier returns malformed outcome', async () => {
    const plan = await resolveAskPlan({
      question: 'match kon jit sakata',
      language: 'en',
      matchId: '14193',
      available,
      signal: signal(),
      classifier: mockClassifier(async () => ({ ok: false, reason: 'invalid_json', latencyMs: 40 })),
    });
    expect(plan.calls[0]?.name).toBe('get_win_probability');
  });

  it('works without a classifier (mock-only rollback)', async () => {
    const plan = await resolveAskPlan({
      question: 'next wicket kb hogi',
      language: 'en',
      matchId: '7',
      available,
      signal: signal(),
      classifier: null,
    });
    expect(plan.source).toBe('deterministic');
    expect(plan.calls[0]?.name).toBe('get_match');
  });
});
