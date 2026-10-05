import { AdPlacement, MatchStatus } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function matchesField(actual: unknown, condition: unknown): boolean {
  if (condition === undefined) {
    return true;
  }
  if (condition === null || typeof condition !== 'object' || condition instanceof Date) {
    return comparable(actual) === comparable(condition);
  }
  const ops = condition as Record<string, unknown>;
  const a = comparable(actual);
  for (const [op, raw] of Object.entries(ops)) {
    const v = comparable(raw);
    switch (op) {
      case 'equals':
        if (a !== v) return false;
        break;
      case 'not':
        if (matchesField(actual, raw)) return false;
        break;
      case 'in':
        if (!(raw as unknown[]).map(comparable).includes(a)) return false;
        break;
      case 'contains':
        if (typeof actual !== 'string' || !actual.includes(raw as string)) return false;
        break;
      case 'startsWith':
        if (typeof actual !== 'string' || !actual.startsWith(raw as string)) return false;
        break;
      case 'gte':
        if (a === null || a === undefined || (a as number) < (v as number)) return false;
        break;
      case 'lte':
        if (a === null || a === undefined || (a as number) > (v as number)) return false;
        break;
      case 'gt':
        if (a === null || a === undefined || (a as number) <= (v as number)) return false;
        break;
      case 'lt':
        if (a === null || a === undefined || (a as number) >= (v as number)) return false;
        break;
      case 'mode':
        break;
      default:
        throw new Error(`FakeDb: unsupported operator ${op}`);
    }
  }
  return true;
}

export function matchesWhere(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') {
      return (condition as Where[]).every((part) => matchesWhere(row, part));
    }
    if (key === 'OR') {
      return (condition as Where[]).some((part) => matchesWhere(row, part));
    }
    if (key === 'NOT') {
      const parts = Array.isArray(condition) ? condition : [condition];
      return !(parts as Where[]).some((part) => matchesWhere(row, part));
    }
    return matchesField(row[key], condition);
  });
}

type OrderBy = Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>;

function sortRows(rows: Row[], orderBy?: OrderBy): Row[] {
  const rules = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
  return [...rows].sort((left, right) => {
    for (const rule of rules) {
      const [field, direction] = Object.entries(rule)[0];
      const a = comparable(left[field]) as number | string;
      const b = comparable(right[field]) as number | string;
      if (a === b) continue;
      const result = a > b ? 1 : -1;
      return direction === 'desc' ? -result : result;
    }
    return 0;
  });
}

interface FindArgs {
  where?: Where;
  orderBy?: OrderBy;
  skip?: number;
  take?: number;
}

let idCounter = 0;
const nextId = () => `c${String((idCounter += 1)).padStart(24, '0')}`;

function table(rows: Row[]) {
  const findAll = (args: FindArgs = {}) => {
    const sorted = sortRows(rows.filter((row) => matchesWhere(row, args.where)), args.orderBy);
    const start = args.skip ?? 0;
    return sorted.slice(start, args.take === undefined ? undefined : start + args.take);
  };
  const create = (data: Row) => {
    const now = new Date();
    const created = { id: nextId(), createdAt: now, updatedAt: now, ...data };
    rows.push(created);
    return created;
  };
  const update = (row: Row, data: Row) => {
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  };
  const notFound = () => Object.assign(new Error('Record not found'), { code: 'P2025' });

  return {
    findUnique: vi.fn(async ({ where }: { where: Where }) => rows.find((row) => matchesWhere(row, where)) ?? null),
    findFirst: vi.fn(async (args: FindArgs = {}) => findAll(args)[0] ?? null),
    findMany: vi.fn(async (args: FindArgs = {}) => findAll(args)),
    count: vi.fn(async ({ where }: { where?: Where } = {}) => rows.filter((row) => matchesWhere(row, where)).length),
    create: vi.fn(async ({ data }: { data: Row }) => create(data)),
    update: vi.fn(async ({ where, data }: { where: Where; data: Row }) => {
      const row = rows.find((candidate) => matchesWhere(candidate, where));
      if (!row) throw notFound();
      return update(row, data);
    }),
    updateMany: vi.fn(async ({ where, data }: { where?: Where; data: Row }) => {
      const matched = rows.filter((row) => matchesWhere(row, where));
      matched.forEach((row) => update(row, data));
      return { count: matched.length };
    }),
    upsert: vi.fn(async ({ where, create: createData, update: updateData }: { where: Where; create: Row; update: Row }) => {
      const existing = rows.find((row) => matchesWhere(row, where));
      return existing ? update(existing, updateData) : create(createData);
    }),
    delete: vi.fn(async ({ where }: { where: Where }) => {
      const index = rows.findIndex((row) => matchesWhere(row, where));
      if (index < 0) throw notFound();
      return rows.splice(index, 1)[0];
    }),
  };
}

/** In-memory Prisma stand-in for API tests. Every query is a spy, so tests can assert MySQL was not touched. */
export class FakeDb {
  readonly rows = {
    match: [] as Row[],
    team: [] as Row[],
    player: [] as Row[],
    league: [] as Row[],
    ad: [] as Row[],
    admin: [] as Row[],
    fcmDevice: [] as Row[],
  };

  readonly match = table(this.rows.match);
  readonly team = table(this.rows.team);
  readonly player = table(this.rows.player);
  readonly league = table(this.rows.league);
  readonly ad = table(this.rows.ad);
  readonly admin = table(this.rows.admin);
  readonly fcmDevice = table(this.rows.fcmDevice);
  down = false;

  readonly $transaction = vi.fn(async (input: unknown) =>
    Array.isArray(input) ? Promise.all(input) : (input as (tx: FakeDb) => Promise<unknown>)(this),
  );

  readonly ping = vi.fn(async (): Promise<'up' | 'down'> => (this.down ? 'down' : 'up'));

  asPrisma(): PrismaService {
    return this as unknown as PrismaService;
  }

  /** Number of calls to any table method. */
  queryCount(): number {
    const tables = [this.match, this.team, this.player, this.league, this.ad, this.admin, this.fcmDevice];
    return tables.reduce(
      (sum, t) => sum + Object.values(t).reduce((inner, fn) => inner + fn.mock.calls.length, 0),
      this.$transaction.mock.calls.length,
    );
  }
}

const CREATED = new Date('2026-09-01T10:00:00.000Z');

export function teamRow(sportmonksId: number, name: string, shortName: string): Row {
  return {
    id: `cteam${String(sportmonksId).padStart(20, '0')}`,
    sportmonksId,
    name,
    shortName,
    imageUrl: null,
    country: 'India',
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

export function playerRow(sportmonksId: number, name: string): Row {
  return {
    id: `cplayer${String(sportmonksId).padStart(20, '0')}`,
    sportmonksId,
    name,
    imageUrl: null,
    country: 'India',
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

export function leagueRow(sportmonksId: number, name: string): Row {
  return {
    id: `cleague${String(sportmonksId).padStart(20, '0')}`,
    sportmonksId,
    name,
    code: 'PT20',
    imageUrl: null,
    country: 'India',
    type: 'league',
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

export function matchRow(sportmonksId: number, overrides: Row = {}): Row {
  return {
    id: `cmatch${String(sportmonksId).padStart(20, '0')}`,
    sportmonksId,
    status: MatchStatus.SCHEDULED,
    statusDetail: 'NS',
    matchType: 'T20',
    round: '13th Match',
    venueName: 'Eden Gardens',
    venueCity: 'Kolkata',
    startTime: new Date('2026-10-02T14:00:00.000Z'),
    resultSummary: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    league: { id: 'cleague', sportmonksId: 3, name: 'Premier T20', code: 'PT20', imageUrl: null },
    season: { id: 'cseason', sportmonksId: 1689, name: '2026' },
    localTeam: { id: 'cteam303', sportmonksId: 303, name: 'Kolkata Kings', shortName: 'KOL', imageUrl: null },
    visitorTeam: { id: 'cteam101', sportmonksId: 101, name: 'Mumbai Strikers', shortName: 'MUM', imageUrl: null },
    winnerTeam: null,
    ...overrides,
  };
}

export function adRow(id: string, placement: AdPlacement, priority = 0, overrides: Row = {}): Row {
  return {
    id,
    title: `Ad ${id}`,
    imageUrl: `https://cdn.example.com/${id}.png`,
    clickUrl: `https://example.com/${id}`,
    placement,
    priority,
    isActive: true,
    startAt: null,
    endAt: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}
