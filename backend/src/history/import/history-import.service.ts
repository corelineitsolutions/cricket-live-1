import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { readCricsheetFile } from './cricsheet-file.reader';
import {
  emptyCounters,
  FileLog,
  HistoryStore,
  ImportOptions,
  ImportReport,
  RunCounters,
  RunStatus,
} from './import.types';
import { PARSER_VERSION, ParseIssue } from './parsed-match.types';
import { safeErrorMessage } from './safe-error';

const PROGRESS_EVERY_FILES = 250;
const MAX_LISTED_PROBLEMS = 200;

export type ProgressListener = (counters: RunCounters, total: number) => void;

/** Lists the files to import, sorted by name for a deterministic order. */
export async function discoverFiles(options: Pick<ImportOptions, 'dir' | 'files' | 'limit'>): Promise<string[]> {
  let names: string[];
  if (options.files && options.files.length > 0) {
    names = options.files.map((f) => basename(f.trim())).filter(Boolean);
  } else {
    const entries = await readdir(options.dir, { withFileTypes: true });
    names = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.csv')).map((e) => e.name);
  }
  names = [...new Set(names)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return options.limit && options.limit > 0 ? names.slice(0, options.limit) : names;
}

/**
 * Imports Cricsheet classic CSV files. Each match is written in its own transaction by the
 * store, so an interrupted run leaves only whole matches behind and can be resumed.
 */
export class HistoryImportService {
  private stopRequested = false;

  constructor(
    private readonly store: HistoryStore | null,
    private readonly onProgress: ProgressListener = () => undefined,
  ) {}

  /** Stop after the files currently in flight (used for Ctrl+C). */
  requestStop(): void {
    this.stopRequested = true;
  }

  async run(options: ImportOptions): Promise<ImportReport> {
    if (!options.dryRun && !this.store) throw new Error('a database store is required unless --dry-run is set');
    const started = Date.now();
    const allFiles = await discoverFiles(options);

    let runId: number | null = null;
    let counters = emptyCounters();
    let doneFiles = new Set<string>();
    if (!options.dryRun) {
      const resumable = options.resume ? await this.store!.findResumableRun() : null;
      if (resumable) {
        ({ runId, doneFiles, counters } = resumable);
        await this.store!.updateRun(runId, counters, 'RUNNING', null);
      } else {
        runId = await this.store!.startRun(basename(options.dir), {
          files: options.files?.length ?? null,
          limit: options.limit ?? null,
          resume: options.resume,
          updateChanged: options.updateChanged,
          concurrency: options.concurrency,
          parserVersion: PARSER_VERSION,
        });
      }
    }

    const pending = allFiles.filter((name) => !doneFiles.has(name));
    const report: ImportReport = {
      runId,
      dryRun: options.dryRun,
      status: 'RUNNING',
      counters,
      deliveriesParsed: 0,
      elapsedMs: 0,
      warningCodes: {},
      quarantined: [],
      failed: [],
      interrupted: false,
    };

    let next = 0;
    const minIntervalMs = options.maxFilesPerSecond > 0 ? 1000 / options.maxFilesPerSecond : 0;
    let lastStart = 0;
    const worker = async () => {
      while (!this.stopRequested) {
        const index = next++;
        if (index >= pending.length) return;
        if (minIntervalMs > 0) {
          const wait = lastStart + minIntervalMs - Date.now();
          lastStart = Math.max(Date.now(), lastStart + minIntervalMs);
          if (wait > 0) await sleep(wait);
        }
        await this.importOne(options, runId, pending[index], report);
        if (runId !== null && counters.filesSeen % PROGRESS_EVERY_FILES === 0) {
          await this.store!.updateRun(runId, counters, 'RUNNING', null);
        }
        if (counters.filesSeen % PROGRESS_EVERY_FILES === 0) this.onProgress(counters, allFiles.length);
      }
    };

    let fatal: unknown = null;
    try {
      await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
    } catch (error) {
      fatal = error;
    }

    report.interrupted = this.stopRequested;
    const status: RunStatus = fatal || this.stopRequested ? 'FAILED' : 'COMPLETED';
    report.status = status;
    report.elapsedMs = Date.now() - started;
    this.onProgress(counters, allFiles.length);
    if (runId !== null) {
      const summary = fatal ? safeErrorMessage(fatal) : this.stopRequested ? 'interrupted; resume with --resume' : null;
      await this.store!.updateRun(runId, counters, status, summary);
    }
    if (fatal) throw fatal;
    return report;
  }

  private async importOne(options: ImportOptions, runId: number | null, fileName: string, report: ImportReport) {
    const counters = report.counters;
    const path = join(options.dir, fileName);
    counters.filesSeen++;
    try {
      const parsed = await readCricsheetFile(path);
      const base = { fileName, sha256: parsed.sha256, sizeBytes: parsed.sizeBytes, parserVersion: PARSER_VERSION };
      const { result } = parsed;
      this.countWarnings(report, result.warnings);

      if (!result.ok) {
        counters.filesQuarantined++;
        const errors = summarizeIssues(result.errors);
        if (report.quarantined.length < MAX_LISTED_PROBLEMS) report.quarantined.push({ fileName, errors });
        const log: FileLog = {
          ...base,
          cricsheetMatchId: null,
          status: 'QUARANTINED',
          deliveries: 0,
          warnings: result.warnings,
          errorSummary: errors,
        };
        if (runId !== null) await this.store!.logFile(runId, log);
        return;
      }

      const match = result.match;
      report.deliveriesParsed += match.deliveries.length;
      const fileBase = { ...base, cricsheetMatchId: match.cricsheetMatchId, warnings: result.warnings, errorSummary: null };
      if (match.cricsheetMatchId !== fileName.replace(/\.csv$/i, '')) {
        result.warnings.push({ code: 'FILE_NAME_MISMATCH', message: 'match_id differs from the file name' });
        this.countWarnings(report, [result.warnings[result.warnings.length - 1]]);
      }
      if (options.dryRun) {
        counters.filesImported++;
        return;
      }

      const existing = await this.store!.findMatch(match.cricsheetMatchId);
      if (existing && existing.sha256 === parsed.sha256 && existing.parserVersion === PARSER_VERSION) {
        counters.filesSkipped++;
        await this.store!.logFile(runId!, { ...fileBase, status: 'SKIPPED_UNCHANGED', deliveries: 0 });
        return;
      }
      if (existing && !options.updateChanged) {
        counters.filesSkipped++;
        await this.store!.logFile(runId!, { ...fileBase, status: 'SKIPPED_CHANGED', deliveries: 0 });
        return;
      }
      const status = existing ? 'REPLACED' : 'IMPORTED';
      await this.store!.saveMatch(runId!, match, { ...fileBase, status, deliveries: match.deliveries.length }, existing?.id ?? null);
      if (existing) counters.filesReplaced++;
      else counters.filesImported++;
      counters.deliveriesImported += match.deliveries.length;
    } catch (error) {
      counters.filesFailed++;
      const message = safeErrorMessage(error);
      if (report.failed.length < MAX_LISTED_PROBLEMS) report.failed.push({ fileName, error: message });
      if (runId !== null) {
        await this.store!
          .logFile(runId, {
            fileName,
            cricsheetMatchId: null,
            sha256: null,
            sizeBytes: 0,
            parserVersion: PARSER_VERSION,
            status: 'FAILED',
            deliveries: 0,
            warnings: [],
            errorSummary: message,
          })
          .catch(() => undefined);
      }
    }
  }

  private countWarnings(report: ImportReport, warnings: ParseIssue[]): void {
    report.counters.warningsCount += warnings.length;
    for (const w of warnings) report.warningCodes[w.code] = (report.warningCodes[w.code] ?? 0) + 1;
  }
}

export function summarizeIssues(issues: ParseIssue[], maxLength = 500): string {
  return issues
    .slice(0, 10)
    .map((i) => `${i.code}${i.line ? `@${i.line}` : ''}: ${i.message}`)
    .join('; ')
    .slice(0, maxLength);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
