import { Module } from '@nestjs/common';
import { LeaguesController } from './leagues.controller';
import { LeaguesRepository } from './leagues.repository';
import { LeaguesService } from './leagues.service';

@Module({
  controllers: [LeaguesController],
  providers: [LeaguesRepository, LeaguesService],
})
export class LeaguesModule {}
