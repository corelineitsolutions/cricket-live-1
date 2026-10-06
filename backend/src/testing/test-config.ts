import type { AppConfigService } from '../config/app-config.service';

export const TEST_LATIYAL_TOKEN = 'lt-test-token-do-not-log';

export interface TestConfigOverrides {
  latiyalApiToken?: string;
  latiyalApiUrl?: string;
  latiyalIdleIntervalMs?: number;
  latiyalLiveIntervalMs?: number;
  latiyalActiveIntervalMs?: number;
  latiyalListIntervalMs?: number;
  latiyalMaxCallsPerHour?: number;
  latiyalOnDemandMaxCallsPerHour?: number;
  latiyalTimeoutMs?: number;
  latiyalMaxRetries?: number;
  liveScoreWorkerEnabled?: boolean;
}

export function testConfig(overrides: TestConfigOverrides = {}): AppConfigService {
  return {
    latiyalApiToken: TEST_LATIYAL_TOKEN,
    latiyalApiUrl: 'https://api.latiyalinfotech.com/apiv5',
    latiyalIdleIntervalMs: 60_000,
    latiyalLiveIntervalMs: 10_000,
    latiyalActiveIntervalMs: 5_000,
    latiyalListIntervalMs: 0,
    latiyalMaxCallsPerHour: 1_600,
    latiyalOnDemandMaxCallsPerHour: 0,
    latiyalTimeoutMs: 8_000,
    latiyalMaxRetries: 2,
    liveScoreWorkerEnabled: true,
    ...overrides,
  } as AppConfigService;
}
