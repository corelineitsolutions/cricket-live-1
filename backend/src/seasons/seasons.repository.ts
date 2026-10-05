import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { seasonInclude } from './seasons.mapper';

@Injectable()
export class SeasonsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: number, limit: number, q?: string, leagueId?: string) {
    const where: Prisma.SeasonWhereInput = {
      ...(q ? { name: { contains: q } } : {}),
      ...(leagueId ? { leagueId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.season.findMany({
        where,
        include: seasonInclude,
        orderBy: { startDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.season.count({ where }),
    ]);
    return { items, total };
  }

  findById(id: string) {
    return this.prisma.season.findUnique({
      where: { id },
      include: seasonInclude,
    });
  }
}
