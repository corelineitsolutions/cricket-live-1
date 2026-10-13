import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { IdentityMapStatus, Prisma } from '@prisma/client';
import { ErrorCode } from '../common/constants/error-codes';
import { apiError, notFound } from '../common/utils/http-errors';
import { buildPagination } from '../common/utils/pagination';
import { logEvent } from '../common/utils/structured-log';
import { PrismaService } from '../database/prisma.service';
import { HistoryPrismaService } from '../history/history-prisma.service';
import { venueKey } from '../history/import/prisma-history.store';
import { CreatePlayerMapDto, CreateTeamMapDto, CreateVenueMapDto, IdentityKind, ListIdentityQueryDto } from './dto/identity.dto';
import { HistPersonNames, normalizeText, proposePlayers, proposeTeams, proposeVenues } from './identity-matching';

const CREATE_CHUNK = 1000;
const SEARCH_LIMIT = 20;
/** Upper bound on live/history ids collected for a name search in the review list. */
const SEARCH_ID_LIMIT = 500;

export interface ProposalRunResult {
  kind: IdentityKind;
  proposals: number;
  created: number;
  updated: number;
  unchangedOrReviewed: number;
  unmatched: number;
  ambiguous: number;
}

const conflict = (message: string) => apiError(HttpStatus.CONFLICT, message, ErrorCode.CONFLICT);

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  private running = false;
  /** hist_* and identity_* (may be HISTORY_DATABASE_URL). */
  private readonly history: HistoryPrismaService['client'];

  constructor(
    private readonly prisma: PrismaService,
    historyPrisma: HistoryPrismaService,
  ) {
    this.history = historyPrisma.client;
  }

  // ---------------------------------------------------------------- summary

  async summary() {
    const statuses = Object.values(IdentityMapStatus);
    const count = async (kind: IdentityKind) => {
      const counts = await Promise.all(statuses.map((status) => this.delegate(kind).count({ where: { status } })));
      return Object.fromEntries(statuses.map((status, i) => [status, counts[i]])) as Record<IdentityMapStatus, number>;
    };
    const [players, teams, venues, histPeople, histTeams, histVenues, livePlayers, liveTeams] = await Promise.all([
      count('players'),
      count('teams'),
      count('venues'),
      this.history.histPerson.count(),
      this.history.histTeam.count(),
      this.history.histVenue.count(),
      this.prisma.player.count(),
      this.prisma.team.count(),
    ]);
    return {
      mappings: { players, teams, venues },
      history: { people: histPeople, teams: histTeams, venues: histVenues },
      live: { players: livePlayers, teams: liveTeams },
      proposalRunning: this.running,
    };
  }

  // ---------------------------------------------------------------- proposals

  async propose(kind: IdentityKind): Promise<ProposalRunResult> {
    if (this.running) throw conflict('A proposal run is already in progress');
    this.running = true;
    const started = Date.now();
    try {
      const result = kind === 'players' ? await this.proposePlayers() : kind === 'teams' ? await this.proposeTeams() : await this.proposeVenues();
      logEvent(this.logger, 'log', 'identity-proposals', { ...result, durationMs: Date.now() - started });
      return result;
    } finally {
      this.running = false;
    }
  }

  private async proposePlayers(): Promise<ProposalRunResult> {
    const [players, people, names, confirmed, international] = await Promise.all([
      this.prisma.player.findMany({ select: { sportmonksId: true, name: true, country: true } }),
      this.history.histPerson.findMany({ select: { id: true, name: true } }),
      this.history.histPersonName.findMany({ select: { personId: true, name: true } }),
      this.history.identityPlayerMap.findMany({ where: { status: 'CONFIRMED' }, select: { latiyalPlayerId: true, histPersonId: true } }),
      this.internationalTeamsByPerson(),
    ]);
    const byPerson = new Map<string, HistPersonNames>();
    for (const person of people) byPerson.set(person.id, { personId: person.id, names: [person.name] });
    for (const row of names) byPerson.get(row.personId)?.names.push(row.name);
    const takenLatiyal = new Set(confirmed.map((r) => r.latiyalPlayerId));
    const takenPeople = new Set(confirmed.map((r) => r.histPersonId));
    const candidates = [...byPerson.values()].filter((p) => !takenPeople.has(p.personId));
    const open = players.filter((p) => !takenLatiyal.has(p.sportmonksId));

    const { proposals, ambiguous, unmatched } = proposePlayers(
      open.map((p) => ({ latiyalId: p.sportmonksId, name: p.name, country: p.country })),
      candidates,
      international,
    );
    const existing = await this.history.identityPlayerMap.findMany({
      select: { id: true, latiyalPlayerId: true, histPersonId: true, status: true, method: true, confidence: true },
    });
    const write = await this.writeProposals(
      proposals.map((p) => ({
        key: `${p.latiyal}|${p.hist}`,
        data: { latiyalPlayerId: p.latiyal, histPersonId: p.hist, method: p.method, confidence: p.confidence, evidence: p.evidence },
      })),
      existing.map((r) => ({ ...r, key: `${r.latiyalPlayerId}|${r.histPersonId}` })),
      (data) => this.history.identityPlayerMap.createMany({ data, skipDuplicates: true }),
      (id, data) => this.history.identityPlayerMap.update({ where: { id }, data }),
    );
    return { kind: 'players', proposals: proposals.length, ...write, unmatched, ambiguous };
  }

  private async proposeTeams(): Promise<ProposalRunResult> {
    const [teams, histTeams, existing] = await Promise.all([
      this.prisma.team.findMany({ select: { sportmonksId: true, name: true } }),
      this.history.histTeam.findMany({ select: { id: true, name: true, teamType: true } }),
      this.history.identityTeamMap.findMany({
        select: { id: true, latiyalTeamId: true, histTeamId: true, gender: true, status: true, method: true, confidence: true },
      }),
    ]);
    const { proposals, unmatched } = proposeTeams(
      teams.map((t) => ({ latiyalId: t.sportmonksId, name: t.name })),
      histTeams,
    );
    const write = await this.writeProposals(
      proposals.map((p) => ({
        key: `${p.latiyal}|${p.hist}|${p.gender}`,
        data: { latiyalTeamId: p.latiyal, histTeamId: p.hist, gender: p.gender, method: p.method, confidence: p.confidence, evidence: p.evidence },
      })),
      existing.map((r) => ({ ...r, key: `${r.latiyalTeamId}|${r.histTeamId}|${r.gender}` })),
      (data) => this.history.identityTeamMap.createMany({ data, skipDuplicates: true }),
      (id, data) => this.history.identityTeamMap.update({ where: { id }, data }),
    );
    return { kind: 'teams', proposals: proposals.length, ...write, unmatched, ambiguous: 0 };
  }

  private async proposeVenues(): Promise<ProposalRunResult> {
    const [matches, histVenues, existing] = await Promise.all([
      this.prisma.match.findMany({
        where: { venueName: { not: null } },
        select: { venueName: true, venueCity: true },
        distinct: ['venueName', 'venueCity'],
      }),
      this.history.histVenue.findMany({ select: { id: true, name: true, city: true } }),
      this.history.identityVenueMap.findMany({
        select: { id: true, liveVenueKey: true, histVenueId: true, status: true, method: true, confidence: true },
      }),
    ]);
    const live = new Map<string, { name: string; city: string | null }>();
    for (const m of matches) {
      if (!m.venueName?.trim()) continue;
      const venue = { name: m.venueName.trim(), city: m.venueCity?.trim() || null };
      live.set(venueKey(venue.name, venue.city), venue);
    }
    const { proposals, unmatched } = proposeVenues([...live.values()], histVenues);
    const write = await this.writeProposals(
      proposals.map((p) => {
        const key = venueKey(p.latiyal.name, p.latiyal.city);
        return {
          key: `${key}|${p.hist}`,
          data: {
            liveVenueKey: key,
            liveVenueName: p.latiyal.name.slice(0, 191),
            liveVenueCity: p.latiyal.city?.slice(0, 120) ?? null,
            histVenueId: p.hist,
            method: p.method,
            confidence: p.confidence,
            evidence: p.evidence,
          },
        };
      }),
      existing.map((r) => ({ ...r, key: `${r.liveVenueKey}|${r.histVenueId}` })),
      (data) => this.history.identityVenueMap.createMany({ data, skipDuplicates: true }),
      (id, data) => this.history.identityVenueMap.update({ where: { id }, data }),
    );
    return { kind: 'venues', proposals: proposals.length, ...write, unmatched, ambiguous: 0 };
  }

  /** Creates new proposals and refreshes PROPOSED ones. Reviewed rows are never touched. */
  private async writeProposals<T extends { method: string; confidence: number; evidence: Record<string, unknown> }>(
    proposals: Array<{ key: string; data: T }>,
    existing: Array<{ id: string; key: string; status: IdentityMapStatus; method: string; confidence: number }>,
    createMany: (data: Array<T & { evidence: Prisma.InputJsonValue; status: 'PROPOSED' }>) => Promise<{ count: number }>,
    update: (id: string, data: { method: string; confidence: number; evidence: Prisma.InputJsonValue }) => Promise<unknown>,
  ) {
    const byKey = new Map(existing.map((row) => [row.key, row]));
    const fresh: Array<T & { evidence: Prisma.InputJsonValue; status: 'PROPOSED' }> = [];
    const seen = new Set<string>();
    let updated = 0;
    let unchangedOrReviewed = 0;
    for (const { key, data } of proposals) {
      if (seen.has(key)) continue;
      seen.add(key);
      const row = byKey.get(key);
      if (!row) {
        fresh.push({ ...data, evidence: data.evidence as Prisma.InputJsonValue, status: 'PROPOSED' });
      } else if (row.status === 'PROPOSED' && (row.method !== data.method || row.confidence !== data.confidence)) {
        await update(row.id, { method: data.method, confidence: data.confidence, evidence: data.evidence as Prisma.InputJsonValue });
        updated++;
      } else {
        unchangedOrReviewed++;
      }
    }
    let created = 0;
    for (let i = 0; i < fresh.length; i += CREATE_CHUNK) {
      created += (await createMany(fresh.slice(i, i + CREATE_CHUNK))).count;
    }
    return { created, updated, unchangedOrReviewed };
  }

  /** Fixed query (no user input): Cricsheet people and the international sides they played for. */
  private async internationalTeamsByPerson(): Promise<Map<string, Set<string>>> {
    const rows = await this.history.$queryRaw<Array<{ personId: string; name: string }>>(Prisma.sql`
      SELECT DISTINCT mp.person_id AS personId, t.name AS name
      FROM hist_match_players mp
      JOIN hist_teams t ON t.id = mp.team_id
      WHERE t.team_type = 'international'`);
    const result = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = result.get(row.personId) ?? new Set<string>();
      set.add(normalizeText(row.name));
      result.set(row.personId, set);
    }
    return result;
  }

  // ---------------------------------------------------------------- review list

  async list(kind: IdentityKind, query: ListIdentityQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.q) Object.assign(where, await this.searchWhere(kind, query.q));
    const delegate = this.delegate(kind);
    const [rows, total] = await Promise.all([
      delegate.findMany({
        where,
        orderBy: [{ confidence: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      delegate.count({ where }),
    ]);
    const items = await this.enrich(kind, rows as never[]);
    return { items, meta: buildPagination(query.page, query.limit, total) };
  }

  private async searchWhere(kind: IdentityKind, q: string): Promise<Record<string, unknown>> {
    if (kind === 'venues') return { liveVenueName: { contains: q } };
    if (kind === 'players') {
      const [live, hist] = await Promise.all([
        this.prisma.player.findMany({ where: { name: { contains: q } }, select: { sportmonksId: true }, take: SEARCH_ID_LIMIT }),
        this.history.histPerson.findMany({ where: { name: { contains: q } }, select: { id: true }, take: SEARCH_ID_LIMIT }),
      ]);
      return { OR: [{ latiyalPlayerId: { in: live.map((p) => p.sportmonksId) } }, { histPersonId: { in: hist.map((p) => p.id) } }] };
    }
    const [live, hist] = await Promise.all([
      this.prisma.team.findMany({ where: { name: { contains: q } }, select: { sportmonksId: true }, take: SEARCH_ID_LIMIT }),
      this.history.histTeam.findMany({ where: { name: { contains: q } }, select: { id: true }, take: SEARCH_ID_LIMIT }),
    ]);
    return { OR: [{ latiyalTeamId: { in: live.map((t) => t.sportmonksId) } }, { histTeamId: { in: hist.map((t) => t.id) } }] };
  }

  private async enrich(kind: IdentityKind, rows: Array<Record<string, unknown>>) {
    const base = (row: Record<string, unknown>) => ({
      id: row.id as string,
      status: row.status as IdentityMapStatus,
      method: row.method as string,
      confidence: row.confidence as number,
      evidence: (row.evidence ?? null) as Record<string, unknown> | null,
      reviewedAt: (row.reviewedAt ?? null) as Date | null,
    });
    if (kind === 'players') {
      const latiyalIds = rows.map((r) => r.latiyalPlayerId as number);
      const personIds = rows.map((r) => r.histPersonId as string);
      const [players, people, names] = await Promise.all([
        this.prisma.player.findMany({ where: { sportmonksId: { in: latiyalIds } }, select: { sportmonksId: true, name: true, country: true } }),
        this.history.histPerson.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true } }),
        this.history.histPersonName.findMany({ where: { personId: { in: personIds } }, select: { personId: true, name: true } }),
      ]);
      const player = new Map(players.map((p) => [p.sportmonksId, p]));
      const person = new Map(people.map((p) => [p.id, p]));
      return rows.map((row) => {
        const p = player.get(row.latiyalPlayerId as number);
        const h = person.get(row.histPersonId as string);
        return {
          ...base(row),
          latiyal: { id: row.latiyalPlayerId as number, name: p?.name ?? null, detail: p?.country ?? null },
          hist: {
            id: row.histPersonId as string,
            name: h?.name ?? null,
            detail: names.filter((n) => n.personId === row.histPersonId && n.name !== h?.name).map((n) => n.name).join(', ') || null,
          },
        };
      });
    }
    if (kind === 'teams') {
      const [teams, histTeams] = await Promise.all([
        this.prisma.team.findMany({ where: { sportmonksId: { in: rows.map((r) => r.latiyalTeamId as number) } }, select: { sportmonksId: true, name: true } }),
        this.history.histTeam.findMany({ where: { id: { in: rows.map((r) => r.histTeamId as number) } }, select: { id: true, name: true, teamType: true } }),
      ]);
      const team = new Map(teams.map((t) => [t.sportmonksId, t]));
      const hist = new Map(histTeams.map((t) => [t.id, t]));
      return rows.map((row) => ({
        ...base(row),
        latiyal: { id: row.latiyalTeamId as number, name: team.get(row.latiyalTeamId as number)?.name ?? null, detail: row.gender as string },
        hist: { id: row.histTeamId as number, name: hist.get(row.histTeamId as number)?.name ?? null, detail: hist.get(row.histTeamId as number)?.teamType ?? null },
      }));
    }
    const venues = await this.history.histVenue.findMany({
      where: { id: { in: rows.map((r) => r.histVenueId as number) } },
      select: { id: true, name: true, city: true },
    });
    const venue = new Map(venues.map((v) => [v.id, v]));
    return rows.map((row) => ({
      ...base(row),
      latiyal: { id: row.liveVenueKey as string, name: row.liveVenueName as string, detail: (row.liveVenueCity ?? null) as string | null },
      hist: { id: row.histVenueId as number, name: venue.get(row.histVenueId as number)?.name ?? null, detail: venue.get(row.histVenueId as number)?.city ?? null },
    }));
  }

  // ---------------------------------------------------------------- review / manual

  async review(kind: IdentityKind, id: string, status: IdentityMapStatus, adminId: string) {
    const delegate = this.delegate(kind);
    const row = (await delegate.findUnique({ where: { id } })) as Record<string, unknown> | null;
    if (!row) throw notFound('Mapping not found');
    if (status === 'CONFIRMED') await this.assertNoConflict(kind, row);
    const updated = (await delegate.update({
      where: { id },
      data: { status, reviewedBy: adminId.slice(0, 64), reviewedAt: new Date() },
    })) as Record<string, unknown>;
    logEvent(this.logger, 'log', 'identity-reviewed', { kind, status });
    return (await this.enrich(kind, [updated]))[0];
  }

  async createPlayer(dto: CreatePlayerMapDto, adminId: string) {
    const [player, person] = await Promise.all([
      this.prisma.player.findUnique({ where: { sportmonksId: dto.latiyalPlayerId } }),
      this.history.histPerson.findUnique({ where: { id: dto.histPersonId } }),
    ]);
    if (!player) throw notFound('Live player not found');
    if (!person) throw notFound('Cricsheet person not found');
    const row = { latiyalPlayerId: dto.latiyalPlayerId, histPersonId: dto.histPersonId };
    await this.assertNoConflict('players', row);
    const saved = await this.history.identityPlayerMap.upsert({
      where: { latiyalPlayerId_histPersonId: row },
      create: { ...row, ...this.manual(adminId) },
      update: this.manual(adminId),
    });
    return (await this.enrich('players', [saved]))[0];
  }

  async createTeam(dto: CreateTeamMapDto, adminId: string) {
    const [team, hist] = await Promise.all([
      this.prisma.team.findUnique({ where: { sportmonksId: dto.latiyalTeamId } }),
      this.history.histTeam.findUnique({ where: { id: dto.histTeamId } }),
    ]);
    if (!team) throw notFound('Live team not found');
    if (!hist) throw notFound('Cricsheet team not found');
    const row = { latiyalTeamId: dto.latiyalTeamId, histTeamId: dto.histTeamId, gender: dto.gender };
    await this.assertNoConflict('teams', row);
    const saved = await this.history.identityTeamMap.upsert({
      where: { latiyalTeamId_histTeamId_gender: row },
      create: { ...row, ...this.manual(adminId) },
      update: this.manual(adminId),
    });
    return (await this.enrich('teams', [saved]))[0];
  }

  async createVenue(dto: CreateVenueMapDto, adminId: string) {
    const hist = await this.history.histVenue.findUnique({ where: { id: dto.histVenueId } });
    if (!hist) throw notFound('Cricsheet venue not found');
    const city = dto.liveVenueCity || null;
    const row = { liveVenueKey: venueKey(dto.liveVenueName, city), histVenueId: dto.histVenueId };
    await this.assertNoConflict('venues', row);
    const saved = await this.history.identityVenueMap.upsert({
      where: { liveVenueKey_histVenueId: row },
      create: { ...row, liveVenueName: dto.liveVenueName, liveVenueCity: city, ...this.manual(adminId) },
      update: this.manual(adminId),
    });
    return (await this.enrich('venues', [saved]))[0];
  }

  private manual(adminId: string) {
    return {
      status: 'CONFIRMED' as const,
      method: 'manual',
      confidence: 100,
      evidence: Prisma.JsonNull,
      reviewedBy: adminId.slice(0, 64),
      reviewedAt: new Date(),
    };
  }

  /** One Latiyal player <-> one person; a Cricsheet team (per gender) or venue belongs to one live entity. */
  private async assertNoConflict(kind: IdentityKind, row: Record<string, unknown>) {
    const notSelf = row.id ? { id: { not: row.id } } : {};
    if (kind === 'players') {
      const other = await this.history.identityPlayerMap.findFirst({
        where: {
          status: 'CONFIRMED',
          ...notSelf,
          OR: [
            { latiyalPlayerId: row.latiyalPlayerId as number, histPersonId: { not: row.histPersonId as string } },
            { histPersonId: row.histPersonId as string, latiyalPlayerId: { not: row.latiyalPlayerId as number } },
          ],
        },
      });
      if (other) throw conflict('This player or Cricsheet person is already confirmed to someone else. Reject that mapping first.');
    } else if (kind === 'teams') {
      const other = await this.history.identityTeamMap.findFirst({
        where: {
          status: 'CONFIRMED',
          ...notSelf,
          histTeamId: row.histTeamId as number,
          gender: row.gender as string,
          latiyalTeamId: { not: row.latiyalTeamId as number },
        },
      });
      if (other) throw conflict('This Cricsheet team is already confirmed to another live team. Reject that mapping first.');
    } else {
      const other = await this.history.identityVenueMap.findFirst({
        where: { status: 'CONFIRMED', ...notSelf, histVenueId: row.histVenueId as number, liveVenueKey: { not: row.liveVenueKey as string } },
      });
      if (other) throw conflict('This Cricsheet venue is already confirmed to another live venue. Reject that mapping first.');
    }
  }

  // ---------------------------------------------------------------- history search

  async searchHistory(kind: IdentityKind, q: string) {
    if (kind === 'players') {
      const names = await this.history.histPersonName.findMany({
        where: { name: { contains: q } },
        select: { personId: true },
        take: SEARCH_ID_LIMIT,
      });
      const people = await this.history.histPerson.findMany({
        where: { OR: [{ name: { contains: q } }, { id: { in: [...new Set(names.map((n) => n.personId))] } }] },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: SEARCH_LIMIT,
      });
      return people.map((p) => ({ id: p.id, name: p.name, detail: null }));
    }
    if (kind === 'teams') {
      const teams = await this.history.histTeam.findMany({
        where: { name: { contains: q } },
        select: { id: true, name: true, teamType: true },
        orderBy: { name: 'asc' },
        take: SEARCH_LIMIT,
      });
      return teams.map((t) => ({ id: t.id, name: t.name, detail: t.teamType }));
    }
    const venues = await this.history.histVenue.findMany({
      where: { name: { contains: q } },
      select: { id: true, name: true, city: true },
      orderBy: { name: 'asc' },
      take: SEARCH_LIMIT,
    });
    return venues.map((v) => ({ id: v.id, name: v.name, detail: v.city }));
  }

  // ---------------------------------------------------------------- lookups for the AI tools (CONFIRMED only)

  async confirmedPersonFor(latiyalPlayerId: number): Promise<string | null> {
    const row = await this.history.identityPlayerMap.findFirst({ where: { latiyalPlayerId, status: 'CONFIRMED' }, select: { histPersonId: true } });
    return row?.histPersonId ?? null;
  }

  async confirmedTeamsFor(latiyalTeamId: number): Promise<{ histTeamIds: number[]; gender: string } | null> {
    const rows = await this.history.identityTeamMap.findMany({
      where: { latiyalTeamId, status: 'CONFIRMED' },
      select: { histTeamId: true, gender: true },
    });
    return rows.length ? { histTeamIds: rows.map((r) => r.histTeamId), gender: rows[0].gender } : null;
  }

  /** `name` and `city` as stored on the live match (matches.venue_name / venue_city). */
  async confirmedVenuesFor(name: string, city: string | null): Promise<number[]> {
    const rows = await this.history.identityVenueMap.findMany({
      where: { liveVenueKey: venueKey(name.trim(), city?.trim() || null), status: 'CONFIRMED' },
      select: { histVenueId: true },
    });
    return [...new Set(rows.map((r) => r.histVenueId))];
  }

  private delegate(kind: IdentityKind) {
    const delegates = {
      players: this.history.identityPlayerMap,
      teams: this.history.identityTeamMap,
      venues: this.history.identityVenueMap,
    };
    return delegates[kind] as unknown as {
      count(args: { where?: Record<string, unknown> }): Promise<number>;
      findMany(args: Record<string, unknown>): Promise<unknown[]>;
      findUnique(args: { where: { id: string } }): Promise<unknown>;
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    };
  }
}
