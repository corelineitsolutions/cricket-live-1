import { Player } from '@prisma/client';
import { PlayerResponseDto } from './dto/player.response.dto';

export function toPlayerResponse(player: Player): PlayerResponseDto {
  return {
    id: player.id,
    sportmonksId: player.sportmonksId,
    name: player.name,
    imageUrl: player.imageUrl,
    country: player.country,
    createdAt: player.createdAt.toISOString(),
    updatedAt: player.updatedAt.toISOString(),
  };
}
