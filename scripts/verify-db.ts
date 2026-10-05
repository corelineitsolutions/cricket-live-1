/**
 * Read-only MySQL check for deployments: connection, applied migrations, indexes,
 * charset/collation and time zone. Never writes, never prints DATABASE_URL.
 *
 *   npm run db:verify
 *
 * Exit code 1 when a check fails.
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

config();

type Level = 'PASS' | 'WARN' | 'FAIL';
const results: Array<{ level: Level; check: string; detail: string }> = [];
const report = (level: Level, check: string, detail: string) => results.push({ level, check, detail });

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

function expectedMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Index names declared in the migration files, keyed by table. */
function expectedIndexes(): Map<string, Set<string>> {
  const byTable = new Map<string, Set<string>>();
  const add = (table: string, index: string) => {
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table)!.add(index);
  };
  for (const name of expectedMigrations()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
    for (const block of sql.matchAll(/CREATE TABLE `(\w+)` \(([\s\S]*?)\) DEFAULT/g)) {
      for (const index of block[2].matchAll(/(?:UNIQUE )?INDEX `(\w+)`/g)) add(block[1], index[1]);
    }
    for (const index of sql.matchAll(/CREATE (?:UNIQUE )?INDEX `(\w+)` ON `(\w+)`/g)) add(index[2], index[1]);
    for (const drop of sql.matchAll(/DROP INDEX `(\w+)` ON `(\w+)`/g)) byTable.get(drop[2])?.delete(drop[1]);
  }
  return byTable;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    report('FAIL', 'config', 'DATABASE_URL is not set');
    return;
  }
  const prisma = new PrismaClient();
  try {
    const [{ version }] = await prisma.$queryRaw<Array<{ version: string }>>`SELECT VERSION() AS version`;
    report('PASS', 'connection', `MySQL ${version}`);

    const [schema] = await prisma.$queryRaw<Array<{ db: string; charset: string; collation: string }>>`
      SELECT SCHEMA_NAME AS db, DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation
      FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()`;
    report(
      schema.charset === 'utf8mb4' ? 'PASS' : 'WARN',
      'database charset',
      `${schema.charset} / ${schema.collation} (tables are created utf8mb4 explicitly; utf8mb4 is recommended as the database default)`,
    );

    const tables = await prisma.$queryRaw<Array<{ name: string; collation: string }>>`
      SELECT TABLE_NAME AS name, TABLE_COLLATION AS collation
      FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '_prisma_migrations'`;
    const nonUtf8 = tables.filter((table) => !table.collation?.startsWith('utf8mb4'));
    report(nonUtf8.length === 0 ? 'PASS' : 'FAIL', 'table charset', nonUtf8.length === 0
      ? `${tables.length} tables use utf8mb4`
      : `not utf8mb4: ${nonUtf8.map((table) => `${table.name} (${table.collation})`).join(', ')}`);

    const [tz] = await prisma.$queryRaw<Array<{ globalTz: string; sessionTz: string; offset: string }>>`
      SELECT @@global.time_zone AS globalTz, @@session.time_zone AS sessionTz,
             CAST(TIMEDIFF(NOW(), UTC_TIMESTAMP()) AS CHAR) AS offset`;
    report(
      tz.offset.startsWith('00:00:00') ? 'PASS' : 'WARN',
      'time zone',
      `global=${tz.globalTz} session=${tz.sessionTz} offset=${tz.offset}. Prisma stores UTC; a UTC server time zone keeps CURRENT_TIMESTAMP defaults consistent.`,
    );

    const applied = await prisma.$queryRaw<Array<{ name: string; finished: Date | null; rolledBack: Date | null }>>`
      SELECT migration_name AS name, finished_at AS finished, rolled_back_at AS rolledBack FROM _prisma_migrations`;
    const done = new Set(applied.filter((row) => row.finished && !row.rolledBack).map((row) => row.name));
    const failed = applied.filter((row) => !row.finished && !row.rolledBack).map((row) => row.name);
    const pending = expectedMigrations().filter((name) => !done.has(name));
    if (failed.length > 0) {
      report('FAIL', 'migrations', `failed migrations: ${failed.join(', ')} (resolve manually, see docs/DEPLOYMENT.md)`);
    } else if (pending.length > 0) {
      report('FAIL', 'migrations', `pending: ${pending.join(', ')} (run: npm run prisma:deploy)`);
    } else {
      report('PASS', 'migrations', `${done.size} applied, none pending`);
    }

    const present = await prisma.$queryRaw<Array<{ tableName: string; indexName: string }>>`
      SELECT DISTINCT TABLE_NAME AS tableName, INDEX_NAME AS indexName
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()`;
    const have = new Set(present.map((row) => `${row.tableName}.${row.indexName}`));
    const missing: string[] = [];
    let expectedCount = 0;
    for (const [table, indexes] of expectedIndexes()) {
      for (const index of indexes) {
        expectedCount += 1;
        if (!have.has(`${table}.${index}`)) missing.push(`${table}.${index}`);
      }
    }
    report(missing.length === 0 ? 'PASS' : 'FAIL', 'indexes', missing.length === 0
      ? `${expectedCount} expected indexes present`
      : `missing: ${missing.join(', ')}`);
  } catch (error) {
    const code = (error as { code?: string; errorCode?: string }).code ?? (error as { errorCode?: string }).errorCode;
    const lines = error instanceof Error ? error.message.split('\n').map((line) => line.trim()).filter(Boolean) : [];
    const firstLine = lines.find((line) => !line.startsWith('Invalid `prisma')) ?? lines[0] ?? '';
    const detail = firstLine.replace(/mysql:\/\/\S+/gi, 'mysql://[redacted]') || 'unknown error';
    report('FAIL', 'connection', `cannot query MySQL${code ? ` (${code})` : ''}: ${detail}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().finally(() => {
  for (const { level, check, detail } of results) {
    console.log(`${level.padEnd(4)}  ${check.padEnd(16)}  ${detail}`);
  }
  if (results.some((result) => result.level === 'FAIL')) {
    process.exitCode = 1;
  }
});
