import { League } from '@prisma/client';
import { LeagueResponseDto } from './dto/league.response.dto';

export function toLeagueResponse(league: League): LeagueResponseDto {
  return {
    id: league.id,
    sportmonksId: league.sportmonksId,
    name: league.name,
    code: league.code,
    imageUrl: league.imageUrl,
    country: league.country,
    type: league.type,
    createdAt: league.createdAt.toISOString(),
    updatedAt: league.updatedAt.toISOString(),
  };
}
