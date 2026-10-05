import { Controller, Get, HttpException, HttpStatus, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ErrorCode } from '../common/constants/error-codes';
import { HealthDataDto, HealthFailureResponseDto, HealthSuccessResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

@ApiTags('Health')
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Check the API process, MySQL, and Redis' })
  @ApiOkResponse({ type: HealthSuccessResponseDto })
  @ApiServiceUnavailableResponse({ type: HealthFailureResponseDto })
  async check(): Promise<HealthDataDto> {
    const report = await this.health.check();
    if (report.status !== 'ok') {
      throw new HttpException(
        {
          success: false,
          message: 'One or more dependencies are unavailable',
          code: ErrorCode.SERVICE_UNAVAILABLE,
          checks: report.checks,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return report;
  }
}
