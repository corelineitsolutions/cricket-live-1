#!/usr/bin/env node
/**
 * Concurrent load test against POST /api/v1/ai/ask (and optional /ai/status).
 *
 * Usage (on the API host or any machine that can reach it):
 *   node scripts/ai-load-test.mjs
 *   AI_BASE=http://127.0.0.1:3000 CCU=20 REQUESTS=100 node scripts/ai-load-test.mjs
 *   AI_BASE=https://api.example.com CCU=50 REQUESTS=200 MATCH_ID=14193 node scripts/ai-load-test.mjs
 *
 * Env:
 *   AI_BASE     API origin (default http://127.0.0.1:3000)
 *   CCU         concurrent in-flight asks (default 10)
 *   REQUESTS    total asks to send (default CCU * 5)
 *   MATCH_ID    optional — attach live questions to this match
 *   TIMEOUT_MS  per-request timeout (default 35000)
 */
const base = (process.env.AI_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const ccu = Math.max(1, Number(process.env.CCU || 10) || 10);
const total = Math.max(ccu, Number(process.env.REQUESTS || ccu * 5) || ccu * 5);
const matchId = process.env.MATCH_ID?.trim() || '';
const timeoutMs = Math.max(3000, Number(process.env.TIMEOUT_MS || 35000) || 35000);

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

async function askOnce(i) {
  const deviceId = `load-test-${String(i % 500).padStart(4, '0')}-${Date.now().toString(36)}`;
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

async function pool(n, worker) {
  const results = new Array(n);
  let next = 0;
  const runners = Array.from({ length: Math.min(ccu, n) }, async () => {
    while (true) {
      const i = next++;
      if (i >= n) return;
      results[i] = await worker(i);
      const done = i + 1;
      if (done % Math.max(1, Math.floor(n / 10)) === 0 || done === n) {
        process.stdout.write(`  progress ${done}/${n}\n`);
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  console.log(`AI load test → ${base}/api/v1/ai/ask`);
  console.log(`CCU=${ccu} REQUESTS=${total} MATCH_ID=${matchId || '(none)'} TIMEOUT_MS=${timeoutMs}`);

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
  const results = await pool(total, askOnce);
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
  console.log(`ok=${ok.length} fail=${fail.length} wall_s=${(wallMs / 1000).toFixed(1)} rps=${(total / (wallMs / 1000)).toFixed(2)}`);
  if (latencies.length) {
    console.log(
      `latency_ms p50=${percentile(latencies, 50)} p95=${percentile(latencies, 95)} p99=${percentile(latencies, 99)} max=${latencies[latencies.length - 1]}`,
    );
  }
  if (Object.keys(byCode).length) {
    console.log('failures:', byCode);
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
      console.log(`  ${r.latencyMs}ms mocked=${r.mocked} tools=${r.tools || '-'} ansLen=${r.answerLen}  ${r.question}`);
    }
  }

  process.exit(fail.length > total * 0.1 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
