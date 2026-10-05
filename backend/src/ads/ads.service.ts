import { Injectable, Logger } from '@nestjs/common';
import { AdPlacement, Prisma } from '@prisma/client';
import { SingleFlightCache } from '../cache/single-flight-cache.service';
import { RedisKey } from '../common/constants/redis-keys';
import { notFound, validationError } from '../common/utils/http-errors';
import { buildPagination } from '../common/utils/pagination';
import { logEvent } from '../common/utils/structured-log';
import { RedisService } from '../redis/redis.service';
import { isAdVisible } from './active-ad.query';
import { toAdminAdResponse, toAdResponse } from './ads.mapper';
import { AdsRepository } from './ads.repository';
import { CreateAdDto } from './dto/create-ad.dto';
import { AdminAdResponseDto, AdResponseDto } from './dto/ad.response.dto';
import { ListAdsQueryDto } from './dto/list-ads.query.dto';
import { UpdateAdDto } from './dto/update-ad.dto';

/** Admin edits invalidate immediately, so the TTL only bounds memory and drift from direct DB edits. */
export const ADS_CACHE_TTL_SECONDS = 300;

@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    private readonly ads: AdsRepository,
    private readonly redis: RedisService,
    private readonly cache: SingleFlightCache,
  ) {}

  /** Ads the app should show now. One cached list serves every placement; the schedule is checked per request. */
  async getActive(placement?: AdPlacement): Promise<AdResponseDto[]> {
    const version = Number((await this.redis.get(RedisKey.adsActiveVersion()).catch(() => null)) ?? 0);
    const { value } = await this.cache.getOrLoad(RedisKey.adsActive(version), { ttlSeconds: ADS_CACHE_TTL_SECONDS }, async () =>
      (await this.ads.findEnabled()).map(toAdResponse),
    );
    const now = new Date();
    return value.filter((ad) => (!placement || ad.placement === placement) && isAdVisible(ad, now));
  }

  async list(query: ListAdsQueryDto) {
    const { items, total } = await this.ads.list(query);
    const now = new Date();
    return {
      items: items.map((ad) => toAdminAdResponse(ad, now)),
      meta: buildPagination(query.page, query.limit, total),
    };
  }

  async getById(id: string): Promise<AdminAdResponseDto> {
    return toAdminAdResponse(await this.findOrThrow(id));
  }

  async create(dto: CreateAdDto): Promise<AdminAdResponseDto> {
    this.assertSchedule(dto.startAt, dto.endAt);
    const ad = await this.ads.create({
      title: dto.title,
      imageUrl: dto.imageUrl,
      clickUrl: dto.clickUrl,
      placement: dto.placement,
      priority: dto.priority,
      isActive: dto.isActive,
      startAt: dto.startAt ?? null,
      endAt: dto.endAt ?? null,
    });
    await this.invalidateCache('create', ad.id);
    return toAdminAdResponse(ad);
  }

  async update(id: string, dto: UpdateAdDto): Promise<AdminAdResponseDto> {
    const existing = await this.findOrThrow(id);
    const startAt = dto.startAt === undefined ? existing.startAt : dto.startAt;
    const endAt = dto.endAt === undefined ? existing.endAt : dto.endAt;
    this.assertSchedule(startAt, endAt);

    const data: Prisma.AdUpdateInput = {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
      ...(dto.clickUrl !== undefined ? { clickUrl: dto.clickUrl } : {}),
      ...(dto.placement !== undefined ? { placement: dto.placement } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.startAt !== undefined ? { startAt: dto.startAt } : {}),
      ...(dto.endAt !== undefined ? { endAt: dto.endAt } : {}),
    };
    const ad = await this.ads.update(id, data);
    await this.invalidateCache('update', id);
    return toAdminAdResponse(ad);
  }

  async setActive(id: string, isActive: boolean): Promise<AdminAdResponseDto> {
    await this.findOrThrow(id);
    const ad = await this.ads.update(id, { isActive });
    await this.invalidateCache(isActive ? 'activate' : 'deactivate', id);
    return toAdminAdResponse(ad);
  }

  async remove(id: string): Promise<{ id: string }> {
    await this.findOrThrow(id);
    await this.ads.delete(id);
    await this.invalidateCache('delete', id);
    return { id };
  }

  countSummary() {
    return this.ads.countSummary(new Date());
  }

  private async findOrThrow(id: string) {
    const ad = await this.ads.findById(id);
    if (!ad) {
      throw notFound('Ad not found');
    }
    return ad;
  }

  private assertSchedule(startAt?: Date | null, endAt?: Date | null): void {
    if (startAt && endAt && endAt < startAt) {
      throw validationError('endAt must be greater than or equal to startAt');
    }
  }

  /** Bumping the version makes every API instance read a fresh list on its next request. */
  private async invalidateCache(action: string, adId: string): Promise<void> {
    try {
      await this.redis.incr(RedisKey.adsActiveVersion());
      logEvent(this.logger, 'log', 'ads-cache-invalidated', { action, adId });
    } catch {
      logEvent(this.logger, 'warn', 'ads-cache-invalidate-failed', { action, adId, maxStaleSeconds: ADS_CACHE_TTL_SECONDS });
    }
  }
}
