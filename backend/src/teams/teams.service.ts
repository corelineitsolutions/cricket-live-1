import { Injectable } from '@nestjs/common';
import { SearchQueryDto } from '../common/dto/search-query.dto';
import { SingleFlightCache } from '../cache/single-flight-cache.service';
import { lookupEntity } from '../common/utils/entity-lookup';
import { buildPagination } from '../common/utils/pagination';
import { TeamResponseDto } from './dto/team.response.dto';
import { toTeamResponse } from './teams.mapper';
import { TeamsRepository } from './teams.repository';

@Injectable()
export class TeamsService {
  constructor(
    private readonly teams: TeamsRepository,
    private readonly cache: SingleFlightCache,
  ) {}

  async list(query: SearchQueryDto) {
    const { items, total } = await this.teams.list(query.page, query.limit, query.q);
    return {
      items: items.map(toTeamResponse),
      meta: buildPagination(query.page, query.limit, total),
    };
  }

  getById(id: string): Promise<TeamResponseDto> {
    return lookupEntity(this.cache, 'team', id, this.teams, toTeamResponse);
  }
}
