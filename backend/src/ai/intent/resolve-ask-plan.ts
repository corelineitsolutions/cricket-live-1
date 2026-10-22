import { LlmToolCall } from '../llm/llm.types';
import { isLiveMatchQuestion, planAskTools } from '../llm/mock-llm.provider';
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

const LIVE_TOOL_NAMES = new Set([
  'calculate_required_rate',
  'get_match',
  'get_scorecard',
  'get_recent_commentary',
  'project_score',
  'project_next_overs',
  'get_first_overs_score',
  'get_win_probability',
  'get_toss_prediction',
]);

const ARCHIVE_TOOL_NAMES = new Set([
  'get_player_history',
  'get_event_results',
  'get_event_leaders',
  'get_event_standings',
  'get_event_team_matches',
  'get_event_extremes',
  'get_event_awards',
  'get_event_phase_stats',
  'get_head_to_head',
  'get_venue_history',
  'get_team_phase_stats',
]);

/** Strong patterns that are safe without the local classifier (latency). */
export function shouldPreferIntentClassifier(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  // Exact "N runs in M overs" arithmetic is handled separately.
  if (/\d{1,4}\s*(?:runs?|रन).{0,24}\d{1,3}(?:\.\d)?\s*(?:overs?|balls?|ओवर|गेंद)/i.test(q)) return false;
  if (/\d{1,3}(?:\.\d)?\s*(?:overs?|balls?|ओवर|गेंद).{0,24}\d{1,4}\s*(?:runs?|रन)/i.test(q)) return false;
  // Clear live projection / target / next-overs with a match open — skip classifier.
  if (isLiveMatchQuestion(q)) return false;

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

function isLiveOnlyPlan(calls: LlmToolCall[]): boolean {
  return calls.length > 0 && calls.every((c) => LIVE_TOOL_NAMES.has(c.name));
}

function isArchivePlan(calls: LlmToolCall[]): boolean {
  return calls.some((c) => ARCHIVE_TOOL_NAMES.has(c.name));
}

/**
 * Resolve tool plan: exact arithmetic → live deterministic (when match open) →
 * optional local intent classifier → deterministic planner.
 * Live target / projected score / next overs never use Cricsheet when matchId is set.
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

  // With a match open, live projection/target/RRR/win/toss win over the classifier
  // so Qwen cannot route "projected score for BAN" into player_history.
  if (matchId && isLiveMatchQuestion(question) && isLiveOnlyPlan(deterministic)) {
    return { calls: deterministic, source: 'deterministic' };
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
        if (deterministic.length > 0) {
          return { calls: deterministic, source: 'deterministic', classifierLatencyMs: classified.latencyMs };
        }
        return { calls: [], source: 'classifier', refuse: 'needs_match', classifierLatencyMs: classified.latencyMs };
      }
      let mapped = intentToToolCalls(result, question, matchId, available);
      // Never let the classifier pick archive tools for live match questions.
      if (matchId && isLiveMatchQuestion(question) && isArchivePlan(mapped)) {
        mapped = isLiveOnlyPlan(deterministic) ? deterministic : [];
      }
      if (mapped.length > 0) {
        return {
          calls: mapped,
          source: mapped === deterministic ? 'deterministic' : 'classifier',
          classifierLatencyMs: classified.latencyMs,
        };
      }
      if (deterministic.length > 0) {
        return { calls: deterministic, source: 'deterministic', classifierLatencyMs: classified.latencyMs };
      }
      return { calls: [], source: 'classifier', classifierLatencyMs: classified.latencyMs };
    }
  }

  if (deterministic.length > 0) {
    return { calls: deterministic, source: 'deterministic' };
  }
  return { calls: [], source: 'none' };
}
