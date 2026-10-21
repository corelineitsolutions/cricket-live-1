import { describe, expect, it } from 'vitest';
import { extractJsonObject, parseIntentPayload } from './parse-intent-json';

describe('parseIntentPayload', () => {
  it('parses a clean required_run_rate intent', () => {
    const result = parseIntentPayload(
      JSON.stringify({
        domain: 'cricket',
        intent: 'required_run_rate',
        parameters: {},
        needs_match: true,
        confidence: 0.95,
      }),
    );
    expect(result).toMatchObject({
      domain: 'cricket',
      intent: 'required_run_rate',
      needsMatch: true,
      confidence: 0.95,
    });
  });

  it('strips thinking blocks and markdown fences', () => {
    const raw = `<think>long reasoning</think>\n\`\`\`json\n{"domain":"cricket","intent":"win_probability","parameters":{},"needs_match":true,"confidence":0.8}\n\`\`\``;
    expect(parseIntentPayload(raw)?.intent).toBe('win_probability');
  });

  it('rejects unsupported or malicious intents', () => {
    expect(parseIntentPayload('{"domain":"cricket","intent":"rm_rf","confidence":1}')).toBeNull();
    expect(parseIntentPayload('{"domain":"cricket","intent":"get_match","confidence":1}')).toBeNull();
    expect(parseIntentPayload('not json')).toBeNull();
  });

  it('ignores model-supplied matchId and personId', () => {
    const result = parseIntentPayload(
      JSON.stringify({
        domain: 'cricket',
        intent: 'player_history',
        parameters: { playerName: 'Virat Kohli', matchId: '99999', personId: 'deadbeef' },
        confidence: 0.9,
      }),
    );
    expect(result?.parameters).toEqual({ playerName: 'Virat Kohli' });
  });

  it('marks out_of_domain', () => {
    const result = parseIntentPayload(
      '{"domain":"other","intent":"out_of_domain","parameters":{},"needs_match":false,"confidence":0.99}',
    );
    expect(result?.domain).toBe('other');
    expect(result?.intent).toBe('out_of_domain');
  });
});

describe('extractJsonObject', () => {
  it('returns null when no object is present', () => {
    expect(extractJsonObject('hello')).toBeNull();
  });
});
