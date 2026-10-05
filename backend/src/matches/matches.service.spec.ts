import { MatchStatus } from '@prisma/client';
import { SingleFlightCache } from '../cache/single-flight-cache.service';
import type { LiveScoreService } from '../live-score/live-score.service';
import { captureLogs } from '../testing/capture-logs';
import { FakeRedis } from '../testing/fake-redis';
import { matchRow } from '../testing/fake-db';
import type { MatchesRepository } from './matches.repository';
import { MatchesService } from './matches.service';

function setup(options: { live?: unknown; row?: unknown; boardError?: boolean } = {}) {
  captureLogs();
  const repository = {
    findById: vi.fn(async () => options.row ?? null),
    findBySportmonksId: vi.fn(async () => options.row ?? null),
    list: vi.fn(),
  };
  const liveScore = {
    getMatchSnapshot: vi.fn(async () => options.live ?? null),
    getLiveBoard: vi.fn(async () => {
      if (options.boardError) {
        throw new Error('Connection is closed.');
      }
      return { matches: options.live ? [options.live] : [], updatedAt: '2026-10-01T16:25:00.000Z', stale: false };
    }),
  };
  const service = new MatchesService(
    repository as unknown as MatchesRepository,
    liveScore as unknown as LiveScoreService,
    new SingleFlightCache(new FakeRedis().asService()),
  );
  return { service, repository, liveScore };
}

const liveMatch = {
  matchId: 'cm_internal_id',
  sportmonksId: 61521,
  status: MatchStatus.LIVE,
  isLive: true,
  isFinished: false,
  score: 120,
  stale: false,
};

describe('MatchesService', () => {
  it('exposes the Sportmonks id as matchId and hides the internal id', async () => {
    const { service, repository } = setup({ live: liveMatch });

    const match = await service.getMatch('61521');

    expect(match).toMatchObject({ matchId: 61521, source: 'live', score: 120 });
    expect(JSON.stringify(match)).not.toContain('cm_internal_id');
    expect(match).not.toHaveProperty('sportmonksId');
    expect(repository.findBySportmonksId).not.toHaveBeenCalled();
  });

  it('maps a stored match without live data and without raw provider payloads', async () => {
    const { service } = setup({ row: matchRow(99, { status: MatchStatus.COMPLETED, resultSummary: 'A won' }) });

    const match = await service.getMatch('99');

    expect(match).toMatchObject({
      matchId: 99,
      source: 'stored',
      isFinished: true,
      note: 'A won',
      score: null,
      startTime: '2026-10-02T14:00:00.000Z',
      stale: false,
    });
    expect(match).not.toHaveProperty('raw');
  });

  it('marks a stored match that claims to be live as stale', async () => {
    const { service } = setup({ row: matchRow(99, { status: MatchStatus.LIVE }) });
    expect(await service.getMatch('99')).toMatchObject({ isLive: true, stale: true });
  });

  it('resolves a legacy backend id to the Sportmonks id', async () => {
    const { service, repository, liveScore } = setup({ row: matchRow(99), live: undefined });
    await service.getMatch('cmatch00000000000000000099');
    expect(repository.findById).toHaveBeenCalledWith('cmatch00000000000000000099');
    expect(liveScore.getMatchSnapshot).toHaveBeenCalledWith(99);
  });

  it('throws not found for unknown matches', async () => {
    const { service } = setup();
    await expect(service.getMatch('12345')).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND', message: 'Match not found' },
    });
  });

  it('maps the live board and turns a Redis failure into 503', async () => {
    expect(await setup({ live: liveMatch }).service.getLive()).toMatchObject({
      matches: [{ matchId: 61521 }],
      stale: false,
    });
    await expect(setup({ boardError: true }).service.getLive()).rejects.toMatchObject({
      response: { code: 'SERVICE_UNAVAILABLE' },
    });
  });
});
