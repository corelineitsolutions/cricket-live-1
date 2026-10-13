import { Module } from '@nestjs/common';
import { HistoryModule } from '../history/history.module';
import { AdminIdentityController } from './admin-identity.controller';
import { IdentityService } from './identity.service';

@Module({
  imports: [HistoryModule],
  controllers: [AdminIdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
