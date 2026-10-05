import { Module } from '@nestjs/common';
import { PlayersController } from './players.controller';
import { PlayersRepository } from './players.repository';
import { PlayersService } from './players.service';

@Module({
  controllers: [PlayersController],
  providers: [PlayersRepository, PlayersService],
})
export class PlayersModule {}
