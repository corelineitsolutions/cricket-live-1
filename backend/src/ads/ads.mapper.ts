import { Ad } from '@prisma/client';
import { isAdVisible } from './active-ad.query';
import { AdminAdResponseDto, AdResponseDto } from './dto/ad.response.dto';

export function toAdResponse(ad: Ad): AdResponseDto {
  return {
    id: ad.id,
    title: ad.title,
    imageUrl: ad.imageUrl,
    clickUrl: ad.clickUrl,
    placement: ad.placement,
    priority: ad.priority,
    isActive: ad.isActive,
    startAt: ad.startAt ? ad.startAt.toISOString() : null,
    endAt: ad.endAt ? ad.endAt.toISOString() : null,
    createdAt: ad.createdAt.toISOString(),
    updatedAt: ad.updatedAt.toISOString(),
  };
}

export function toAdminAdResponse(ad: Ad, now = new Date()): AdminAdResponseDto {
  return { ...toAdResponse(ad), isVisibleNow: isAdVisible(ad, now) };
}
