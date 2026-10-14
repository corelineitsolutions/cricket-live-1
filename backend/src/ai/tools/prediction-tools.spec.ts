import type { FeedsService } from '../../feeds/feeds.service';
import type { MatchDto } from '../../matches/dto/match.dto';
import type { MatchesService } from '../../matches/matches.service';
import { AiToolRegistry } from './ai-tool.registry';
import {
  createPredictionTools,
  oversLimitFor,
  parseMatchProbHistory,
  projectInningsScore,
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
});
