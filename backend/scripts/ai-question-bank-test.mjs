#!/usr/bin/env node
/**
 * Run the Cricket AI test question bank against POST /api/v1/ai/ask.
 *
 * From /home/cricket-live-1/backend (repo root questions/ sits one level up):
 *
 *   # all questions (needs raised rate limits for a long run)
 *   MATCH_ID=14761 node scripts/ai-question-bank-test.mjs
 *
 *   # slice
 *   FROM=1 TO=55 MATCH_ID=14761 node scripts/ai-question-bank-test.mjs
 *   FROM=56 TO=115 node scripts/ai-question-bank-test.mjs
 *
 *   # section by number range helpers
 *   SECTION=live MATCH_ID=14761 node scripts/ai-question-bank-test.mjs
 *   SECTION=ipl node scripts/ai-question-bank-test.mjs
 *   SECTION=icc node scripts/ai-question-bank-test.mjs
 *   SECTION=lang node scripts/ai-question-bank-test.mjs
 *   SECTION=safety node scripts/ai-question-bank-test.mjs
 *
 * Env:
 *   AI_BASE       default http://127.0.0.1:3000
 *   BANK          path to question bank (default ../questions/cricket_ai_test_question_bank.txt)
 *   MATCH_ID      live match for live/follow-up questions (omit for pure archive)
 *   FROM / TO     inclusive question numbers (default 1–300)
 *   SECTION       live|ipl|icc|lang|safety|all
 *   CONCURRENCY   parallel asks (default 1 — sequential is safest for review)
 *   DELAY_MS      pause between asks (default 3000 — Groq free tier needs breathing room)
 *   RETRIES       retries on AI_BUSY / 429 (default 4)
 *   BUSY_WAIT_MS  base wait before AI_BUSY retry (default 15000; grows per attempt)
 *   TIMEOUT_MS    per ask (default 60000)
 *   OUT           results jsonl path (default ./tmp/ai-question-bank-results.jsonl)
 *   ONLY_LIVE     1 = only questions that need a match (skip archive)
 *   ONLY_ARCHIVE  1 = skip live-oriented questions
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = (process.env.AI_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const bankPath = resolve(
  process.env.BANK || resolve(__dirname, '../../questions/cricket_ai_test_question_bank.txt'),
);
const matchId = process.env.MATCH_ID?.trim() || '';
const concurrency = Math.max(1, Number(process.env.CONCURRENCY || 1) || 1);
const delayMs = Math.max(0, Number(process.env.DELAY_MS || 3000) || 3000);
const retries = Math.max(0, Number(process.env.RETRIES || 4) || 4);
const busyWaitMs = Math.max(1000, Number(process.env.BUSY_WAIT_MS || 15000) || 15000);
const timeoutMs = Math.max(5000, Number(process.env.TIMEOUT_MS || 60000) || 60000);
const outPath = resolve(process.env.OUT || resolve(__dirname, '../tmp/ai-question-bank-results.jsonl'));
const onlyLive = process.env.ONLY_LIVE === '1';
const onlyArchive = process.env.ONLY_ARCHIVE === '1';

const SECTIONS = {
  live: [1, 55],
  ipl: [56, 115],
  icc: [116, 175],
  lang: [176, 260],
  safety: [261, 300],
  all: [1, 300],
};

function rangeFromEnv() {
  const section = (process.env.SECTION || 'all').toLowerCase();
  const preset = SECTIONS[section] || SECTIONS.all;
  const from = Math.max(1, Number(process.env.FROM || preset[0]) || preset[0]);
  const to = Math.max(from, Number(process.env.TO || preset[1]) || preset[1]);
  return { from, to, section };
}

/** Live / follow-up questions that should send matchId when available. */
function needsMatch(id, text) {
  if (id >= 1 && id <= 55) return true;
  if (id >= 176 && id <= 190) return true;
  if (id >= 191 && id <= 210) return /मैच|रन चाहिए|ओवर|जीत|बल्ले|मैदान|स्कोर|सारांश|विकेट|target|chase|live/i.test(text);
  if (id >= 211 && id <= 240) {
    return /score|run|over|target|chase|wicket|batting|winning|ground|pitch|match|kitne|kitna|abhi|next|last over|ind vs|chahiye/i.test(
      text,
    );
  }
  if (id >= 261 && id <= 280) return /current|chase|venue|prediction|today|wicket|over|match/i.test(text);
  if (id >= 281 && id <= 300) return /live score|stale|prediction when|match to another|no match is live/i.test(text);
  return /current score|this match|this venue|this ground|winning chance|required run|projected|next \d+ over|chase/i.test(
    text,
  );
}

function guessLanguage(text) {
  return /[\u0900-\u097F]/.test(text) ? 'hi' : 'en';
}

/** Drop trailing tester instructions in parentheses. */
function cleanQuestion(raw) {
  let q = raw.trim();
  q = q.replace(
    /\s*\((?:Check|Ask|Use|Clarify|The AI|Give|Provide|Define|If no|If the|Otherwise).*$/i,
    '',
  );
  q = q.replace(/\s+/g, ' ').trim();
  return q;
}

function parseBank(text) {
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\d{1,3})\.\s+(.+)\s*$/.exec(line.trim());
    if (!m) continue;
    const id = Number(m[1]);
    const question = cleanQuestion(m[2]);
    if (question.length < 2) continue;
    items.push({ id, question, language: guessLanguage(question), live: needsMatch(id, question) });
  }
  return items;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isBusy(row) {
  return row.code === 'AI_BUSY' || row.status === 429 || row.status === 503;
}

async function askOnce(item, index, attempt) {
  const deviceId = `qbank-${item.id}-a${attempt}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const useMatch = Boolean(matchId) && item.live;
  const body = {
    question: item.question.slice(0, 500),
    language: item.language,
    deviceId,
    ...(useMatch ? { matchId } : {}),
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
    const json = await res.json().catch(() => null);
    const latencyMs = Date.now() - started;
    const ok = res.ok && json?.success === true;
    const answer = ok ? String(json?.data?.answer ?? '') : '';
    return {
      id: item.id,
      index,
      ok,
      status: res.status,
      code: json?.code ?? null,
      latencyMs,
      attempts: attempt,
      language: item.language,
      live: item.live,
      matchId: useMatch ? matchId : null,
      question: item.question,
      answer,
      answerPreview: answer.slice(0, 240).replace(/\s+/g, ' '),
      toolsUsed: json?.data?.toolsUsed ?? json?.data?.sources ?? [],
      mocked: json?.data?.mocked ?? null,
      error: ok ? null : json?.message || `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      id: item.id,
      index,
      ok: false,
      status: 0,
      code: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
      latencyMs: Date.now() - started,
      attempts: attempt,
      language: item.language,
      live: item.live,
      matchId: useMatch ? matchId : null,
      question: item.question,
      answer: '',
      answerPreview: '',
      toolsUsed: [],
      mocked: null,
      error: String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function ask(item, index) {
  let last = await askOnce(item, index, 1);
  for (let attempt = 2; attempt <= retries + 1 && isBusy(last); attempt++) {
    // Provider RPM limits need tens of seconds, not 2–6s.
    const wait = busyWaitMs * (attempt - 1);
    process.stdout.write(`  retry #${item.id} attempt ${attempt} after ${wait}ms (${last.code})\n`);
    await sleep(wait);
    last = await askOnce(item, index, attempt);
  }
  return last;
}

async function runPool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      if (delayMs > 0) await sleep(delayMs);
      results[i] = await worker(items[i], i);
      const done = results.filter(Boolean).length;
      if (done % 10 === 0 || done === items.length) {
        const last = results[i];
        process.stdout.write(
          `  [${done}/${items.length}] #${last.id} ${last.ok ? 'OK' : 'FAIL'} ${last.latencyMs}ms  ${last.question.slice(0, 50)}\n`,
        );
      }
    }
  });
  await Promise.all(runners);
  return results;
}

function toCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = [
    'id',
    'ok',
    'status',
    'code',
    'latencyMs',
    'language',
    'live',
    'matchId',
    'mocked',
    'question',
    'answerPreview',
    'error',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.ok,
        r.status,
        r.code,
        r.latencyMs,
        r.language,
        r.live,
        r.matchId,
        r.mocked,
        esc(r.question),
        esc(r.answerPreview),
        esc(r.error),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const { from, to, section } = rangeFromEnv();
  console.log(`AI question-bank test → ${base}/api/v1/ai/ask`);
  console.log(`bank=${bankPath}`);
  console.log(`section=${section} FROM=${from} TO=${to} MATCH_ID=${matchId || '(none)'} CONCURRENCY=${concurrency}`);

  const raw = await readFile(bankPath, 'utf8');
  let items = parseBank(raw).filter((q) => q.id >= from && q.id <= to);
  if (onlyLive) items = items.filter((q) => q.live);
  if (onlyArchive) items = items.filter((q) => !q.live);
  if (!items.length) {
    console.error('No questions matched the filter.');
    process.exit(2);
  }
  console.log(`questions=${items.length} (parsed from bank)`);

  try {
    const statusRes = await fetch(`${base}/api/v1/ai/status`);
    const statusJson = await statusRes.json().catch(() => null);
    console.log('GET /ai/status:', statusRes.status, JSON.stringify(statusJson?.data ?? statusJson));
    if (statusJson?.data?.available === false) {
      console.error('AI unavailable. Aborting.');
      process.exit(2);
    }
  } catch (err) {
    console.error('Cannot reach API:', err.message || err);
    process.exit(2);
  }

  if (!matchId) {
    const liveCount = items.filter((q) => q.live).length;
    if (liveCount) {
      console.log(`Note: ${liveCount} live-oriented questions will run WITHOUT matchId (set MATCH_ID=… for better results).`);
    }
  }

  await mkdir(dirname(outPath), { recursive: true });
  const stream = createWriteStream(outPath, { flags: 'w' });
  const wallStart = Date.now();
  const results = await runPool(items, async (item, index) => {
    const row = await ask(item, index);
    stream.write(`${JSON.stringify(row)}\n`);
    return row;
  });
  stream.end();
  const wallMs = Date.now() - wallStart;

  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const csvPath = outPath.replace(/\.jsonl$/i, '.csv');
  await writeFile(csvPath, toCsv(results), 'utf8');

  const byCode = {};
  for (const r of fail) {
    const key = `${r.status}:${r.code || 'ERR'}`;
    byCode[key] = (byCode[key] || 0) + 1;
  }

  console.log('\n=== Summary ===');
  console.log(`ok=${ok.length} fail=${fail.length} total=${results.length} wall_s=${(wallMs / 1000).toFixed(1)}`);
  console.log(`success=${((ok.length / results.length) * 100).toFixed(1)}%`);
  if (Object.keys(byCode).length) console.log('failures:', byCode);
  console.log(`jsonl=${outPath}`);
  console.log(`csv=${csvPath}`);
  console.log('Review CSV/JSONL for Pass/Fail/Partial by reading answerPreview.');

  process.exit(fail.length > results.length * 0.2 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
