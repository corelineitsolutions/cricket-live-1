import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  emptyCounters,
  ExistingMatch,
  FileLog,
  HistoryStore,
  RunCounters,
  RunStatus,
} from './import.types';
import { PARSER_VERSION, ParsedMatch } from './parsed-match.types';

/** MySQL allows 65,535 placeholders per statement; keep each createMany well below it. */
const MAX_PLACEHOLDERS = 60_000;
const DELIVERY_COLUMNS = 21;
const WICKET_COLUMNS = 15;
const MATCH_TX_TIMEOUT_MS = 120_000;

type Tx = Prisma.TransactionClient;

export function venueKey(name: string, city: string | null): string {
  const norm = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const key = `${norm(name)}|${norm(city ?? '')}`;
  if (key.length <= 191) return key;
  return `${key.slice(0, 150)}#${createHash('sha1').update(key).digest('hex').slice(0, 16)}`;
}

function chunk<T>(rows: T[], columns: number, batchSize: number): T[][] {
  const size = Math.max(1, Math.min(batchSize, Math.floor(MAX_PLACEHOLDERS / columns)));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export class PrismaHistoryStore implements HistoryStore {
  private readonly teamIds = new Map<string, number>();
  private readonly venueIds = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly batchSize = 5000,
  ) {}

  async startRun(sourceLabel: string, options: Record<string, unknown>): Promise<number> {
    const run = await this.prisma.histImportRun.create({
      data: { sourceLabel: sourceLabel.slice(0, 191), options: options as Prisma.InputJsonValue, parserVersion: PARSER_VERSION },
    });
    return run.id;
  }

  async findResumableRun() {
    const latest = await this.prisma.histImportRun.findFirst({ orderBy: { id: 'desc' } });
    if (!latest || (latest.status !== 'RUNNING' && latest.status !== 'FAILED')) return null;
    const files = await this.prisma.histImportFile.findMany({
      where: { runId: latest.id, status: { not: 'FAILED' } },
      select: { fileName: true },
    });
    const counters: RunCounters = { ...emptyCounters() };
    for (const key of Object.keys(counters) as Array<keyof RunCounters>) counters[key] = latest[key];
    counters.filesFailed = 0;
    counters.filesSeen = files.length;
    return { runId: latest.id, doneFiles: new Set(files.map((f) => f.fileName)), counters };
  }

  async findMatch(cricsheetMatchId: string): Promise<ExistingMatch | null> {
    const match = await this.prisma.histMatch.findUnique({
      where: { cricsheetMatchId },
      select: { id: true, sourceSha256: true, parserVersion: true },
    });
    return match ? { id: match.id, sha256: match.sourceSha256, parserVersion: match.parserVersion } : null;
  }

  async logFile(runId: number, file: FileLog, tx: Tx | PrismaClient = this.prisma): Promise<void> {
    const codes = [...new Set(file.warnings.map((w) => w.code))].join(',').slice(0, 500) || null;
    const data = {
      cricsheetMatchId: file.cricsheetMatchId,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      parserVersion: file.parserVersion,
      status: file.status,
      deliveries: file.deliveries,
      warningsCount: file.warnings.length,
      warningCodes: codes,
      errorSummary: file.errorSummary?.slice(0, 500) ?? null,
    };
    await tx.histImportFile.upsert({
      where: { runId_fileName: { runId, fileName: file.fileName } },
      create: { runId, fileName: file.fileName, ...data },
      update: data,
    });
  }

  async updateRun(runId: number, counters: RunCounters, status: RunStatus, errorSummary?: string | null) {
    await this.prisma.histImportRun.update({
      where: { id: runId },
      data: {
        ...counters,
        status,
        ...(errorSummary !== undefined ? { errorSummary: errorSummary?.slice(0, 1000) ?? null } : {}),
        finishedAt: status === 'RUNNING' ? null : new Date(),
      },
    });
  }

  async saveMatch(runId: number, match: ParsedMatch, file: FileLog, replaceMatchId: number | null): Promise<void> {
    await this.ensurePeople(match);
    const [team1Id, team2Id] = await Promise.all(match.teams.map((name) => this.teamId(name, match.teamType)));
    const teamIdByName = new Map([
      [match.teams[0], team1Id],
      [match.teams[1], team2Id],
    ]);
    const venueId = await this.venueId(match);
    const teamOf = (name: string | null) => (name ? (teamIdByName.get(name) ?? null) : null);

    await this.prisma.$transaction(
      async (tx) => {
        if (replaceMatchId !== null) await tx.histMatch.delete({ where: { id: replaceMatchId } });
        const created = await tx.histMatch.create({
          data: {
            cricsheetMatchId: match.cricsheetMatchId,
            sourceSha256: file.sha256!,
            formatVersion: match.formatVersion.slice(0, 16),
            parserVersion: PARSER_VERSION,
            importRunId: runId,
            matchType: match.matchType.slice(0, 8),
            gender: match.gender.slice(0, 16),
            teamType: match.teamType.slice(0, 16),
            season: match.season.slice(0, 16),
            startDate: toDate(match.startDate),
            endDate: toDate(match.endDate),
            dates: match.dates,
            eventName: match.eventName?.slice(0, 191) ?? null,
            matchNumber: match.matchNumber?.slice(0, 32) ?? null,
            matchTypeNumber: match.matchTypeNumber,
            venueId,
            team1Id,
            team2Id,
            tossWinnerId: teamOf(match.tossWinner),
            tossDecision: match.tossDecision?.slice(0, 8) ?? null,
            tossUncontested: match.tossUncontested,
            outcome: match.outcome,
            winnerId: teamOf(match.winner),
            winByRuns: match.winByRuns,
            winByWickets: match.winByWickets,
            winByInnings: match.winByInnings,
            method: match.method?.slice(0, 32) ?? null,
            eliminatorTeam: match.eliminator?.slice(0, 191) ?? null,
            bowlOutTeam: match.bowlOut?.slice(0, 191) ?? null,
            oversLimit: match.oversLimit,
            ballsPerOver: match.ballsPerOver,
            neutralVenue: match.neutralVenue,
            hasSuperOver: match.hasSuperOver,
            deliveriesCount: match.deliveries.length,
            officials: Object.keys(match.officials).length > 0 ? match.officials : Prisma.DbNull,
            extraInfo: Object.keys(match.extraInfo).length > 0 ? match.extraInfo : Prisma.DbNull,
          },
          select: { id: true },
        });
        const matchId = created.id;
        const pom = new Set(match.playerOfMatchIds);

        if (match.players.length > 0) {
          await tx.histMatchPlayer.createMany({
            data: match.players.map((p) => ({
              matchId,
              personId: p.personId,
              teamId: teamIdByName.get(p.team)!,
              isPlayerOfMatch: pom.has(p.personId),
            })),
            skipDuplicates: true,
          });
        }
        if (match.innings.length > 0) {
          await tx.histInnings.createMany({
            data: match.innings.map((i) => ({
              matchId,
              inningsNo: i.inningsNo,
              battingTeamId: teamOf(i.battingTeam),
              bowlingTeamId: teamOf(i.bowlingTeam),
              isSuperOver: i.isSuperOver,
              declared: i.declared,
              forfeited: i.forfeited,
              runs: i.runs,
              wickets: i.wickets,
              legalBalls: i.legalBalls,
              deliveries: i.deliveries,
              extras: i.extras,
              wides: i.wides,
              noballs: i.noballs,
              byes: i.byes,
              legbyes: i.legbyes,
              penaltyInDeliveries: i.penaltyInDeliveries,
              penaltyPre: i.penaltyPre,
              penaltyPost: i.penaltyPost,
              targetRuns: i.targetRuns,
              targetOvers: i.targetOvers,
            })),
          });
        }

        const deliveries = match.deliveries.map((d) => ({
          matchId,
          inningsNo: d.innings,
          seq: d.seq,
          overNo: d.overNo,
          ballNo: d.ballNo,
          legalOverNo: d.legalOverNo,
          legalBallNo: d.legalBallNo,
          batterId: d.batterId,
          nonStrikerId: d.nonStrikerId,
          bowlerId: d.bowlerId,
          runsBatter: d.runsBatter,
          extras: d.extras,
          wides: d.wides,
          noballs: d.noballs,
          byes: d.byes,
          legbyes: d.legbyes,
          penalty: d.penalty,
          totalRuns: d.totalRuns,
          isLegal: d.isLegal,
          nonBoundary: d.nonBoundary,
          teamWickets: d.wickets.filter((w) => w.countsAsTeamWicket).length,
        }));
        for (const rows of chunk(deliveries, DELIVERY_COLUMNS, this.batchSize)) {
          await tx.histDelivery.createMany({ data: rows });
        }

        const wickets = match.deliveries.flatMap((d) =>
          d.wickets.map((w) => ({
            matchId,
            inningsNo: d.innings,
            seq: d.seq,
            ordinal: w.ordinal,
            kind: w.kind.slice(0, 32),
            playerOutId: w.playerOutId,
            playerOutName: w.playerOutName?.slice(0, 191) ?? null,
            bowlerId: d.bowlerId,
            creditedToBowler: w.creditedToBowler,
            countsAsTeamWicket: w.countsAsTeamWicket,
            fielder1Id: w.fielderIds[0] ?? null,
            fielder2Id: w.fielderIds[1] ?? null,
            fielder3Id: w.fielderIds[2] ?? null,
            fielder4Id: w.fielderIds[3] ?? null,
            unresolvedFielders: w.unresolvedFielders.length > 0 ? w.unresolvedFielders.join('; ').slice(0, 500) : null,
          })),
        );
        for (const rows of chunk(wickets, WICKET_COLUMNS, this.batchSize)) {
          await tx.histWicket.createMany({ data: rows });
        }

        await this.logFile(runId, file, tx);
      },
      { timeout: MATCH_TX_TIMEOUT_MS, maxWait: 30_000 },
    );
  }

  /** Deletes the matches a run inserted or replaced, one transaction per match. */
  async rollbackRun(runId: number): Promise<{ matchesDeleted: number; replacedFiles: number }> {
    const run = await this.prisma.histImportRun.findUnique({ where: { id: runId } });
    if (!run) throw new Error(`import run ${runId} not found`);
    const replacedFiles = await this.prisma.histImportFile.count({ where: { runId, status: 'REPLACED' } });
    let matchesDeleted = 0;
    for (;;) {
      const batch = await this.prisma.histMatch.findMany({ where: { importRunId: runId }, select: { id: true }, take: 200 });
      if (batch.length === 0) break;
      for (const { id } of batch) {
        await this.prisma.histMatch.delete({ where: { id } });
        matchesDeleted++;
      }
    }
    await this.prisma.histImportRun.update({
      where: { id: runId },
      data: { status: 'ROLLED_BACK', rolledBackAt: new Date() },
    });
    return { matchesDeleted, replacedFiles };
  }

  /** Data + index bytes of the hist_* tables in the current database. */
  async historyTableBytes(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ bytes: bigint | number | null }>>`
      SELECT SUM(DATA_LENGTH + INDEX_LENGTH) AS bytes FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'hist\\_%'`;
    return Number(rows[0]?.bytes ?? 0);
  }

  private async ensurePeople(match: ParsedMatch): Promise<void> {
    if (match.people.length === 0) return;
    const firstNameById = new Map<string, string>();
    for (const p of match.people) if (!firstNameById.has(p.id)) firstNameById.set(p.id, p.name);
    await this.prisma.histPerson.createMany({
      data: [...firstNameById].map(([id, name]) => ({ id, name: name.slice(0, 191) })),
      skipDuplicates: true,
    });
    await this.prisma.histPersonName.createMany({
      data: match.people.map((p) => ({ personId: p.id, name: p.name.slice(0, 191) })),
      skipDuplicates: true,
    });
  }

  private async teamId(name: string, teamType: string): Promise<number> {
    const key = `${teamType}|${name}`;
    const cached = this.teamIds.get(key);
    if (cached) return cached;
    const where = { name_teamType: { name: name.slice(0, 191), teamType: teamType.slice(0, 16) } };
    const id = await this.retryOnConflict(async () => {
      const team = await this.prisma.histTeam.upsert({ where, create: where.name_teamType, update: {}, select: { id: true } });
      return team.id;
    });
    this.teamIds.set(key, id);
    return id;
  }

  private async venueId(match: ParsedMatch): Promise<number> {
    const { name, city, cricsheetVenueId } = match.venue;
    const normalizedKey = venueKey(name, city);
    const cached = this.venueIds.get(normalizedKey);
    if (cached) return cached;
    const id = await this.retryOnConflict(async () => {
      const venue = await this.prisma.histVenue.upsert({
        where: { normalizedKey },
        create: { normalizedKey, name: name.slice(0, 191), city: city?.slice(0, 120) ?? null, cricsheetVenueId },
        update: cricsheetVenueId ? { cricsheetVenueId } : {},
        select: { id: true },
      });
      return venue.id;
    });
    this.venueIds.set(normalizedKey, id);
    return id;
  }

  private async retryOnConflict<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return fn();
    }
  }
}
