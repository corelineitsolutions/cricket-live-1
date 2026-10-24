import { HistoryQueryService } from '../../history/history-query.service';
import { IdentityService } from '../../identity/identity.service';
import type { MatchDto } from '../../matches/dto/match.dto';
import type { MatchesService } from '../../matches/matches.service';
import { FakeDb } from '../../testing/fake-db';
import { guessEvent, guessFormat, guessGender, guessPlayerName, guessYear } from '../llm/mock-llm.provider';
import { AiToolRegistry } from './ai-tool.registry';
import { createHistoryTools, formatOf, normalizePlayerQuery } from './history-tools';

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function seed(db: FakeDb) {
  db.rows.histPerson.push({ id: 'cccccccc', name: 'V Kohli' }, { id: 'aaaaaaaa', name: 'RG Sharma' }, { id: 'bbbbbbbb', name: 'R Sharma' });
  db.rows.histPersonName.push(
    { personId: 'cccccccc', name: 'V Kohli' },
    { personId: 'aaaaaaaa', name: 'RG Sharma' },
    { personId: 'bbbbbbbb', name: 'R Sharma' },
  );
  const bat = { gender: 'male', fours: 10, sixes: 2, highestNotOut: false, fifties: 3, hundreds: 1, ducks: 0, firstMatchDate: D('2010-01-01'), lastMatchDate: D('2024-06-29') };
  db.rows.histAggPlayerBatting.push(
    { ...bat, personId: 'cccccccc', matchType: 'IT20', teamType: 'international', matches: 120, innings: 110, notOuts: 30, runs: 4000, ballsFaced: 2900, highest: 122, highestNotOut: true },
    { ...bat, personId: 'cccccccc', matchType: 'T20', teamType: 'club', matches: 250, innings: 240, notOuts: 30, runs: 8000, ballsFaced: 6100, highest: 113 },
    { ...bat, personId: 'cccccccc', matchType: 'ODI', teamType: 'international', matches: 290, innings: 280, notOuts: 40, runs: 13000, ballsFaced: 13900, highest: 183 },
  );
  db.rows.histAggPlayerBowling.push({
    personId: 'cccccccc', matchType: 'IT20', gender: 'male', teamType: 'international', innings: 12, legalBalls: 146, runsConceded: 204,
    wickets: 4, dots: 40, foursConceded: 20, sixesConceded: 5, wides: 3, noballs: 1, bestWickets: 1, bestRuns: 13, fourWickets: 0, fiveWickets: 0,
  });
  db.rows.histTeam.push(
    { id: 1, name: 'India', teamType: 'international' },
    { id: 2, name: 'Australia', teamType: 'international' },
    { id: 3, name: 'Mumbai Indians', teamType: 'club' },
  );
  const h2h = { ties: 0, draws: 0, noResults: 1, lastMatchDate: D('2024-06-24') };
  db.rows.histAggHeadToHead.push(
    { ...h2h, team1Id: 1, team2Id: 2, matchType: 'IT20', gender: 'male', matches: 32, team1Wins: 20, team2Wins: 11 },
    { ...h2h, team1Id: 1, team2Id: 2, matchType: 'IT20', gender: 'female', matches: 34, team1Wins: 8, team2Wins: 25 },
  );
  db.rows.histVenue.push({ id: 7, name: 'Wankhede Stadium, Mumbai', city: 'Mumbai' }, { id: 8, name: 'Wankhede Stadium', city: 'Mumbai' });
  const venue = { gender: 'male', resultMatches: 0, ties: 0, draws: 0, noResults: 0, tossWinnerWins: 5, lastMatchDate: D('2024-05-17') };
  db.rows.histAggVenue.push(
    { ...venue, venueId: 7, matchType: 'T20', matches: 40, batFirstWins: 18, chasingWins: 22, firstInningsCount: 40, firstInningsRuns: 6800, highestTotal: 235, lowestAllOutTotal: 67 },
    { ...venue, venueId: 8, matchType: 'T20', matches: 10, batFirstWins: 6, chasingWins: 4, firstInningsCount: 10, firstInningsRuns: 1700, highestTotal: 210, lowestAllOutTotal: 92 },
  );
  db.rows.histAggTeamPhase.push(
    { teamId: 3, matchType: 'T20', gender: 'male', phase: 'powerplay', innings: 200, runs: 9000, legalBalls: 7200, wickets: 300, fours: 900, sixes: 250, dots: 3000 },
  );
}

const liveMatch = { localTeam: { sportmonksId: 101, name: 'India Women' }, visitorTeam: { sportmonksId: 202, name: 'Australia Women' }, matchType: 'T20', venue: { name: 'Wankhede Stadium, Mumbai', city: null } } as unknown as MatchDto;

describe('AI history tools', () => {
  let db: FakeDb;
  let registry: AiToolRegistry;
  const run = async (name: string, args: Record<string, unknown>) => {
    const result = await registry.execute(name, JSON.stringify(args));
    return { ...result, data: result.data as Record<string, any> };
  };

  beforeEach(() => {
    db = new FakeDb();
    seed(db);
    const matches = { getMatch: vi.fn(async () => liveMatch) } as unknown as MatchesService;
    const historyPrisma = { client: db.asPrisma() } as unknown as import('../../history/history-prisma.service').HistoryPrismaService;
    registry = new AiToolRegistry(createHistoryTools(new HistoryQueryService(historyPrisma), new IdentityService(db.asPrisma(), historyPrisma), matches));
  });

  it('finds a player by app name and reports archive figures with derived rates', async () => {
    const res = await run('get_player_history', { name: 'Virat Kohli', format: 'T20' });
    expect(res.ok).toBe(true);
    expect(res.label).toBe('Cricsheet archive: Virat Kohli');
    expect(res.data.player).toBe('V Kohli');
    expect(res.data.coverage).toMatch(/not official career totals/);
    expect(res.data.batting.map((b: { matchType: string }) => b.matchType)).toEqual(['T20', 'IT20']);
    expect(res.data.batting[1]).toMatchObject({ runs: 4000, average: 50, strikeRate: 137.93, highest: '122*' });
    expect(res.data.bowling[0]).toMatchObject({ overs: '24.2', economy: 8.38, average: 51, best: '1/13' });
  });

  it('lists candidates instead of guessing between players', async () => {
    const res = await run('get_player_history', { name: 'Rahul Sharma' });
    expect(res.data.found).toBe(false);
    expect(res.data.candidates.map((c: { personId: string }) => c.personId).sort()).toEqual(['aaaaaaaa', 'bbbbbbbb']);
    const picked = await run('get_player_history', { personId: 'bbbbbbbb' });
    expect(picked.data.player).toBe('R Sharma');
    expect((await run('get_player_history', { name: 'Nobody Known' })).data.found).toBe(false);
  });

  it('validates arguments before touching the database', async () => {
    const before = db.histAggPlayerBatting.findMany.mock.calls.length;
    expect((await run('get_player_history', {})).data.error).toMatch(/required/);
    expect((await run('get_player_history', { personId: "x' OR 1=1" })).data.error).toMatch(/personId/);
    expect((await run('get_player_history', { name: 'Kohli', format: 'Hundred' })).data.error).toMatch(/format/);
    expect((await run('get_head_to_head', { team1: 'India' })).data.error).toMatch(/team1 and team2/);
    expect((await run('get_venue_history', { matchId: '1; DROP' })).data.error).toMatch(/matchId/);
    expect((await run('get_team_phase_stats', { team: 'India', format: 'Test' })).data.error).toMatch(/T20 or ODI/);
    expect(db.histAggPlayerBatting.findMany.mock.calls.length).toBe(before);
  });

  it('orients head-to-head wins to the teams as asked', async () => {
    const res = await run('get_head_to_head', { team1: 'Australia', team2: 'India', gender: 'male' });
    expect(res.data.teams).toEqual(['Australia', 'India']);
    expect(res.data.results).toEqual([expect.objectContaining({ matchType: 'IT20', matches: 32, 'Australia wins': 11, 'India wins': 20 })]);
    const women = await run('get_head_to_head', { team1: 'India Women', team2: 'Australia Women' });
    expect(women.data.results).toEqual([expect.objectContaining({ gender: 'female', 'India Women wins': 8 })]);
  });

  it('uses confirmed identity mappings for a live match and ignores unconfirmed ones', async () => {
    db.rows.identityTeamMap.push(
      { id: 't1', latiyalTeamId: 101, histTeamId: 1, gender: 'female', status: 'CONFIRMED' },
      { id: 't2', latiyalTeamId: 202, histTeamId: 3, gender: 'male', status: 'PROPOSED' },
    );
    const res = await run('get_head_to_head', { matchId: '61521' });
    // 202 is only proposed, so "Australia Women" is resolved by exact name instead.
    expect(res.data.results).toEqual([expect.objectContaining({ gender: 'female', matches: 34 })]);
  });

  it('combines every spelling of the live venue', async () => {
    const res = await run('get_venue_history', { matchId: '61521' });
    expect(res.data.formats).toEqual([
      expect.objectContaining({ matchType: 'T20', matches: 50, batFirstWins: 24, chasingWins: 26, averageFirstInningsScore: 170, highestTotal: 235, lowestAllOutTotal: 67 }),
    ]);
    expect(res.data.coverage).toMatch(/Cricsheet/);
  });

  it('reports team phase rates', async () => {
    const res = await run('get_team_phase_stats', { team: 'Mumbai Indians', format: 'T20' });
    expect(res.data.phases).toEqual([expect.objectContaining({ phase: 'powerplay', runRate: 7.5, wicketsPerInnings: 1.5, dotBallPercent: 41.67 })]);
  });

  it('maps Latiyal match types and guesses names for the mock provider', () => {
    expect([formatOf('T20I'), formatOf('ODI'), formatOf('Test'), formatOf('The Hundred')]).toEqual(['T20', 'ODI', 'Test', null]);
    expect(guessPlayerName('What is Virat Kohli career record in ODI?')).toBe('Virat Kohli');
    expect(guessPlayerName('Tell me Quinton de Kock stats')).toBe('Quinton de Kock');
    expect(guessPlayerName("there is how many 100 of rohit sharma in icc men's world cup")).toBe('Rohit Sharma');
    expect(guessPlayerName('ipl hundred of virat kohli')).toBe('Virat Kohli');
    expect(guessPlayerName('ipl hundred of rohit sharma')).toBe('Rohit Sharma');
    expect(guessPlayerName('how many hundred score virat kohli in ipl')).toBe('Virat Kohli');
    expect(guessPlayerName('career stats please')).toBeNull();
    expect(guessEvent("icc men's world cup")).toBe('World Cup');
    expect(guessEvent('who win WC 2019')).toBe('World Cup');
    expect(guessEvent('who win the 2024 t20 word cup')).toBe('World Cup');
    expect(guessEvent('T20 विश्व कप 2024 कौन जीता?')).toBe('World Cup');
    expect(guessEvent('who win IPL 2026')).toBe('Indian Premier League');
    expect(guessEvent('आयपीएल 2025 kon jita')).toBe('Indian Premier League');
    expect(guessEvent('ip 2026 kon jita da')).toBe('Indian Premier League');
    expect(guessEvent('Orange Cap in IPL 2019')).toBe('Indian Premier League');
    expect(guessFormat("icc men's world cup")).toBe('ODI');
    expect(guessFormat('who win WC 2019')).toBe('ODI');
    expect(guessFormat('t20 world cup')).toBe('T20');
    expect(guessFormat('who win the 2024 t20 word cup')).toBe('T20');
    expect(guessFormat('T20 विश्व कप 2024 कौन जीता?')).toBe('T20');
    expect(guessFormat('who win IPL 2026')).toBe('T20');
    expect(guessYear('who win icc odi world cup 2019')).toBe(2019);
    expect(guessYear('who win IPL 2026')).toBe(2026);
    expect(guessGender("icc men's world cup")).toBe('male');
    expect(guessPlayerName('How many runs per over does WA need?')).toBeNull();
    expect(guessPlayerName('next wicket kb hogi')).toBeNull();
    expect(normalizePlayerQuery('rohit sharam')).toBe('Rohit Sharma');
    expect(normalizePlayerQuery('rohit sharama')).toBe('Rohit Sharma');
    expect(normalizePlayerQuery('virat kohili')).toBe('Virat Kohli');
    expect(guessYear('suryakumar yadav icc world cup 2023')).toBe(2023);
  });

  it('auto-picks Rohit Sharma among Sharma candidates when IPL runs dominate', async () => {
    const iplBat = (runs: number, hundreds: number) => [
      {
        eventName: 'Indian Premier League',
        matchType: 'T20',
        gender: 'male',
        matches: runs > 100 ? 200 : 2,
        innings: runs > 100 ? 200 : 2,
        runs,
        hundreds,
        fifties: 0,
        highest: runs > 100 ? 109 : 22,
      },
    ];
    let calls = 0;
    db.$queryRaw.mockImplementation(async () => {
      calls += 1;
      // Disambiguation queries (per candidate), then final batting + bowling.
      if (calls === 1) return iplBat(6000, 7); // RG Sharma
      if (calls === 2) return iplBat(40, 0); // R Sharma
      if (calls === 3) return iplBat(6000, 7); // chosen player batting
      return []; // bowling
    });
    const res = await run('get_player_history', {
      name: 'Rohit Sharma',
      event: 'Indian Premier League',
      format: 'T20',
    });
    expect(res.ok).toBe(true);
    expect(res.data.found).not.toBe(false);
    expect(res.data.player).toBe('RG Sharma');
    expect(res.data.hundredsInEvent).toBe(7);
  });

  it('returns most-hundreds leaders for an IPL-style event', async () => {
    db.$queryRaw.mockResolvedValueOnce([
      { personId: 'cccccccc', name: 'V Kohli', matches: 200, innings: 200, runs: 7000, hundreds: 8, highest: 113 },
      { personId: 'aaaaaaaa', name: 'RG Sharma', matches: 200, innings: 200, runs: 6000, hundreds: 7, highest: 109 },
    ]);
    const res = await run('get_event_leaders', {
      event: 'Indian Premier League',
      format: 'T20',
      kind: 'hundreds',
    });
    expect(res.ok).toBe(true);
    expect(res.data.kind).toBe('hundreds');
    expect(res.data.top).toMatchObject({ player: 'V Kohli', hundreds: 8, rank: 1 });
  });

  it('returns archive standings with NRR for an IPL-style event', async () => {
    db.rows.histMatch.push(
      {
        id: 10,
        eventName: 'Indian Premier League',
        season: '2026',
        startDate: new Date('2026-04-01'),
        matchType: 'T20',
        gender: 'male',
        matchNumber: '1st Match',
        outcome: 'WIN',
        winnerId: 1,
        winByRuns: 20,
        winByWickets: null,
        eliminatorTeam: null,
        method: null,
        team1: { id: 1, name: 'Mumbai Indians' },
        team2: { id: 2, name: 'Chennai Super Kings' },
        winner: { id: 1, name: 'Mumbai Indians' },
        innings: [
          { battingTeamId: 1, bowlingTeamId: 2, runs: 180, legalBalls: 120 },
          { battingTeamId: 2, bowlingTeamId: 1, runs: 160, legalBalls: 120 },
        ],
      },
      {
        id: 11,
        eventName: 'Indian Premier League',
        season: '2026',
        startDate: new Date('2026-04-02'),
        matchType: 'T20',
        gender: 'male',
        matchNumber: '2nd Match',
        outcome: 'WIN',
        winnerId: 1,
        winByRuns: null,
        winByWickets: 5,
        eliminatorTeam: null,
        method: null,
        team1: { id: 2, name: 'Chennai Super Kings' },
        team2: { id: 1, name: 'Mumbai Indians' },
        winner: { id: 1, name: 'Mumbai Indians' },
        innings: [
          { battingTeamId: 2, bowlingTeamId: 1, runs: 140, legalBalls: 120 },
          { battingTeamId: 1, bowlingTeamId: 2, runs: 141, legalBalls: 114 },
        ],
      },
    );
    const res = await run('get_event_standings', { event: 'Indian Premier League', year: 2026, format: 'T20' });
    expect(res.ok).toBe(true);
    expect(res.data.top).toMatchObject({ team: 'Mumbai Indians', won: 2, points: 4 });
    expect(typeof (res.data.top as { nrr: number }).nrr).toBe('number');
    expect(res.label).toContain('standings');
  });

  it('returns Player of the Match award leaders', async () => {
    db.$queryRaw.mockResolvedValueOnce([
      { personId: 'cccccccc', name: 'V Kohli', awards: 5 },
      { personId: 'aaaaaaaa', name: 'RG Sharma', awards: 3 },
    ]);
    const res = await run('get_event_awards', { event: 'Indian Premier League', year: 2026, format: 'T20' });
    expect(res.ok).toBe(true);
    expect(res.data.top).toMatchObject({ player: 'V Kohli', playerOfMatchAwards: 5 });
    expect(res.data.note).toMatch(/Player of the Tournament/i);
  });

  it('returns filtered death-over team phase leaders', async () => {
    db.$queryRaw.mockResolvedValueOnce([
      {
        teamId: 1,
        team: 'Mumbai Indians',
        phaseName: 'death',
        innings: 10,
        runs: 200,
        balls: 120,
        wickets: 15,
        fours: 12,
        sixes: 10,
        dots: 30,
      },
    ]);
    const res = await run('get_event_phase_stats', {
      event: 'Indian Premier League',
      year: 2026,
      format: 'T20',
      phase: 'death',
      resultFilter: 'won',
      stage: 'all',
      subject: 'team',
    });
    expect(res.ok).toBe(true);
    expect(res.data.top).toMatchObject({ team: 'Mumbai Indians', phase: 'death' });
    expect((res.data.top as { runRate: number }).runRate).toBe(10);
  });

  it('counts hundreds and wickets for an event filter without inventing SQL from the question', async () => {
    const battingRows = [
      { eventName: 'ICC World Cup', matchType: 'ODI', gender: 'male', matches: 9, innings: 9, runs: 648, hundreds: 5, fifties: 1, highest: 140 },
      { eventName: 'ICC Cricket World Cup', matchType: 'ODI', gender: 'male', matches: 11, innings: 11, runs: 597, hundreds: 2, fifties: 3, highest: 131 },
    ];
    const bowlingRows = [
      { eventName: 'ICC Cricket World Cup', matchType: 'ODI', gender: 'male', matches: 15, innings: 15, legalBalls: 840, runsConceded: 620, wickets: 27 },
    ];
    db.$queryRaw.mockImplementation(async () => (db.$queryRaw.mock.calls.length <= 1 ? battingRows : bowlingRows));
    const res = await run('get_player_history', { name: 'Virat Kohli', event: 'World Cup', format: 'ODI', gender: 'male' });
    expect(res.ok).toBe(true);
    expect(res.data.hundredsInEvent).toBe(7);
    expect(res.data.wicketsInEvent).toBe(27);
    expect(res.data.battingByEvent).toHaveLength(2);
    expect(res.data.bowlingByEvent).toHaveLength(1);
    expect(res.data.gender).toBe('male');
    expect(res.label).toContain('World Cup');
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('returns the World Cup final winner from the archive without inventing it', async () => {
    db.rows.histMatch.push({
      id: 1,
      eventName: 'ICC Cricket World Cup',
      season: '2019',
      startDate: new Date('2019-07-14T00:00:00.000Z'),
      matchType: 'ODI',
      gender: 'male',
      matchNumber: 'Final',
      outcome: 'WIN',
      winByRuns: null,
      winByWickets: null,
      eliminatorTeam: 'England',
      method: null,
      team1: { name: 'England' },
      team2: { name: 'New Zealand' },
      winner: { name: 'England' },
    });
    const res = await run('get_event_results', { event: 'World Cup', year: 2019, format: 'ODI', gender: 'male' });
    expect(res.ok).toBe(true);
    expect(res.data.tournamentWinner).toBe('England');
    expect(res.data.final).toMatchObject({ matchNumber: 'Final', teams: ['England', 'New Zealand'] });
    expect(res.data.coverage).toMatch(/Cricsheet/);
    expect(res.label).toContain('2019');
  });

  it('returns tournament batting leaders without requiring a player name', async () => {
    db.$queryRaw.mockResolvedValueOnce([
      { personId: 'aaaaaaaa', name: 'RG Sharma', matches: 9, innings: 9, runs: 648, hundreds: 5, highest: 140 },
      { personId: 'cccccccc', name: 'V Kohli', matches: 9, innings: 9, runs: 443, hundreds: 1, highest: 82 },
    ]);
    const res = await run('get_event_leaders', {
      event: 'World Cup',
      year: 2019,
      format: 'ODI',
      gender: 'male',
      kind: 'batting',
    });
    expect(res.ok).toBe(true);
    expect(res.data.top).toMatchObject({ player: 'RG Sharma', runs: 648, rank: 1 });
    expect(res.data.leaders).toHaveLength(2);
    expect(res.label).toContain('batting leaders');
  });
});
