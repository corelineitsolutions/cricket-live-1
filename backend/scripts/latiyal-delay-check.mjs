#!/usr/bin/env node
/**
 * Live delay check: polls Latiyal directly and our server side by side and reports how
 * long our server takes to show each new score that Latiyal publishes.
 *
 *   npm run latiyal:delay                          # first live match, 2 minutes, every 1 s
 *   npm run latiyal:delay -- 5484                  # a specific Latiyal match id
 *   npm run latiyal:delay -- 5484 --duration 300 --interval 1000 --server http://127.0.0.1:3000
 *
 * Columns:
 *   LATIYAL  liveMatch called directly on api.latiyalinfotech.com (the source)
 *   SERVER   GET /api/v1/matches/{id} on our API (what the app and the socket get)
 *   FEED     GET /api/v1/feeds/liveMatch on our API (cached passthrough, 1 s)
 *
 * Reads LATIYAL_API_URL and LATIYAL_API_TOKEN from backend/.env. The token is never printed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

function parseArgs(argv) {
  const options = { matchId: null, server: null, intervalMs: 1000, durationS: 120 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--server') options.server = argv[++i];
    else if (arg === '--interval') options.intervalMs = Math.max(300, Number(argv[++i]) || 1000);
    else if (arg === '--duration') options.durationS = Math.max(5, Number(argv[++i]) || 120);
    else if (/^\d+$/.test(arg)) options.matchId = Number(arg);
  }
  return options;
}

const env = { ...parseEnv(join(BACKEND_ROOT, '.env')), ...process.env };
const options = parseArgs(process.argv.slice(2));
const latiyalUrl = (env.LATIYAL_API_URL || 'https://api.latiyalinfotech.com/apiv5').replace(/\/+$/, '');
const token = (env.LATIYAL_API_TOKEN || '').trim();
const server = (options.server || `http://127.0.0.1:${env.PORT || 3000}`).replace(/\/+$/, '');

if (!token) {
  console.error('LATIYAL_API_TOKEN is empty in backend/.env (run this on the server, inside backend/).');
  process.exit(1);
}

const redact = (text) => String(text).split(token).join('[REDACTED]');
const clock = (ms = Date.now()) => new Date(ms).toTimeString().slice(0, 8);
const pad = (text, width) => String(text).padEnd(width);

async function timed(fn) {
  const startedAt = Date.now();
  try {
    return { value: await fn(), ms: Date.now() - startedAt, error: null };
  } catch (error) {
    return { value: null, ms: Date.now() - startedAt, error: redact(error instanceof Error ? error.message : error) };
  }
}

async function latiyal(endpoint, form) {
  const init = { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) };
  if (form) {
    const body = new FormData();
    for (const [key, value] of Object.entries(form)) body.append(key, String(value));
    Object.assign(init, { method: 'POST', body });
  }
  const response = await fetch(`${latiyalUrl}/${endpoint}/${encodeURIComponent(token)}`, init);
  const body = await response.json();
  if (!body?.status) throw new Error(`Latiyal ${endpoint}: ${body?.msg ?? `HTTP ${response.status}`}`);
  return body.data;
}

async function ours(path) {
  const response = await fetch(`${server}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error(`${path}: HTTP ${response.status} ${body?.message ?? ''}`.trim());
  return body.data;
}

const asRecord = (value) => (Array.isArray(value) ? value[0] : value) ?? null;
const num = (value) => {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(n) && String(value ?? '').trim() !== '' ? n : null;
};

/** Last "188-6 (20)" style score line of one side of a Latiyal record. */
function sideScore(raw, side) {
  const text = String(raw[`team_${side}_scores`] ?? raw[`team_${side}_score`] ?? '').trim();
  if (!text) return null;
  const segment = text.split('&').map((part) => part.trim()).at(-1);
  const match = /^(\d+)(?:\s*[-/]\s*(\d+))?(?:\s*\(?\s*([\d.]+))?/.exec(segment);
  if (!match) return null;
  return {
    score: Number(match[1]),
    wickets: match[2] ? Number(match[2]) : 0,
    overs: num(match[3]) ?? num(raw[`team_${side}_over`] ?? raw[`team_${side}_overs`]) ?? 0,
  };
}

/** Current batting score of a Latiyal liveMatch record as "score/wickets (overs)". */
function latiyalKey(data) {
  const raw = asRecord(data);
  if (!raw || typeof raw !== 'object') return null;
  const batting = num(raw.batting_team);
  const side = batting !== null && batting === num(raw.team_a_id) ? 'a' : batting !== null && batting === num(raw.team_b_id) ? 'b' : null;
  const line = side ? sideScore(raw, side) : (sideScore(raw, 'b') ?? sideScore(raw, 'a'));
  return line ? `${line.score}/${line.wickets} (${line.overs})` : null;
}

function serverKey(match) {
  if (!match || match.score === null || match.score === undefined) return null;
  return `${match.score}/${match.wickets ?? 0} (${match.overs ?? 0})`;
}

async function pickMatchId() {
  if (options.matchId) return options.matchId;
  const list = await latiyal('liveMatchList');
  const items = Array.isArray(list) ? list : Object.values(list ?? {});
  const first = items.find((item) => item && item.match_id);
  if (!first) {
    console.log('Latiyal has no live match right now. Run again with a match id: npm run latiyal:delay -- <match_id>');
    process.exit(0);
  }
  console.log(`Live matches on Latiyal: ${items.map((item) => `${item.match_id} (${item.team_a_short ?? item.team_a ?? '?'} v ${item.team_b_short ?? item.team_b ?? '?'})`).join(', ')}`);
  return Number(first.match_id);
}

const matchId = await pickMatchId();
console.log(`\nMatch ${matchId} · server ${server} · every ${options.intervalMs} ms for ${options.durationS} s\n`);
console.log(`${pad('TIME', 9)}${pad('LATIYAL (direct)', 26)}${pad('SERVER /matches', 26)}${pad('FEED /feeds/liveMatch', 26)}RESULT`);

/** score key -> when it was first seen at each source */
const firstSeen = new Map();
const delays = [];
let behindTicks = 0;
let ticks = 0;
const endAt = Date.now() + options.durationS * 1000;

while (Date.now() < endAt) {
  const tickStartedAt = Date.now();
  const [direct, live, feed] = await Promise.all([
    timed(() => latiyal('liveMatch', { match_id: matchId })),
    timed(() => ours(`/api/v1/matches/${matchId}`)),
    timed(() => ours(`/api/v1/feeds/liveMatch?match_id=${matchId}`)),
  ]);
  ticks += 1;

  const directKey = direct.error ? null : latiyalKey(direct.value);
  const liveKey = live.error ? null : serverKey(live.value);
  const feedKey = feed.error ? null : latiyalKey(feed.value?.data);
  const now = Date.now();

  for (const [source, key] of [['latiyal', directKey], ['server', liveKey], ['feed', feedKey]]) {
    if (!key) continue;
    const seen = firstSeen.get(key) ?? {};
    if (seen[source] === undefined) {
      seen[source] = now;
      if (source === 'latiyal') seen.tick = ticks;
    }
    firstSeen.set(key, seen);
  }

  const notes = [];
  for (const [key, seen] of firstSeen) {
    if (seen.latiyal !== undefined && seen.server !== undefined && !seen.reported) {
      seen.reported = true;
      const delay = Math.max(0, seen.server - seen.latiyal);
      // A score already showing on the first poll was not published during the test.
      if (seen.tick > 1) {
        delays.push(delay);
        notes.push(`${key} reached server +${(delay / 1000).toFixed(1)} s after Latiyal`);
      }
    }
  }

  let result = directKey && liveKey ? (directKey === liveKey ? 'SAME' : 'DIFF') : 'n/a';
  if (result === 'DIFF') behindTicks += 1;
  if (live.value?.stale) result += ' (server stale)';

  const cell = (key, res) => (res.error ? `error ${res.ms}ms` : `${key ?? '-'} ${res.ms}ms`);
  console.log(
    `${pad(clock(tickStartedAt), 9)}${pad(cell(directKey, direct), 26)}${pad(cell(liveKey, live), 26)}${pad(cell(feedKey, feed), 26)}${result}${notes.length ? `  · ${notes.join(' · ')}` : ''}`,
  );
  for (const res of [direct, live, feed]) {
    if (res.error && ticks <= 3) console.log(`         ${res.error}`);
  }

  await new Promise((resolve) => setTimeout(resolve, Math.max(0, options.intervalMs - (Date.now() - tickStartedAt))));
}

console.log('\nSummary');
console.log(`  polls: ${ticks}, server showed a different score than Latiyal on ${behindTicks} of them`);
if (delays.length === 0) {
  console.log('  no new score appeared on Latiyal during the test (try a longer --duration while a ball is bowled)');
} else {
  const avg = delays.reduce((sum, d) => sum + d, 0) / delays.length;
  console.log(`  new scores seen: ${delays.length}`);
  console.log(`  server delay after Latiyal: avg ${(avg / 1000).toFixed(1)} s, max ${(Math.max(...delays) / 1000).toFixed(1)} s`);
  console.log(`  (resolution is the poll interval, ${options.intervalMs} ms; 0-${(options.intervalMs / 1000).toFixed(1)} s means "no delay")`);
}
