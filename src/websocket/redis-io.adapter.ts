import { INestApplication, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';
import { AppConfigService } from '../config/app-config.service';
import { attachConnectionLogging, buildRedisOptions } from '../redis/redis-connection';

/**
 * Socket.IO adapter backed by Redis Pub/Sub so several API processes can share rooms.
 * If Redis is down at startup the gateway runs in single-node mode.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly adapterLogger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  constructor(app: INestApplication) {
    super(app);
  }

  async connect(config: AppConfigService): Promise<boolean> {
    const pubClient = new Redis(buildRedisOptions(config, 'cricket-live-socket-pub'));
    const subClient = new Redis(buildRedisOptions(config, 'cricket-live-socket-sub'));
    attachConnectionLogging(pubClient, this.adapterLogger, 'Socket.IO Redis publisher');
    attachConnectionLogging(subClient, this.adapterLogger, 'Socket.IO Redis subscriber');

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.adapterConstructor = createAdapter(pubClient, subClient);
      return true;
    } catch {
      pubClient.disconnect();
      subClient.disconnect();
      return false;
    }
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: true, credentials: false },
    } as ServerOptions);

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }
}
