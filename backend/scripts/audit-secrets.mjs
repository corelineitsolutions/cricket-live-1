#!/usr/bin/env node
/**
 * Secret leak audit. Looks for the real secret values from .env (backend) in every
 * other file of the repository, including build output (dist/, admin/.next/), and for
 * server-only variable names in the admin panel code. Prints key names and file paths
 * only, never values.
 *
 *   npm run audit:secrets
 *
 * Exit code 1 when something leaks.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(BACKEND_ROOT, '..');
const SECRET_KEYS = [
  'LATIYAL_API_TOKEN',
  'JWT_SECRET',
  'FIREBASE_PRIVATE_KEY',
  'REDIS_PASSWORD',
  'ADMIN_INITIAL_PASSWORD',
  'METRICS_TOKEN',
  'DATABASE_URL',
];
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', '.turbo']);
/** Real env files hold the secrets; .env.example is scanned like any other file. */
const SKIP_FILES = /^\.env(\.(?!example$).*)?$/;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SERVER_ONLY_NAMES = /\b(LATIYAL_API_TOKEN|DATABASE_URL|JWT_SECRET|FIREBASE_PRIVATE_KEY|FIREBASE_CLIENT_EMAIL|REDIS_PASSWORD|ADMIN_INITIAL_PASSWORD|METRICS_TOKEN)\b/;

function parseEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

function secretsFromEnv() {
  const env = { ...parseEnv(join(BACKEND_ROOT, '.env')) };
  const secrets = [];
  for (const key of SECRET_KEYS) {
    let value = env[key] ?? '';
    if (key === 'DATABASE_URL') {
      // Only the password part is secret.
      try {
        value = decodeURIComponent(new URL(value).password);
      } catch {
        value = '';
      }
    }
    if (key === 'FIREBASE_PRIVATE_KEY') {
      // The base64 body of the key is distinctive; headers are not.
      value = value.replace(/-----[A-Z ]+-----/g, '').replace(/\\n|\s/g, '').slice(0, 64);
    }
    if (value.length >= 8) secrets.push({ key, value });
  }
  return secrets;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (entry.isFile() && !SKIP_FILES.test(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}

const findings = [];
const secrets = secretsFromEnv();
let scanned = 0;

for (const file of walk(ROOT)) {
  if (statSync(file).size > MAX_FILE_BYTES) continue;
  const content = readFileSync(file, 'utf8');
  scanned += 1;
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  for (const { key, value } of secrets) {
    if (content.includes(value)) findings.push(`${key} value found in ${rel}`);
  }
  if (/-----BEGIN (RSA )?PRIVATE KEY-----/.test(content) && !rel.startsWith('backend/scripts/')) {
    findings.push(`private key block found in ${rel}`);
  }
  const isAdminCode = rel.startsWith('admin/src/') || rel.startsWith('admin/.next/static/');
  if (isAdminCode && SERVER_ONLY_NAMES.test(content)) {
    findings.push(`server-only variable name referenced in admin code: ${rel}`);
  }
}

for (const ignoreFile of ['.gitignore', 'admin/.gitignore']) {
  const path = join(ROOT, ignoreFile);
  if (!existsSync(path)) {
    findings.push(`${ignoreFile} is missing`);
    continue;
  }
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).map((line) => line.trim());
  if (!lines.some((line) => line === '.env' || line === '.env*' || line === '.env*.local' || line === '/.env')) {
    findings.push(`${ignoreFile} does not ignore .env files`);
  }
}

console.log(`Scanned ${scanned} files for ${secrets.length} secret values from .env.`);
if (findings.length > 0) {
  for (const finding of findings) console.log(`LEAK  ${finding}`);
  process.exitCode = 1;
} else {
  console.log('PASS  no secret values or server-only variables found outside .env');
}
