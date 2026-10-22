import { Module } from '@nestjs/common';
import { R2AdsService } from './r2-ads.service';

@Module({
  providers: [R2AdsService],
  exports: [R2AdsService],
})
export class StorageModule {}
