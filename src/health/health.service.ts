import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { HealthDataDto } from './dto/health-response.dto';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthDataDto> {
    const [mysql, redis] = await Promise.all([this.prisma.ping(), this.redis.ping()]);
    const status = mysql === 'up' && redis === 'up' ? 'ok' : 'degraded';

    return {
      status,
      checks: {
        api: 'up',
        mysql,
        redis,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
