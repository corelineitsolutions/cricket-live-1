import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { compareNames, nameParts, venueParts } from '../identity/identity-matching';
import { HistoryPrismaService } from './history-prisma.service';

/** Shown with every historical figure so it is never mistaken for an official career record. */
export const HISTORY_COVERAGE_NOTE =
  'Cricsheet archive only (cricsheet.org, ODC-By 1.0): matches in the archive, not official career totals.';

export const HISTORY_FORMATS = ['T20', 'ODI', 'Test'] as const;
export type HistoryFormat = (typeof HISTORY_FORMATS)[number];

/** Cricsheet match types behind each user-facing format (international and domestic). */
const FORMAT_MATCH_TYPES: Record<HistoryFormat, string[]> = {
  T20: ['T20', 'IT20'],
  ODI: ['ODI', 'ODM'],
  Test: ['Test', 'MDM'],
};

const MAX_PEOPLE = 8;
const NAME_SCAN_LIMIT = 300;
const MAX_VENUES = 5;

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const ratio = (a: number, b: number, scale = 1) => (b > 0 ? round((a * scale) / b) : null);
const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;

export interface HistTeamSide {
  ids: number[];
  name: string;
  gender: 'male' | 'female' | null;
}

/**
 * Read-only queries over the Cricsheet summary tables. Every query is a fixed Prisma call
 * with typed, validated values; nothing here builds SQL from model or user text.
 */
@Injectable()
export class HistoryQueryService {
  constructor(historyPrisma: HistoryPrismaService) {
    this.prisma = historyPrisma.client;
  }

  private readonly prisma: HistoryPrismaService['client'];

  private matchTypes(format: HistoryFormat | null) {
    return format ? { in: FORMAT_MATCH_TYPES[format] } : undefined;
  }

  /**
   * Cricsheet people whose name fits `name` ("Virat Kohli" finds "V Kohli", "Rohit Sharma" finds "RG Sharma").
   * Prefer surname+given scans so common surnames (Sharma) are not truncated by NAME_SCAN_LIMIT.
   */
  async findPeople(name: string): Promise<Array<{ personId: string; name: string }>> {
    const wanted = nameParts(name);
    if (!wanted) return [];
    const surname = wanted.surname.split(' ').pop()!;
    const given = wanted.full.split(' ')[0] ?? '';
    const givenLong = given.length >= 3 && given !== surname;
    // Narrow query first (Rohit+Sharma), then surname-only fallback for initials forms (RG Sharma).
    const scans: Array<{ name: { contains: string } } | { AND: Array<{ name: { contains: string } }> }> = [];
    if (givenLong) scans.push({ AND: [{ name: { contains: surname } }, { name: { contains: given } }] });
    // Cricsheet short forms: "RG Sharma", "V Kohli", "SA Yadav"
    if (wanted.initials) {
      scans.push({ AND: [{ name: { contains: surname } }, { name: { contains: wanted.initials.toUpperCase() } }] });
      scans.push({ AND: [{ name: { contains: surname } }, { name: { contains: wanted.initials } }] });
    }
    scans.push({ name: { contains: surname } });

    const seenRow = new Set<string>();
    const rows: Array<{ personId: string; name: string }> = [];
    for (const where of scans) {
      const batch = await this.prisma.histPersonName.findMany({
        where,
        select: { personId: true, name: true },
        take: NAME_SCAN_LIMIT,
      });
      for (const row of batch) {
        const key = `${row.personId}:${row.name}`;
        if (seenRow.has(key)) continue;
        seenRow.add(key);
        rows.push(row);
      }
      // Enough close matches from a narrow scan — stop before the broad surname dump.
      if (givenLong && rows.length >= MAX_PEOPLE) break;
    }

    const exact = new Set<string>();
    const close = new Set<string>();
    for (const row of rows) {
      const parts = nameParts(row.name);
      const method = parts ? compareNames(wanted, parts) : null;
      if (method === 'exact_name') exact.add(row.personId);
      else if (method) close.add(row.personId);
    }
    const ids = [...(exact.size ? exact : close)].slice(0, MAX_PEOPLE);
    if (ids.length === 0) return [];
    const people = await this.prisma.histPerson.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return people.map((p) => ({ personId: p.id, name: p.name }));
  }

  async personName(personId: string): Promise<string | null> {
    return (await this.prisma.histPerson.findUnique({ where: { id: personId }, select: { name: true } }))?.name ?? null;
  }

  async playerStats(personId: string, format: HistoryFormat | null) {
    const where = { personId, matchType: this.matchTypes(format) };
    const [batting, bowling] = await Promise.all([
      this.prisma.histAggPlayerBatting.findMany({ where, orderBy: { matches: 'desc' }, take: 12 }),
      this.prisma.histAggPlayerBowling.findMany({ where, orderBy: { innings: 'desc' }, take: 12 }),
    ]);
    return {
      batting: batting.map((b) => ({
        matchType: b.matchType,
        teamType: b.teamType,
        gender: b.gender,
        matches: b.matches,
        innings: b.innings,
        notOuts: b.notOuts,
        runs: b.runs,
        average: ratio(b.runs, b.innings - b.notOuts),
        strikeRate: ratio(b.runs, b.ballsFaced, 100),
        highest: `${b.highest}${b.highestNotOut ? '*' : ''}`,
        hundreds: b.hundreds,
        fifties: b.fifties,
        fours: b.fours,
        sixes: b.sixes,
        firstMatch: day(b.firstMatchDate),
        lastMatch: day(b.lastMatchDate),
      })),
      bowling: bowling
        .filter((b) => b.legalBalls > 0)
        .map((b) => ({
          matchType: b.matchType,
          teamType: b.teamType,
          gender: b.gender,
          innings: b.innings,
          overs: overs(b.legalBalls),
          wickets: b.wickets,
          runsConceded: b.runsConceded,
          average: ratio(b.runsConceded, b.wickets),
          economy: ratio(b.runsConceded, b.legalBalls, 6),
          best: `${b.bestWickets}/${b.bestRuns}`,
          fiveWickets: b.fiveWickets,
        })),
    };
  }

  /** Optional filters for event-scoped player and tournament queries. */
  private eventMatchSql(
    format: HistoryFormat | null,
    gender: 'male' | 'female' | null,
    tightenWorldCup: boolean,
    year: number | null = null,
  ) {
    const types = format ? FORMAT_MATCH_TYPES[format] : null;
    const formatSql = types ? Prisma.sql`AND m.match_type IN (${Prisma.join(types)})` : Prisma.sql``;
    const genderSql = gender ? Prisma.sql`AND m.gender = ${gender}` : Prisma.sql``;
    // Drop U19 / qualifier / Women's spill when asking about a men's World Cup fragment.
    const tightenSql = tightenWorldCup
      ? Prisma.sql`AND m.event_name NOT LIKE ${'%Under-19%'}
                   AND m.event_name NOT LIKE ${'%U19%'}
                   AND m.event_name NOT LIKE ${'%Qualifier%'}
                   AND m.event_name NOT LIKE ${'%Women%'}`
      : Prisma.sql``;
    const yearSql = year
      ? Prisma.sql`AND (m.season LIKE ${`%${year}%`} OR (m.start_date >= ${new Date(Date.UTC(year, 0, 1))} AND m.start_date < ${new Date(Date.UTC(year + 1, 0, 1))}))`
      : Prisma.sql``;
    return { formatSql, genderSql, tightenSql, yearSql };
  }

  /**
   * Batting totals for one player limited to matches whose Cricsheet event_name contains
   * `eventContains` (e.g. "World Cup"). Fixed SQL with bound parameters only.
   */
  async playerBattingByEvent(
    personId: string,
    eventContains: string,
    format: HistoryFormat | null = null,
    gender: 'male' | 'female' | null = null,
    year: number | null = null,
  ) {
    const pattern = `%${eventContains}%`;
    const tighten = /world\s*cup/i.test(eventContains) && gender !== 'female';
    const { formatSql, genderSql, tightenSql, yearSql } = this.eventMatchSql(format, gender, tighten, year);
    const rows = await this.prisma.$queryRaw<
      Array<{
        eventName: string;
        matchType: string;
        gender: string;
        matches: number;
        innings: bigint | number;
        runs: bigint | number;
        hundreds: bigint | number;
        fifties: bigint | number;
        highest: number | null;
      }>
    >(Prisma.sql`
      SELECT m.event_name AS eventName, m.match_type AS matchType, m.gender AS gender,
             COUNT(DISTINCT s.match_id) AS matches,
             COUNT(*) AS innings,
             COALESCE(SUM(s.runs), 0) AS runs,
             COALESCE(SUM(s.runs >= 100), 0) AS hundreds,
             COALESCE(SUM(s.runs >= 50 AND s.runs < 100), 0) AS fifties,
             MAX(s.runs) AS highest
      FROM (
        SELECT d.match_id, d.innings_no, SUM(d.runs_batter) AS runs
        FROM hist_deliveries d
        WHERE d.batter_id = ${personId}
        GROUP BY d.match_id, d.innings_no
      ) s
      JOIN hist_innings i ON i.match_id = s.match_id AND i.innings_no = s.innings_no AND i.is_super_over = 0
      JOIN hist_matches m ON m.id = s.match_id
      WHERE m.event_name IS NOT NULL AND m.event_name LIKE ${pattern}
        ${formatSql} ${genderSql} ${tightenSql} ${yearSql}
      GROUP BY m.event_name, m.match_type, m.gender
      ORDER BY hundreds DESC, runs DESC
      LIMIT 20`);
    return rows.map((r) => ({
      event: r.eventName,
      matchType: r.matchType,
      gender: r.gender,
      matches: Number(r.matches),
      innings: Number(r.innings),
      runs: Number(r.runs),
      hundreds: Number(r.hundreds),
      fifties: Number(r.fifties),
      highest: r.highest ?? 0,
    }));
  }

  /**
   * Bowling totals for one player limited to matches whose Cricsheet event_name contains
   * `eventContains`. Fixed SQL with bound parameters only.
   */
  async playerBowlingByEvent(
    personId: string,
    eventContains: string,
    format: HistoryFormat | null = null,
    gender: 'male' | 'female' | null = null,
    year: number | null = null,
  ) {
    const pattern = `%${eventContains}%`;
    const tighten = /world\s*cup/i.test(eventContains) && gender !== 'female';
    const { formatSql, genderSql, tightenSql, yearSql } = this.eventMatchSql(format, gender, tighten, year);
    const rows = await this.prisma.$queryRaw<
      Array<{
        eventName: string;
        matchType: string;
        gender: string;
        matches: number;
        innings: bigint | number;
        legalBalls: bigint | number;
        runsConceded: bigint | number;
        wickets: bigint | number;
      }>
    >(Prisma.sql`
      SELECT m.event_name AS eventName, m.match_type AS matchType, m.gender AS gender,
             COUNT(DISTINCT s.match_id) AS matches,
             COUNT(*) AS innings,
             COALESCE(SUM(s.legal_balls), 0) AS legalBalls,
             COALESCE(SUM(s.runs), 0) AS runsConceded,
             COALESCE(SUM(s.wickets), 0) AS wickets
      FROM (
        SELECT d.match_id, d.innings_no,
               SUM(d.is_legal) AS legal_balls,
               SUM(d.runs_batter + d.wides + d.noballs) AS runs,
               COALESCE((
                 SELECT COUNT(*) FROM hist_wickets w
                 WHERE w.match_id = d.match_id AND w.innings_no = d.innings_no
                   AND w.bowler_id = d.bowler_id AND w.credited_to_bowler = 1
               ), 0) AS wickets
        FROM hist_deliveries d
        WHERE d.bowler_id = ${personId}
        GROUP BY d.match_id, d.innings_no, d.bowler_id
      ) s
      JOIN hist_innings i ON i.match_id = s.match_id AND i.innings_no = s.innings_no AND i.is_super_over = 0
      JOIN hist_matches m ON m.id = s.match_id
      WHERE m.event_name IS NOT NULL AND m.event_name LIKE ${pattern}
        ${formatSql} ${genderSql} ${tightenSql} ${yearSql}
      GROUP BY m.event_name, m.match_type, m.gender
      ORDER BY wickets DESC, runsConceded ASC
      LIMIT 20`);
    return rows.map((r) => {
      const legalBalls = Number(r.legalBalls ?? 0);
      const runsConceded = Number(r.runsConceded ?? 0);
      const wickets = Number(r.wickets ?? 0);
      return {
        event: r.eventName,
        matchType: r.matchType,
        gender: r.gender,
        matches: Number(r.matches ?? 0),
        innings: Number(r.innings ?? 0),
        overs: overs(legalBalls),
        runsConceded,
        wickets,
        average: ratio(runsConceded, wickets),
        economy: ratio(runsConceded, legalBalls, 6),
      };
    });
  }

  /**
   * Matches whose event_name contains `eventContains`, optionally limited by year / format / gender.
   * Highlights a Final when match_number says so; otherwise the latest dated match in the filter.
   */
  async eventResults(
    eventContains: string,
    opts: { year?: number | null; format?: HistoryFormat | null; gender?: 'male' | 'female' | null } = {},
  ) {
    const year = opts.year ?? null;
    const format = opts.format ?? null;
    const gender = opts.gender ?? null;
    const tighten = /world\s*cup/i.test(eventContains) && gender !== 'female';
    const where: Prisma.HistMatchWhereInput = {
      eventName: { contains: eventContains },
      ...(format ? { matchType: { in: FORMAT_MATCH_TYPES[format] } } : {}),
      ...(gender ? { gender } : {}),
      ...(tighten
        ? {
            AND: [
              { NOT: { eventName: { contains: 'Under-19' } } },
              { NOT: { eventName: { contains: 'U19' } } },
              { NOT: { eventName: { contains: 'Qualifier' } } },
              { NOT: { eventName: { contains: 'Women' } } },
            ],
          }
        : {}),
      ...(year
        ? {
            OR: [
              { season: { contains: String(year) } },
              {
                startDate: {
                  gte: new Date(Date.UTC(year, 0, 1)),
                  lt: new Date(Date.UTC(year + 1, 0, 1)),
                },
              },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.histMatch.findMany({
      where,
      include: { team1: { select: { name: true } }, team2: { select: { name: true } }, winner: { select: { name: true } } },
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
      take: 40,
    });
    const mapped = rows.map((m) => ({
      event: m.eventName,
      season: m.season,
      date: day(m.startDate),
      matchType: m.matchType,
      gender: m.gender,
      matchNumber: m.matchNumber,
      teams: [m.team1.name, m.team2.name],
      outcome: m.outcome,
      winner: m.winner?.name ?? null,
      winByRuns: m.winByRuns,
      winByWickets: m.winByWickets,
      eliminator: m.eliminatorTeam,
      method: m.method,
    }));
    const labelledFinal =
      mapped.find((m) => m.matchNumber !== null && /final/i.test(m.matchNumber) && !/semi|quarter/i.test(m.matchNumber)) ??
      null;
    // Super-over / tie finals often carry eliminator on the last match even when match_number is blank.
    const eliminatorFinal =
      mapped.find((m) => !!m.eliminator && (m.outcome === 'TIE' || m.outcome === 'WIN' || !m.winner)) ??
      mapped.find((m) => !!m.eliminator) ??
      null;
    const final = labelledFinal ?? eliminatorFinal ?? null;
    const highlight = final ?? mapped[0] ?? null;
    const usedLabelledFinal = !!labelledFinal && highlight === labelledFinal;
    return {
      event: eventContains,
      year,
      format: format ?? 'all',
      gender: gender ?? 'any',
      matchCount: mapped.length,
      tournamentWinner: highlight?.winner ?? highlight?.eliminator ?? null,
      final: highlight,
      matches: mapped.slice(0, 12),
      note:
        mapped.length === 0
          ? `No archive matches whose event name contains "${eventContains}"${year ? ` in ${year}` : ''}.`
          : usedLabelledFinal
            ? 'Tournament winner taken from the Final (Cricsheet archive).'
            : highlight?.eliminator
              ? 'Tournament winner taken from the match eliminator / last matching match (Cricsheet archive).'
              : 'Showing the latest matching match as the highlight (Cricsheet archive).',
    };
  }

  /**
   * Tournament batting / bowling leaders for an event (e.g. most runs or wickets in World Cup 2019).
   * Fixed SQL with bound parameters only — archive totals, not official ICC leaderboards.
   */
  async eventLeaders(
    eventContains: string,
    opts: {
      year?: number | null;
      format?: HistoryFormat | null;
      gender?: 'male' | 'female' | null;
      kind?: 'batting' | 'bowling' | 'runs_conceded' | 'sixes' | 'fours' | 'hundreds';
      limit?: number;
    } = {},
  ) {
    const year = opts.year ?? null;
    const format = opts.format ?? null;
    const gender = opts.gender ?? null;
    const kind =
      opts.kind === 'bowling' ||
      opts.kind === 'runs_conceded' ||
      opts.kind === 'sixes' ||
      opts.kind === 'fours' ||
      opts.kind === 'hundreds'
        ? opts.kind
        : 'batting';
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 20);
    const pattern = `%${eventContains}%`;
    const tighten = /world\s*cup/i.test(eventContains) && gender !== 'female';
    const { formatSql, genderSql, tightenSql, yearSql } = this.eventMatchSql(format, gender, tighten, year);

    if (kind === 'sixes' || kind === 'fours') {
      const boundary = kind === 'sixes' ? 6 : 4;
      const rows = await this.prisma.$queryRaw<
        Array<{ personId: string; name: string; matches: number; boundaries: bigint | number; runs: bigint | number }>
      >(Prisma.sql`
        SELECT p.id AS personId, p.name AS name,
               COUNT(DISTINCT d.match_id) AS matches,
               COALESCE(SUM(CASE WHEN d.runs_batter = ${boundary} THEN 1 ELSE 0 END), 0) AS boundaries,
               COALESCE(SUM(d.runs_batter), 0) AS runs
        FROM hist_deliveries d
        JOIN hist_innings i ON i.match_id = d.match_id AND i.innings_no = d.innings_no AND i.is_super_over = 0
        JOIN hist_matches m ON m.id = d.match_id
        JOIN hist_people p ON p.id = d.batter_id
        WHERE d.batter_id IS NOT NULL
          AND m.event_name IS NOT NULL AND m.event_name LIKE ${pattern}
          ${formatSql} ${genderSql} ${tightenSql} ${yearSql}
        GROUP BY p.id, p.name
        ORDER BY boundaries DESC, runs DESC
        LIMIT ${Prisma.raw(String(limit))}`);
      const leaders = rows.map((r, index) => ({
        rank: index + 1,
        personId: r.personId,
        player: r.name,
        matches: Number(r.matches),
        ...(kind === 'sixes' ? { sixes: Number(r.boundaries) } : { fours: Number(r.boundaries) }),
        runs: Number(r.runs),
      }));
      return {
        kind: kind === 'sixes' ? ('sixes' as const) : ('fours' as const),
        event: eventContains,
        year,
        format: format ?? 'all',
        gender: gender ?? 'any',
        leaders,
        top: leaders[0] ?? null,
        note:
          leaders.length === 0
            ? `No ${kind} figures in the archive for "${eventContains}"${year ? ` ${year}` : ''}.`
            : `Tournament ${kind} leaders from Cricsheet archive deliveries (not official totals).`,
      };
    }

    if (kind === 'batting' || kind === 'hundreds') {
      const orderSql =
        kind === 'hundreds'
          ? Prisma.sql`ORDER BY hundreds DESC, runs DESC, highest DESC`
          : Prisma.sql`ORDER BY runs DESC, hundreds DESC, highest DESC`;
      const rows = await this.prisma.$queryRaw<
        Array<{
          personId: string;
          name: string;
          matches: number;
          innings: bigint | number;
          runs: bigint | number;
          hundreds: bigint | number;
          highest: number | null;
        }>
      >(Prisma.sql`
        SELECT p.id AS personId, p.name AS name,
               COUNT(DISTINCT s.match_id) AS matches,
               COUNT(*) AS innings,
               COALESCE(SUM(s.runs), 0) AS runs,
               COALESCE(SUM(s.runs >= 100), 0) AS hundreds,
               MAX(s.runs) AS highest
        FROM (
          SELECT d.match_id, d.innings_no, d.batter_id, SUM(d.runs_batter) AS runs
          FROM hist_deliveries d
          WHERE d.batter_id IS NOT NULL
          GROUP BY d.match_id, d.innings_no, d.batter_id
        ) s
        JOIN hist_innings i ON i.match_id = s.match_id AND i.innings_no = s.innings_no AND i.is_super_over = 0
        JOIN hist_matches m ON m.id = s.match_id
        JOIN hist_people p ON p.id = s.batter_id
        WHERE m.event_name IS NOT NULL AND m.event_name LIKE ${pattern}
          ${formatSql} ${genderSql} ${tightenSql} ${yearSql}
        GROUP BY p.id, p.name
        ${orderSql}
        LIMIT ${Prisma.raw(String(limit))}`);
      const leaders = rows.map((r, index) => ({
        rank: index + 1,
        personId: r.personId,
        player: r.name,
        matches: Number(r.matches),
        innings: Number(r.innings),
        runs: Number(r.runs),
        hundreds: Number(r.hundreds),
        highest: r.highest ?? 0,
      }));
      return {
        kind: kind === 'hundreds' ? ('hundreds' as const) : ('batting' as const),
        event: eventContains,
        year,
        format: format ?? 'all',
        gender: gender ?? 'any',
        leaders,
        top: leaders[0] ?? null,
        note:
          leaders.length === 0
            ? `No batting figures in the archive for "${eventContains}"${year ? ` ${year}` : ''}.`
            : kind === 'hundreds'
              ? 'Most hundreds in the event from Cricsheet archive deliveries (not official totals).'
              : 'Tournament batting leaders from Cricsheet archive deliveries (not official ICC totals).',
      };
    }

    const orderSql =
      kind === 'runs_conceded'
        ? Prisma.sql`ORDER BY runsConceded DESC, wickets ASC`
        : Prisma.sql`ORDER BY wickets DESC, runsConceded ASC`;
    const rows = await this.prisma.$queryRaw<
      Array<{
        personId: string;
        name: string;
        matches: number;
        innings: bigint | number;
        wickets: bigint | number;
        runsConceded: bigint | number;
        legalBalls: bigint | number;
      }>
    >(Prisma.sql`
      SELECT p.id AS personId, p.name AS name,
             COUNT(DISTINCT s.match_id) AS matches,
             COUNT(*) AS innings,
             COALESCE(SUM(s.wickets), 0) AS wickets,
             COALESCE(SUM(s.runs), 0) AS runsConceded,
             COALESCE(SUM(s.legal_balls), 0) AS legalBalls
      FROM (
        SELECT d.match_id, d.innings_no, d.bowler_id,
               SUM(d.is_legal) AS legal_balls,
               SUM(d.runs_batter + d.wides + d.noballs) AS runs,
               COALESCE((
                 SELECT COUNT(*) FROM hist_wickets w
                 WHERE w.match_id = d.match_id AND w.innings_no = d.innings_no
                   AND w.bowler_id = d.bowler_id AND w.credited_to_bowler = 1
               ), 0) AS wickets
        FROM hist_deliveries d
        WHERE d.bowler_id IS NOT NULL
        GROUP BY d.match_id, d.innings_no, d.bowler_id
      ) s
      JOIN hist_innings i ON i.match_id = s.match_id AND i.innings_no = s.innings_no AND i.is_super_over = 0
      JOIN hist_matches m ON m.id = s.match_id
      JOIN hist_people p ON p.id = s.bowler_id
      WHERE m.event_name IS NOT NULL AND m.event_name LIKE ${pattern}
        ${formatSql} ${genderSql} ${tightenSql} ${yearSql}
      GROUP BY p.id, p.name
      ${orderSql}
      LIMIT ${Prisma.raw(String(limit))}`);
    const leaders = rows.map((r, index) => {
      const wickets = Number(r.wickets);
      const runsConceded = Number(r.runsConceded);
      const legalBalls = Number(r.legalBalls);
      return {
        rank: index + 1,
        personId: r.personId,
        player: r.name,
        matches: Number(r.matches),
        innings: Number(r.innings),
        wickets,
        runsConceded,
        overs: overs(legalBalls),
        average: ratio(runsConceded, wickets),
        economy: ratio(runsConceded, legalBalls, 6),
      };
    });
    return {
      kind: kind === 'runs_conceded' ? ('runs_conceded' as const) : ('bowling' as const),
      event: eventContains,
      year,
      format: format ?? 'all',
      gender: gender ?? 'any',
      leaders,
      top: leaders[0] ?? null,
      note:
        leaders.length === 0
          ? `No bowling figures in the archive for "${eventContains}"${year ? ` ${year}` : ''}.`
          : kind === 'runs_conceded'
            ? 'Most runs conceded in the event from Cricsheet archive deliveries (not official totals).'
            : 'Tournament bowling leaders from Cricsheet archive deliveries (not official ICC totals).',
    };
  }

  /**
   * League table from archive match winners (2 pts per win) plus computed NRR from innings
   * (runs/overs for − runs/overs against). Close to IPL NRR; not an official published table.
   */
  async eventStandings(
    eventContains: string,
    opts: { year?: number | null; format?: HistoryFormat | null; gender?: 'male' | 'female' | null } = {},
  ) {
    const year = opts.year ?? null;
    const format = opts.format ?? null;
    const gender = opts.gender ?? null;
    const tighten = /world\s*cup/i.test(eventContains) && gender !== 'female';
    const where: Prisma.HistMatchWhereInput = {
      eventName: { contains: eventContains },
      ...(format ? { matchType: { in: FORMAT_MATCH_TYPES[format] } } : {}),
      ...(gender ? { gender } : {}),
      ...(tighten
        ? {
            AND: [
              { NOT: { eventName: { contains: 'Under-19' } } },
              { NOT: { eventName: { contains: 'U19' } } },
              { NOT: { eventName: { contains: 'Qualifier' } } },
              { NOT: { eventName: { contains: 'Women' } } },
            ],
          }
        : {}),
      ...(year
        ? {
            OR: [
              { season: { contains: String(year) } },
              {
                startDate: {
                  gte: new Date(Date.UTC(year, 0, 1)),
                  lt: new Date(Date.UTC(year + 1, 0, 1)),
                },
              },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.histMatch.findMany({
      where,
      include: {
        team1: { select: { id: true, name: true } },
        team2: { select: { id: true, name: true } },
        winner: { select: { id: true, name: true } },
        innings: {
          where: { isSuperOver: false },
          select: { battingTeamId: true, bowlingTeamId: true, runs: true, legalBalls: true },
        },
      },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    type Row = {
      teamId: number;
      team: string;
      played: number;
      won: number;
      lost: number;
      noResult: number;
      points: number;
      runsFor: number;
      ballsFor: number;
      runsAgainst: number;
      ballsAgainst: number;
      nrr: number | null;
    };
    const table = new Map<number, Row>();
    const bump = (id: number, name: string) => {
      const row =
        table.get(id) ??
        ({
          teamId: id,
          team: name,
          played: 0,
          won: 0,
          lost: 0,
          noResult: 0,
          points: 0,
          runsFor: 0,
          ballsFor: 0,
          runsAgainst: 0,
          ballsAgainst: 0,
          nrr: null,
        } satisfies Row);
      table.set(id, row);
      return row;
    };
    for (const m of rows) {
      const a = bump(m.team1.id, m.team1.name);
      const b = bump(m.team2.id, m.team2.name);
      a.played++;
      b.played++;
      if (m.winnerId === m.team1.id) {
        a.won++;
        a.points += 2;
        b.lost++;
      } else if (m.winnerId === m.team2.id) {
        b.won++;
        b.points += 2;
        a.lost++;
      } else {
        a.noResult++;
        b.noResult++;
        a.points += 1;
        b.points += 1;
      }
      for (const inn of m.innings) {
        if (inn.battingTeamId === null || inn.legalBalls <= 0) continue;
        const bat = table.get(inn.battingTeamId);
        if (bat) {
          bat.runsFor += inn.runs;
          bat.ballsFor += inn.legalBalls;
        }
        if (inn.bowlingTeamId !== null) {
          const bowl = table.get(inn.bowlingTeamId);
          if (bowl) {
            bowl.runsAgainst += inn.runs;
            bowl.ballsAgainst += inn.legalBalls;
          }
        }
      }
    }
    for (const row of table.values()) {
      const forRate = row.ballsFor > 0 ? (row.runsFor * 6) / row.ballsFor : null;
      const againstRate = row.ballsAgainst > 0 ? (row.runsAgainst * 6) / row.ballsAgainst : null;
      row.nrr =
        forRate !== null && againstRate !== null ? Math.round((forRate - againstRate) * 1000) / 1000 : null;
    }
    const standings = [...table.values()]
      .map(({ teamId: _id, runsFor: _rf, ballsFor: _bf, runsAgainst: _ra, ballsAgainst: _ba, ...rest }) => rest)
      .sort((x, y) => y.points - x.points || (y.nrr ?? -99) - (x.nrr ?? -99) || y.won - x.won || x.team.localeCompare(y.team));
    return {
      event: eventContains,
      year,
      format: format ?? 'all',
      gender: gender ?? 'any',
      matchCount: rows.length,
      standings,
      top: standings[0] ?? null,
      note:
        standings.length === 0
          ? `No archive matches whose event name contains "${eventContains}"${year ? ` in ${year}` : ''}.`
          : 'Archive standings: 2 pts win, 1 pt each no-result; NRR = (runs/overs for) − (runs/overs against) from Cricsheet innings. Close to IPL NRR, not an official published table.',
    };
  }

  /** Player of the Match leaders in an event (Cricsheet player_of_match). POT is not stored — most POTMs is the proxy. */
  async eventAwards(
    eventContains: string,
    opts: { year?: number | null; format?: HistoryFormat | null; gender?: 'male' | 'female' | null; limit?: number } = {},
  ) {
    const year = opts.year ?? null;
    const format = opts.format ?? null;
    const gender = opts.gender ?? null;
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 20);
    const pattern = `%${eventContains}%`;
    const { formatSql, genderSql, tightenSql, yearSql } = this.eventMatchSql(
      format,
      gender,
      /world\s*cup/i.test(eventContains) && gender !== 'female',
      year,
    );
    const rows = await this.prisma.$queryRaw<
      Array<{ personId: string; name: string; awards: bigint | number }>
    >(Prisma.sql`
      SELECT p.id AS personId, p.name AS name, COUNT(*) AS awards
      FROM hist_match_players mp
      JOIN hist_matches m ON m.id = mp.match_id
      JOIN hist_people p ON p.id = mp.person_id
      WHERE mp.is_player_of_match = 1
        AND m.event_name IS NOT NULL AND m.event_name LIKE ${pattern}
        ${formatSql} ${genderSql} ${tightenSql} ${yearSql}
      GROUP BY p.id, p.name
      ORDER BY awards DESC, p.name ASC
      LIMIT ${Prisma.raw(String(limit))}`);
    const leaders = rows.map((r, index) => ({
      rank: index + 1,
      personId: r.personId,
      player: r.name,
      playerOfMatchAwards: Number(r.awards),
    }));
    return {
      event: eventContains,
      year,
      format: format ?? 'all',
      gender: gender ?? 'any',
      leaders,
      top: leaders[0] ?? null,
      playerOfTournament: null as string | null,
      note:
        leaders.length === 0
          ? `No Player of the Match awards in the archive for "${eventContains}"${year ? ` ${year}` : ''}.`
          : 'Most Player of the Match awards from Cricsheet. Official "Player of the Tournament" is not in the archive — use this list as the closest proxy.',
    };
  }

  /**
   * Team or batter phase rates inside an event, with optional won/lost and playoffs filters.
   * Phases: powerplay / middle / death (T20 overs 1-6 / 7-15 / 16-20).
   */
  async eventPhaseStats(
    eventContains: string,
    opts: {
      year?: number | null;
      format?: HistoryFormat | null;
      gender?: 'male' | 'female' | null;
      phase?: 'powerplay' | 'middle' | 'death' | 'all';
      resultFilter?: 'all' | 'won' | 'lost';
      stage?: 'all' | 'playoffs';
      teamIds?: number[] | null;
      subject?: 'team' | 'batter';
      limit?: number;
    } = {},
  ) {
    const year = opts.year ?? null;
    const format = opts.format ?? 'T20';
    const gender = opts.gender ?? null;
    const phase = opts.phase ?? 'all';
    const resultFilter = opts.resultFilter ?? 'all';
    const stage = opts.stage ?? 'all';
    const subject = opts.subject ?? 'team';
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 20);
    const pattern = `%${eventContains}%`;
    const types = FORMAT_MATCH_TYPES[format === 'ODI' ? 'ODI' : 'T20'];
    const formatSql = Prisma.sql`AND m.match_type IN (${Prisma.join(types)})`;
    const genderSql = gender ? Prisma.sql`AND m.gender = ${gender}` : Prisma.sql``;
    const yearSql = year
      ? Prisma.sql`AND (m.season LIKE ${`%${year}%`} OR (m.start_date >= ${new Date(Date.UTC(year, 0, 1))} AND m.start_date < ${new Date(Date.UTC(year + 1, 0, 1))}))`
      : Prisma.sql``;
    const isOdi = format === 'ODI';
    const phaseSql =
      phase === 'powerplay'
        ? isOdi
          ? Prisma.sql`AND d.over_no < 10`
          : Prisma.sql`AND d.over_no < 6`
        : phase === 'middle'
          ? isOdi
            ? Prisma.sql`AND d.over_no >= 10 AND d.over_no < 40`
            : Prisma.sql`AND d.over_no >= 6 AND d.over_no < 15`
          : phase === 'death'
            ? isOdi
              ? Prisma.sql`AND d.over_no >= 40`
              : Prisma.sql`AND d.over_no >= 15`
            : Prisma.sql``;
    const resultSql =
      resultFilter === 'won'
        ? Prisma.sql`AND m.winner_id = i.batting_team_id`
        : resultFilter === 'lost'
          ? Prisma.sql`AND m.winner_id IS NOT NULL AND m.winner_id <> i.batting_team_id`
          : Prisma.sql``;
    const stageSql =
      stage === 'playoffs'
        ? Prisma.sql`AND (
            m.match_number LIKE ${'%Final%'} OR m.match_number LIKE ${'%Qualifier%'}
            OR m.match_number LIKE ${'%Eliminator%'} OR m.match_number LIKE ${'%Playoff%'}
            OR m.match_number LIKE ${'%Play-off%'}
          )`
        : Prisma.sql``;
    const teamSql =
      opts.teamIds && opts.teamIds.length > 0
        ? Prisma.sql`AND i.batting_team_id IN (${Prisma.join(opts.teamIds)})`
        : Prisma.sql``;

    if (subject === 'batter') {
      const rows = await this.prisma.$queryRaw<
        Array<{ personId: string; name: string; innings: bigint | number; runs: bigint | number; balls: bigint | number; fours: bigint | number; sixes: bigint | number }>
      >(Prisma.sql`
        SELECT p.id AS personId, p.name AS name,
               COUNT(DISTINCT d.match_id, d.innings_no) AS innings,
               COALESCE(SUM(d.runs_batter), 0) AS runs,
               COALESCE(SUM(d.is_legal), 0) AS balls,
               COALESCE(SUM(CASE WHEN d.runs_batter = 4 AND d.non_boundary = 0 THEN 1 ELSE 0 END), 0) AS fours,
               COALESCE(SUM(CASE WHEN d.runs_batter = 6 AND d.non_boundary = 0 THEN 1 ELSE 0 END), 0) AS sixes
        FROM hist_deliveries d
        JOIN hist_innings i ON i.match_id = d.match_id AND i.innings_no = d.innings_no AND i.is_super_over = 0
        JOIN hist_matches m ON m.id = d.match_id
        JOIN hist_people p ON p.id = d.batter_id
        WHERE d.batter_id IS NOT NULL AND m.balls_per_over = 6
          AND m.event_name IS NOT NULL AND m.event_name LIKE ${pattern}
          ${formatSql} ${genderSql} ${yearSql} ${phaseSql} ${resultSql} ${stageSql} ${teamSql}
        GROUP BY p.id, p.name
        HAVING COALESCE(SUM(d.is_legal), 0) >= 12
        ORDER BY runs DESC, balls ASC
        LIMIT ${Prisma.raw(String(limit))}`);
      const leaders = rows.map((r, index) => {
        const runs = Number(r.runs);
        const balls = Number(r.balls);
        return {
          rank: index + 1,
          personId: r.personId,
          player: r.name,
          innings: Number(r.innings),
          runs,
          balls,
          strikeRate: ratio(runs, balls, 100),
          fours: Number(r.fours),
          sixes: Number(r.sixes),
        };
      });
      return {
        subject: 'batter' as const,
        event: eventContains,
        year,
        format,
        phase,
        resultFilter,
        stage,
        leaders,
        top: leaders[0] ?? null,
        note:
          leaders.length === 0
            ? `No batter phase figures for "${eventContains}"${year ? ` ${year}` : ''} (${phase}, ${resultFilter}, ${stage}).`
            : 'Batter phase leaders from Cricsheet deliveries (min 12 balls). Home/away not available.',
      };
    }

    const phaseCase = isOdi
      ? Prisma.sql`CASE WHEN d.over_no < 10 THEN 'powerplay' WHEN d.over_no < 40 THEN 'middle' ELSE 'death' END`
      : Prisma.sql`CASE WHEN d.over_no < 6 THEN 'powerplay' WHEN d.over_no < 15 THEN 'middle' ELSE 'death' END`;
    const rows = await this.prisma.$queryRaw<
      Array<{
        teamId: number;
        team: string;
        phaseName: string;
        innings: bigint | number;
        runs: bigint | number;
        balls: bigint | number;
        wickets: bigint | number;
        fours: bigint | number;
        sixes: bigint | number;
        dots: bigint | number;
      }>
    >(Prisma.sql`
      SELECT i.batting_team_id AS teamId, t.name AS team,
             ${phaseCase} AS phaseName,
             COUNT(DISTINCT d.match_id, d.innings_no) AS innings,
             COALESCE(SUM(d.total_runs), 0) AS runs,
             COALESCE(SUM(d.is_legal), 0) AS balls,
             COALESCE(SUM(d.team_wickets), 0) AS wickets,
             COALESCE(SUM(CASE WHEN d.runs_batter = 4 AND d.non_boundary = 0 THEN 1 ELSE 0 END), 0) AS fours,
             COALESCE(SUM(CASE WHEN d.runs_batter = 6 AND d.non_boundary = 0 THEN 1 ELSE 0 END), 0) AS sixes,
             COALESCE(SUM(CASE WHEN d.is_legal = 1 AND d.total_runs = 0 THEN 1 ELSE 0 END), 0) AS dots
      FROM hist_deliveries d
      JOIN hist_innings i ON i.match_id = d.match_id AND i.innings_no = d.innings_no AND i.is_super_over = 0
      JOIN hist_matches m ON m.id = d.match_id
      JOIN hist_teams t ON t.id = i.batting_team_id
      WHERE i.batting_team_id IS NOT NULL AND m.balls_per_over = 6
        AND m.event_name IS NOT NULL AND m.event_name LIKE ${pattern}
        ${formatSql} ${genderSql} ${yearSql} ${phaseSql} ${resultSql} ${stageSql} ${teamSql}
      GROUP BY i.batting_team_id, t.name, phaseName
      HAVING COALESCE(SUM(d.is_legal), 0) >= 30
      ORDER BY (COALESCE(SUM(d.total_runs), 0) * 6) / COALESCE(SUM(d.is_legal), 0) DESC, runs DESC
      LIMIT ${Prisma.raw(String(limit * (phase === 'all' ? 3 : 1)))}`);
    const leaders = rows.map((r, index) => {
      const runs = Number(r.runs);
      const balls = Number(r.balls);
      const innings = Number(r.innings);
      return {
        rank: index + 1,
        teamId: r.teamId,
        team: r.team,
        phase: r.phaseName,
        innings,
        runs,
        runRate: ratio(runs, balls, 6),
        wicketsPerInnings: ratio(Number(r.wickets), innings),
        dotBallPercent: ratio(Number(r.dots), balls, 100),
        fours: Number(r.fours),
        sixes: Number(r.sixes),
      };
    });
    return {
      subject: 'team' as const,
      event: eventContains,
      year,
      format,
      phase,
      resultFilter,
      stage,
      leaders,
      top: leaders[0] ?? null,
      note:
        leaders.length === 0
          ? `No team phase figures for "${eventContains}"${year ? ` ${year}` : ''} (${phase}, ${resultFilter}, ${stage}).`
          : 'Team phase rates from Cricsheet deliveries. Playoffs = Final/Qualifier/Eliminator match_number. Home/away not available.',
    };
  }

  /**
   * Matches between two teams inside an event (e.g. CSK vs MI in IPL 2019), with innings scores.
   * Covers "what was the result / score / margin / target" style asks from the IPL question set.
   */
  async eventTeamMatches(
    eventContains: string,
    teamAIds: number[],
    teamBIds: number[],
    opts: { year?: number | null; format?: HistoryFormat | null; gender?: 'male' | 'female' | null } = {},
  ) {
    const year = opts.year ?? null;
    const format = opts.format ?? null;
    const gender = opts.gender ?? null;
    const and: Prisma.HistMatchWhereInput[] = [
      { eventName: { contains: eventContains } },
      {
        OR: [
          { team1Id: { in: teamAIds }, team2Id: { in: teamBIds } },
          { team1Id: { in: teamBIds }, team2Id: { in: teamAIds } },
        ],
      },
    ];
    if (format) and.push({ matchType: { in: FORMAT_MATCH_TYPES[format] } });
    if (gender) and.push({ gender });
    if (year) {
      and.push({
        OR: [
          { season: { contains: String(year) } },
          {
            startDate: {
              gte: new Date(Date.UTC(year, 0, 1)),
              lt: new Date(Date.UTC(year + 1, 0, 1)),
            },
          },
        ],
      });
    }
    const rows = await this.prisma.histMatch.findMany({
      where: { AND: and },
      include: {
        team1: { select: { id: true, name: true } },
        team2: { select: { id: true, name: true } },
        winner: { select: { id: true, name: true } },
        innings: {
          where: { isSuperOver: false },
          orderBy: { inningsNo: 'asc' },
          select: {
            inningsNo: true,
            battingTeamId: true,
            runs: true,
            wickets: true,
            legalBalls: true,
            targetRuns: true,
            extras: true,
          },
        },
      },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      take: 40,
    });
    const matches = rows.map((m) => {
      const innings = m.innings.map((i) => {
        const batting =
          i.battingTeamId === m.team1.id ? m.team1.name : i.battingTeamId === m.team2.id ? m.team2.name : null;
        return {
          inning: i.inningsNo,
          team: batting,
          score: `${i.runs}/${i.wickets}`,
          overs: overs(i.legalBalls),
          target: i.targetRuns,
          extras: i.extras,
        };
      });
      return {
        date: day(m.startDate),
        season: m.season,
        matchNumber: m.matchNumber,
        teams: [m.team1.name, m.team2.name],
        winner: m.winner?.name ?? m.eliminatorTeam ?? null,
        winByRuns: m.winByRuns,
        winByWickets: m.winByWickets,
        outcome: m.outcome,
        innings,
      };
    });
    return {
      event: eventContains,
      year,
      format: format ?? 'all',
      matchCount: matches.length,
      matches,
      note:
        matches.length === 0
          ? `No archive matches between these teams for "${eventContains}"${year ? ` in ${year}` : ''}.`
          : 'Archive match list for this fixture (Cricsheet). Multiple meetings in a season are all listed.',
    };
  }

  /** Season extremes: highest/lowest team totals and biggest win margins in an event. */
  async eventExtremes(
    eventContains: string,
    opts: { year?: number | null; format?: HistoryFormat | null; gender?: 'male' | 'female' | null } = {},
  ) {
    const year = opts.year ?? null;
    const format = opts.format ?? null;
    const gender = opts.gender ?? null;
    const pattern = `%${eventContains}%`;
    const { formatSql, genderSql, tightenSql, yearSql } = this.eventMatchSql(
      format,
      gender,
      /world\s*cup/i.test(eventContains) && gender !== 'female',
      year,
    );
    const totals = await this.prisma.$queryRaw<
      Array<{
        matchId: number;
        date: Date | null;
        team: string;
        runs: number;
        wickets: number;
        legalBalls: number;
        opponent: string | null;
      }>
    >(Prisma.sql`
      SELECT m.id AS matchId, m.start_date AS date, bt.name AS team, i.runs AS runs, i.wickets AS wickets,
             i.legal_balls AS legalBalls, ot.name AS opponent
      FROM hist_innings i
      JOIN hist_matches m ON m.id = i.match_id
      JOIN hist_teams bt ON bt.id = i.batting_team_id
      LEFT JOIN hist_teams ot ON ot.id = i.bowling_team_id
      WHERE i.is_super_over = 0 AND m.event_name IS NOT NULL AND m.event_name LIKE ${pattern}
        ${formatSql} ${genderSql} ${tightenSql} ${yearSql}
      ORDER BY i.runs DESC
      LIMIT 5`);
    const lowest = await this.prisma.$queryRaw<
      Array<{ matchId: number; date: Date | null; team: string; runs: number; wickets: number; opponent: string | null }>
    >(Prisma.sql`
      SELECT m.id AS matchId, m.start_date AS date, bt.name AS team, i.runs AS runs, i.wickets AS wickets, ot.name AS opponent
      FROM hist_innings i
      JOIN hist_matches m ON m.id = i.match_id
      JOIN hist_teams bt ON bt.id = i.batting_team_id
      LEFT JOIN hist_teams ot ON ot.id = i.bowling_team_id
      WHERE i.is_super_over = 0 AND i.wickets >= 10 AND m.event_name IS NOT NULL AND m.event_name LIKE ${pattern}
        ${formatSql} ${genderSql} ${tightenSql} ${yearSql}
      ORDER BY i.runs ASC
      LIMIT 5`);
    const margins = await this.prisma.histMatch.findMany({
      where: {
        eventName: { contains: eventContains },
        ...(format ? { matchType: { in: FORMAT_MATCH_TYPES[format] } } : {}),
        ...(gender ? { gender } : {}),
        ...(year
          ? {
              OR: [
                { season: { contains: String(year) } },
                {
                  startDate: {
                    gte: new Date(Date.UTC(year, 0, 1)),
                    lt: new Date(Date.UTC(year + 1, 0, 1)),
                  },
                },
              ],
            }
          : {}),
        OR: [{ winByRuns: { not: null } }, { winByWickets: { not: null } }],
      },
      include: { team1: { select: { name: true } }, team2: { select: { name: true } }, winner: { select: { name: true } } },
      orderBy: [{ winByRuns: 'desc' }, { winByWickets: 'desc' }],
      take: 8,
    });
    const mapTotal = (r: { date: Date | null; team: string; runs: number; wickets: number; opponent: string | null; legalBalls?: number }) => ({
      date: day(r.date),
      team: r.team,
      opponent: r.opponent,
      score: `${r.runs}/${r.wickets}`,
      overs: r.legalBalls !== undefined ? overs(r.legalBalls) : null,
      runs: r.runs,
    });
    return {
      event: eventContains,
      year,
      format: format ?? 'all',
      highestTotals: totals.map(mapTotal),
      lowestAllOutTotals: lowest.map(mapTotal),
      biggestWins: margins.map((m) => ({
        date: day(m.startDate),
        teams: [m.team1.name, m.team2.name],
        winner: m.winner?.name ?? null,
        winByRuns: m.winByRuns,
        winByWickets: m.winByWickets,
        matchNumber: m.matchNumber,
      })),
      note:
        totals.length === 0
          ? `No innings totals in the archive for "${eventContains}"${year ? ` in ${year}` : ''}.`
          : 'Season extremes from Cricsheet archive innings (not official IPL records).',
    };
  }

  /** Batter strike-rate and bowler economy at venues from hist_agg_player_venue. */
  async playerVenueRates(personId: string, venueIds: number[], format: HistoryFormat | null) {
    if (venueIds.length === 0) return { battingRunRate: null as number | null, bowlingEconomy: null as number | null, battingInnings: 0, bowlingInnings: 0 };
    const rows = await this.prisma.histAggPlayerVenue.findMany({
      where: { personId, venueId: { in: venueIds }, matchType: this.matchTypes(format) },
    });
    let batRuns = 0;
    let batBalls = 0;
    let batInnings = 0;
    let bowlRuns = 0;
    let bowlBalls = 0;
    let bowlInnings = 0;
    for (const row of rows) {
      batRuns += row.runs;
      batBalls += row.ballsFaced;
      batInnings += row.battingInnings;
      bowlRuns += row.runsConceded;
      bowlBalls += row.legalBalls;
      bowlInnings += row.bowlingInnings;
    }
    return {
      battingRunRate: batBalls > 0 ? ratio(batRuns, batBalls, 6) : null,
      bowlingEconomy: bowlBalls > 0 ? ratio(bowlRuns, bowlBalls, 6) : null,
      battingInnings: batInnings,
      bowlingInnings: bowlInnings,
    };
  }

  /**
   * Overall scoring rate when this batter faced this bowler in the archive
   * (runs off the bat + extras per over of legal balls). Not limited to 6-over windows.
   */
  async batterVsBowlerRate(batterId: string, bowlerId: string, format: HistoryFormat | null) {
    const types = format ? FORMAT_MATCH_TYPES[format] : null;
    const formatSql = types ? Prisma.sql`AND m.match_type IN (${Prisma.join(types)})` : Prisma.sql``;
    const rows = await this.prisma.$queryRaw<Array<{ legalBalls: bigint | number; runs: bigint | number }>>(Prisma.sql`
      SELECT COALESCE(SUM(d.is_legal), 0) AS legalBalls,
             COALESCE(SUM(d.runs_batter + d.wides + d.noballs), 0) AS runs
      FROM hist_deliveries d
      JOIN hist_matches m ON m.id = d.match_id
      WHERE d.batter_id = ${batterId} AND d.bowler_id = ${bowlerId}
        ${formatSql}`);
    const legalBalls = Number(rows[0]?.legalBalls ?? 0);
    const runs = Number(rows[0]?.runs ?? 0);
    return {
      balls: legalBalls,
      runs,
      runRate: legalBalls > 0 ? ratio(runs, legalBalls, 6) : null,
    };
  }

  /** Cricsheet teams with exactly this name (case-insensitive in MySQL). */
  async teamsByName(name: string): Promise<number[]> {
    const trimmed = name.trim();
    if (!trimmed) return [];
    const aliases: Record<string, string[]> = {
      afg: ['Afghanistan'],
      afghanistan: ['Afghanistan'],
      ban: ['Bangladesh'],
      bangladesh: ['Bangladesh'],
      ind: ['India'],
      india: ['India'],
      aus: ['Australia'],
      australia: ['Australia'],
      eng: ['England'],
      england: ['England'],
      pak: ['Pakistan'],
      pakistan: ['Pakistan'],
      nz: ['New Zealand'],
      'new zealand': ['New Zealand'],
      sl: ['Sri Lanka'],
      'sri lanka': ['Sri Lanka'],
      sa: ['South Africa'],
      'south africa': ['South Africa'],
      wi: ['West Indies'],
      'west indies': ['West Indies'],
    };
    const candidates = [...new Set([trimmed, ...(aliases[trimmed.toLowerCase()] ?? [])])];
    for (const candidate of candidates) {
      const exact = await this.prisma.histTeam.findMany({
        where: { name: { equals: candidate } },
        select: { id: true },
        take: 4,
      });
      if (exact.length > 0) return exact.map((r) => r.id);
    }
    // Soft fallback: surname-style contains (international sides only when possible).
    const soft = await this.prisma.histTeam.findMany({
      where: { name: { contains: candidates[0] } },
      select: { id: true, name: true },
      take: 8,
    });
    const international = soft.filter((r) => !/\b(xi|under|u19|women)\b/i.test(r.name));
    const pick = international.length > 0 ? international : soft;
    return pick.slice(0, 4).map((r) => r.id);
  }

  async headToHead(a: HistTeamSide, b: HistTeamSide, format: HistoryFormat | null) {
    const gender = a.gender ?? b.gender ?? undefined;
    const rows = await this.prisma.histAggHeadToHead.findMany({
      where: {
        matchType: this.matchTypes(format),
        gender,
        OR: [
          { team1Id: { in: a.ids }, team2Id: { in: b.ids } },
          { team1Id: { in: b.ids }, team2Id: { in: a.ids } },
        ],
      },
    });
    const byFormat = new Map<string, { matchType: string; gender: string; matches: number; winsA: number; winsB: number; ties: number; draws: number; noResults: number; last: Date | null }>();
    for (const row of rows) {
      const key = `${row.matchType}|${row.gender}`;
      const acc = byFormat.get(key) ?? { matchType: row.matchType, gender: row.gender, matches: 0, winsA: 0, winsB: 0, ties: 0, draws: 0, noResults: 0, last: null };
      const aIsTeam1 = a.ids.includes(row.team1Id);
      acc.matches += row.matches;
      acc.winsA += aIsTeam1 ? row.team1Wins : row.team2Wins;
      acc.winsB += aIsTeam1 ? row.team2Wins : row.team1Wins;
      acc.ties += row.ties;
      acc.draws += row.draws;
      acc.noResults += row.noResults;
      if (row.lastMatchDate && (!acc.last || row.lastMatchDate > acc.last)) acc.last = row.lastMatchDate;
      byFormat.set(key, acc);
    }
    return [...byFormat.values()]
      .sort((x, y) => y.matches - x.matches)
      .map((r) => ({
        matchType: r.matchType,
        gender: r.gender,
        matches: r.matches,
        [`${a.name} wins`]: r.winsA,
        [`${b.name} wins`]: r.winsB,
        ties: r.ties,
        draws: r.draws,
        noResults: r.noResults,
        lastMatch: day(r.last),
      }));
  }

  /** Cricsheet venues with the same ground name and a compatible city. */
  async venuesByName(name: string, city: string | null): Promise<number[]> {
    const wanted = venueParts({ name, city });
    if (!wanted.name) return [];
    const keyword = wanted.name.split(' ').reduce((best, word) => (word.length > best.length ? word : best), '');
    const rows = await this.prisma.histVenue.findMany({
      where: { name: { contains: keyword } },
      select: { id: true, name: true, city: true },
      take: NAME_SCAN_LIMIT,
    });
    return rows
      .filter((row) => {
        const parts = venueParts(row);
        return parts.name === wanted.name && (!wanted.city || !parts.city || parts.city === wanted.city);
      })
      .map((row) => row.id)
      .slice(0, MAX_VENUES * 4);
  }

  async venueStats(venueIds: number[], format: HistoryFormat | null) {
    const [venues, rows] = await Promise.all([
      this.prisma.histVenue.findMany({ where: { id: { in: venueIds } }, select: { id: true, name: true, city: true } }),
      this.prisma.histAggVenue.findMany({ where: { venueId: { in: venueIds }, matchType: this.matchTypes(format) } }),
    ]);
    const byFormat = new Map<string, Record<string, number | string | null> & { _last: Date | null }>();
    for (const row of rows) {
      const key = `${row.matchType}|${row.gender}`;
      const acc =
        byFormat.get(key) ??
        ({ matchType: row.matchType, gender: row.gender, matches: 0, batFirstWins: 0, chasingWins: 0, ties: 0, draws: 0, noResults: 0, tossWinnerWins: 0, firstInningsRuns: 0, firstInningsCount: 0, highestTotal: 0, lowestAllOutTotal: null, _last: null } as Record<string, number | string | null> & { _last: Date | null });
      for (const field of ['matches', 'batFirstWins', 'chasingWins', 'ties', 'draws', 'noResults', 'tossWinnerWins', 'firstInningsRuns', 'firstInningsCount'] as const) {
        acc[field] = (acc[field] as number) + row[field];
      }
      acc.highestTotal = Math.max(acc.highestTotal as number, row.highestTotal);
      if (row.lowestAllOutTotal !== null) {
        acc.lowestAllOutTotal = acc.lowestAllOutTotal === null ? row.lowestAllOutTotal : Math.min(acc.lowestAllOutTotal as number, row.lowestAllOutTotal);
      }
      if (row.lastMatchDate && (!acc._last || row.lastMatchDate > acc._last)) acc._last = row.lastMatchDate;
      byFormat.set(key, acc);
    }
    const names = [...new Set(venues.map((v) => [v.name, v.city].filter(Boolean).join(', ')))];
    return {
      venue: names[0] ?? null,
      otherSpellings: names.slice(1, 4),
      formats: [...byFormat.values()]
        .sort((x, y) => (y.matches as number) - (x.matches as number))
        .map(({ _last, firstInningsRuns, firstInningsCount, ...rest }) => ({
          ...rest,
          averageFirstInningsScore: ratio(firstInningsRuns as number, firstInningsCount as number),
          lastMatch: day(_last),
        })),
    };
  }

  async teamPhases(teamIds: number[], gender: string | null, format: 'T20' | 'ODI') {
    const rows = await this.prisma.histAggTeamPhase.findMany({
      where: { teamId: { in: teamIds }, gender: gender ?? undefined, matchType: this.matchTypes(format) },
    });
    const byKey = new Map<string, { matchType: string; gender: string; phase: string; innings: number; runs: number; balls: number; wickets: number; fours: number; sixes: number; dots: number }>();
    for (const row of rows) {
      const key = `${row.matchType}|${row.gender}|${row.phase}`;
      const acc = byKey.get(key) ?? { matchType: row.matchType, gender: row.gender, phase: row.phase, innings: 0, runs: 0, balls: 0, wickets: 0, fours: 0, sixes: 0, dots: 0 };
      acc.innings += row.innings;
      acc.runs += row.runs;
      acc.balls += row.legalBalls;
      acc.wickets += row.wickets;
      acc.fours += row.fours;
      acc.sixes += row.sixes;
      acc.dots += row.dots;
      byKey.set(key, acc);
    }
    return [...byKey.values()].map((r) => ({
      matchType: r.matchType,
      gender: r.gender,
      phase: r.phase,
      innings: r.innings,
      runRate: ratio(r.runs, r.balls, 6),
      runsPerInnings: ratio(r.runs, r.innings),
      wicketsPerInnings: ratio(r.wickets, r.innings),
      dotBallPercent: ratio(r.dots, r.balls, 100),
      boundaries: r.fours + r.sixes,
    }));
  }
}
