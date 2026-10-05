import { CanActivate, Controller, ExecutionContext, Get, Injectable, Res, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { notFound, unauthorized } from '../common/utils/http-errors';
import { AppConfigService } from '../config/app-config.service';
import { MonitoringService, toPrometheus } from './monitoring.service';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Bearer METRICS_TOKEN. The endpoint does not exist while the token is unset. */
@Injectable()
export class MetricsTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.metricsToken;
    if (!expected) {
      throw notFound('Not found');
    }
    const header = context.switchToHttp().getRequest<Request>().headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!provided || !timingSafeEqual(digest(provided), digest(expected))) {
      throw unauthorized('Metrics token required');
    }
    return true;
  }
}

@ApiExcludeController()
@SkipThrottle()
@UseGuards(MetricsTokenGuard)
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class PrometheusController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get()
  async scrape(@Res() res: Response): Promise<void> {
    const { metrics, workerHealth } = await this.monitoring.collect();
    res.type('text/plain; version=0.0.4; charset=utf-8').send(toPrometheus(metrics, workerHealth));
  }
}
