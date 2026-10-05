import { Prisma } from '@prisma/client';
import { SeasonResponseDto } from './dto/season.response.dto';

export const seasonInclude = {
  league: true,
} as const satisfies Prisma.SeasonInclude;

export type SeasonWithLeague = Prisma.SeasonGetPayload<{ include: typeof seasonInclude }>;

export function toSeasonResponse(season: SeasonWithLeague): SeasonResponseDto {
  return {
    id: season.id,
    sportmonksId: season.sportmonksId,
    name: season.name,
    startDate: season.startDate ? season.startDate.toISOString() : null,
    endDate: season.endDate ? season.endDate.toISOString() : null,
    isCurrent: season.isCurrent,
    league: {
      id: season.league.id,
      sportmonksId: season.league.sportmonksId,
      name: season.league.name,
      code: season.league.code,
    },
    createdAt: season.createdAt.toISOString(),
    updatedAt: season.updatedAt.toISOString(),
  };
}
