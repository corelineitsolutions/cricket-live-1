import { Injectable } from '@nestjs/common';
import { SingleFlightCache } from '../cache/single-flight-cache.service';
import { SearchQueryDto } from '../common/dto/search-query.dto';
import { lookupEntity } from '../common/utils/entity-lookup';
import { buildPagination } from '../common/utils/pagination';
import { LeagueResponseDto } from './dto/league.response.dto';
import { toLeagueResponse } from './leagues.mapper';
import { LeaguesRepository } from './leagues.repository';

@Injectable()
export class LeaguesService {
  constructor(
    private readonly leagues: LeaguesRepository,
    private readonly cache: SingleFlightCache,
  ) {}

  async list(query: SearchQueryDto) {
    const { items, total } = await this.leagues.list(query.page, query.limit, query.q);
    return {
      items: items.map(toLeagueResponse),
      meta: buildPagination(query.page, query.limit, total),
    };
  }

  getById(id: string): Promise<LeagueResponseDto> {
    return lookupEntity(this.cache, 'league', id, this.leagues, toLeagueResponse);
  }
}
