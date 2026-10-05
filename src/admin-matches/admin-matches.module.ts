import { Module } from '@nestjs/common';
import { LiveScoreModule } from '../live-score/live-score.module';
import { MatchesModule } from '../matches/matches.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { AdminMatchesController } from './admin-matches.controller';
import { AdminMatchesService } from './admin-matches.service';

@Module({
  imports: [LiveScoreModule, MatchesModule, WebsocketModule],
  controllers: [AdminMatchesController],
  providers: [AdminMatchesService],
})
export class AdminMatchesModule {}
