import { Module } from '@nestjs/common';
import { FirebaseModule } from '../firebase/firebase.module';
import { AdminDevicesController } from './admin-devices.controller';
import { FcmController } from './fcm.controller';
import { FcmRepository } from './fcm.repository';
import { FcmService } from './fcm.service';

@Module({
  imports: [FirebaseModule],
  controllers: [FcmController, AdminDevicesController],
  providers: [FcmRepository, FcmService],
  exports: [FcmService],
})
export class FcmModule {}
