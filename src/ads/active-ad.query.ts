import { AdPlacement, Prisma } from '@prisma/client';

export function activeAdsWhere(placement: AdPlacement | undefined, now: Date): Prisma.AdWhereInput {
  return {
    isActive: true,
    ...(placement ? { placement } : {}),
    AND: [
      { OR: [{ startAt: null }, { startAt: { lte: now } }] },
      { OR: [{ endAt: null }, { endAt: { gte: now } }] },
    ],
  };
}

export interface ScheduledAd {
  isActive: boolean;
  startAt: Date | string | null;
  endAt: Date | string | null;
}

const time = (value: Date | string) => (value instanceof Date ? value.getTime() : Date.parse(value));

/** Same rule as activeAdsWhere, for ads already in memory (cached copies). */
export function isAdVisible(ad: ScheduledAd, now: Date): boolean {
  const at = now.getTime();
  return ad.isActive && (ad.startAt === null || time(ad.startAt) <= at) && (ad.endAt === null || time(ad.endAt) >= at);
}
