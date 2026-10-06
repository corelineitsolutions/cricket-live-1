import { latiyalMatch, LatiyalMatchOptions, listItem, LOCAL_TEAM_ID, SERIES_ID, VISITOR_TEAM_ID } from '../testing/latiyal-fixtures';
import { normalizeLatiyalMatch, oversToBalls, parseScoreLines, syntheticId } from './live-match.normalizer';

const NOW = new Date('2026-10-01T16:25:00.000Z');

function normalize(options: LatiyalMatchOptions = {}) {
  const match = latiyalMatch(options);
  return normalizeLatiyalMatch(listItem(match), match, NOW);
}

describe('normalizeLatiyalMatch', () => {
  it('builds the live match for a T20 chase', () => {
    const match = normalize();

    expect(match).toMatchObject({
      matchId: null,
      sportmonksId: 61521,
      league: { sportmonksId: SERIES_ID, name: 'Premier T20 2026' },
      season: { sportmonksId: SERIES_ID, name: 'Premier T20 2026' },
      matchType: 'T20',
      round: '12th Match',
      status: 'LIVE',
      statusDetail: 'Live',
      isLive: true,
      isFinished: false,
      startTime: '2026-10-01T14:00:00.000Z',
      venue: { name: 'Wankhede Stadium, Mumbai', city: null },
      localTeam: { sportmonksId: LOCAL_TEAM_ID, name: 'Mumbai Strikers', shortName: 'MUM', imageUrl: 'https://cdn.example/mum.png' },
      visitorTeam: { sportmonksId: VISITOR_TEAM_ID, name: 'Delhi Royals', shortName: 'DEL' },
      currentInning: 2,
      battingTeamSportmonksId: VISITOR_TEAM_ID,
      score: 120,
      wickets: 3,
      overs: 15.2,
      runRate: 7.83,
      target: 181,
      runsRequired: 61,
      ballsRemaining: 28,
      requiredRunRate: 13.07,
      lastUpdatedAt: NOW.toISOString(),
      stale: false,
    });
    expect(match.innings).toEqual([
      { inning: 1, teamSportmonksId: LOCAL_TEAM_ID, score: 180, wickets: 6, overs: 20 },
      { inning: 2, teamSportmonksId: VISITOR_TEAM_ID, score: 120, wickets: 3, overs: 15.2 },
    ]);
  });

  it('reads the batsmen and the current bowler from the liveMatch detail', () => {
    const match = normalize();

    expect(match.batsmen.map((batsman) => batsman.name)).toEqual(['Rohan Mehta', 'Arjun Rao']);
    expect(match.batsmen[0]).toEqual({
      sportmonksId: 9002,
      name: 'Rohan Mehta',
      imageUrl: null,
      runs: 54,
      balls: 38,
      fours: 5,
      sixes: 2,
      strikeRate: 142.11,
    });
    expect(match.bowler).toMatchObject({ sportmonksId: 7002, name: 'Kiran Patel', overs: 3.2, wickets: 2, economy: 7.2 });
  });

  it('uses the list item alone when there is no detail', () => {
    const match = normalizeLatiyalMatch(listItem(latiyalMatch()), null, NOW);

    expect(match).toMatchObject({ score: 120, overs: 15.2, batsmen: [], bowler: null });
  });

  it('prefers rates and the equation Latiyal sends over computed ones', () => {
    const raw = { ...latiyalMatch(), curr_rate: '7.90', rr_rate: '13.10', target: '181', run_need: '61', ball_rem: '28' };
    const match = normalizeLatiyalMatch(raw, null, NOW);

    expect(match).toMatchObject({ runRate: 7.9, requiredRunRate: 13.1, target: 181, runsRequired: 61, ballsRemaining: 28 });
  });

  it('reads the chase equation from need_run_ball text', () => {
    const raw = { ...latiyalMatch({ type: 'Unknown' }), need_run_ball: 'Delhi Royals need 61 runs in 28 balls' };
    const match = normalizeLatiyalMatch(raw, null, NOW);

    expect(match).toMatchObject({ target: 181, runsRequired: 61, ballsRemaining: 28, requiredRunRate: 13.07 });
    expect(match.note).toBe('Delhi Royals need 61 runs in 28 balls');
  });

  it('has no target or required rate in the first innings', () => {
    const match = normalize({ runs: [[1, LOCAL_TEAM_ID, 64, 1, 7.4]] });

    expect(match).toMatchObject({ currentInning: 1, battingTeamSportmonksId: LOCAL_TEAM_ID, runRate: 8.35 });
    expect(match.target).toBeNull();
    expect(match.requiredRunRate).toBeNull();
    expect(match.ballsRemaining).toBeNull();
  });

  it('keeps a listed match live even when its status still says it has not started', () => {
    const match = normalize({ id: 71391, status: 'Upcoming', runs: [] });

    expect(match).toMatchObject({ sportmonksId: 71391, status: 'LIVE', statusDetail: 'Upcoming', isLive: true, isFinished: false });
    expect(match.score).toBeNull();
    expect(match.batsmen).toEqual([]);
  });

  it('marks a finished match as final and works out the winner', () => {
    const match = normalize({ status: 'Finished', result: 'Mumbai Strikers won by 20 runs' });

    expect(match).toMatchObject({
      status: 'COMPLETED',
      statusDetail: 'Finished',
      isLive: false,
      isFinished: true,
      winnerTeamSportmonksId: LOCAL_TEAM_ID,
      note: 'Mumbai Strikers won by 20 runs',
    });
  });

  it('maps abandoned and rain-interrupted matches', () => {
    expect(normalize({ status: 'Abandoned' })).toMatchObject({ status: 'ABANDONED', isLive: false, isFinished: true });
    expect(normalize({ status: 'Rain Delay' })).toMatchObject({ status: 'INTERRUPTED', isLive: true, isFinished: false });
  });

  it('gives players and teams without an id a stable negative id', () => {
    const raw = latiyalMatch();
    delete raw.team_b_id;
    raw.batsman = [{ name: 'No Id Batter', run: '1', ball: '2' }];
    const match = normalizeLatiyalMatch(raw, null, NOW);

    expect(match.visitorTeam.sportmonksId).toBe(syntheticId('Delhi Royals'));
    expect(match.visitorTeam.sportmonksId).toBeLessThan(0);
    expect(match.batsmen[0].sportmonksId).toBe(syntheticId('No Id Batter'));
  });

  it('keeps missing data as null instead of guessing', () => {
    const match = normalizeLatiyalMatch({ match_id: 5 }, null, NOW);

    expect(match).toMatchObject({ sportmonksId: 5, venue: null, league: null, startTime: null, score: null, runRate: null, bowler: null });
    expect(match.batsmen).toEqual([]);
  });

  it('converts overs notation to balls', () => {
    expect(oversToBalls(15.2)).toBe(92);
    expect(oversToBalls(20)).toBe(120);
    expect(oversToBalls(0.5)).toBe(5);
  });
});

describe('parseScoreLines', () => {
  it('reads the score formats Latiyal uses', () => {
    expect(parseScoreLines('188-6', '20')).toEqual([{ score: 188, wickets: 6, overs: 20 }]);
    expect(parseScoreLines('188/6 (19.4)', null)).toEqual([{ score: 188, wickets: 6, overs: 19.4 }]);
    expect(parseScoreLines('250 & 120-3', '30.1')).toEqual([
      { score: 250, wickets: 10, overs: 0 },
      { score: 120, wickets: 3, overs: 30.1 },
    ]);
    expect(parseScoreLines({ 1: { score: '99', wicket: '2', over: '12.3' } }, null)).toEqual([{ score: 99, wickets: 2, overs: 12.3 }]);
    expect(parseScoreLines('', '')).toEqual([]);
  });
});
