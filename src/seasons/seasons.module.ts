import { Module } from '@nestjs/common';
import { SeasonsController } from './seasons.controller';
import { SeasonsRepository } from './seasons.repository';
import { SeasonsService } from './seasons.service';

@Module({
  controllers: [SeasonsController],
  providers: [SeasonsRepository, SeasonsService],
})
export class SeasonsModule {}
