import { Module } from '@nestjs/common';
import { AdminAdsController } from './admin-ads.controller';
import { AdsController } from './ads.controller';
import { AdsRepository } from './ads.repository';
import { AdsService } from './ads.service';

@Module({
  controllers: [AdsController, AdminAdsController],
  providers: [AdsRepository, AdsService],
  exports: [AdsService],
})
export class AdsModule {}
