import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';

export function apiError(status: HttpStatus, message: string, code: string): HttpException {
  return new HttpException({ success: false, message, code }, status);
}

export function notFound(message: string): HttpException {
  return apiError(HttpStatus.NOT_FOUND, message, ErrorCode.RESOURCE_NOT_FOUND);
}

export function unauthorized(message: string): HttpException {
  return apiError(HttpStatus.UNAUTHORIZED, message, ErrorCode.UNAUTHORIZED);
}

export function validationError(message: string): HttpException {
  return apiError(HttpStatus.BAD_REQUEST, message, ErrorCode.VALIDATION_ERROR);
}

export function serviceUnavailable(message: string): HttpException {
  return apiError(HttpStatus.SERVICE_UNAVAILABLE, message, ErrorCode.SERVICE_UNAVAILABLE);
}
