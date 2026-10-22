import { describe, expect, it } from 'vitest';
import { AiIntentResult } from './ai-intent.types';
import { intentToToolCalls } from './intent-to-tools';

const ALL = new Set([
  'calculate_required_rate',
  'get_match',
  'get_scorecard',
  'get_recent_commentary',
  'get_win_probability',
  'get_toss_prediction',
  'project_score',
  'project_next_overs',
  'get_first_overs_score',
  'get_player_history',
  'get_event_results',
  'get_event_leaders',
  'get_head_to_head',
  'get_live_matches',
]);

const base = (intent: AiIntentResult['intent'], extra: Partial<AiIntentResult> = {}): AiIntentResult => ({
  domain: 'cricket',
  intent,
  parameters: {},
  needsMatch: false,
  confidence: 0.9,
  ...extra,
});

describe('intentToToolCalls', () => {
  it('maps required run rate to get_match with app matchId', () => {
    const calls = intentToToolCalls(base('required_run_rate', { needsMatch: true }), 'rrr?', '14193', ALL);
    expect(calls[0]).toMatchObject({ name: 'get_match' });
    expect(JSON.parse(calls[0].arguments)).toEqual({ matchId: '14193' });
  });

  it('refuses to invent match tools without matchId', () => {
    expect(intentToToolCalls(base('win_probability', { needsMatch: true }), 'who wins', null, ALL)).toEqual([]);
  });

  it('maps next_wicket to live match + commentary', () => {
    const names = intentToToolCalls(base('next_wicket'), 'agla wicket', '1', ALL).map((c) => c.name);
    expect(names).toEqual(['get_match', 'get_recent_commentary']);
  });

  it('maps player_history using classifier playerName', () => {
    const calls = intentToToolCalls(
      base('player_history', { parameters: { playerName: 'Rohit Sharma', event: 'World Cup', year: 2023, format: 'ODI' } }),
      'what did this player score in the last World Cup?',
      null,
      ALL,
    );
    expect(calls[0]?.name).toBe('get_player_history');
    expect(JSON.parse(calls[0].arguments)).toMatchObject({
      name: 'Rohit Sharma',
      event: 'World Cup',
      year: 2023,
      format: 'ODI',
    });
  });

  it('maps head_to_head from teams or matchId', () => {
    expect(
      intentToToolCalls(base('head_to_head', { parameters: { team1: 'India', team2: 'Australia' } }), 'h2h', null, ALL)[0]
        ?.name,
    ).toBe('get_head_to_head');
    expect(intentToToolCalls(base('head_to_head'), 'h2h', '55', ALL)[0]?.name).toBe('get_head_to_head');
  });

  it('maps calculate_required_rate only with validated numbers', () => {
    expect(intentToToolCalls(base('calculate_required_rate'), 'rate?', null, ALL)).toEqual([]);
    const calls = intentToToolCalls(
      base('calculate_required_rate', { parameters: { runsNeeded: 100, oversRemaining: 6 } }),
      '100 in 6',
      null,
      ALL,
    );
    expect(JSON.parse(calls[0].arguments)).toEqual({ runsNeeded: 100, oversRemaining: 6 });
  });

  it('returns no tools for out_of_domain', () => {
    expect(intentToToolCalls(base('out_of_domain', { domain: 'other' }), 'weather?', null, ALL)).toEqual([]);
  });

  it('treats project_score + overs as project_next_overs', () => {
    const calls = intentToToolCalls(
      base('project_score', { parameters: { overs: 5 }, needsMatch: true }),
      'runs in next five overs',
      '14193',
      ALL,
    );
    expect(calls[0]?.name).toBe('project_next_overs');
    expect(JSON.parse(calls[0].arguments)).toEqual({ matchId: '14193', overs: 5 });
  });
});
