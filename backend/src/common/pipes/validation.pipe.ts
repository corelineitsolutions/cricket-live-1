import { HttpException, HttpStatus, ValidationPipe, ValidationError } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';

export function flattenValidationErrors(errors: ValidationError[], parent = ''): string[] {
  const messages: string[] = [];

  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      for (const constraint of Object.values(error.constraints)) {
        messages.push(`${path}: ${constraint}`);
      }
    }
    if (error.children?.length) {
      messages.push(...flattenValidationErrors(error.children, path));
    }
  }

  return messages;
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: false,
    },
    exceptionFactory: (errors: ValidationError[]) =>
      new HttpException(
        {
          success: false,
          message: 'Validation failed',
          code: ErrorCode.VALIDATION_ERROR,
          errors: flattenValidationErrors(errors),
        },
        HttpStatus.BAD_REQUEST,
      ),
  });
}
