import { Module } from '@nestjs/common';
import { SportmonksModule } from '../sportmonks/sportmonks.module';
import { LiveScoreSyncService } from './live-score-sync.service';
import { LiveScoreService } from './live-score.service';
import { LiveScoreWorker } from './live-score.worker';
import { LiveStateRepository } from './live-state.repository';
import { MatchPersistenceService } from './match-persistence.service';
import { WorkerStateRepository } from './worker-state.repository';

@Module({
  imports: [SportmonksModule],
  providers: [
    LiveStateRepository,
    WorkerStateRepository,
    MatchPersistenceService,
    LiveScoreSyncService,
    LiveScoreWorker,
    LiveScoreService,
  ],
  exports: [LiveScoreService, MatchPersistenceService, WorkerStateRepository],
})
export class LiveScoreModule {}
