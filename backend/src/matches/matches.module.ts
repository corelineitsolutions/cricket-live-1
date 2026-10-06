import { Module } from '@nestjs/common';
import { LiveScoreModule } from '../live-score/live-score.module';
import { LatiyalModule } from '../latiyal/latiyal.module';
import { MatchDetailService } from './match-detail.service';
import { MatchesController } from './matches.controller';
import { MatchesRepository } from './matches.repository';
import { MatchesService } from './matches.service';

@Module({
  imports: [LiveScoreModule, LatiyalModule],
  controllers: [MatchesController],
  providers: [MatchesRepository, MatchesService, MatchDetailService],
  exports: [MatchesService, MatchesRepository],
})
export class MatchesModule {}
