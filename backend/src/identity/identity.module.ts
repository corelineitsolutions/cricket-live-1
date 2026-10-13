import { Module } from '@nestjs/common';
import { AdminIdentityController } from './admin-identity.controller';
import { IdentityService } from './identity.service';

@Module({
  controllers: [AdminIdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
