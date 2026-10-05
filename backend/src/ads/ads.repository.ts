import { Injectable } from '@nestjs/common';
import { AdPlacement, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { activeAdsWhere } from './active-ad.query';

export interface ListAdsFilter {
  page: number;
  limit: number;
  placement?: AdPlacement;
  isActive?: boolean;
}

@Injectable()
export class AdsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every enabled ad regardless of schedule; the schedule is applied when serving. */
  findEnabled() {
    return this.prisma.ad.findMany({
      where: { isActive: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async countSummary(now: Date) {
    const [total, enabled, visibleNow] = await Promise.all([
      this.prisma.ad.count(),
      this.prisma.ad.count({ where: { isActive: true } }),
      this.prisma.ad.count({ where: activeAdsWhere(undefined, now) }),
    ]);
    return { total, enabled, visibleNow };
  }

  async list(filter: ListAdsFilter) {
    const where: Prisma.AdWhereInput = {
      ...(filter.placement ? { placement: filter.placement } : {}),
      ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ad.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.ad.count({ where }),
    ]);
    return { items, total };
  }

  findById(id: string) {
    return this.prisma.ad.findUnique({ where: { id } });
  }

  create(data: Prisma.AdCreateInput) {
    return this.prisma.ad.create({ data });
  }

  update(id: string, data: Prisma.AdUpdateInput) {
    return this.prisma.ad.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.prisma.ad.delete({ where: { id } });
  }
}
