import { Module } from '@nestjs/common';
import { LatiyalModule } from '../latiyal/latiyal.module';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';

@Module({
  imports: [LatiyalModule],
  controllers: [FeedsController],
  providers: [FeedsService],
})
export class FeedsModule {}
