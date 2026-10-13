import { Global, Module } from '@nestjs/common';
import { HistoryPrismaService } from './history-prisma.service';
import { HistoryQueryService } from './history-query.service';

@Global()
@Module({
  providers: [HistoryPrismaService, HistoryQueryService],
  exports: [HistoryPrismaService, HistoryQueryService],
})
export class HistoryModule {}
