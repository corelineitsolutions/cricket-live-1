import { Team } from '@prisma/client';
import { TeamResponseDto } from './dto/team.response.dto';

export function toTeamResponse(team: Team): TeamResponseDto {
  return {
    id: team.id,
    sportmonksId: team.sportmonksId,
    name: team.name,
    shortName: team.shortName,
    imageUrl: team.imageUrl,
    country: team.country,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
}
