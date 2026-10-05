import { Injectable } from '@nestjs/common';
import { MatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { matchInclude } from './matches.mapper';

export interface ListMatchesFilter {
  page: number;
  limit: number;
  status?: MatchStatus;
  leagueId?: string;
  seasonId?: string;
}

@Injectable()
export class MatchesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: ListMatchesFilter) {
    const where: Prisma.MatchWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.leagueId ? { leagueId: filter.leagueId } : {}),
      ...(filter.seasonId ? { seasonId: filter.seasonId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.match.findMany({
        where,
        include: matchInclude,
        orderBy: { startTime: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.match.count({ where }),
    ]);

    return { items, total };
  }

  findById(id: string) {
    return this.prisma.match.findUnique({
      where: { id },
      include: matchInclude,
    });
  }

  findBySportmonksId(sportmonksId: number) {
    return this.prisma.match.findUnique({
      where: { sportmonksId },
      include: matchInclude,
    });
  }
}
