#!/usr/bin/env node
/**
 * Calls the Latiyal endpoints the backend uses and saves the raw responses, with the
 * token redacted, to backend/latiyal-samples/. Use it to check the field mapping
 * against real data.
 *
 *   npm run latiyal:probe                 # liveMatchList, then details of the first live match
 *   npm run latiyal:probe -- 12345        # details of match 12345
 *
 * Reads LATIYAL_API_URL and LATIYAL_API_TOKEN from backend/.env. Costs 4 API calls.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(BACKEND_ROOT, 'latiyal-samples');

function parseEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const env = { ...parseEnv(join(BACKEND_ROOT, '.env')), ...process.env };
const baseUrl = (env.LATIYAL_API_URL || 'https://api.latiyalinfotech.com/apiv5').replace(/\/+$/, '');
const token = (env.LATIYAL_API_TOKEN || '').trim();
if (!token) {
  console.error('LATIYAL_API_TOKEN is empty in backend/.env');
  process.exit(1);
}

const redact = (text) => text.split(token).join('[REDACTED]');

async function call(endpoint, matchId) {
  const init = { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) };
  if (matchId !== undefined) {
    const form = new FormData();
    form.append('match_id', String(matchId));
    Object.assign(init, { method: 'POST', body: form });
  }
  try {
    const response = await fetch(`${baseUrl}/${endpoint}/${encodeURIComponent(token)}`, init);
    const text = redact(await response.text());
    const file = join(OUT_DIR, `${endpoint}${matchId === undefined ? '' : `-${matchId}`}.json`);
    let body;
    try {
      body = JSON.parse(text);
      writeFileSync(file, JSON.stringify(body, null, 2));
    } catch {
      writeFileSync(file, text);
    }
    const count = Array.isArray(body?.data) ? ` · ${body.data.length} items` : '';
    console.log(`${endpoint}${matchId === undefined ? '' : ` (match ${matchId})`}: HTTP ${response.status} · status=${body?.status} · msg=${body?.msg ?? '-'}${count} -> ${file}`);
    return body;
  } catch (error) {
    console.error(`${endpoint}: ${redact(error instanceof Error ? error.message : String(error))}`);
    return null;
  }
}

mkdirSync(OUT_DIR, { recursive: true });
let matchId = process.argv[2] ? Number(process.argv[2]) : undefined;
if (matchId === undefined) {
  const list = await call('liveMatchList');
  const items = Array.isArray(list?.data) ? list.data : Object.values(list?.data ?? {});
  matchId = items.find((item) => item && typeof item === 'object' && item.match_id)?.match_id;
  if (!matchId) {
    console.log('No live match found. Run again with a match id: npm run latiyal:probe -- <match_id>');
    process.exit(0);
  }
}
for (const endpoint of ['liveMatch', 'scorecardByMatchId', 'commentary']) {
  await call(endpoint, matchId);
}
console.log(`\nSend the files in ${OUT_DIR} to the backend developer to verify the field mapping.`);
