import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { RedisKey } from '../common/constants/redis-keys';
import { RedisService } from '../redis/redis.service';

const PUBLISH_INTERVAL_MS = 15_000;
const SNAPSHOT_TTL_SECONDS = 45;
const MATCH_ROOM = /^match:(\d+)$/;

export interface InstanceMetrics {
  instanceId: string;
  connections: number;
  /** Subscribers per match on this instance. */
  rooms: Record<string, number>;
  updatedAt: string;
}

export interface ClusterMetrics {
  instances: number;
  connections: number;
  activeRooms: number;
  subscriptions: number;
  subscriptionsPerMatch: Array<{ matchId: number; subscribers: number }>;
  updatedAt: string;
}

/**
 * Counts sockets and match-room members in memory. Every instance writes a short-lived
 * snapshot to Redis, so the cluster view survives crashes without per-connection writes.
 */
@Injectable()
export class RealtimeMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeMetricsService.name);
  readonly instanceId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private connections = 0;
  private readRooms: () => Map<string, Set<string>> = () => new Map();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.publish(), PUBLISH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    void this.redis.del(RedisKey.wsInstanceMetrics(this.instanceId)).catch(() => undefined);
  }

  attachRooms(readRooms: () => Map<string, Set<string>>): void {
    this.readRooms = readRooms;
  }

  connected(): void {
    this.connections += 1;
  }

  disconnected(): void {
    this.connections = Math.max(0, this.connections - 1);
  }

  local(): InstanceMetrics {
    const rooms: Record<string, number> = {};
    for (const [room, members] of this.readRooms()) {
      const match = MATCH_ROOM.exec(room);
      if (match && members.size > 0) {
        rooms[match[1]] = members.size;
      }
    }
    return { instanceId: this.instanceId, connections: this.connections, rooms, updatedAt: new Date().toISOString() };
  }

  async publish(): Promise<void> {
    try {
      await this.redis.setJson(RedisKey.wsInstanceMetrics(this.instanceId), this.local(), SNAPSHOT_TTL_SECONDS);
    } catch {
      this.logger.debug('Realtime metrics snapshot not written (Redis unavailable)');
    }
  }

  /** Sum of every live instance's latest snapshot. Falls back to this instance alone. */
  async cluster(): Promise<ClusterMetrics> {
    let snapshots: InstanceMetrics[];
    try {
      await this.publish();
      const keys = await this.redis.scanKeys(RedisKey.wsInstanceMetrics('*'));
      snapshots = (await this.redis.getManyJson<InstanceMetrics>(keys)).filter((value): value is InstanceMetrics => Boolean(value));
    } catch {
      snapshots = [this.local()];
    }

    const perMatch = new Map<number, number>();
    for (const snapshot of snapshots) {
      for (const [matchId, count] of Object.entries(snapshot.rooms)) {
        perMatch.set(Number(matchId), (perMatch.get(Number(matchId)) ?? 0) + count);
      }
    }
    const subscriptionsPerMatch = [...perMatch.entries()]
      .map(([matchId, subscribers]) => ({ matchId, subscribers }))
      .sort((a, b) => b.subscribers - a.subscribers);

    return {
      instances: snapshots.length,
      connections: snapshots.reduce((sum, snapshot) => sum + snapshot.connections, 0),
      activeRooms: subscriptionsPerMatch.length,
      subscriptions: subscriptionsPerMatch.reduce((sum, entry) => sum + entry.subscribers, 0),
      subscriptionsPerMatch,
      updatedAt: new Date().toISOString(),
    };
  }
}
