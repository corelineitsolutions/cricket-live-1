import type { WorkerStatus } from '../live-score/worker-state.repository';
import { workerHealth } from './admin-dashboard.service';
import { METRIC_DEFINITIONS, type Metrics, toPrometheus } from './monitoring.service';

const NOW = Date.parse('2026-10-01T12:00:00.000Z');

function status(overrides: Partial<WorkerStatus> = {}): WorkerStatus {
  return {
    state: 'live',
    instanceId: 'w1',
    mode: 'live',
    reason: null,
    nextIntervalMs: 10_000,
    nextPollAt: null,
    liveMatchCount: 1,
    consecutiveFailures: 0,
    message: null,
    updatedAt: new Date(NOW - 5_000).toISOString(),
    ...overrides,
  };
}

describe('workerHealth', () => {
  it('is unknown without a status and disabled when the worker has no token', () => {
    expect(workerHealth(null, 60_000, NOW)).toBe('unknown');
    expect(workerHealth(status({ state: 'disabled', updatedAt: new Date(NOW - 86_400_000).toISOString() }), 60_000, NOW)).toBe('disabled');
  });

  it('is up while the worker reports within three expected gaps (at least two minutes)', () => {
    expect(workerHealth(status(), 60_000, NOW)).toBe('up');
    expect(workerHealth(status({ updatedAt: new Date(NOW - 179_000).toISOString() }), 60_000, NOW)).toBe('up');
  });

  it('is down when the worker has been silent too long (crashed or stuck)', () => {
    expect(workerHealth(status({ updatedAt: new Date(NOW - 181_000).toISOString() }), 60_000, NOW)).toBe('down');
  });

  it('allows longer silence while the worker is backing off', () => {
    const backoff = status({ state: 'backoff', nextIntervalMs: 300_000, updatedAt: new Date(NOW - 600_000).toISOString() });
    expect(workerHealth(backoff, 60_000, NOW)).toBe('up');
    expect(workerHealth({ ...backoff, updatedAt: new Date(NOW - 901_000).toISOString() }, 60_000, NOW)).toBe('down');
  });
});

describe('toPrometheus', () => {
  const metrics = Object.fromEntries(Object.keys(METRIC_DEFINITIONS).map((name) => [name, 1])) as Metrics;

  it('renders every known metric as a gauge with the cricket_live_ prefix', () => {
    const text = toPrometheus({ ...metrics, 'sportmonks.calls.hour': 42, 'sportmonks.429': 3 }, 'up');

    expect(text).toContain('# TYPE cricket_live_sportmonks_calls_hour gauge\ncricket_live_sportmonks_calls_hour 42\n');
    expect(text).toContain('cricket_live_sportmonks_429 3\n');
    expect(text).toContain('cricket_live_websocket_connected 1\n');
    expect(text).toContain('cricket_live_worker_health{health="up"} 1\n');
    expect(text.endsWith('\n')).toBe(true);
    for (const line of text.trim().split('\n').filter((l) => !l.startsWith('#'))) {
      expect(line).toMatch(/^cricket_live_[a-z0-9_]+(\{health="[a-z]+"\})? -?\d+(\.\d+)?$/);
    }
  });

  it('omits unknown values instead of reporting zero', () => {
    const text = toPrometheus({ ...metrics, 'redis.status': 0, 'sportmonks.calls.remaining': null }, 'unknown');

    expect(text).toContain('cricket_live_redis_status 0\n');
    expect(text).not.toContain('cricket_live_sportmonks_calls_remaining');
  });
});
