import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsRepository } from './teams.repository';
import { TeamsService } from './teams.service';

@Module({
  controllers: [TeamsController],
  providers: [TeamsRepository, TeamsService],
})
export class TeamsModule {}
