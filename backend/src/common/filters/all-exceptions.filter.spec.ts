import { ArgumentsHost, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfigService } from '../../config/app-config.service';
import { AllExceptionsFilter } from './all-exceptions.filter';

function hostFor(json: ReturnType<typeof vi.fn>): ArgumentsHost {
  const status = vi.fn().mockReturnValue({ json });
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'GET', originalUrl: '/api/v1/matches?x=1' }),
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter({ isProduction: true } as AppConfigService);

  it('hides database details for unknown errors', () => {
    const json = vi.fn();
    filter.catch(new Error('connect ECONNREFUSED mysql://root:secret@127.0.0.1/cricket_live'), hostFor(json));

    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('mysql://');
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('secret');
  });

  it('maps missing routes to a stable not-found code', () => {
    const json = vi.fn();
    filter.catch(new NotFoundException('Cannot GET /missing'), hostFor(json));

    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Resource not found',
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('passes through application error bodies and health checks', () => {
    const json = vi.fn();
    filter.catch(
      new HttpException(
        {
          success: false,
          message: 'One or more dependencies are unavailable',
          code: 'SERVICE_UNAVAILABLE',
          checks: { api: 'up', mysql: 'down', redis: 'up' },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      ),
      hostFor(json),
    );

    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'One or more dependencies are unavailable',
      code: 'SERVICE_UNAVAILABLE',
      checks: { api: 'up', mysql: 'down', redis: 'up' },
    });
  });

  it('maps unique constraint failures without the Prisma message', () => {
    const json = vi.fn();
    const exception = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

    filter.catch(exception, hostFor(json));

    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Resource already exists',
      code: 'CONFLICT',
    });
  });
});
