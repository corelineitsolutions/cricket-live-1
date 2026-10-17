import type { FeedsService } from '../../feeds/feeds.service';
import type { HistoryQueryService } from '../../history/history-query.service';
import type { IdentityService } from '../../identity/identity.service';
import type { MatchDto } from '../../matches/dto/match.dto';
import type { MatchesService } from '../../matches/matches.service';
import { AiToolRegistry } from './ai-tool.registry';
import {
  blendNextOversEstimate,
  createPredictionTools,
  oversLimitFor,
  parseLiveMatchPrediction,
  parseMatchProbHistory,
  parseTossComparison,
  parseTossResult,
  projectInningsScore,
  projectNextOvers,
  recentOversRunRate,
  strikeRateToRunRate,
} from './prediction-tools';

const match = {
  matchId: '61521',
  localTeam: { sportmonksId: 101, name: 'Delhi Royals' },
  visitorTeam: { sportmonksId: 202, name: 'Mumbai Strikers' },
  winnerTeamSportmonksId: null,
  matchType: 'T20',
  isLive: true,
  isFinished: false,
  status: 'LIVE',
  statusDetail: 'Live',
  note: null,
  venue: null,
  startTime: null,
  league: null,
  innings: [],
  battingTeamSportmonksId: 101,
  score: 120,
  wickets: 3,
  overs: 15.2,
  runRate: 7.83,
  target: null,
  runsRequired: null,
  ballsRemaining: null,
  requiredRunRate: null,
  batsmen: [],
  bowler: null,
  lastUpdatedAt: '2026-10-13T00:00:00.000Z',
  stale: false,
} as unknown as MatchDto;

describe('prediction helpers', () => {
  it('infers limited-overs limits and projects from run rate', () => {
    expect(oversLimitFor('T20')).toBe(20);
    expect(oversLimitFor('ODI')).toBe(50);
    expect(oversLimitFor('Test')).toBeNull();
    const proj = projectInningsScore({
      team: 'Delhi Royals',
      score: 120,
      overs: 15.0,
      runRate: 8,
      oversLimit: 20,
      wickets: 2,
    });
    expect(proj).toMatchObject({ available: true, projectedScore: 160, oversRemaining: '5.0' });
    expect(projectNextOvers({ team: 'India', score: 40, overs: 5, runRate: 8, oversAhead: 6 })).toMatchObject({
      available: true,
      estimatedRunsMid: 48,
      rangeText: '41-55',
      blendedRunRate: 8,
    });
    expect(strikeRateToRunRate(150)).toBe(9);
    expect(recentOversRunRate([{ runs: 12 }, { runs: 8 }, { runs: 10 }], 3)).toBe(10);
    const blended = blendNextOversEstimate({
      team: 'India',
      score: 20,
      overs: 2,
      oversAhead: 6,
      signals: [
        { source: 'live_rr', rate: 10, weight: 2.2 },
        { source: 'batter_venue', rate: 8, weight: 0.45 },
        { source: 'bowler_venue', rate: 7, weight: 0.35 },
      ],
    });
    expect(blended.available).toBe(true);
    if (blended.available) {
      // Live anchors; archive only nudges — stay near 10, not pulled to ~7.
      expect(blended.blendedRunRate).toBeGreaterThan(9);
      expect(blended.blendedRunRate).toBeLessThan(11);
      expect(blended.liveRunRate).toBe(10);
    }

    // History alone must not collapse a T20 powerplay RR (~12.5) toward Test rates (~3).
    const powerplay = blendNextOversEstimate({
      team: 'West Indies',
      score: 52,
      overs: 4.1,
      oversAhead: 3,
      signals: [
        { source: 'live_rr', rate: 12.5, weight: 2.2 },
        { source: 'recent_overs', rate: 13, weight: 1.4 },
        { source: 'batter_venue', rate: 3.2, weight: 0.7 },
        { source: 'bowler_venue', rate: 2.8, weight: 0.5 },
        { source: 'batter_vs_bowler', rate: 3.5, weight: 0.8 },
      ],
    });
    expect(powerplay.available).toBe(true);
    if (powerplay.available) {
      expect(powerplay.blendedRunRate).toBeGreaterThan(10);
      expect(powerplay.estimatedRunsMid).toBeGreaterThanOrEqual(30);
    }
  });

  it('parses liveMatch prediction fields when present', () => {
    const parsed = parseLiveMatchPrediction(
      { fav_team: 'Delhi Royals', team_a_per: 42, team_b_per: 58, projected_score: 175 },
      match,
    );
    expect(parsed).toMatchObject({
      available: true,
      favouriteTeam: 'Delhi Royals',
      projectedScore: 175,
      teams: [
        { team: 'Delhi Royals', probabilityPercent: 42 },
        { team: 'Mumbai Strikers', probabilityPercent: 58 },
      ],
    });
  });

  it('parses toss result and toss comparison payloads', () => {
    expect(parseTossResult({ toss_winner: 'India', toss_decision: 'bat' }, match)).toMatchObject({
      tossComplete: true,
      tossWinner: 'India',
      tossDecision: 'bat',
    });
    const cmp = parseTossComparison(
      { team_a_toss_win: 12, team_a_toss_per: 55, team_b_toss_win: 10, team_b_toss_per: 45 },
      match,
    );
    expect(cmp.available).toBe(true);
    expect(cmp.lean).toBe('Delhi Royals');
    expect(cmp.teams[0]).toMatchObject({ team: 'Delhi Royals', tossWins: 12, tossWinPercent: 55 });
  });

  it('parses common matchProbHistory shapes and refuses empty payloads', () => {
    expect(parseMatchProbHistory(null, match).available).toBe(false);
    expect(parseMatchProbHistory([], match)).toMatchObject({
      available: false,
      note: expect.stringMatching(/empty/i),
    });
    const pair = parseMatchProbHistory({ team1_prob: 0.55, team2_prob: 0.45 }, match);
    expect(pair).toMatchObject({
      available: true,
      teams: [
        { team: 'Delhi Royals', probabilityPercent: 55 },
        { team: 'Mumbai Strikers', probabilityPercent: 45 },
      ],
    });
    const series = parseMatchProbHistory([{ team1: 40, team2: 60 }, { team1: 58, team2: 42 }], match);
    expect(series).toMatchObject({
      available: true,
      rawShape: 'series_pair',
      teams: [
        { team: 'Delhi Royals', probabilityPercent: 58 },
        { team: 'Mumbai Strikers', probabilityPercent: 42 },
      ],
    });
    const list = parseMatchProbHistory(
      [
        { team_id: 101, probability: 62 },
        { team_id: 202, probability: 38 },
      ],
      match,
    );
    expect(list.teams.map((t) => t.probabilityPercent)).toEqual([62, 38]);
  });
});

describe('prediction tools', () => {
  it('exposes win probability and projected score for a match', async () => {
    const feeds = {
      get: vi.fn(async () => ({
        endpoint: 'matchProbHistory',
        params: { match_id: '61521' },
        data: [
          { team: 'Delhi Royals', percent: 58 },
          { team: 'Mumbai Strikers', percent: 42 },
        ],
        message: null,
        updatedAt: '2026-10-13T00:00:00.000Z',
        stale: false,
      })),
    } as unknown as FeedsService;
    const matches = { getMatch: vi.fn(async () => match) } as unknown as MatchesService;
    const registry = new AiToolRegistry(createPredictionTools(matches, feeds));

    const win = await registry.execute('get_win_probability', JSON.stringify({ matchId: '61521' }));
    expect(win.ok).toBe(true);
    expect(win.data).toMatchObject({
      available: true,
      teams: [
        { team: 'Delhi Royals', probabilityPercent: 58 },
        { team: 'Mumbai Strikers', probabilityPercent: 42 },
      ],
    });
    expect(win.label).toBe('Win probability 61521');

    const proj = await registry.execute('project_score', JSON.stringify({ matchId: '61521' }));
    expect(proj.ok).toBe(true);
    expect(proj.data).toMatchObject({ available: true, team: 'Delhi Royals' });
    expect((proj.data as { projectedScore: number }).projectedScore).toBeGreaterThan(120);
  });

  it('marks win probability unavailable when the feed fails', async () => {
    const feeds = { get: vi.fn(async () => { throw new Error('down'); }) } as unknown as FeedsService;
    const matches = { getMatch: vi.fn(async () => match) } as unknown as MatchesService;
    const registry = new AiToolRegistry(createPredictionTools(matches, feeds));
    const win = await registry.execute('get_win_probability', JSON.stringify({ matchId: '61521' }));
    expect(win.data).toMatchObject({ available: false });
  });

  it('returns toss comparison when the toss is not done yet', async () => {
    const feeds = {
      get: vi.fn(async (endpoint: string) => {
        if (endpoint === 'matchInfo' || endpoint === 'liveMatch') {
          return { endpoint, data: {}, message: null, updatedAt: null, stale: false };
        }
        return {
          endpoint: 'tossComparisonByTeamId',
          data: { team_a_toss_win: 8, team_a_toss_per: 60, team_b_toss_win: 5, team_b_toss_per: 40 },
          message: null,
          updatedAt: null,
          stale: false,
        };
      }),
    } as unknown as FeedsService;
    const matches = { getMatch: vi.fn(async () => match) } as unknown as MatchesService;
    const registry = new AiToolRegistry(createPredictionTools(matches, feeds));
    const toss = await registry.execute('get_toss_prediction', JSON.stringify({ matchId: '61521' }));
    expect(toss.ok).toBe(true);
    expect(toss.data).toMatchObject({
      available: true,
      kind: 'toss',
      tossComplete: false,
      lean: 'Delhi Royals',
    });
  });

  it('blends history signals into project_next_overs when identity maps exist', async () => {
    const liveMatch = {
      ...match,
      venue: { name: 'Wankhede Stadium', city: 'Mumbai' },
      batsmen: [{ sportmonksId: 9002, name: 'Rohit Sharma', runs: 12, balls: 8, fours: 2, sixes: 0, strikeRate: 150, imageUrl: null }],
      bowler: { sportmonksId: 7002, name: 'Jasprit Bumrah', overs: 1, maidens: 0, runs: 6, wickets: 0, economy: 6, imageUrl: null },
      score: 20,
      overs: 2,
      runRate: 10,
    } as unknown as MatchDto;
    const feeds = {
      get: vi.fn(async (endpoint: string) => {
        if (endpoint === 'matchOverHistory') {
          return { data: [{ runs: 8 }, { runs: 12 }], stale: false, message: null, updatedAt: '', endpoint, params: {} };
        }
        if (endpoint === 'matchProbHistory') {
          return {
            data: [
              { team: 'Delhi Royals', percent: 55 },
              { team: 'Mumbai Strikers', percent: 45 },
            ],
            stale: false,
            message: null,
            updatedAt: '',
            endpoint,
            params: {},
          };
        }
        if (endpoint === 'liveMatch') {
          return { data: { fav_team: 'Delhi Royals', team_a_per: 55, team_b_per: 45 }, stale: false, message: null, updatedAt: '', endpoint, params: {} };
        }
        throw new Error(`unexpected ${endpoint}`);
      }),
    } as unknown as FeedsService;
    const identity = {
      confirmedVenuesFor: vi.fn(async () => [11]),
      confirmedPersonFor: vi.fn(async (id: number) => (id === 9002 ? 'aaaaaaaa' : id === 7002 ? 'bbbbbbbb' : null)),
    } as unknown as IdentityService;
    const history = {
      playerVenueRates: vi.fn(async (personId: string) =>
        personId === 'aaaaaaaa'
          ? { battingRunRate: 8.5, bowlingEconomy: null, battingInnings: 5, bowlingInnings: 0 }
          : { battingRunRate: null, bowlingEconomy: 6.5, battingInnings: 0, bowlingInnings: 4 },
      ),
      batterVsBowlerRate: vi.fn(async () => ({ balls: 30, runs: 36, runRate: 7.2 })),
    } as unknown as HistoryQueryService;
    const matches = { getMatch: vi.fn(async () => liveMatch) } as unknown as MatchesService;
    const registry = new AiToolRegistry(createPredictionTools(matches, feeds, { history, identity }));
    const result = await registry.execute('project_next_overs', JSON.stringify({ matchId: '61521', overs: 6 }));
    expect(result.ok).toBe(true);
    const data = result.data as {
      available: boolean;
      signals: Array<{ source: string }>;
      blendedRunRate: number;
      context: { batterMapped: boolean; latiyalWinProbability: unknown[] };
    };
    expect(data.available).toBe(true);
    expect(data.signals.map((s) => s.source)).toEqual(
      expect.arrayContaining(['live_rr', 'recent_overs', 'batter_venue', 'bowler_venue', 'batter_vs_bowler']),
    );
    expect(data.context.batterMapped).toBe(true);
    expect(data.context.latiyalWinProbability).toHaveLength(2);
    expect(data.blendedRunRate).not.toBe(10);
  });
});
