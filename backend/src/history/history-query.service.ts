import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { compareNames, nameParts, venueParts } from '../identity/identity-matching';

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
  constructor(private readonly prisma: PrismaService) {}

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
