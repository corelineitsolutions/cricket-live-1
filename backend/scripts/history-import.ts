/**
 * Imports Cricsheet classic CSV files into the hist_* tables.
 *
 *   npm run history:import -- --dir <csv dir> --dry-run                    # parse + validate only, no DB
 *   npm run history:import -- --dir <csv dir> --limit 50 --database <db>   # small real import
 *   npm run history:import -- --dir <csv dir> --database <db> --confirm-full-import
 *   npm run history:import -- --resume --dir <csv dir> --database <db>
 *   npm run history:import -- --aggregates-only --database <db>
 *   npm run history:import -- --rollback-run <id> --database <db>
 *
 * Uses HISTORY_DATABASE_URL when set, otherwise DATABASE_URL. Every write needs
 * `--database <name>` matching the target database, plus `--allow-remote-database` for a
 * non-local host. Never prints the URL or credentials.
 * Data: Cricsheet (https://cricsheet.org), ODC-By 1.0.
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rebuildAggregates } from '../src/history/import/aggregates.builder';
import { HistoryImportService } from '../src/history/import/history-import.service';
import { ImportReport, RunCounters } from '../src/history/import/import.types';
import { PrismaHistoryStore } from '../src/history/import/prisma-history.store';
import { safeErrorMessage } from '../src/history/import/safe-error';

config();

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    limit: { type: 'string' },
    files: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    resume: { type: 'boolean', default: false },
    'update-changed': { type: 'boolean', default: false },
    'rollback-run': { type: 'string' },
    'aggregates-only': { type: 'boolean', default: false },
    'no-aggregates': { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '2' },
    'max-files-per-second': { type: 'string', default: '0' },
    'batch-size': { type: 'string', default: '5000' },
    database: { type: 'string' },
    'confirm-full-import': { type: 'boolean', default: false },
    'allow-production': { type: 'boolean', default: false },
    'allow-remote-database': { type: 'boolean', default: false },
    report: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

const log = (message: string) => console.log(`[history-import] ${message}`);
const fail = (message: string): never => {
  console.error(`[history-import] ${message}`);
  process.exit(1);
};

function positiveInt(name: string, raw: string | undefined, allowZero = false): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) fail(`--${name} must be a ${allowZero ? 'non-negative' : 'positive'} integer`);
  return value;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** host:port/database only; user and password are never shown. */
function describeTarget(url: string): { label: string; database: string; local: boolean } {
  try {
    const parsed = new URL(url);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return {
      label: `${parsed.hostname}:${parsed.port || '3306'}/${database}`,
      database,
      local: LOCAL_HOSTS.has(parsed.hostname),
    };
  } catch {
    return fail('database URL is not a valid URL');
  }
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function printReport(report: ImportReport, counters: RunCounters) {
  const seconds = report.elapsedMs / 1000;
  log(`status: ${report.status}${report.interrupted ? ' (interrupted)' : ''}${report.runId ? `, run ${report.runId}` : ''}`);
  log(
    `files: seen ${counters.filesSeen}, ${report.dryRun ? 'valid' : 'imported'} ${counters.filesImported}, replaced ${counters.filesReplaced}, ` +
      `skipped ${counters.filesSkipped}, quarantined ${counters.filesQuarantined}, failed ${counters.filesFailed}`,
  );
  log(`deliveries ${report.dryRun ? 'parsed' : 'written'}: ${(report.dryRun ? report.deliveriesParsed : counters.deliveriesImported).toLocaleString('en')}`);
  log(`elapsed ${seconds.toFixed(1)} s, ${(counters.filesSeen / Math.max(seconds, 0.001)).toFixed(1)} files/s`);
  const codes = Object.entries(report.warningCodes).sort((a, b) => b[1] - a[1]);
  if (codes.length > 0) log(`warnings (${counters.warningsCount}): ${codes.map(([c, n]) => `${c}=${n}`).join(', ')}`);
  for (const q of report.quarantined.slice(0, 20)) log(`quarantined ${q.fileName}: ${q.errors}`);
  for (const f of report.failed.slice(0, 20)) log(`failed ${f.fileName}: ${f.error}`);
}

async function main(): Promise<void> {
  if (values.help) {
    console.log(readUsage());
    return;
  }
  const dryRun = values['dry-run'];
  const rollbackRun = positiveInt('rollback-run', values['rollback-run']);
  const aggregatesOnly = values['aggregates-only'];
  const dir = values.dir ?? process.env.HISTORY_CSV_DIR;
  const files = values.files?.split(',').map((f) => f.trim()).filter(Boolean);
  const limit = positiveInt('limit', values.limit);
  const concurrency = positiveInt('concurrency', values.concurrency)!;
  const maxFilesPerSecond = positiveInt('max-files-per-second', values['max-files-per-second'], true)!;
  const batchSize = positiveInt('batch-size', values['batch-size'])!;

  if ([dryRun, rollbackRun !== undefined, aggregatesOnly].filter(Boolean).length > 1) {
    fail('--dry-run, --rollback-run and --aggregates-only cannot be combined');
  }
  const importing = rollbackRun === undefined && !aggregatesOnly;
  if (importing && !dir) fail('--dir (or HISTORY_CSV_DIR) is required');

  if (dryRun) {
    const service = new HistoryImportService(null, (c, total) => log(`${c.filesSeen}/${total} files parsed`));
    process.once('SIGINT', () => service.requestStop());
    const report = await service.run({ dir: dir!, files, limit, dryRun: true, resume: false, updateChanged: false, concurrency, maxFilesPerSecond });
    printReport(report, report.counters);
    if (values.report) writeFileSync(values.report, JSON.stringify(report, null, 2));
    return;
  }

  const url = process.env.HISTORY_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) fail('set HISTORY_DATABASE_URL or DATABASE_URL');
  const target = describeTarget(url!);
  log(`target database: ${target.label}`);
  if (values.database !== target.database) {
    fail(`refusing to write: pass --database ${target.database} to confirm the target database`);
  }
  if (!target.local && !values['allow-remote-database']) {
    fail('target is not a local database: pass --allow-remote-database only for an approved, backed-up target');
  }
  if (process.env.NODE_ENV === 'production' && !values['allow-production']) {
    fail('NODE_ENV=production: pass --allow-production after confirming a backup and a maintenance window');
  }
  if (importing && !files?.length && !limit && !values['confirm-full-import']) {
    fail('importing every file needs --confirm-full-import (or use --limit / --files)');
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const store = new PrismaHistoryStore(prisma, batchSize);
  try {
    if (rollbackRun !== undefined) {
      const result = await store.rollbackRun(rollbackRun);
      log(`run ${rollbackRun} rolled back: ${result.matchesDeleted} matches deleted`);
      if (result.replacedFiles > 0) {
        log(`note: ${result.replacedFiles} matches in this run replaced older versions; re-import those files to restore them`);
      }
    }

    if (importing) {
      const before = await store.historyTableBytes();
      const service = new HistoryImportService(store, (c, total) =>
        log(`${c.filesSeen}/${total} files, ${c.deliveriesImported.toLocaleString('en')} deliveries written`),
      );
      process.once('SIGINT', () => {
        log('stopping after files in flight; resume later with --resume');
        service.requestStop();
      });
      const report = await service.run({
        dir: dir!,
        files,
        limit,
        dryRun: false,
        resume: values.resume,
        updateChanged: values['update-changed'],
        concurrency,
        maxFilesPerSecond,
      });
      printReport(report, report.counters);
      const after = await store.historyTableBytes();
      log(`hist_* tables: ${mb(before)} -> ${mb(after)} (+${mb(after - before)})`);
      if (values.report) writeFileSync(values.report, JSON.stringify(report, null, 2));
      if (report.interrupted) return;
    }

    if (aggregatesOnly || !values['no-aggregates']) {
      const started = Date.now();
      log('rebuilding summary tables...');
      const counts = await rebuildAggregates(prisma);
      log(`summary tables rebuilt in ${((Date.now() - started) / 1000).toFixed(1)} s: ${JSON.stringify(counts)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

function readUsage(): string {
  return [
    'Usage: npm run history:import -- [options]',
    '  --dir <path>                 folder of Cricsheet classic CSV files (or HISTORY_CSV_DIR)',
    '  --files a.csv,b.csv          only these files from --dir',
    '  --limit <n>                  first n files (sorted by name)',
    '  --dry-run                    parse and validate only; no database access',
    '  --resume                     continue the latest unfinished run',
    '  --update-changed             replace matches whose source file changed',
    '  --rollback-run <id>          delete the matches written by a run',
    '  --aggregates-only            only rebuild the summary tables',
    '  --no-aggregates              skip the summary rebuild after importing',
    '  --concurrency <n>            files processed in parallel (default 2)',
    '  --max-files-per-second <n>   throttle (default 0 = off)',
    '  --batch-size <n>             rows per insert (default 5000, capped by MySQL placeholder limit)',
    '  --database <name>            required for writes; must equal the target database name',
    '  --confirm-full-import        required when importing without --limit/--files',
    '  --allow-remote-database      required when the target host is not localhost',
    '  --allow-production           required when NODE_ENV=production',
    '  --report <file>              also write the JSON report to a file',
  ].join('\n');
}

main().catch((error) => {
  console.error(`[history-import] failed: ${safeErrorMessage(error)}`);
  process.exit(1);
});
