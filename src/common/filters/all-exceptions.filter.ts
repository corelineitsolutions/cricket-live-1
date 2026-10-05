import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { ErrorCode, ErrorCodeValue } from '../constants/error-codes';

interface ErrorBody {
  status: number;
  code: string;
  payload: {
    success: false;
    message: string;
    code: string;
    errors?: string[];
    checks?: unknown;
  };
}

@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly config: AppConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      return;
    }

    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const path = (request.originalUrl ?? request.url ?? '').split('?')[0];
    const body = this.toBody(exception);

    if (body.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logServerError(exception);
    } else {
      this.logger.warn(`${request.method} ${path} ${body.code}`);
    }
    const retryAfterSeconds = this.retryAfterSeconds(exception);
    if (retryAfterSeconds !== null) {
      response.setHeader('Retry-After', String(retryAfterSeconds));
    } else if (body.status === HttpStatus.TOO_MANY_REQUESTS && !response.getHeader('Retry-After')) {
      // The burst throttler sets Retry-After-burst; clients only need to read Retry-After.
      response.setHeader('Retry-After', String(response.getHeader('Retry-After-burst') ?? 1));
    }

    response.status(body.status).json(body.payload);
  }

  private retryAfterSeconds(exception: unknown): number | null {
    if (!(exception instanceof HttpException)) {
      return null;
    }
    const raw = exception.getResponse() as { retryAfterSeconds?: unknown };
    return typeof raw === 'object' && typeof raw.retryAfterSeconds === 'number' ? raw.retryAfterSeconds : null;
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return this.error(HttpStatus.CONFLICT, 'Resource already exists', ErrorCode.CONFLICT);
      }
      if (exception.code === 'P2025') {
        return this.error(HttpStatus.NOT_FOUND, 'Resource not found', ErrorCode.RESOURCE_NOT_FOUND);
      }
      return this.error(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'Internal server error',
        ErrorCode.INTERNAL_ERROR,
      );
    }

    if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientRustPanicError
    ) {
      return this.error(
        HttpStatus.SERVICE_UNAVAILABLE,
        'Database unavailable',
        ErrorCode.SERVICE_UNAVAILABLE,
      );
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return this.error(HttpStatus.BAD_REQUEST, 'Invalid request', ErrorCode.VALIDATION_ERROR);
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    return this.error(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Internal server error',
      ErrorCode.INTERNAL_ERROR,
    );
  }

  private fromHttpException(exception: HttpException): ErrorBody {
    const status = exception.getStatus();
    const raw = exception.getResponse();

    if (this.isApiBody(raw)) {
      return {
        status,
        code: raw.code,
        payload: {
          success: false,
          message: raw.message,
          code: raw.code,
          ...(raw.errors ? { errors: raw.errors } : {}),
          ...(raw.checks ? { checks: raw.checks } : {}),
        },
      };
    }

    const code = this.codeForStatus(status);
    let message = this.messageFromUnknown(raw, status);
    if (status === HttpStatus.NOT_FOUND && message.startsWith('Cannot ')) {
      message = 'Resource not found';
    }
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      message = 'Too many requests';
    }

    const errors = this.stringErrors(raw);
    return {
      status,
      code,
      payload: {
        success: false,
        message,
        code,
        ...(errors ? { errors } : {}),
      },
    };
  }

  private isApiBody(
    value: unknown,
  ): value is { success: false; message: string; code: string; errors?: string[]; checks?: unknown } {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const record = value as Record<string, unknown>;
    return record.success === false && typeof record.message === 'string' && typeof record.code === 'string';
  }

  private messageFromUnknown(value: unknown, status: number): string {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
    if (value && typeof value === 'object' && 'message' in value) {
      const message = (value as { message?: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
        return 'Validation failed';
      }
    }
    return status >= 500 ? 'Internal server error' : 'Request failed';
  }

  private stringErrors(value: unknown): string[] | undefined {
    if (!value || typeof value !== 'object' || !('message' in value)) {
      return undefined;
    }
    const message = (value as { message?: unknown }).message;
    if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
      return message;
    }
    return undefined;
  }

  private codeForStatus(status: number): ErrorCodeValue {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.RESOURCE_NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.TOO_MANY_REQUESTS;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCode.SERVICE_UNAVAILABLE;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }

  private error(status: number, message: string, code: ErrorCodeValue): ErrorBody {
    return {
      status,
      code,
      payload: { success: false, message, code },
    };
  }

  private logServerError(exception: unknown): void {
    if (!this.config.isProduction && exception instanceof Error) {
      this.logger.error(exception.stack ?? exception.message);
      return;
    }
    this.logger.error('Unhandled exception');
  }
}
