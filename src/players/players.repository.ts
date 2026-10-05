import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PlayersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: number, limit: number, q?: string) {
    const where: Prisma.PlayerWhereInput = q ? { name: { contains: q } } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.player.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.player.count({ where }),
    ]);
    return { items, total };
  }

  findById(id: string) {
    return this.prisma.player.findUnique({ where: { id } });
  }

  findBySportmonksId(sportmonksId: number) {
    return this.prisma.player.findUnique({ where: { sportmonksId } });
  }
}
