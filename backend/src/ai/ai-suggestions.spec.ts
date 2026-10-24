import type { MatchDto } from '../matches/dto/match.dto';
import {
  classifyFormat,
  completedWholeOvers,
  generalSuggestions,
  matchSuggestions,
  nextFirstOversTarget,
} from './ai-suggestions';

function baseMatch(over: Partial<MatchDto> = {}): MatchDto {
  return {
    matchId: 14193,
    source: 'live',
    league: null,
    season: null,
    matchType: 'ODI',
    round: null,
    status: 'LIVE',
    statusDetail: 'Live',
    isLive: true,
    isFinished: false,
    note: null,
    startTime: null,
    venue: null,
    localTeam: { sportmonksId: 1, name: 'Canada', shortName: 'CAN', imageUrl: null },
    visitorTeam: { sportmonksId: 2, name: 'Nepal', shortName: 'NEP', imageUrl: null },
    winnerTeamSportmonksId: null,
    innings: [{ inning: 1, teamSportmonksId: 1, score: 232, wickets: 5, overs: 46.3 }],
    currentInning: 1,
    battingTeamSportmonksId: 1,
    score: 232,
    wickets: 5,
    overs: 46.3,
    runRate: 5.0,
    target: null,
    runsRequired: null,
    ballsRemaining: null,
    requiredRunRate: null,
    batsmen: [],
    bowler: null,
    lastUpdatedAt: new Date().toISOString(),
    stale: false,
    ...over,
  } as MatchDto;
}

describe('ai-suggestions', () => {
  it('classifies formats', () => {
    expect(classifyFormat('T20')).toBe('T20');
    expect(classifyFormat('ODI')).toBe('ODI');
    expect(classifyFormat('Test')).toBe('Test');
  });

  it('returns general chips without a match', () => {
    const res = generalSuggestions('en');
    expect(res.phase).toBe('general');
    expect(res.questions.some((q) => /IPL 2025|IPL 2026/i.test(q.question))).toBe(true);
  });

  it('does not suggest required-rate / target chips in the first innings', () => {
    const res = matchSuggestions(baseMatch({ overs: 12.3 }), 'en');
    expect(res.phase).toBe('first_innings');
    expect(res.format).toBe('ODI');
    const text = res.questions.map((q) => q.question).join(' | ');
    expect(text).toMatch(/projected score/i);
    expect(text).toMatch(/target might/i);
    expect(text).not.toMatch(/runs per over.*need/i);
    expect(text).toMatch(/50 overs/i);
    expect(text).toMatch(/first 20 overs/i);
    expect(text).not.toMatch(/next 6 overs/i);
  });

  it('T20 first-overs chips progress 6 → 10 and never above 20', () => {
    expect(completedWholeOvers(5.4)).toBe(5);
    expect(nextFirstOversTarget('T20', 0)).toBe(6);
    expect(nextFirstOversTarget('T20', 6)).toBe(10);
    expect(nextFirstOversTarget('T20', 10)).toBe(15);
    expect(nextFirstOversTarget('T20', 19)).toBe(20);
    expect(nextFirstOversTarget('T20', 20)).toBeNull();

    const early = matchSuggestions(baseMatch({ matchType: 'T20', overs: 3.2, innings: [{ inning: 1, teamSportmonksId: 1, score: 40, wickets: 1, overs: 3.2 }] }), 'en');
    expect(early.questions.map((q) => q.question).join(' ')).toMatch(/first 6 overs/i);
    expect(early.questions.map((q) => q.question).join(' ')).not.toMatch(/50 overs|next 6/i);

    const mid = matchSuggestions(baseMatch({ matchType: 'T20', overs: 7.1, innings: [{ inning: 1, teamSportmonksId: 1, score: 70, wickets: 2, overs: 7.1 }] }), 'en');
    expect(mid.questions.map((q) => q.question).join(' ')).toMatch(/first 10 overs/i);
  });

  it('suggests chase chips including required rate in the second innings', () => {
    const res = matchSuggestions(
      baseMatch({
        matchType: 'T20',
        currentInning: 2,
        overs: 15.2,
        target: 181,
        runsRequired: 61,
        ballsRemaining: 28,
        requiredRunRate: 13,
        battingTeamSportmonksId: 2,
        innings: [
          { inning: 1, teamSportmonksId: 1, score: 180, wickets: 6, overs: 20 },
          { inning: 2, teamSportmonksId: 2, score: 120, wickets: 3, overs: 15.2 },
        ],
      }),
      'en',
    );
    expect(res.phase).toBe('chase');
    const text = res.questions.map((q) => q.question).join(' | ');
    expect(text).toMatch(/runs per over/i);
    expect(text).toMatch(/target/i);
    expect(text).toMatch(/first 20 overs/i);
    expect(text).not.toMatch(/next 6 overs/i);
  });
});
