#!/usr/bin/env node
/**
 * Concurrent load test against POST /api/v1/ai/ask.
 *
 * IMPORTANT: Do NOT use TARGET_RPM=0 with high CCU — that spams rejected 429s
 * and reports fake rpm_total (200k+/min). Use WAVE or fixed REQUESTS instead.
 *
 * Wave mode (best for “200–300 at once”):
 *   MODE=wave CCU=200 WAVES=3 TIMEOUT_MS=60000 node scripts/ai-load-test.mjs
 *   → each wave fires exactly CCU asks, waits for all, then next wave
 *
 * Fixed count:
 *   CCU=24 REQUESTS=120 TIMEOUT_MS=60000 node scripts/ai-load-test.mjs
 *
 * Sustained RPM (paced):
 *   TARGET_RPM=120 DURATION_S=60 CCU=24 TIMEOUT_MS=60000 node scripts/ai-load-test.mjs
 *
 * Raise .env for the test, then revert:
 *   AI_MAX_CONCURRENT=32   (or match CCU if you want to test that high)
 *   AI_REQUESTS_PER_IP_PER_MINUTE=20000
 *   RATE_LIMIT_PER_MINUTE=20000
 */
const base = (process.env.AI_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const mode = (process.env.MODE || '').toLowerCase() || (process.env.TARGET_RPM ? 'timed' : 'fixed');
const targetRpm = Math.max(0, Number(process.env.TARGET_RPM || 0) || 0);
const durationS = Math.max(10, Number(process.env.DURATION_S || 60) || 60);
const waves = Math.max(1, Number(process.env.WAVES || 3) || 3);
const ccuDefault = mode === 'wave' ? 24 : targetRpm > 0 ? Math.max(8, Math.ceil((targetRpm / 60) * 12)) : 4;
const ccu = Math.max(1, Number(process.env.CCU || ccuDefault) || ccuDefault);
const totalFixed = Math.max(ccu, Number(process.env.REQUESTS || ccu * 10) || ccu * 10);
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

/** Exactly `n` asks with up to `concurrency` in flight. */
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
          results.push(await worker(i));
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

/** Fire CCU asks, wait for all to finish, repeat. True “N at a time” test. */
async function poolWaves(concurrency, waveCount, worker) {
  const results = [];
  let seq = 0;
  for (let w = 1; w <= waveCount; w++) {
    const started = Date.now();
    process.stdout.write(`  wave ${w}/${waveCount}: firing ${concurrency} asks…\n`);
    const batch = await Promise.all(Array.from({ length: concurrency }, () => worker(seq++)));
    results.push(...batch);
    const ok = batch.filter((r) => r.ok).length;
    const wall = ((Date.now() - started) / 1000).toFixed(1);
    process.stdout.write(`  wave ${w} done: ok=${ok}/${concurrency} wall_s=${wall}\n`);
  }
  return results;
}

/** Paced sustained load — requires TARGET_RPM > 0. */
async function poolTimed(concurrency, durationMs, rpm, worker) {
  if (!(rpm > 0)) {
    throw new Error('Timed mode needs TARGET_RPM>0. For high CCU use MODE=wave instead of TARGET_RPM=0.');
  }
  const results = [];
  const deadline = Date.now() + durationMs;
  let next = 0;
  let lastReport = 0;
  const minGapMs = Math.floor(60000 / rpm);
  let nextStartAt = Date.now();
  const startLock = { p: Promise.resolve() };

  async function takeSlot() {
    let release;
    const wait = new Promise((r) => {
      release = r;
    });
    const prev = startLock.p;
    startLock.p = prev.then(() => wait);
    await prev;
    const now = Date.now();
    if (now < nextStartAt) await sleep(nextStartAt - now);
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
          const r = await worker(next++);
          results.push(r);
          if (results.length - lastReport >= 10) {
            lastReport = results.length;
            const elapsed = (Date.now() - (deadline - durationMs)) / 1000;
            const okRpm = elapsed > 0 ? ((results.filter((x) => x.ok).length / elapsed) * 60).toFixed(1) : '0';
            process.stdout.write(`  progress ${results.length}  elapsed=${elapsed.toFixed(0)}s  rpm_ok≈${okRpm}\n`);
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
    hints.push(`AI_BUSY (${byCode['503:AI_BUSY']}x): LLM/app concurrent slots full — raise AI_MAX_CONCURRENT only if the model can handle it.`);
  }
  if (byCode['429:TOO_MANY_REQUESTS']) {
    hints.push(
      `TOO_MANY_REQUESTS (${byCode['429:TOO_MANY_REQUESTS']}x): raise AI_REQUESTS_PER_IP_PER_MINUTE and RATE_LIMIT_PER_MINUTE for the test.`,
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
  const okRpm = wallMs > 0 ? (ok.length / (wallMs / 1000)) * 60 : 0;
  const instantFail = fail.filter((r) => r.latencyMs < 500).length;

  console.log('\n=== Summary ===');
  console.log(`ok=${ok.length} fail=${fail.length} total=${results.length} wall_s=${(wallMs / 1000).toFixed(1)}`);
  console.log(`rpm_ok=${okRpm.toFixed(1)}  success=${results.length ? ((ok.length / results.length) * 100).toFixed(1) : 0}%`);
  if (instantFail > results.length * 0.5) {
    console.log(
      `note: ${instantFail} fails were <500ms (rate-limit spam). Ignore huge fail counts; trust rpm_ok and wave ok/CCU.`,
    );
  }
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
  // Wave / capacity tests: judge by ok rate, not tiny 429 spam.
  const meaningful = results.filter((r) => r.ok || r.latencyMs >= 500 || r.code === 'AI_BUSY' || r.code === 'TIMEOUT');
  const meaningfulFail = meaningful.filter((r) => !r.ok).length;
  return meaningful.length > 0 && meaningfulFail > meaningful.length * 0.5 ? 1 : ok.length === 0 ? 1 : 0;
}

async function main() {
  if (mode === 'timed' && !(targetRpm > 0)) {
    console.error('Do not use TARGET_RPM=0. Use MODE=wave CCU=200 WAVES=3 for “N at once”.');
    process.exit(2);
  }

  console.log(`AI load test → ${base}/api/v1/ai/ask`);
  if (mode === 'wave') {
    console.log(`mode=wave  CCU=${ccu}  WAVES=${waves}  TIMEOUT_MS=${timeoutMs}`);
  } else if (mode === 'timed') {
    console.log(`mode=timed  TARGET_RPM=${targetRpm}  DURATION_S=${durationS}  CCU=${ccu}  TIMEOUT_MS=${timeoutMs}`);
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
  let results;
  if (mode === 'wave') {
    results = await poolWaves(ccu, waves, askOnce);
  } else if (mode === 'timed') {
    results = await poolTimed(ccu, durationS * 1000, targetRpm, askOnce);
  } else {
    results = await poolFixed(totalFixed, ccu, askOnce);
  }
  process.exit(printSummary(results, Date.now() - wallStart));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
