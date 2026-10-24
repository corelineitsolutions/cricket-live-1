#!/usr/bin/env node
/**
 * Concurrent load test against POST /api/v1/ai/ask.
 *
 * Your first runs failed for protection limits (not because the LLM crashed):
 *   503 AI_BUSY            → AI_MAX_CONCURRENT (default 4) — only N asks at once
 *   429 TOO_MANY_REQUESTS  → HTTP rate limit (RATE_LIMIT_PER_MINUTE, default 600)
 *                            and/or AI_REQUESTS_PER_IP_PER_MINUTE (default 20)
 *   429 AI_QUOTA_EXCEEDED  → AI_REQUESTS_PER_DEVICE_PER_MINUTE / _DAY
 *
 * Temporary load-test .env on the server (then restart API), then revert:
 *   AI_MAX_CONCURRENT=32
 *   AI_REQUESTS_PER_IP_PER_MINUTE=5000
 *   AI_REQUESTS_PER_DEVICE_PER_MINUTE=200
 *   AI_REQUESTS_PER_DEVICE_PER_DAY=50000
 *   RATE_LIMIT_PER_MINUTE=5000
 *
 * Usage (from /home/cricket-live-1/backend — do NOT cd backend again):
 *   npm run ai:load
 *   CCU=4 REQUESTS=40 node scripts/ai-load-test.mjs
 *   CCU=8 REQUESTS=80 RAMP_MS=50 node scripts/ai-load-test.mjs
 *   CCU=8 REQUESTS=80 MATCH_ID=14193 node scripts/ai-load-test.mjs
 *
 * Env:
 *   AI_BASE      API origin (default http://127.0.0.1:3000)
 *   CCU          concurrent in-flight asks (default 4 — matches AI_MAX_CONCURRENT)
 *   REQUESTS     total asks (default CCU * 10)
 *   RAMP_MS      delay before starting each extra worker (default 0)
 *   MATCH_ID     optional live match id
 *   TIMEOUT_MS   per-request timeout (default 60000 for real LLM)
 */
const base = (process.env.AI_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const ccu = Math.max(1, Number(process.env.CCU || 4) || 4);
const total = Math.max(ccu, Number(process.env.REQUESTS || ccu * 10) || ccu * 10);
const matchId = process.env.MATCH_ID?.trim() || '';
const timeoutMs = Math.max(3000, Number(process.env.TIMEOUT_MS || 60000) || 60000);
const rampMs = Math.max(0, Number(process.env.RAMP_MS || 0) || 0);

const ARCHIVE = [
  'Who won IPL 2025?',
  'Who won the T20 World Cup 2024?',
  'How many hundreds has Virat Kohli scored in the IPL?',
  'rohit sharama ipl hundred',
  'which player win most ipl title',
  'IPL 2025 कौन जीता?',
  'Who has the most wickets in IPL 2026?',
];

const LIVE = [
  'What is the projected score?',
  'How many runs in the first 6 overs?',
  'How many runs per over do they need?',
  'Can they chase this?',
  'Who might win the toss?',
];

const questions = matchId ? [...LIVE, ...ARCHIVE] : ARCHIVE;

function pickQuestion(i) {
  return questions[i % questions.length];
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function askOnce(i) {
  // Unique device per request so device/minute quota is not the first wall.
  const deviceId = `load-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 8)}`;
  const body = {
    question: pickQuestion(i),
    language: i % 4 === 0 ? 'hi' : 'en',
    deviceId,
    ...(matchId ? { matchId } : {}),
  };
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/v1/ai/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* ignore */
    }
    const latencyMs = Date.now() - started;
    const ok = res.ok && json?.success === true;
    return {
      ok,
      status: res.status,
      latencyMs,
      code: json?.code ?? null,
      mocked: json?.data?.mocked ?? null,
      answerLen: typeof json?.data?.answer === 'string' ? json.data.answer.length : 0,
      tools: Array.isArray(json?.data?.toolsUsed) ? json.data.toolsUsed.join(',') : '',
      question: body.question.slice(0, 48),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      code: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
      mocked: null,
      answerLen: 0,
      tools: '',
      question: body.question.slice(0, 48),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function pool(n, concurrency, worker) {
  const results = new Array(n);
  let next = 0;
  const runners = [];
  for (let w = 0; w < Math.min(concurrency, n); w++) {
    if (rampMs > 0 && w > 0) await sleep(rampMs);
    runners.push(
      (async () => {
        while (true) {
          const i = next++;
          if (i >= n) return;
          results[i] = await worker(i);
          const done = results.filter(Boolean).length;
          if (done % Math.max(1, Math.floor(n / 10)) === 0 || done === n) {
            process.stdout.write(`  progress ${done}/${n}\n`);
          }
        }
      })(),
    );
  }
  await Promise.all(runners);
  return results;
}

function explainFailures(byCode) {
  const hints = [];
  if (byCode['503:AI_BUSY']) {
    hints.push(
      `AI_BUSY (${byCode['503:AI_BUSY']}x): raise AI_MAX_CONCURRENT (default 4) or set CCU ≤ that value.`,
    );
  }
  if (byCode['429:TOO_MANY_REQUESTS']) {
    hints.push(
      `TOO_MANY_REQUESTS (${byCode['429:TOO_MANY_REQUESTS']}x): all asks share one IP — raise AI_REQUESTS_PER_IP_PER_MINUTE and RATE_LIMIT_PER_MINUTE, then restart API.`,
    );
  }
  if (byCode['429:AI_QUOTA_EXCEEDED']) {
    hints.push(
      `AI_QUOTA_EXCEEDED (${byCode['429:AI_QUOTA_EXCEEDED']}x): raise AI_REQUESTS_PER_DEVICE_PER_MINUTE / _DAY.`,
    );
  }
  return hints;
}

async function main() {
  console.log(`AI load test → ${base}/api/v1/ai/ask`);
  console.log(
    `CCU=${ccu} REQUESTS=${total} RAMP_MS=${rampMs} MATCH_ID=${matchId || '(none)'} TIMEOUT_MS=${timeoutMs}`,
  );
  console.log(
    'Tip: start with CCU=4 (default AI_MAX_CONCURRENT). For higher CCU, raise limits in .env first.',
  );

  try {
    const statusRes = await fetch(`${base}/api/v1/ai/status`);
    const statusJson = await statusRes.json().catch(() => null);
    console.log('GET /ai/status:', statusRes.status, JSON.stringify(statusJson?.data ?? statusJson));
    if (statusJson?.data?.available === false) {
      console.error('AI is not available (AI_ENABLED off or misconfigured). Aborting.');
      process.exit(2);
    }
  } catch (err) {
    console.error('Cannot reach API:', err.message || err);
    process.exit(2);
  }

  const wallStart = Date.now();
  const results = await pool(total, ccu, askOnce);
  const wallMs = Date.now() - wallStart;

  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const latencies = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
  const byCode = {};
  for (const r of fail) {
    const key = `${r.status}:${r.code || 'ERR'}`;
    byCode[key] = (byCode[key] || 0) + 1;
  }

  console.log('\n=== Summary ===');
  console.log(
    `ok=${ok.length} fail=${fail.length} wall_s=${(wallMs / 1000).toFixed(1)} rps=${(total / (wallMs / 1000)).toFixed(2)}`,
  );
  if (latencies.length) {
    console.log(
      `latency_ms p50=${percentile(latencies, 50)} p95=${percentile(latencies, 95)} p99=${percentile(latencies, 99)} max=${latencies[latencies.length - 1]}`,
    );
  }
  if (Object.keys(byCode).length) {
    console.log('failures:', byCode);
    for (const line of explainFailures(byCode)) console.log('→', line);
  }
  const sampleFail = fail.slice(0, 5);
  if (sampleFail.length) {
    console.log('sample failures:');
    for (const r of sampleFail) {
      console.log(`  [${r.status} ${r.code}] ${r.latencyMs}ms  ${r.question}`);
    }
  }
  const sampleOk = ok.slice(0, 3);
  if (sampleOk.length) {
    console.log('sample ok:');
    for (const r of sampleOk) {
      console.log(
        `  ${r.latencyMs}ms mocked=${r.mocked} tools=${r.tools || '-'} ansLen=${r.answerLen}  ${r.question}`,
      );
    }
  }

  process.exit(fail.length > total * 0.1 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
