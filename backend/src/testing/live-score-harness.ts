import { RedisChannel, RedisKey } from '../common/constants/redis-keys';
import type { PrismaService } from '../database/prisma.service';
import { FetchFn, LatiyalHttpClient } from '../latiyal/latiyal-http.client';
import { LatiyalQuotaService } from '../latiyal/latiyal-quota.service';
import { LatiyalService } from '../latiyal/latiyal.service';
import type { LatiyalRecord } from '../latiyal/latiyal.types';
import { LiveScoreSyncService } from '../live-score/live-score-sync.service';
import { LiveScoreService } from '../live-score/live-score.service';
import { LiveScoreWorker } from '../live-score/live-score.worker';
import type { LiveMatch, LiveScoreEvent } from '../live-score/live-match.types';
import { LiveStateRepository } from '../live-score/live-state.repository';
import { MatchPersistenceService } from '../live-score/match-persistence.service';
import { WorkerStateRepository, WorkerStatus } from '../live-score/worker-state.repository';
import { captureLogs } from './capture-logs';
import { FakeRedis } from './fake-redis';
import { endpointOf, latiyalApi, LatiyalResponder } from './latiyal-fixtures';
import { testConfig, TestConfigOverrides } from './test-config';

class InstantRetryClient extends LatiyalHttpClient {
  protected override sleep(): Promise<void> {
    return Promise.resolve();
  }
}

export type Responder = LatiyalResponder;

/** Real live-score pipeline over an in-memory Redis, a scripted Latiyal API and a mocked MySQL. */
export function liveScoreHarness(overrides: TestConfigOverrides = {}, redis = new FakeRedis()) {
  const config = testConfig({ latiyalMaxRetries: 0, ...overrides });
  const logs = captureLogs();

  let responder: Responder = latiyalApi([]);
  const fetchMock = vi.fn<FetchFn>(async (input, init) => responder(new URL(input), init));

  const quota = new LatiyalQuotaService(redis.asService(), config);
  const latiyal = new LatiyalService(config, new InstantRetryClient(config, quota, fetchMock));
  const liveState = new LiveStateRepository(redis.asService());
  const workerState = new WorkerStateRepository(redis.asService());

  const transaction = vi.fn(async () => 'cm_match_1');
  const playerUpsert = vi.fn(async () => ({}));
  const persistence = new MatchPersistenceService(
    { $transaction: transaction, player: { upsert: playerUpsert } } as unknown as PrismaService,
    redis.asService(),
  );

  const sync = new LiveScoreSyncService(config, latiyal, quota, liveState, workerState, persistence);
  const worker = new LiveScoreWorker(config, latiyal, workerState, sync);
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
    /** Scripts Latiyal so these matches are in liveMatchList and answer liveMatch. */
    live(...matches: LatiyalRecord[]) {
      responder = latiyalApi(matches);
    },
    /** Endpoint names of every request so far, in order. */
    calls(): string[] {
      return fetchMock.mock.calls.map(([input]) => endpointOf(new URL(input)));
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
      return redis.peekJson<WorkerStatus>(RedisKey.providerWorkerStatus());
    },
  };
}
