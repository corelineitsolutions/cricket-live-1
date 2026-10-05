import { Injectable } from '@nestjs/common';
import { notFound } from '../common/utils/http-errors';
import { buildPagination } from '../common/utils/pagination';
import { ListSeasonsQueryDto } from './dto/list-seasons.query.dto';
import { SeasonResponseDto } from './dto/season.response.dto';
import { toSeasonResponse } from './seasons.mapper';
import { SeasonsRepository } from './seasons.repository';

@Injectable()
export class SeasonsService {
  constructor(private readonly seasons: SeasonsRepository) {}

  async list(query: ListSeasonsQueryDto) {
    const { items, total } = await this.seasons.list(query.page, query.limit, query.q, query.leagueId);
    return {
      items: items.map(toSeasonResponse),
      meta: buildPagination(query.page, query.limit, total),
    };
  }

  async getById(id: string): Promise<SeasonResponseDto> {
    const season = await this.seasons.findById(id);
    if (!season) {
      throw notFound('Season not found');
    }
    return toSeasonResponse(season);
  }
}
