import { Injectable } from '@nestjs/common';
import { DevicePlatform, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface UpsertDeviceInput {
  deviceId: string;
  fcmToken: string;
  platform: DevicePlatform;
  appVersion: string | null;
  lastSeenAt: Date;
}

export interface ListDevicesFilter {
  page: number;
  limit: number;
  search?: string;
  platform?: DevicePlatform;
  isActive?: boolean;
  lastSeenFrom?: Date;
  lastSeenTo?: Date;
  createdFrom?: Date;
  createdTo?: Date;
}

function range(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
  if (!from && !to) {
    return undefined;
  }
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

@Injectable()
export class FcmRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** A token now belongs to this device; older rows holding it are stale. */
  deactivateOtherTokens(deviceId: string, fcmToken: string) {
    return this.prisma.fcmDevice.updateMany({
      where: { fcmToken, isActive: true, NOT: { deviceId } },
      data: { isActive: false },
    });
  }

  upsert(input: UpsertDeviceInput) {
    const data = {
      fcmToken: input.fcmToken,
      platform: input.platform,
      appVersion: input.appVersion,
      lastSeenAt: input.lastSeenAt,
      isActive: true,
    };
    return this.prisma.fcmDevice.upsert({
      where: { deviceId: input.deviceId },
      create: { deviceId: input.deviceId, ...data },
      update: data,
    });
  }

  findByDeviceId(deviceId: string) {
    return this.prisma.fcmDevice.findUnique({ where: { deviceId } });
  }

  findActiveByDeviceIds(deviceIds: string[]) {
    return this.prisma.fcmDevice.findMany({
      where: { deviceId: { in: deviceIds }, isActive: true },
      select: { deviceId: true, fcmToken: true },
    });
  }

  deactivate(deviceId: string) {
    return this.prisma.fcmDevice.update({
      where: { deviceId },
      data: { isActive: false, lastSeenAt: new Date() },
    });
  }

  deactivateTokens(tokens: string[]) {
    return this.prisma.fcmDevice.updateMany({
      where: { fcmToken: { in: tokens }, isActive: true },
      data: { isActive: false },
    });
  }

  async list(filter: ListDevicesFilter) {
    const lastSeenAt = range(filter.lastSeenFrom, filter.lastSeenTo);
    const createdAt = range(filter.createdFrom, filter.createdTo);
    const where: Prisma.FcmDeviceWhereInput = {
      ...(filter.search ? { deviceId: { contains: filter.search } } : {}),
      ...(filter.platform ? { platform: filter.platform } : {}),
      ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
      ...(lastSeenAt ? { lastSeenAt } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.fcmDevice.findMany({
        where,
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.fcmDevice.count({ where }),
    ]);
    return { items, total };
  }

  async countSummary() {
    const [registered, active] = await Promise.all([
      this.prisma.fcmDevice.count(),
      this.prisma.fcmDevice.count({ where: { isActive: true } }),
    ]);
    return { registered, active };
  }
}
