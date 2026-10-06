import { DynamicModule, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { io, Socket } from 'socket.io-client';
import { AdminModule } from '../admin/admin.module';
import { AdminDashboardModule } from '../admin-dashboard/admin-dashboard.module';
import { AdminMatchesModule } from '../admin-matches/admin-matches.module';
import { AdsModule } from '../ads/ads.module';
import { configureHttpApp } from '../app.setup';
import { AppCacheModule } from '../cache/cache.module';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { HttpThrottlerGuard } from '../common/guards/http-throttler.guard';
import { throttlerOptions } from '../common/guards/throttler.config';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { FcmModule } from '../fcm/fcm.module';
import { FirebaseService } from '../firebase/firebase.service';
import { HealthModule } from '../health/health.module';
import { LeaguesModule } from '../leagues/leagues.module';
import { MatchesModule } from '../matches/matches.module';
import { PlayersModule } from '../players/players.module';
import { RedisService } from '../redis/redis.service';
import { LATIYAL_FETCH } from '../latiyal/latiyal.constants';
import type { FetchFn } from '../latiyal/latiyal-http.client';
import { TeamsModule } from '../teams/teams.module';
import { LIVE_NAMESPACE } from '../websocket/realtime.contract';
import { WebsocketModule } from '../websocket/websocket.module';
import { FakeDb } from './fake-db';
import { FakeFirebase } from './fake-firebase';
import { FakeRedis } from './fake-redis';
import { jsonResponse, LatiyalResponder } from './latiyal-fixtures';
import { testConfig } from './test-config';

export type ApiTestConfig = Partial<Record<keyof AppConfigService, unknown>>;

export function apiTestConfig(overrides: ApiTestConfig = {}): AppConfigService {
  return {
    ...testConfig({ liveScoreWorkerEnabled: false, latiyalMaxRetries: 0 }),
    nodeEnv: 'test',
    isProduction: false,
    corsOrigin: '*',
    latiyalOnDemandMaxCallsPerHour: 400,
    // High by default so functional tests are not throttled; rate-limit tests override these.
    rateLimitPerMinute: 100_000,
    rateLimitBurstPerSecond: 10_000,
    jwtSecret: 'test-only-jwt-secret-with-enough-length',
    jwtExpiresIn: '1h',
    firebaseProjectId: '',
    firebaseClientEmail: '',
    firebasePrivateKey: '',
    metricsToken: '',
    ...overrides,
  } as AppConfigService;
}

@Module({})
class TestInfraModule {}

function testInfra(config: AppConfigService, redis: FakeRedis, db: FakeDb): DynamicModule {
  return {
    module: TestInfraModule,
    global: true,
    providers: [
      { provide: AppConfigService, useValue: config },
      { provide: RedisService, useValue: redis.asService() },
      { provide: PrismaService, useValue: db.asPrisma() },
    ],
    exports: [AppConfigService, RedisService, PrismaService],
  };
}

export interface ApiTestOptions {
  redis?: FakeRedis;
  db?: FakeDb;
  firebase?: FakeFirebase;
  config?: ApiTestConfig;
}

export type Responder = LatiyalResponder;

/**
 * The public API (REST + Socket.IO) on a random port, wired like production except that
 * Redis, MySQL and Latiyal are in-memory fakes. Several apps can share one FakeRedis
 * to behave like API instances behind a load balancer.
 */
export async function createApiTestApp(options: ApiTestOptions = {}) {
  const redis = options.redis ?? new FakeRedis();
  const db = options.db ?? new FakeDb();
  const firebase = options.firebase ?? new FakeFirebase();
  const config = apiTestConfig(options.config);

  let responder: Responder = () => jsonResponse({ message: 'not scripted' }, 500);
  const fetchMock = vi.fn<FetchFn>(async (input, init) => responder(new URL(String(input)), init));

  const moduleRef = await Test.createTestingModule({
    imports: [
      testInfra(config, redis, db),
      ThrottlerModule.forRootAsync({ inject: [AppConfigService, RedisService], useFactory: throttlerOptions }),
      AppCacheModule,
      AdminModule,
      MatchesModule,
      TeamsModule,
      PlayersModule,
      LeaguesModule,
      AdsModule,
      FcmModule,
      WebsocketModule,
      AdminDashboardModule,
      AdminMatchesModule,
      HealthModule,
    ],
    providers: [AllExceptionsFilter, { provide: APP_GUARD, useClass: HttpThrottlerGuard }],
  })
    .overrideProvider(LATIYAL_FETCH)
    .useValue(fetchMock)
    .overrideProvider(FirebaseService)
    .useValue(firebase)
    .compile();

  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  configureHttpApp(app, config);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sockets: Socket[] = [];

  return {
    app,
    redis,
    db,
    firebase,
    config,
    fetchMock,
    baseUrl,
    http: app.getHttpServer(),
    respond(next: Responder) {
      responder = next;
    },
    /** Connected Socket.IO client on the /live namespace. */
    async connect(): Promise<Socket> {
      const socket = io(`${baseUrl}${LIVE_NAMESPACE}`, { transports: ['websocket'], reconnection: false, forceNew: true });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      return socket;
    },
    async close() {
      sockets.forEach((socket) => socket.disconnect());
      await app.close();
    },
  };
}

export type ApiTestApp = Awaited<ReturnType<typeof createApiTestApp>>;

/** Next occurrence of `event` on the socket, or a rejection after `timeoutMs`. */
export function nextEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const handler = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

/** Collects every payload of `event` from now on. */
export function collect<T = unknown>(socket: Socket, event: string): T[] {
  const received: T[] = [];
  socket.on(event, (payload: T) => received.push(payload));
  return received;
}

export function emitWithAck<T = unknown>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return socket.timeout(2000).emitWithAck(event, payload) as Promise<T>;
}

export const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
