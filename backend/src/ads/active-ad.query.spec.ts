import { AdPlacement } from '@prisma/client';
import { activeAdsWhere } from './active-ad.query';

describe('activeAdsWhere', () => {
  it('requires an active placement inside an open-ended schedule', () => {
    const now = new Date('2026-10-01T12:00:00.000Z');
    expect(activeAdsWhere(AdPlacement.HOME_BANNER, now)).toEqual({
      isActive: true,
      placement: AdPlacement.HOME_BANNER,
      AND: [
        { OR: [{ startAt: null }, { startAt: { lte: now } }] },
        { OR: [{ endAt: null }, { endAt: { gte: now } }] },
      ],
    });
  });

  it('covers every placement when none is given', () => {
    expect(activeAdsWhere(undefined, new Date())).not.toHaveProperty('placement');
  });
});
