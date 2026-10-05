import { AdPlacement, MatchStatus } from '@prisma/client';
import request from 'supertest';
import { RedisKey } from '../common/constants/redis-keys';
import { ApiTestApp, createApiTestApp } from '../testing/api-test-app';
import { adRow, FakeDb, leagueRow, matchRow, playerRow, teamRow } from '../testing/fake-db';
import { FakeRedis } from '../testing/fake-redis';
import { liveScoreHarness } from '../testing/live-score-harness';
import { jsonResponse, rawFixture } from '../testing/sportmonks-fixtures';
import { TEST_SPORTMONKS_TOKEN } from '../testing/test-config';
import { DETAIL_TTL_SECONDS } from './match-detail.service';

const LIVE_ID = 61521;
const SCHEDULED_ID = 61530;
const FINISHED_ID = 61400;

function scorecardBody(id = LIVE_ID) {
  return {
    data: {
      ...rawFixture({ id }),
      scoreboards: [
        { scoreboard: 'S2', team_id: 202, type: 'extra', wide: 3, noball_runs: 1, bye: 0, leg_bye: 2, penalty: 0, total: 0, overs: 0, wickets: 0 },
      ],
    },
  };
}

function ballsBody(id = LIVE_ID) {
  const ball = (ballId: number, over: number, score: Record<string, unknown>) => ({
    id: ballId,
    team_id: 202,
    ball: over,
    scoreboard: 'S2',
    batsman: { id: 9002, fullname: 'Rohan Mehta' },
    bowler: { id: 7002, fullname: 'Kiran Patel' },
    score: { name: 'x', runs: 0, four: false, six: false, bye: 0, leg_bye: 0, noball: 0, noball_runs: 0, is_wicket: false, out: false, ball: true, ...score },
  });
  return {
    data: {
      id,
      balls: [
        ball(1, 15.1, { name: '1 Run', runs: 1 }),
        ball(2, 15.2, { name: 'Four', runs: 4, four: true }),
        ball(3, 15.3, { name: 'Catch Out', is_wicket: true, out: true }),
      ],
    },
  };
}

/** Seeds Redis through the real worker pipeline, exactly like production. */
async function runWorker(redis: FakeRedis, ...fixtures: Array<Record<string, unknown>>) {
  const worker = liveScoreHarness({}, redis);
  worker.livescores(...fixtures);
  await worker.sync.runCycle('test-worker');
  return worker;
}

function seedDb(db: FakeDb) {
  db.rows.match.push(
    matchRow(LIVE_ID, { status: MatchStatus.LIVE, statusDetail: '2nd Innings' }),
    matchRow(SCHEDULED_ID),
    matchRow(FINISHED_ID, {
      status: MatchStatus.COMPLETED,
      statusDetail: 'Finished',
      resultSummary: 'Kolkata Kings won by 5 wickets',
    }),
  );
  db.rows.team.push(teamRow(101, 'Mumbai Strikers', 'MUM'));
  db.rows.player.push(playerRow(9002, 'Rohan Mehta'));
  db.rows.league.push(leagueRow(3, 'Premier T20'));
  db.rows.ad.push(adRow('ad-home', AdPlacement.HOME_BANNER, 10), adRow('ad-list', AdPlacement.MATCH_LIST, 5));
}

describe('Public REST API (e2e)', () => {
  let api: ApiTestApp;
  let redis: FakeRedis;
  let db: FakeDb;

  beforeEach(async () => {
    redis = new FakeRedis();
    db = new FakeDb();
    seedDb(db);
    api = await createApiTestApp({ redis, db });
  });

  afterEach(async () => {
    await api.close();
  });

  describe('GET /api/v1/matches/live', () => {
    it('returns live matches from Redis without touching MySQL or Sportmonks', async () => {
      await runWorker(redis, rawFixture());
      db.match.findUnique.mockClear();
      const queriesBefore = db.queryCount();

      const res = await request(api.http).get('/api/v1/matches/live').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.stale).toBe(false);
      expect(res.body.data.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(res.body.data.matches).toHaveLength(1);
      const [match] = res.body.data.matches;
      expect(match).toMatchObject({
        matchId: LIVE_ID,
        source: 'live',
        status: 'LIVE',
        isLive: true,
        score: 120,
        wickets: 3,
        overs: 15.2,
        target: 181,
        localTeam: { sportmonksId: 101, name: 'Mumbai Strikers' },
        stale: false,
      });
      expect(match.batsmen.map((b: { sportmonksId: number }) => b.sportmonksId)).toEqual([9002, 9003]);
      expect(match.bowler.sportmonksId).toBe(7002);
      expect(db.queryCount()).toBe(queriesBefore);
      expect(api.fetchMock).not.toHaveBeenCalled();
      expect(JSON.stringify(res.body)).not.toContain('cm_match_1');
    });

    it('returns an empty, stale list before the worker has ever succeeded', async () => {
      const res = await request(api.http).get('/api/v1/matches/live').expect(200);
      expect(res.body).toEqual({ success: true, data: { matches: [], updatedAt: null, stale: true } });
    });

    it('answers 503 in the error envelope when Redis is down', async () => {
      redis.down = true;
      const res = await request(api.http).get('/api/v1/matches/live').expect(503);
      expect(res.body).toEqual({
        success: false,
        message: 'Live scores are temporarily unavailable. Try again shortly.',
        code: 'SERVICE_UNAVAILABLE',
      });
    });
  });

  describe('GET /api/v1/matches/:id', () => {
    it('serves a live match from Redis', async () => {
      await runWorker(redis, rawFixture());
      const res = await request(api.http).get(`/api/v1/matches/${LIVE_ID}`).expect(200);
      expect(res.body.data).toMatchObject({ matchId: LIVE_ID, source: 'live', score: 120 });
      expect(db.match.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { sportmonksId: LIVE_ID } }));
    });

    it('serves a stored match from MySQL once, then from the cache', async () => {
      const first = await request(api.http).get(`/api/v1/matches/${SCHEDULED_ID}`).expect(200);
      await request(api.http).get(`/api/v1/matches/${SCHEDULED_ID}`).expect(200);

      expect(first.body.data).toMatchObject({
        matchId: SCHEDULED_ID,
        source: 'stored',
        status: 'SCHEDULED',
        isLive: false,
        isFinished: false,
        score: null,
        innings: [],
        batsmen: [],
        bowler: null,
        stale: false,
      });
      expect(db.match.findUnique).toHaveBeenCalledTimes(1);
      expect(redis.ttlSeconds(RedisKey.matchDetails(SCHEDULED_ID))).toBe(300);
    });

    it('accepts the legacy backend id of a stored match', async () => {
      const res = await request(api.http).get(`/api/v1/matches/${db.rows.match[1].id as string}`).expect(200);
      expect(res.body.data.matchId).toBe(SCHEDULED_ID);
    });

    it('returns 404 for an unknown match and caches the miss briefly', async () => {
      const res = await request(api.http).get('/api/v1/matches/999999').expect(404);
      expect(res.body).toEqual({ success: false, message: 'Match not found', code: 'RESOURCE_NOT_FOUND' });
      expect(redis.ttlSeconds(RedisKey.matchDetails(999999))).toBe(30);
    });

    it.each(['abc', '0', '-5', '12.5', '1234567890123'])('rejects the invalid id %s with 400', async (id) => {
      const res = await request(api.http).get(`/api/v1/matches/${id}`).expect(400);
      expect(res.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR', message: 'Validation failed' });
      expect(res.body.errors).toEqual(['id: id must be a numeric match id']);
    });

    it('rejects unknown query parameters', async () => {
      const res = await request(api.http).get(`/api/v1/matches/${SCHEDULED_ID}/commentary?foo=1`).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/matches/:id/scorecard', () => {
    beforeEach(async () => {
      await runWorker(redis, rawFixture());
    });

    it('makes one Sportmonks call for many concurrent requests and caches the result', async () => {
      api.respond(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return jsonResponse(scorecardBody());
      });

      const responses = await Promise.all(
        Array.from({ length: 25 }, () => request(api.http).get(`/api/v1/matches/${LIVE_ID}/scorecard`)),
      );
      await request(api.http).get(`/api/v1/matches/${LIVE_ID}/scorecard`).expect(200);

      expect(responses.every((res) => res.status === 200)).toBe(true);
      expect(api.fetchMock).toHaveBeenCalledTimes(1);
      const url = new URL(String(api.fetchMock.mock.calls[0][0]));
      expect(url.pathname).toBe(`/api/v2.0/fixtures/${LIVE_ID}`);
      expect(url.searchParams.get('include')).toContain('batting.batsman');
      expect(redis.ttlSeconds(RedisKey.matchScorecard(LIVE_ID))).toBe(DETAIL_TTL_SECONDS.live);

      const card = responses[0].body.data;
      expect(card).toMatchObject({ matchId: LIVE_ID, status: 'LIVE', isLive: true, stale: false });
      expect(card.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const second = card.innings.find((inning: { inning: number }) => inning.inning === 2);
      expect(second).toMatchObject({
        team: { sportmonksId: 202, name: 'Delhi Royals' },
        score: 120,
        extras: { total: 6, wides: 3, noBalls: 1, byes: 0, legByes: 2, penalty: 0 },
      });
      expect(second.batting.map((b: { name: string }) => b.name)).toEqual(['Out Opener', 'Rohan Mehta', 'Arjun Rao']);
      expect(second.bowling.find((b: { active: boolean }) => b.active).name).toBe('Kiran Patel');
      expect(JSON.stringify(responses[0].body)).not.toContain(TEST_SPORTMONKS_TOKEN);
    });

    it('stores scorecard players once so GET /players/:id works', async () => {
      api.respond(() => jsonResponse(scorecardBody()));
      await request(api.http).get(`/api/v1/matches/${LIVE_ID}/scorecard`).expect(200);
      // 9001 is out, so the live worker never saw them; only the scorecard knows this player.
      const res = await request(api.http).get('/api/v1/players/9001').expect(200);
      expect(res.body.data).toMatchObject({ sportmonksId: 9001, name: 'Out Opener' });
    });

    it('serves the last good copy marked stale when a refresh fails', async () => {
      api.respond(() => jsonResponse(scorecardBody()));
      await request(api.http).get(`/api/v1/matches/${LIVE_ID}/scorecard`).expect(200);
      await redis.del(RedisKey.matchScorecard(LIVE_ID));
      api.respond(() => jsonResponse({ message: 'boom' }, 500));

      const res = await request(api.http).get(`/api/v1/matches/${LIVE_ID}/scorecard`).expect(200);

      expect(res.body.data.stale).toBe(true);
      expect(res.body.data.innings.length).toBeGreaterThan(0);
    });

    it('answers 503 when Sportmonks fails and nothing is cached', async () => {
      api.respond(() => jsonResponse({ message: 'boom' }, 500));
      const res = await request(api.http).get(`/api/v1/matches/${LIVE_ID}/scorecard`).expect(503);
      expect(res.body).toEqual({
        success: false,
        message: 'Scorecard is temporarily unavailable. Try again shortly.',
        code: 'SERVICE_UNAVAILABLE',
      });
    });

    it('never calls Sportmonks when Redis is down', async () => {
      redis.down = true;
      await request(api.http).get(`/api/v1/matches/${LIVE_ID}/scorecard`).expect(503);
      expect(api.fetchMock).not.toHaveBeenCalled();
    });

    it('returns an empty scorecard for a match that has not started, without calling Sportmonks', async () => {
      const res = await request(api.http).get(`/api/v1/matches/${SCHEDULED_ID}/scorecard`).expect(200);
      expect(res.body.data).toEqual({
        matchId: SCHEDULED_ID,
        status: 'SCHEDULED',
        isLive: false,
        isFinished: false,
        innings: [],
        updatedAt: null,
        stale: false,
      });
      expect(api.fetchMock).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown match without calling Sportmonks', async () => {
      await request(api.http).get('/api/v1/matches/777777/scorecard').expect(404);
      expect(api.fetchMock).not.toHaveBeenCalled();
    });

    it('keeps a finished match scorecard for 24 hours', async () => {
      api.respond(() => jsonResponse(scorecardBody(FINISHED_ID)));
      await request(api.http).get(`/api/v1/matches/${FINISHED_ID}/scorecard`).expect(200);
      expect(redis.ttlSeconds(RedisKey.matchScorecard(FINISHED_ID))).toBe(DETAIL_TTL_SECONDS.finished);
    });

    it('stops calling Sportmonks once the on-demand hourly budget is spent', async () => {
      await api.close();
      api = await createApiTestApp({ redis, db, config: { sportmonksOnDemandMaxCallsPerHour: 0 } });
      api.respond(() => jsonResponse(scorecardBody()));

      await request(api.http).get(`/api/v1/matches/${LIVE_ID}/scorecard`).expect(503);
      expect(api.fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/matches/:id/commentary', () => {
    beforeEach(async () => {
      await runWorker(redis, rawFixture());
    });

    it('caches commentary: concurrent and repeated requests share one Sportmonks call', async () => {
      api.respond(() => jsonResponse(ballsBody()));

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => request(api.http).get(`/api/v1/matches/${LIVE_ID}/commentary`)),
      );
      const limited = await request(api.http).get(`/api/v1/matches/${LIVE_ID}/commentary?limit=2`).expect(200);

      expect(api.fetchMock).toHaveBeenCalledTimes(1);
      expect(new URL(String(api.fetchMock.mock.calls[0][0])).searchParams.get('include')).toContain('balls');
      expect(responses.every((res) => res.status === 200)).toBe(true);

      const items = responses[0].body.data.items;
      expect(items.map((item: { id: number }) => item.id)).toEqual([3, 2, 1]);
      expect(items[0]).toMatchObject({ over: 15.3, isWicket: true, text: 'Kiran Patel to Rohan Mehta, OUT (Catch Out)' });
      expect(items[1]).toMatchObject({ runs: 4, isFour: true, text: 'Kiran Patel to Rohan Mehta, FOUR' });
      expect(limited.body.data.items).toHaveLength(2);
      expect(limited.body.data.stale).toBe(false);
    });

    it('rejects a limit above 100', async () => {
      const res = await request(api.http).get(`/api/v1/matches/${LIVE_ID}/commentary?limit=500`).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(api.fetchMock).not.toHaveBeenCalled();
    });

    it('returns no items for a match that has not started', async () => {
      const res = await request(api.http).get(`/api/v1/matches/${SCHEDULED_ID}/commentary`).expect(200);
      expect(res.body.data).toEqual({ matchId: SCHEDULED_ID, items: [], updatedAt: null, stale: false });
      expect(api.fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('teams, players, leagues, ads', () => {
    it('GET /teams/:id by Sportmonks id', async () => {
      const res = await request(api.http).get('/api/v1/teams/101').expect(200);
      expect(res.body.data).toMatchObject({ sportmonksId: 101, name: 'Mumbai Strikers', shortName: 'MUM' });
    });

    it('GET /players/:id and /leagues/:id', async () => {
      await request(api.http).get('/api/v1/players/9002').expect(200);
      const league = await request(api.http).get('/api/v1/leagues/3').expect(200);
      expect(league.body.data).toMatchObject({ sportmonksId: 3, name: 'Premier T20' });
    });

    it('returns 404 and 400 in the error envelope', async () => {
      const missing = await request(api.http).get('/api/v1/teams/5555').expect(404);
      expect(missing.body).toEqual({ success: false, message: 'Team not found', code: 'RESOURCE_NOT_FOUND' });
      const invalid = await request(api.http).get('/api/v1/players/not-an-id').expect(400);
      expect(invalid.body.code).toBe('VALIDATION_ERROR');
    });

    it('GET /ads returns every active ad, or one placement', async () => {
      const all = await request(api.http).get('/api/v1/ads').expect(200);
      const home = await request(api.http).get('/api/v1/ads?placement=HOME_BANNER').expect(200);
      await request(api.http).get('/api/v1/ads?placement=NOPE').expect(400);

      expect(all.body.data.map((ad: { id: string }) => ad.id)).toEqual(['ad-home', 'ad-list']);
      expect(home.body.data.map((ad: { id: string }) => ad.id)).toEqual(['ad-home']);
    });
  });
});
