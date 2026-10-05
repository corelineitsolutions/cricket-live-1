import type { AppConfigService } from '../config/app-config.service';

export const TEST_SPORTMONKS_TOKEN = 'sm-test-token-do-not-log';

export interface TestConfigOverrides {
  sportmonksApiToken?: string;
  sportmonksApiUrl?: string;
  sportmonksIdleIntervalMs?: number;
  sportmonksLiveIntervalMs?: number;
  sportmonksActiveIntervalMs?: number;
  sportmonksMaxCallsPerHour?: number;
  sportmonksTimeoutMs?: number;
  sportmonksMaxRetries?: number;
  liveScoreWorkerEnabled?: boolean;
}

export function testConfig(overrides: TestConfigOverrides = {}): AppConfigService {
  return {
    sportmonksApiToken: TEST_SPORTMONKS_TOKEN,
    sportmonksApiUrl: 'https://cricket.sportmonks.com/api/v2.0',
    sportmonksIdleIntervalMs: 60_000,
    sportmonksLiveIntervalMs: 10_000,
    sportmonksActiveIntervalMs: 5_000,
    sportmonksMaxCallsPerHour: 1_600,
    sportmonksTimeoutMs: 8_000,
    sportmonksMaxRetries: 2,
    liveScoreWorkerEnabled: true,
    ...overrides,
  } as AppConfigService;
}
