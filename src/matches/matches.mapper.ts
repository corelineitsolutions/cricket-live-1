import { Prisma } from '@prisma/client';

export const matchInclude = {
  league: true,
  season: true,
  localTeam: true,
  visitorTeam: true,
  winnerTeam: true,
} as const satisfies Prisma.MatchInclude;

export type MatchWithRelations = Prisma.MatchGetPayload<{ include: typeof matchInclude }>;
