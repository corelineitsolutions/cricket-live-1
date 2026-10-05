import { RedisChannel, RedisKey } from '../common/constants/redis-keys';
import type { PrismaService } from '../database/prisma.service';
import { LiveScoreSyncService } from '../live-score/live-score-sync.service';
import { LiveScoreService } from '../live-score/live-score.service';
import { LiveScoreWorker } from '../live-score/live-score.worker';
import type { LiveMatch, LiveScoreEvent } from '../live-score/live-match.types';
import { LiveStateRepository } from '../live-score/live-state.repository';
import { MatchPersistenceService } from '../live-score/match-persistence.service';
import { WorkerStateRepository, WorkerStatus } from '../live-score/worker-state.repository';
import { FetchFn, SportmonksHttpClient } from '../sportmonks/sportmonks-http.client';
import { SportmonksQuotaService } from '../sportmonks/sportmonks-quota.service';
import { SportmonksService } from '../sportmonks/sportmonks.service';
import { captureLogs } from './capture-logs';
import { FakeRedis } from './fake-redis';
import { jsonResponse } from './sportmonks-fixtures';
import { testConfig, TestConfigOverrides } from './test-config';

class InstantRetryClient extends SportmonksHttpClient {
  protected override sleep(): Promise<void> {
    return Promise.resolve();
  }
}

export type Responder = (url: URL) => Response | Promise<Response>;

/** Real live-score pipeline over an in-memory Redis, a scripted Sportmonks and a mocked MySQL. */
export function liveScoreHarness(overrides: TestConfigOverrides = {}, redis = new FakeRedis()) {
  const config = testConfig({ sportmonksMaxRetries: 0, ...overrides });
  const logs = captureLogs();

  let responder: Responder = () => jsonResponse({ data: [] });
  const fetchMock = vi.fn<FetchFn>(async (input) => responder(new URL(input)));

  const quota = new SportmonksQuotaService(redis.asService(), config);
  const sportmonks = new SportmonksService(config, new InstantRetryClient(config, quota, fetchMock));
  const liveState = new LiveStateRepository(redis.asService());
  const workerState = new WorkerStateRepository(redis.asService());

  const transaction = vi.fn(async () => 'cm_match_1');
  const playerUpsert = vi.fn(async () => ({}));
  const persistence = new MatchPersistenceService(
    { $transaction: transaction, player: { upsert: playerUpsert } } as unknown as PrismaService,
    redis.asService(),
  );

  const sync = new LiveScoreSyncService(config, sportmonks, quota, liveState, workerState, persistence);
  const worker = new LiveScoreWorker(config, sportmonks, workerState, sync);
  const reader = new LiveScoreService(liveState, workerState, config);

  return {
    config,
    redis,
    logs,
    fetchMock,
    transaction,
    playerUpsert,
    sync,
    worker,
    reader,
    respond(next: Responder) {
      responder = next;
    },
    livescores(...fixtures: Array<Record<string, unknown>>) {
      responder = () => jsonResponse({ data: fixtures });
    },
    events(): LiveScoreEvent[] {
      return redis.published
        .filter((entry) => entry.channel === `cricket:v1:${RedisChannel.liveScoreUpdates()}`)
        .map((entry) => entry.message as LiveScoreEvent);
    },
    match(id: number): LiveMatch | null {
      return redis.peekJson<LiveMatch>(RedisKey.liveMatch(id));
    },
    liveIds(): number[] | null {
      return redis.peekJson<number[]>(RedisKey.liveMatchList());
    },
    status(): WorkerStatus | null {
      return redis.peekJson<WorkerStatus>(RedisKey.sportmonksWorkerStatus());
    },
  };
}
