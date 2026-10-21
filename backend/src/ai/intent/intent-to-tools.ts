import { LlmToolCall } from '../llm/llm.types';
import { guessEvent, guessFormat, guessGender, guessPlayerName, guessYear } from '../llm/mock-llm.provider';
import { AiIntentParameters, AiIntentResult } from './ai-intent.types';

function call(id: string, name: string, args: Record<string, unknown>): LlmToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

function mergePlayerArgs(question: string, params: AiIntentParameters): Record<string, unknown> {
  const name = params.playerName ?? guessPlayerName(question);
  if (!name) return {};
  const args: Record<string, unknown> = { name };
  const format = params.format ?? guessFormat(question);
  const event = params.event ?? guessEvent(question);
  const year = params.year ?? guessYear(question);
  const gender = params.gender ?? guessGender(question) ?? (event && /icc|men/i.test(question) ? 'male' : null);
  if (format) args.format = format;
  if (event) args.event = event;
  if (gender) args.gender = gender;
  if (year) args.year = year;
  return args;
}

function eventArgs(question: string, params: AiIntentParameters): Record<string, unknown> {
  const event = params.event ?? guessEvent(question);
  if (!event) return {};
  const args: Record<string, unknown> = { event };
  const year = params.year ?? guessYear(question);
  const format = params.format ?? guessFormat(question);
  const gender = params.gender ?? guessGender(question);
  if (year) args.year = year;
  if (format) args.format = format;
  if (gender) args.gender = gender;
  return args;
}

/**
 * Map a validated intent to existing tool calls.
 * matchId always comes from the app context — never from the model.
 */
export function intentToToolCalls(
  intent: AiIntentResult,
  question: string,
  matchId: string | null,
  available: Set<string>,
): LlmToolCall[] {
  if (intent.domain === 'other' || intent.intent === 'out_of_domain') return [];
  if (intent.intent === 'needs_match' || (intent.needsMatch && !matchId)) return [];

  const p = intent.parameters;
  const has = (name: string) => available.has(name);

  switch (intent.intent) {
    case 'calculate_required_rate': {
      if (!has('calculate_required_rate')) return [];
      if (p.runsNeeded != null && p.ballsRemaining != null) {
        return [call('intent_1', 'calculate_required_rate', { runsNeeded: p.runsNeeded, ballsRemaining: p.ballsRemaining })];
      }
      if (p.runsNeeded != null && p.oversRemaining != null) {
        return [call('intent_1', 'calculate_required_rate', { runsNeeded: p.runsNeeded, oversRemaining: p.oversRemaining })];
      }
      return [];
    }
    case 'required_run_rate':
      return matchId && has('get_match') ? [call('intent_1', 'get_match', { matchId })] : [];
    case 'win_probability':
      return matchId && has('get_win_probability') ? [call('intent_1', 'get_win_probability', { matchId })] : [];
    case 'toss_prediction':
      return matchId && has('get_toss_prediction') ? [call('intent_1', 'get_toss_prediction', { matchId })] : [];
    case 'next_wicket': {
      if (!matchId || !has('get_match')) return [];
      const calls = [call('intent_1', 'get_match', { matchId })];
      if (has('get_recent_commentary')) calls.push(call('intent_2', 'get_recent_commentary', { matchId, limit: 6 }));
      return calls;
    }
    case 'project_score':
      return matchId && has('project_score')
        ? [call('intent_1', 'project_score', { matchId })]
        : matchId && has('get_match')
          ? [call('intent_1', 'get_match', { matchId })]
          : [];
    case 'project_next_overs': {
      if (!matchId || !has('project_next_overs')) return [];
      return [call('intent_1', 'project_next_overs', { matchId, overs: p.overs ?? 6 })];
    }
    case 'match_summary':
      return matchId && has('get_match') ? [call('intent_1', 'get_match', { matchId })] : [];
    case 'scorecard': {
      if (!matchId || !has('get_match')) return [];
      const calls = [call('intent_1', 'get_match', { matchId })];
      if (has('get_scorecard')) calls.push(call('intent_2', 'get_scorecard', { matchId }));
      return calls;
    }
    case 'current_batters': {
      if (!matchId || !has('get_match')) return [];
      const calls = [call('intent_1', 'get_match', { matchId })];
      if (has('get_scorecard')) calls.push(call('intent_2', 'get_scorecard', { matchId }));
      return calls;
    }
    case 'commentary': {
      if (!matchId || !has('get_match')) return [];
      const calls = [call('intent_1', 'get_match', { matchId })];
      if (has('get_recent_commentary')) calls.push(call('intent_2', 'get_recent_commentary', { matchId, limit: 6 }));
      return calls;
    }
    case 'player_history': {
      if (!has('get_player_history')) return [];
      const args = mergePlayerArgs(question, p);
      if (!args.name) return [];
      return [call('intent_1', 'get_player_history', args)];
    }
    case 'event_results': {
      if (!has('get_event_results')) return [];
      const args = eventArgs(question, p);
      if (!args.event) return [];
      return [call('intent_1', 'get_event_results', args)];
    }
    case 'event_leaders': {
      if (!has('get_event_leaders')) return [];
      const args = eventArgs(question, p);
      if (!args.event) return [];
      args.kind = p.leaderKind ?? 'batting';
      return [call('intent_1', 'get_event_leaders', args)];
    }
    case 'event_standings': {
      if (!has('get_event_standings')) return [];
      const args = eventArgs(question, p);
      if (!args.event) return [];
      return [call('intent_1', 'get_event_standings', args)];
    }
    case 'head_to_head': {
      if (!has('get_head_to_head')) return [];
      if (p.team1 && p.team2) return [call('intent_1', 'get_head_to_head', { team1: p.team1, team2: p.team2 })];
      if (matchId) return [call('intent_1', 'get_head_to_head', { matchId })];
      return [];
    }
    case 'venue_history':
      return matchId && has('get_venue_history') ? [call('intent_1', 'get_venue_history', { matchId })] : [];
    case 'live_matches':
      return has('get_live_matches') ? [call('intent_1', 'get_live_matches', {})] : [];
    default:
      return [];
  }
}
