import { LlmToolCall } from '../llm/llm.types';
import { planAskTools } from '../llm/mock-llm.provider';
import { AiIntentClassifier } from './ai-intent-classifier';
import { intentToToolCalls } from './intent-to-tools';

export type AskPlanSource = 'arithmetic' | 'deterministic' | 'classifier' | 'none';

export interface AskPlanResult {
  calls: LlmToolCall[];
  source: AskPlanSource;
  /** User-facing refusal without tools (out of domain / needs match). */
  refuse?: 'out_of_domain' | 'needs_match';
  classifierLatencyMs?: number;
}

/** Strong patterns that are safe without the local classifier (latency). */
export function shouldPreferIntentClassifier(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  // Exact "N runs in M overs" arithmetic is handled separately.
  if (/\d{1,4}\s*(?:runs?|रन).{0,24}\d{1,3}(?:\.\d)?\s*(?:overs?|balls?|ओवर|गेंद)/i.test(q)) return false;
  if (/\d{1,3}(?:\.\d)?\s*(?:overs?|balls?|ओवर|गेंद).{0,24}\d{1,4}\s*(?:runs?|रन)/i.test(q)) return false;

  // Conversational / ambiguous → classifier when enabled.
  if (
    /can they|chase this|what about|explain|simple hindi|likely to win|gir sakta|gir sakti|chahiye|kitne run|ab kitne|last five|last 5|pehle|agle|agli|sakta hai|sakte hai/i.test(
      q,
    )
  ) {
    return true;
  }
  // Very short queries are often ambiguous Hinglish.
  if (q.split(/\s+/).filter(Boolean).length <= 5) return true;
  // Soft / vague live asks without strong keywords.
  if (/^(what|how|who|when|kya|kaise|kab|kon|kaun)\b/i.test(q) && !/world\s*cup|\bipl\b|hundred|career|rrr|required/i.test(q)) {
    return true;
  }
  return false;
}

function isExactArithmeticPlan(calls: LlmToolCall[]): boolean {
  return calls.length === 1 && calls[0]?.name === 'calculate_required_rate';
}

/**
 * Resolve tool plan: exact arithmetic → (optional) local intent classifier → deterministic planner.
 * Classifier never invents facts; tools still fetch live/archive data.
 */
export async function resolveAskPlan(input: {
  question: string;
  language: 'en' | 'hi';
  matchId: string | null;
  available: Set<string>;
  signal: AbortSignal;
  classifier: AiIntentClassifier | null;
}): Promise<AskPlanResult> {
  const { question, matchId, available } = input;

  const deterministic = planAskTools(question, matchId, available, { strict: true });
  if (isExactArithmeticPlan(deterministic)) {
    return { calls: deterministic, source: 'arithmetic' };
  }

  const classifier = input.classifier;
  const preferClassifier = classifier?.enabled === true && shouldPreferIntentClassifier(question);
  const tryClassifier = classifier?.enabled === true && (preferClassifier || deterministic.length === 0);

  if (tryClassifier && classifier) {
    const classified = await classifier.classify({
      question,
      language: input.language,
      matchId,
      signal: input.signal,
    });
    if (classified.ok) {
      const { result } = classified;
      if (result.domain === 'other' || result.intent === 'out_of_domain') {
        return { calls: [], source: 'classifier', refuse: 'out_of_domain', classifierLatencyMs: classified.latencyMs };
      }
      if (result.intent === 'needs_match' || (result.needsMatch && !matchId)) {
        // Fall back to deterministic if it somehow has tools; else refuse.
        if (deterministic.length > 0) {
          return { calls: deterministic, source: 'deterministic', classifierLatencyMs: classified.latencyMs };
        }
        return { calls: [], source: 'classifier', refuse: 'needs_match', classifierLatencyMs: classified.latencyMs };
      }
      const mapped = intentToToolCalls(result, question, matchId, available);
      if (mapped.length > 0) {
        return { calls: mapped, source: 'classifier', classifierLatencyMs: classified.latencyMs };
      }
      // Valid intent but could not map (missing tool / params) → deterministic fallback.
      if (deterministic.length > 0) {
        return { calls: deterministic, source: 'deterministic', classifierLatencyMs: classified.latencyMs };
      }
      return { calls: [], source: 'classifier', classifierLatencyMs: classified.latencyMs };
    }
    // Classifier failed: continue with deterministic plan.
  }

  if (deterministic.length > 0) {
    return { calls: deterministic, source: 'deterministic' };
  }
  return { calls: [], source: 'none' };
}
