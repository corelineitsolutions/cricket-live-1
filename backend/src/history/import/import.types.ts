import { ParsedMatch, ParseIssue } from './parsed-match.types';

export type ImportFileStatus =
  | 'IMPORTED'
  | 'REPLACED'
  | 'SKIPPED_UNCHANGED'
  | 'SKIPPED_CHANGED'
  | 'QUARANTINED'
  | 'FAILED';

export interface ImportOptions {
  dir: string;
  /** Explicit file names inside `dir`; otherwise every *.csv in it. */
  files?: string[];
  limit?: number;
  dryRun: boolean;
  resume: boolean;
  updateChanged: boolean;
  concurrency: number;
  /** 0 = no throttle. */
  maxFilesPerSecond: number;
}

export interface FileLog {
  fileName: string;
  cricsheetMatchId: string | null;
  /** Null when the file could not be read. */
  sha256: string | null;
  sizeBytes: number;
  parserVersion: number;
  status: ImportFileStatus;
  deliveries: number;
  warnings: ParseIssue[];
  errorSummary: string | null;
}

export interface ExistingMatch {
  id: number;
  sha256: string;
  parserVersion: number;
}

export interface RunCounters {
  filesSeen: number;
  filesImported: number;
  filesReplaced: number;
  filesSkipped: number;
  filesQuarantined: number;
  filesFailed: number;
  deliveriesImported: number;
  warningsCount: number;
}

export type RunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';

/** Persistence used by the importer. The dry run never touches a store. */
export interface HistoryStore {
  startRun(sourceLabel: string, options: Record<string, unknown>): Promise<number>;
  /** Latest unfinished run plus the files it already handled (FAILED files are retried). */
  findResumableRun(): Promise<{ runId: number; doneFiles: Set<string>; counters: RunCounters } | null>;
  findMatch(cricsheetMatchId: string): Promise<ExistingMatch | null>;
  saveMatch(runId: number, match: ParsedMatch, file: FileLog, replaceMatchId: number | null): Promise<void>;
  logFile(runId: number, file: FileLog): Promise<void>;
  updateRun(runId: number, counters: RunCounters, status: RunStatus, errorSummary?: string | null): Promise<void>;
}

export interface ImportReport {
  runId: number | null;
  dryRun: boolean;
  status: RunStatus;
  counters: RunCounters;
  /** Deliveries parsed (dry run) or written (real run). */
  deliveriesParsed: number;
  elapsedMs: number;
  warningCodes: Record<string, number>;
  quarantined: Array<{ fileName: string; errors: string }>;
  failed: Array<{ fileName: string; error: string }>;
  interrupted: boolean;
}

export const emptyCounters = (): RunCounters => ({
  filesSeen: 0,
  filesImported: 0,
  filesReplaced: 0,
  filesSkipped: 0,
  filesQuarantined: 0,
  filesFailed: 0,
  deliveriesImported: 0,
  warningsCount: 0,
});
