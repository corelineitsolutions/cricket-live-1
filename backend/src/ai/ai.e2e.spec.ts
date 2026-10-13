import request from 'supertest';
import { adminAuthHeader, seedAdmin } from '../testing/admin-auth';
import { ApiTestApp, ApiTestConfig, createApiTestApp } from '../testing/api-test-app';
import { captureLogs } from '../testing/capture-logs';
import { FakeDb } from '../testing/fake-db';
import { FakeRedis } from '../testing/fake-redis';
import { latiyalMatch } from '../testing/latiyal-fixtures';
import { liveScoreHarness } from '../testing/live-score-harness';
import type { LlmFetch } from './llm/openai-compatible.provider';

const DEVICE_ID = 'device-ai-test-0001';
const SECRET_QUESTION = 'What is the score in this match zebra-marker-7781?';
const API_KEY = 'sk-live-key-never-log-1234567890';
const LIVE_ID = '61521';

const ask = (api: ApiTestApp, body: Record<string, unknown> = {}) =>
  request(api.http)
    .post('/api/v1/ai/ask')
    .send({ question: SECRET_QUESTION, deviceId: DEVICE_ID, matchId: LIVE_ID, ...body });

const llmJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** A scripted OpenAI-compatible server: asks for get_match once, then answers. */
const scriptedLlm: LlmFetch = async (_url, init) => {
  const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string }> };
  const hasToolResult = body.messages.some((m) => m.role === 'tool');
  return llmJson(
    hasToolResult
      ? { choices: [{ message: { content: 'Delhi Royals need 61 runs from 28 balls.' } }], usage: { prompt_tokens: 400, completion_tokens: 20 } }
      : {
          choices: [
            { message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_match', arguments: `{"matchId":"${LIVE_ID}"}` } }] } },
          ],
          usage: { prompt_tokens: 300, completion_tokens: 15 },
        },
  );
};

async function start(config: ApiTestConfig, options: { llmFetch?: LlmFetch; db?: FakeDb } = {}) {
  const redis = new FakeRedis();
  const db = options.db ?? new FakeDb();
  const worker = liveScoreHarness({}, redis);
  worker.live(latiyalMatch());
  await worker.sync.runCycle('test-worker');
  const logs = captureLogs();
  const api = await createApiTestApp({ redis, db, config, llmFetch: options.llmFetch });
  return { api, redis, db, logs };
}

describe('AI assistant (e2e)', () => {
  let api: ApiTestApp;
  let redis: FakeRedis;
  let db: FakeDb;

  afterEach(async () => {
    await api?.close();
  });

  it('is off by default and says so without calling any provider', async () => {
    ({ api } = await start({}));
    const status = await request(api.http).get('/api/v1/ai/status').expect(200);
    expect(status.body.data).toMatchObject({ available: false, languages: ['en', 'hi'] });
    const res = await ask(api).expect(503);
    expect(res.body.code).toBe('AI_DISABLED');
    expect(api.llmFetch).not.toHaveBeenCalled();
  });

  it('validates the request body', async () => {
    ({ api } = await start({ aiEnabled: true }));
    expect((await ask(api, { question: '' }).expect(400)).body.code).toBe('VALIDATION_ERROR');
    expect((await ask(api, { matchId: '../etc' }).expect(400)).body.code).toBe('VALIDATION_ERROR');
    expect((await ask(api, { language: 'fr' }).expect(400)).body.code).toBe('VALIDATION_ERROR');
    expect((await ask(api, { question: 'x'.repeat(501) }).expect(400)).body.code).toBe('VALIDATION_ERROR');
    expect((await ask(api, { deviceId: undefined }).expect(400)).body.code).toBe('VALIDATION_ERROR');
  });

  it('answers from live data with the mock provider in English and Hindi', async () => {
    ({ api } = await start({ aiEnabled: true }));
    const en = await ask(api).expect(200);
    expect(en.body.data).toMatchObject({ language: 'en', mocked: true, sources: ['Match 61521'] });
    expect(en.body.data.answer).toContain('Mumbai Strikers vs Delhi Royals');
    expect(en.body.data.answer).toContain('need 61 runs from 28 balls');

    const hi = await ask(api, { language: 'hi' }).expect(200);
    expect(hi.body.data.answer).toMatch(/[\u0900-\u097F]/);
    expect(hi.body.data.disclaimer).toMatch(/[\u0900-\u097F]/);
    expect(api.llmFetch).not.toHaveBeenCalled();
  });

  it('enforces the per-device minute and day limits', async () => {
    ({ api } = await start({ aiEnabled: true, aiRequestsPerDevicePerMinute: 2, aiRequestsPerDevicePerDay: 3 }));
    await ask(api).expect(200);
    await ask(api).expect(200);
    const limited = await ask(api).expect(429);
    expect(limited.body.code).toBe('AI_QUOTA_EXCEEDED');
    await ask(api, { deviceId: 'another-device-0002' }).expect(200);
  });

  it('enforces the per-IP minute limit across devices', async () => {
    ({ api } = await start({ aiEnabled: true, aiRequestsPerIpPerMinute: 2 }));
    await ask(api, { deviceId: 'device-a-000001' }).expect(200);
    await ask(api, { deviceId: 'device-b-000002' }).expect(200);
    expect((await ask(api, { deviceId: 'device-c-000003' }).expect(429)).body.code).toBe('AI_QUOTA_EXCEEDED');
  });

  it('never uses a real provider without a token budget', async () => {
    ({ api } = await start(
      { aiEnabled: true, llmProvider: 'openai-compatible', llmBaseUrl: 'https://llm.example.com/v1', llmApiKey: API_KEY, llmModel: 'm', aiDailyTokenBudget: 0 },
      { llmFetch: scriptedLlm },
    ));
    expect((await ask(api).expect(503)).body.code).toBe('AI_NOT_CONFIGURED');
    expect((await request(api.http).get('/api/v1/ai/status').expect(200)).body.data.available).toBe(false);
    expect(api.llmFetch).not.toHaveBeenCalled();
  });

  it('rejects an unsafe provider URL', async () => {
    ({ api } = await start(
      { aiEnabled: true, llmProvider: 'openai-compatible', llmBaseUrl: 'http://10.0.0.5/v1', llmApiKey: API_KEY, llmModel: 'm', aiDailyTokenBudget: 1000 },
      { llmFetch: scriptedLlm },
    ));
    expect((await ask(api).expect(503)).body.code).toBe('AI_NOT_CONFIGURED');
    expect(api.llmFetch).not.toHaveBeenCalled();
  });

  it('runs the tool loop with a real-style provider and stops at the daily token budget', async () => {
    ({ api } = await start(
      { aiEnabled: true, llmProvider: 'openai-compatible', llmBaseUrl: 'https://llm.example.com/v1', llmApiKey: API_KEY, llmModel: 'model-x', aiDailyTokenBudget: 500 },
      { llmFetch: scriptedLlm },
    ));
    const res = await ask(api).expect(200);
    expect(res.body.data).toMatchObject({ answer: 'Delhi Royals need 61 runs from 28 balls.', mocked: false, sources: ['Match 61521'] });
    expect(api.llmFetch).toHaveBeenCalledTimes(2);
    const toolMessage = JSON.parse(String(api.llmFetch.mock.calls[1][1].body)).messages.find((m: { role: string }) => m.role === 'tool');
    expect(JSON.parse(toolMessage.content)).toMatchObject({ matchId: 61521, teams: ['Mumbai Strikers', 'Delhi Royals'] });

    expect((await ask(api).expect(503)).body.code).toBe('AI_BUDGET_EXHAUSTED');
    expect(api.llmFetch).toHaveBeenCalledTimes(2);
  });

  it('maps provider failures to 502 and keeps secrets and user data out of logs and storage', async () => {
    const started = await start(
      { aiEnabled: true, llmProvider: 'openai-compatible', llmBaseUrl: 'https://llm.example.com/v1', llmApiKey: API_KEY, llmModel: 'model-x', aiDailyTokenBudget: 10_000 },
      { llmFetch: async () => new Response(`{"error":"invalid key ${API_KEY}"}`, { status: 401 }) },
    );
    ({ api, db, redis } = started);
    const { logs } = started;
    const failed = await ask(api).set('X-Forwarded-For', '203.0.113.77').expect(502);
    expect(failed.body.code).toBe('AI_PROVIDER_ERROR');
    expect(JSON.stringify(failed.body)).not.toContain(API_KEY);

    await seedAdmin(db);
    const overview = await request(api.http)
      .get('/api/v1/admin/ai/overview')
      .set('Authorization', await adminAuthHeader(api))
      .expect(200);
    expect(overview.body.data.history[0]).toMatchObject({ provider: 'openai-compatible', model: 'model-x', requests: 1, errors: 1 });

    const everything = [logs.text(), JSON.stringify(db.rows.aiUsageDaily), JSON.stringify([...redis.store.entries()])].join('\n');
    for (const secret of [API_KEY, SECRET_QUESTION, 'zebra-marker-7781', DEVICE_ID, '203.0.113.77']) {
      expect(everything).not.toContain(secret);
    }
    expect(logs.tagged('ai-ask')).toHaveLength(1);
  });

  it('logs answered questions as counters only and shows aggregates to admins', async () => {
    const started = await start({ aiEnabled: true });
    ({ api, db } = started);
    const { logs } = started;
    const answer = (await ask(api).expect(200)).body.data.answer as string;
    await ask(api, { language: 'hi' }).expect(200);

    const [line] = logs.tagged('ai-ask');
    expect(JSON.parse(line.replace('[ai-ask] ', ''))).toMatchObject({ outcome: 'answered', provider: 'mock', tools: ['get_match'] });
    expect(logs.text()).not.toContain(answer.slice(0, 30));
    expect(logs.text()).not.toContain(DEVICE_ID);

    await request(api.http).get('/api/v1/admin/ai/overview').expect(401);
    await seedAdmin(db);
    const res = await request(api.http)
      .get('/api/v1/admin/ai/overview?days=7')
      .set('Authorization', await adminAuthHeader(api))
      .expect(200);
    expect(res.body.data.status).toMatchObject({ enabled: true, ready: true, provider: 'mock', mocked: true });
    expect(res.body.data.history[0]).toMatchObject({ requests: 2, answered: 2, languageEn: 1, languageHi: 1, toolCalls: 2 });
    expect(Object.keys(db.rows.aiUsageDaily[0])).not.toContain('question');

    // A second flush overwrites with the same absolute values instead of double counting.
    await request(api.http).get('/api/v1/admin/ai/overview').set('Authorization', await adminAuthHeader(api)).expect(200);
    expect(db.rows.aiUsageDaily).toHaveLength(1);
    expect(db.rows.aiUsageDaily[0]).toMatchObject({ requests: 2 });
  });

  describe('Cricsheet history tools', () => {
    const historyDb = () => {
      const seeded = new FakeDb();
      seeded.rows.histVenue.push({ id: 7, name: 'Wankhede Stadium', city: 'Mumbai' });
      seeded.rows.histAggVenue.push({
        venueId: 7, matchType: 'T20', gender: 'male', matches: 40, resultMatches: 40, batFirstWins: 18, chasingWins: 22, ties: 0, draws: 0,
        noResults: 0, firstInningsCount: 40, firstInningsRuns: 6800, highestTotal: 235, lowestAllOutTotal: 67, tossWinnerWins: 21, lastMatchDate: null,
      });
      return seeded;
    };
    const venueQuestion = { question: 'How does this ground usually play?' };

    it('answers venue questions from the archive and labels the source', async () => {
      ({ api } = await start({ aiEnabled: true, aiHistoryEnabled: true }, { db: historyDb() }));
      const res = await ask(api, venueQuestion).expect(200);
      expect(res.body.data.sources).toEqual(['Cricsheet archive: venue of match 61521']);
      expect(res.body.data.answer).toContain('average first-innings score 170');
      expect(res.body.data.answer).toContain('Cricsheet archive');
      expect(res.body.data.answer).toContain('not official career totals');

      const hi = await ask(api, { ...venueQuestion, language: 'hi' }).expect(200);
      expect(hi.body.data.answer).toContain('Cricsheet संग्रह');
    });

    it('offers no history tools while AI_HISTORY_ENABLED is off', async () => {
      ({ api } = await start(
        { aiEnabled: true, llmProvider: 'openai-compatible', llmBaseUrl: 'https://llm.example.com/v1', llmApiKey: API_KEY, llmModel: 'm', aiDailyTokenBudget: 10_000 },
        { llmFetch: scriptedLlm, db: historyDb() },
      ));
      await ask(api, venueQuestion).expect(200);
      const sent = JSON.parse(String(api.llmFetch.mock.calls[0][1].body)) as { tools: Array<{ function: { name: string } }>; messages: Array<{ content: string }> };
      expect(sent.tools.map((t) => t.function.name)).not.toContain('get_venue_history');
      expect(sent.messages[0].content).not.toContain('Cricsheet');
    });
  });
});
