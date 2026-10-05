import { Injectable } from '@nestjs/common';
import { SingleFlightCache } from '../cache/single-flight-cache.service';
import { SearchQueryDto } from '../common/dto/search-query.dto';
import { lookupEntity } from '../common/utils/entity-lookup';
import { buildPagination } from '../common/utils/pagination';
import { PlayerResponseDto } from './dto/player.response.dto';
import { toPlayerResponse } from './players.mapper';
import { PlayersRepository } from './players.repository';

@Injectable()
export class PlayersService {
  constructor(
    private readonly players: PlayersRepository,
    private readonly cache: SingleFlightCache,
  ) {}

  async list(query: SearchQueryDto) {
    const { items, total } = await this.players.list(query.page, query.limit, query.q);
    return {
      items: items.map(toPlayerResponse),
      meta: buildPagination(query.page, query.limit, total),
    };
  }

  getById(id: string): Promise<PlayerResponseDto> {
    return lookupEntity(this.cache, 'player', id, this.players, toPlayerResponse);
  }
}
