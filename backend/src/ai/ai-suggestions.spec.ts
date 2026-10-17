import type { MatchDto } from '../matches/dto/match.dto';
import { classifyFormat, generalSuggestions, matchSuggestions } from './ai-suggestions';

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
    expect(res.questions.some((q) => /World Cup|IPL/i.test(q.question))).toBe(true);
  });

  it('does not suggest required-rate / target chips in the first innings', () => {
    const res = matchSuggestions(baseMatch(), 'en');
    expect(res.phase).toBe('first_innings');
    expect(res.format).toBe('ODI');
    const text = res.questions.map((q) => q.question).join(' | ');
    expect(text).toMatch(/projected score/i);
    expect(text).toMatch(/target might/i);
    expect(text).not.toMatch(/runs per over.*need/i);
    expect(text).toMatch(/50 overs/i);
  });

  it('suggests chase chips including required rate in the second innings', () => {
    const res = matchSuggestions(
      baseMatch({
        matchType: 'T20',
        currentInning: 2,
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
  });
});
