import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports ok only when MySQL and Redis are up', async () => {
    const prisma = { ping: vi.fn().mockResolvedValue('up') };
    const redis = { ping: vi.fn().mockResolvedValue('down') };
    const service = new HealthService(prisma as unknown as PrismaService, redis as unknown as RedisService);

    const report = await service.check();

    expect(report.status).toBe('degraded');
    expect(report.checks).toEqual({ api: 'up', mysql: 'up', redis: 'down' });
  });
});
