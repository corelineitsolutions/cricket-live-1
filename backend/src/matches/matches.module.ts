import { Module } from '@nestjs/common';
import { LiveScoreModule } from '../live-score/live-score.module';
import { SportmonksModule } from '../sportmonks/sportmonks.module';
import { MatchDetailService } from './match-detail.service';
import { MatchesController } from './matches.controller';
import { MatchesRepository } from './matches.repository';
import { MatchesService } from './matches.service';

@Module({
  imports: [LiveScoreModule, SportmonksModule],
  controllers: [MatchesController],
  providers: [MatchesRepository, MatchesService, MatchDetailService],
  exports: [MatchesService, MatchesRepository],
})
export class MatchesModule {}
