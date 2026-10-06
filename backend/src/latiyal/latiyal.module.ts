import { Module } from '@nestjs/common';
import { LATIYAL_FETCH } from './latiyal.constants';
import { FetchFn, LatiyalHttpClient } from './latiyal-http.client';
import { LatiyalQuotaService } from './latiyal-quota.service';
import { LatiyalService } from './latiyal.service';

@Module({
  providers: [
    { provide: LATIYAL_FETCH, useValue: ((input, init) => fetch(input, init)) satisfies FetchFn },
    LatiyalQuotaService,
    LatiyalHttpClient,
    LatiyalService,
  ],
  exports: [LatiyalService, LatiyalQuotaService],
})
export class LatiyalModule {}
