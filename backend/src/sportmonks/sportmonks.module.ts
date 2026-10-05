import { Module } from '@nestjs/common';
import { SPORTMONKS_FETCH } from './sportmonks.constants';
import { FetchFn, SportmonksHttpClient } from './sportmonks-http.client';
import { SportmonksQuotaService } from './sportmonks-quota.service';
import { SportmonksService } from './sportmonks.service';

@Module({
  providers: [
    { provide: SPORTMONKS_FETCH, useValue: ((input, init) => fetch(input, init)) satisfies FetchFn },
    SportmonksQuotaService,
    SportmonksHttpClient,
    SportmonksService,
  ],
  exports: [SportmonksService, SportmonksQuotaService],
})
export class SportmonksModule {}
