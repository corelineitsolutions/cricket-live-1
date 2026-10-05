import { Global, Module } from '@nestjs/common';
import { SingleFlightCache } from './single-flight-cache.service';

@Global()
@Module({
  providers: [SingleFlightCache],
  exports: [SingleFlightCache],
})
export class AppCacheModule {}
