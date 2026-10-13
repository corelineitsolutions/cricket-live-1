import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverFiles, HistoryImportService } from './history-import.service';
import {
  emptyCounters,
  ExistingMatch,
  FileLog,
  HistoryStore,
  ImportOptions,
  RunCounters,
  RunStatus,
} from './import.types';
import { PARSER_VERSION, ParsedMatch } from './parsed-match.types';

const FIXTURES = join(__dirname, '__fixtures__');

class MemoryStore implements HistoryStore {
  runs: Array<{ id: number; status: RunStatus; counters: RunCounters; error: string | null }> = [];
  files = new Map<string, FileLog>();
  matches = new Map<string, ExistingMatch & { runId: number; deliveries: number }>();
  private nextMatchId = 1;

  async startRun(): Promise<number> {
    const id = this.runs.length + 1;
    this.runs.push({ id, status: 'RUNNING', counters: emptyCounters(), error: null });
    return id;
  }
  async findResumableRun() {
    const latest = this.runs[this.runs.length - 1];
    if (!latest || (latest.status !== 'RUNNING' && latest.status !== 'FAILED')) return null;
    const done = [...this.files.entries()]
      .filter(([key, f]) => key.startsWith(`${latest.id}:`) && f.status !== 'FAILED')
      .map(([, f]) => f.fileName);
    return { runId: latest.id, doneFiles: new Set(done), counters: { ...latest.counters, filesSeen: done.length } };
  }
  async findMatch(id: string) {
    return this.matches.get(id) ?? null;
  }
  async saveMatch(runId: number, match: ParsedMatch, file: FileLog, replaceId: number | null) {
    const id = replaceId ?? this.nextMatchId++;
    this.matches.set(match.cricsheetMatchId, {
      id,
      sha256: file.sha256!,
      parserVersion: PARSER_VERSION,
      runId,
      deliveries: match.deliveries.length,
    });
    await this.logFile(runId, file);
  }
  async logFile(runId: number, file: FileLog) {
    this.files.set(`${runId}:${file.fileName}`, file);
  }
  async updateRun(runId: number, counters: RunCounters, status: RunStatus, error?: string | null) {
    const run = this.runs[runId - 1];
    run.counters = { ...counters };
    run.status = status;
    if (error !== undefined) run.error = error;
  }
  statuses(runId: number) {
    return Object.fromEntries(
      [...this.files.entries()].filter(([k]) => k.startsWith(`${runId}:`)).map(([, f]) => [f.fileName, f.status]),
    );
  }
}

const options = (dir: string, extra: Partial<ImportOptions> = {}): ImportOptions => ({
  dir,
  dryRun: false,
  resume: false,
  updateChanged: false,
  concurrency: 2,
  maxFilesPerSecond: 0,
  ...extra,
});

describe('HistoryImportService', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hist-import-'));
    for (const name of ['1127532', '1252684', 'wi_201706']) copyFileSync(join(FIXTURES, `${name}.csv`), join(dir, `${name}.csv`));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('discovers csv files in natural order and honours --limit and --files', async () => {
    writeFileSync(join(dir, 'notes.txt'), 'ignored');
    expect(await discoverFiles({ dir })).toEqual(['1127532.csv', '1252684.csv', 'wi_201706.csv']);
    expect(await discoverFiles({ dir, limit: 1 })).toEqual(['1127532.csv']);
    expect(await discoverFiles({ dir, files: ['wi_201706.csv', 'wi_201706.csv'] })).toEqual(['wi_201706.csv']);
  });

  it('dry run parses every file without a store', async () => {
    const report = await new HistoryImportService(null).run(options(dir, { dryRun: true }));
    expect(report.counters).toMatchObject({ filesSeen: 3, filesImported: 3, filesQuarantined: 0 });
    const ballRows = ['1127532', '1252684', 'wi_201706']
      .map((n) => readFileSync(join(FIXTURES, `${n}.csv`), 'utf8').split('\n').filter((l) => l.startsWith('ball,')).length)
      .reduce((a, b) => a + b, 0);
    expect(report.deliveriesParsed).toBe(ballRows);
    expect(report.runId).toBeNull();
  });

  it('imports once, then skips unchanged files on a second run', async () => {
    const store = new MemoryStore();
    const service = new HistoryImportService(store);
    const first = await service.run(options(dir));
    expect(first.counters).toMatchObject({ filesImported: 3, filesSkipped: 0 });
    expect(store.runs[0].status).toBe('COMPLETED');

    const second = await service.run(options(dir));
    expect(second.counters).toMatchObject({ filesImported: 0, filesSkipped: 3 });
    expect(Object.values(store.statuses(2))).toEqual(['SKIPPED_UNCHANGED', 'SKIPPED_UNCHANGED', 'SKIPPED_UNCHANGED']);
  });

  it('leaves changed files alone unless --update-changed is set, then replaces in place', async () => {
    const store = new MemoryStore();
    const service = new HistoryImportService(store);
    await service.run(options(dir));
    const before = store.matches.get('wi_201706')!;

    const path = join(dir, 'wi_201706.csv');
    writeFileSync(path, readFileSync(path, 'utf8').replace('info,city,', 'info,city,Providence'));

    await service.run(options(dir));
    expect(store.statuses(2)['wi_201706.csv']).toBe('SKIPPED_CHANGED');
    expect(store.matches.get('wi_201706')!.sha256).toBe(before.sha256);

    const third = await service.run(options(dir, { updateChanged: true }));
    expect(third.counters).toMatchObject({ filesReplaced: 1, filesSkipped: 2 });
    expect(store.matches.get('wi_201706')).toMatchObject({ id: before.id, runId: 3 });
    expect(store.matches.get('wi_201706')!.sha256).not.toBe(before.sha256);
  });

  it('quarantines a malformed file and keeps going', async () => {
    writeFileSync(join(dir, 'broken.csv'), 'version,1.8.0\ninfo,venue,"unterminated\n');
    const store = new MemoryStore();
    const report = await new HistoryImportService(store).run(options(dir));
    expect(report.counters).toMatchObject({ filesImported: 3, filesQuarantined: 1 });
    expect(store.statuses(1)['broken.csv']).toBe('QUARANTINED');
    expect(report.quarantined[0].errors).toContain('MALFORMED_LINE');
  });

  it('stops on request and resumes the same run without redoing finished files', async () => {
    const store = new MemoryStore();
    const service = new HistoryImportService(store);
    const save = store.saveMatch.bind(store);
    const saveSpy = vi.spyOn(store, 'saveMatch').mockImplementation(async (...args) => {
      await save(...args);
      service.requestStop();
    });
    const stopped = await service.run(options(dir, { concurrency: 1 }));
    expect(stopped.interrupted).toBe(true);
    expect(store.runs[0].status).toBe('FAILED');
    expect(store.matches.size).toBe(1);
    saveSpy.mockImplementation(save);

    const resumed = await new HistoryImportService(store).run(options(dir, { resume: true, concurrency: 1 }));
    expect(resumed.runId).toBe(1);
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0].status).toBe('COMPLETED');
    expect(store.matches.size).toBe(3);
    expect(saveSpy).toHaveBeenCalledTimes(3);
  });

  it('records a failed write without stopping the run or leaking the error detail', async () => {
    const store = new MemoryStore();
    vi.spyOn(store, 'saveMatch').mockRejectedValueOnce(new Error('connect mysql://root:hunter2@db:3306/x failed'));
    const report = await new HistoryImportService(store).run(options(dir, { concurrency: 1 }));
    expect(report.counters).toMatchObject({ filesFailed: 1, filesImported: 2 });
    expect(report.failed[0].error).not.toContain('hunter2');
    expect(report.failed[0].error).toContain('[redacted-url]');
  });
});
