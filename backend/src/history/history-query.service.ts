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
  gender: string | null;
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

  /** Cricsheet people whose name fits `name` ("Virat Kohli" finds "V Kohli"). */
  async findPeople(name: string): Promise<Array<{ personId: string; name: string }>> {
    const wanted = nameParts(name);
    if (!wanted) return [];
    const rows = await this.prisma.histPersonName.findMany({
      where: { name: { contains: wanted.surname.split(' ').pop()! } },
      select: { personId: true, name: true },
      take: NAME_SCAN_LIMIT,
    });
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
  private eventMatchSql(format: HistoryFormat | null, gender: 'male' | 'female' | null, tightenWorldCup: boolean) {
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
    return { formatSql, genderSql, tightenSql };
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
  ) {
    const pattern = `%${eventContains}%`;
    const tighten = /world\s*cup/i.test(eventContains) && gender !== 'female';
    const { formatSql, genderSql, tightenSql } = this.eventMatchSql(format, gender, tighten);
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
        ${formatSql} ${genderSql} ${tightenSql}
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
  ) {
    const pattern = `%${eventContains}%`;
    const tighten = /world\s*cup/i.test(eventContains) && gender !== 'female';
    const { formatSql, genderSql, tightenSql } = this.eventMatchSql(format, gender, tighten);
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
        ${formatSql} ${genderSql} ${tightenSql}
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

  /** Cricsheet teams with exactly this name (case-insensitive in MySQL). */
  async teamsByName(name: string): Promise<number[]> {
    const rows = await this.prisma.histTeam.findMany({ where: { name: { equals: name.trim() } }, select: { id: true }, take: 4 });
    return rows.map((r) => r.id);
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
