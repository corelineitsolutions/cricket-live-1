import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AdminAdsController } from './admin-ads.controller';
import { AdsController } from './ads.controller';
import { AdsRepository } from './ads.repository';
import { AdsService } from './ads.service';

@Module({
  imports: [StorageModule],
  controllers: [AdsController, AdminAdsController],
  providers: [AdsRepository, AdsService],
  exports: [AdsService],
})
export class AdsModule {}
