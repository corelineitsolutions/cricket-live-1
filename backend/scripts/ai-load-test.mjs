#!/usr/bin/env node
/**
 * Concurrent load test against POST /api/v1/ai/ask.
 *
 * Fixed-count mode:
 *   CCU=8 REQUESTS=80 TIMEOUT_MS=60000 node scripts/ai-load-test.mjs
 *
 * 1-minute / target RPM mode (keeps CCU workers busy for DURATION_S):
 *   TARGET_RPM=120 DURATION_S=60 CCU=24 TIMEOUT_MS=60000 node scripts/ai-load-test.mjs
 *
 * With ~10s p50 latency, CCU ≈ TARGET_RPM/60 * 10  →  for 120/min use CCU≈20–24.
 * Raise .env first (restart API), then revert after test:
 *   AI_MAX_CONCURRENT=32
 *   AI_REQUESTS_PER_IP_PER_MINUTE=5000
 *   AI_REQUESTS_PER_DEVICE_PER_MINUTE=500
 *   AI_REQUESTS_PER_DEVICE_PER_DAY=100000
 *   RATE_LIMIT_PER_MINUTE=5000
 *
 * Run from /home/cricket-live-1/backend (do NOT cd backend again).
 */
const base = (process.env.AI_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const targetRpm = Math.max(0, Number(process.env.TARGET_RPM || 0) || 0);
const durationS = Math.max(10, Number(process.env.DURATION_S || 60) || 60);
const ccuDefault = targetRpm > 0 ? Math.max(8, Math.ceil((targetRpm / 60) * 12)) : 4;
const ccu = Math.max(1, Number(process.env.CCU || ccuDefault) || ccuDefault);
const totalFixed = Math.max(ccu, Number(process.env.REQUESTS || ccu * 10) || ccu * 10);
const matchId = process.env.MATCH_ID?.trim() || '';
const timeoutMs = Math.max(3000, Number(process.env.TIMEOUT_MS || 60000) || 60000);
const rampMs = Math.max(0, Number(process.env.RAMP_MS || 0) || 0);
const timedMode = targetRpm > 0 || process.env.DURATION_S != null;

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

/** Fixed number of requests with CCU workers. */
async function poolFixed(n, concurrency, worker) {
  const results = [];
  let next = 0;
  const runners = [];
  for (let w = 0; w < Math.min(concurrency, n); w++) {
    if (rampMs > 0 && w > 0) await sleep(rampMs);
    runners.push(
      (async () => {
        while (true) {
          const i = next++;
          if (i >= n) return;
          const r = await worker(i);
          results.push(r);
          if (results.length % Math.max(1, Math.floor(n / 10)) === 0 || results.length === n) {
            process.stdout.write(`  progress ${results.length}/${n}\n`);
          }
        }
      })(),
    );
  }
  await Promise.all(runners);
  return results;
}

/**
 * Keep `concurrency` workers busy until deadline.
 * Optional TARGET_RPM paces starts (~TARGET_RPM/60 starts per second).
 */
async function poolTimed(concurrency, durationMs, targetRpm, worker) {
  const results = [];
  const deadline = Date.now() + durationMs;
  let next = 0;
  let lastReport = 0;
  const minGapMs = targetRpm > 0 ? Math.floor(60000 / targetRpm) : 0;
  let nextStartAt = Date.now();
  const startLock = { p: Promise.resolve() };

  async function takeSlot() {
    // Serialize start pacing across workers.
    let release;
    const wait = new Promise((r) => {
      release = r;
    });
    const prev = startLock.p;
    startLock.p = prev.then(() => wait);
    await prev;
    const now = Date.now();
    if (minGapMs > 0 && now < nextStartAt) {
      await sleep(nextStartAt - now);
    }
    nextStartAt = Date.now() + minGapMs;
    release();
  }

  const runners = [];
  for (let w = 0; w < concurrency; w++) {
    if (rampMs > 0 && w > 0) await sleep(rampMs);
    runners.push(
      (async () => {
        while (Date.now() < deadline) {
          await takeSlot();
          if (Date.now() >= deadline) return;
          const i = next++;
          const r = await worker(i);
          results.push(r);
          if (results.length - lastReport >= 10) {
            lastReport = results.length;
            const elapsed = (Date.now() - (deadline - durationMs)) / 1000;
            const rpm = elapsed > 0 ? ((results.length / elapsed) * 60).toFixed(1) : '0';
            process.stdout.write(`  progress ${results.length}  elapsed=${elapsed.toFixed(0)}s  rpm≈${rpm}\n`);
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
    hints.push(`AI_BUSY (${byCode['503:AI_BUSY']}x): raise AI_MAX_CONCURRENT ≥ CCU.`);
  }
  if (byCode['429:TOO_MANY_REQUESTS']) {
    hints.push(
      `TOO_MANY_REQUESTS (${byCode['429:TOO_MANY_REQUESTS']}x): raise AI_REQUESTS_PER_IP_PER_MINUTE and RATE_LIMIT_PER_MINUTE.`,
    );
  }
  if (byCode['429:AI_QUOTA_EXCEEDED']) {
    hints.push(`AI_QUOTA_EXCEEDED (${byCode['429:AI_QUOTA_EXCEEDED']}x): raise device minute/day quotas.`);
  }
  return hints;
}

function printSummary(results, wallMs) {
  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const latencies = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
  const byCode = {};
  for (const r of fail) {
    const key = `${r.status}:${r.code || 'ERR'}`;
    byCode[key] = (byCode[key] || 0) + 1;
  }
  const rpm = wallMs > 0 ? (results.length / (wallMs / 1000)) * 60 : 0;
  const okRpm = wallMs > 0 ? (ok.length / (wallMs / 1000)) * 60 : 0;

  console.log('\n=== Summary ===');
  console.log(
    `ok=${ok.length} fail=${fail.length} total=${results.length} wall_s=${(wallMs / 1000).toFixed(1)}`,
  );
  console.log(`rpm_total=${rpm.toFixed(1)}  rpm_ok=${okRpm.toFixed(1)}  success=${results.length ? ((ok.length / results.length) * 100).toFixed(1) : 0}%`);
  if (latencies.length) {
    console.log(
      `latency_ms p50=${percentile(latencies, 50)} p95=${percentile(latencies, 95)} p99=${percentile(latencies, 99)} max=${latencies[latencies.length - 1]}`,
    );
  }
  if (Object.keys(byCode).length) {
    console.log('failures:', byCode);
    for (const line of explainFailures(byCode)) console.log('→', line);
  }
  for (const r of fail.slice(0, 5)) {
    console.log(`  fail [${r.status} ${r.code}] ${r.latencyMs}ms  ${r.question}`);
  }
  for (const r of ok.slice(0, 3)) {
    console.log(`  ok ${r.latencyMs}ms mocked=${r.mocked} tools=${r.tools || '-'}  ${r.question}`);
  }
  return fail.length > results.length * 0.1 ? 1 : 0;
}

async function main() {
  console.log(`AI load test → ${base}/api/v1/ai/ask`);
  if (timedMode) {
    console.log(
      `mode=timed  TARGET_RPM=${targetRpm || '(max)'}  DURATION_S=${durationS}  CCU=${ccu}  TIMEOUT_MS=${timeoutMs}`,
    );
  } else {
    console.log(`mode=fixed  CCU=${ccu}  REQUESTS=${totalFixed}  TIMEOUT_MS=${timeoutMs}`);
  }
  console.log(`MATCH_ID=${matchId || '(none)'}`);

  try {
    const statusRes = await fetch(`${base}/api/v1/ai/status`);
    const statusJson = await statusRes.json().catch(() => null);
    console.log('GET /ai/status:', statusRes.status, JSON.stringify(statusJson?.data ?? statusJson));
    if (statusJson?.data?.available === false) {
      console.error('AI is not available. Aborting.');
      process.exit(2);
    }
  } catch (err) {
    console.error('Cannot reach API:', err.message || err);
    process.exit(2);
  }

  const wallStart = Date.now();
  const results = timedMode
    ? await poolTimed(ccu, durationS * 1000, targetRpm, askOnce)
    : await poolFixed(totalFixed, ccu, askOnce);
  const wallMs = Date.now() - wallStart;
  process.exit(printSummary(results, wallMs));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
