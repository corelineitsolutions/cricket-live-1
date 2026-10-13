import { PrismaClient } from '@prisma/client';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rebuildAggregates } from './aggregates.builder';
import { parseCricsheetCsv } from './cricsheet-original.parser';
import { HistoryImportService } from './history-import.service';
import { ImportOptions } from './import.types';
import { ParsedMatch } from './parsed-match.types';
import { PrismaHistoryStore } from './prisma-history.store';

/**
 * Runs only against a disposable local database, e.g.
 *   HISTORY_TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/cricket_live_history_test
 * Apply migrations to it first: DATABASE_URL=$HISTORY_TEST_DATABASE_URL npx prisma migrate deploy
 */
const url = process.env.HISTORY_TEST_DATABASE_URL;
const FIXTURES = join(__dirname, '__fixtures__');
const HIST_TABLES = [
  'hist_agg_team_phase',
  'hist_agg_head_to_head',
  'hist_agg_player_venue',
  'hist_agg_venue',
  'hist_agg_player_bowling',
  'hist_agg_player_batting',
  'hist_agg_builds',
  'hist_wickets',
  'hist_deliveries',
  'hist_innings',
  'hist_match_players',
  'hist_matches',
  'hist_import_files',
  'hist_import_runs',
  'hist_person_names',
  'hist_people',
  'hist_teams',
  'hist_venues',
];
const LIVE_TABLES = ['leagues', 'seasons', 'teams', 'players', 'matches', 'fcm_devices', 'ads', 'admins'];

function assertDisposable(raw: string): void {
  const parsed = new URL(raw);
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  if (!local || !parsed.pathname.endsWith('_test')) {
    throw new Error('HISTORY_TEST_DATABASE_URL must be a local database whose name ends with _test');
  }
}

const parsedFixtures = (): ParsedMatch[] =>
  readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.csv'))
    .map((f) => {
      const result = parseCricsheetCsv(readFileSync(join(FIXTURES, f), 'utf8'));
      if (!result.ok) throw new Error(`fixture ${f} failed to parse`);
      return result.match;
    });

describe.skipIf(!url)('history import against MySQL', () => {
  let prisma: PrismaClient;
  let liveCounts: number[];
  const options: ImportOptions = {
    dir: FIXTURES,
    dryRun: false,
    resume: false,
    updateChanged: false,
    concurrency: 2,
    maxFilesPerSecond: 0,
  };

  const count = async (table: string) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*) AS n FROM \`${table}\``);
    return Number(rows[0].n);
  };

  beforeAll(async () => {
    assertDisposable(url!);
    prisma = new PrismaClient({ datasources: { db: { url } } });
    for (const table of HIST_TABLES) await prisma.$executeRawUnsafe(`DELETE FROM \`${table}\``);
    liveCounts = await Promise.all(LIVE_TABLES.map(count));
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('imports the fixtures with exact delivery counts and is idempotent', async () => {
    const expected = parsedFixtures();
    const store = new PrismaHistoryStore(prisma);
    const first = await new HistoryImportService(store).run(options);
    expect(first.counters.filesImported).toBe(expected.length);
    expect(await count('hist_matches')).toBe(expected.length);
    expect(await count('hist_deliveries')).toBe(expected.reduce((n, m) => n + m.deliveries.length, 0));
    expect(await count('hist_wickets')).toBe(
      expected.reduce((n, m) => n + m.deliveries.reduce((k, d) => k + d.wickets.length, 0), 0),
    );

    const second = await new HistoryImportService(new PrismaHistoryStore(prisma)).run(options);
    expect(second.counters).toMatchObject({ filesImported: 0, filesSkipped: expected.length });
    expect(await count('hist_matches')).toBe(expected.length);

    const perth = await prisma.histInnings.findMany({
      where: { match: { cricsheetMatchId: '1000851' } },
      orderBy: { inningsNo: 'asc' },
      select: { runs: true, wickets: true, declared: true },
    });
    expect(perth.map((i) => [i.runs, i.wickets, i.declared])).toEqual([
      [242, 10, false],
      [244, 10, false],
      [540, 8, true],
      [361, 10, false],
    ]);
  }, 120_000);

  it('builds batting and bowling aggregates that match an independent calculation', async () => {
    await rebuildAggregates(prisma);
    const test = parsedFixtures().find((m) => m.matchType === 'Test')!;
    const runs = new Map<string, number>();
    const wickets = new Map<string, number>();
    for (const d of test.deliveries) {
      runs.set(d.batterId, (runs.get(d.batterId) ?? 0) + d.runsBatter);
      const credited = d.wickets.filter((w) => w.creditedToBowler).length;
      wickets.set(d.bowlerId, (wickets.get(d.bowlerId) ?? 0) + credited);
    }
    const batting = await prisma.histAggPlayerBatting.findMany({ where: { matchType: 'Test' } });
    for (const row of batting) expect(row.runs).toBe(runs.get(row.personId) ?? 0);
    expect(batting.reduce((n, r) => n + r.runs, 0)).toBe([...runs.values()].reduce((a, b) => a + b, 0));
    const bowling = await prisma.histAggPlayerBowling.findMany({ where: { matchType: 'Test' } });
    for (const row of bowling) expect(row.wickets).toBe(wickets.get(row.personId) ?? 0);

    const h2h = await prisma.histAggHeadToHead.findMany({ where: { matchType: 'Test' } });
    expect(h2h).toHaveLength(1);
    expect(h2h[0].matches).toBe(1);
  }, 300_000);

  it('rolls back a run and never touches the live tables', async () => {
    const run = await prisma.histImportRun.findFirst({ orderBy: { id: 'asc' } });
    const result = await new PrismaHistoryStore(prisma).rollbackRun(run!.id);
    expect(result.matchesDeleted).toBe(parsedFixtures().length);
    expect(await count('hist_matches')).toBe(0);
    expect(await count('hist_deliveries')).toBe(0);
    expect(await Promise.all(LIVE_TABLES.map(count))).toEqual(liveCounts);
  }, 120_000);
});
