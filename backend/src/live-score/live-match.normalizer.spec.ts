import { LOCAL_TEAM_ID, rawFixture, RawFixtureOptions, VISITOR_TEAM_ID } from '../testing/sportmonks-fixtures';
import { parseFixture, parseFixtureList } from '../sportmonks/sportmonks.validation';
import { normalizeFixture, oversToBalls } from './live-match.normalizer';

const NOW = new Date('2026-10-01T16:25:00.000Z');

function normalize(options: RawFixtureOptions = {}) {
  return normalizeFixture(parseFixture(rawFixture(options))!, NOW);
}

describe('normalizeFixture', () => {
  it('builds the live match for a T20 chase', () => {
    const match = normalize();

    expect(match).toMatchObject({
      matchId: null,
      sportmonksId: 61521,
      league: { sportmonksId: 3, name: 'Premier T20' },
      season: { sportmonksId: 1689, name: '2026' },
      status: 'LIVE',
      statusDetail: '2nd Innings',
      isLive: true,
      isFinished: false,
      startTime: '2026-10-01T14:00:00.000Z',
      venue: { name: 'Wankhede Stadium', city: 'Mumbai' },
      localTeam: { sportmonksId: LOCAL_TEAM_ID, name: 'Mumbai Strikers', shortName: 'MUM' },
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
    expect(match.innings).toHaveLength(2);
  });

  it('picks the two batsmen at the crease and the current bowler', () => {
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
    expect(match.bowler).toMatchObject({ sportmonksId: 7002, name: 'Kiran Patel', overs: 3.2, wickets: 2 });
  });

  it('has no target or required rate in the first innings', () => {
    const match = normalize({ status: '1st Innings', runs: [[1, LOCAL_TEAM_ID, 64, 1, 7.4]] });

    expect(match.runRate).toBe(8.35);
    expect(match.target).toBeNull();
    expect(match.requiredRunRate).toBeNull();
    expect(match.ballsRemaining).toBeNull();
  });

  it('computes the fourth-innings target of a Test match', () => {
    const match = normalize({
      type: 'Test/5day',
      status: '4th Innings',
      runs: [
        [1, LOCAL_TEAM_ID, 300, 10, 95],
        [2, VISITOR_TEAM_ID, 250, 10, 80],
        [3, LOCAL_TEAM_ID, 200, 10, 60],
        [4, VISITOR_TEAM_ID, 50, 1, 12],
      ],
    });

    expect(match.target).toBe(251);
    expect(match.runsRequired).toBe(201);
    expect(match.requiredRunRate).toBeNull();
  });

  it('marks a finished match as final and not live', () => {
    const match = normalize({ status: 'Finished', live: false, winnerTeamId: LOCAL_TEAM_ID, note: 'Mumbai won by 20 runs' });

    expect(match).toMatchObject({
      status: 'COMPLETED',
      isLive: false,
      isFinished: true,
      winnerTeamSportmonksId: LOCAL_TEAM_ID,
      note: 'Mumbai won by 20 runs',
    });
  });

  it('keeps missing data as null instead of guessing', () => {
    const raw = rawFixture();
    delete raw.venue;
    delete raw.runs;
    delete raw.batting;
    delete raw.bowling;
    const match = normalizeFixture(parseFixture(raw)!, NOW);

    expect(match.venue).toBeNull();
    expect(match.score).toBeNull();
    expect(match.overs).toBeNull();
    expect(match.runRate).toBeNull();
    expect(match.batsmen).toEqual([]);
    expect(match.bowler).toBeNull();
  });

  it('converts overs notation to balls', () => {
    expect(oversToBalls(15.2)).toBe(92);
    expect(oversToBalls(20)).toBe(120);
    expect(oversToBalls(0.5)).toBe(5);
  });
});

describe('parseFixtureList', () => {
  it('rejects fixtures without an integer id and a body without a data array', () => {
    expect(parseFixtureList({ data: [rawFixture(), { id: null }, 'junk'] })).toMatchObject({ rejected: 2 });
    expect(parseFixtureList({ data: { id: 1 } })).toBeNull();
    expect(parseFixtureList(null)).toBeNull();
  });
});
