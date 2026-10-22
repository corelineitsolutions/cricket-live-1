/**
 * Allowlisted Ask intents for the local Qwen classifier.
 * Mapped to existing tools only — never execute free-form tool names from the model.
 */
export const AI_INTENTS = [
  'required_run_rate',
  'calculate_required_rate',
  'win_probability',
  'toss_prediction',
  'next_wicket',
  'project_score',
  'project_next_overs',
  'first_overs_score',
  'match_summary',
  'scorecard',
  'current_batters',
  'commentary',
  'player_history',
  'event_results',
  'event_leaders',
  'event_standings',
  'head_to_head',
  'venue_history',
  'live_matches',
  'out_of_domain',
  'needs_match',
] as const;

export type AiIntentName = (typeof AI_INTENTS)[number];

export const AI_INTENT_SET = new Set<string>(AI_INTENTS);

export const EVENT_LEADER_KINDS = ['batting', 'bowling', 'runs_conceded', 'sixes', 'fours', 'hundreds'] as const;
export type EventLeaderKind = (typeof EVENT_LEADER_KINDS)[number];

/** Parameters the classifier may suggest. All are re-validated before tools run. */
export interface AiIntentParameters {
  overs?: number;
  playerName?: string;
  event?: string;
  year?: number;
  format?: 'T20' | 'ODI' | 'Test';
  gender?: 'male' | 'female';
  leaderKind?: EventLeaderKind;
  team1?: string;
  team2?: string;
  runsNeeded?: number;
  oversRemaining?: number;
  ballsRemaining?: number;
}

export interface AiIntentResult {
  domain: 'cricket' | 'other';
  intent: AiIntentName;
  parameters: AiIntentParameters;
  needsMatch: boolean;
  confidence: number;
}

export type AiIntentClassifyOutcome =
  | { ok: true; result: AiIntentResult; latencyMs: number }
  | { ok: false; reason: 'disabled' | 'unavailable' | 'timeout' | 'invalid_json' | 'invalid_intent' | 'busy'; latencyMs: number };
