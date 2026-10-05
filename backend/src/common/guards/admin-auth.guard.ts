import { applyDecorators, Injectable, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { unauthorized } from '../utils/http-errors';
import { ErrorResponseDto } from '../dto/error-response.dto';

/** Requires a valid admin JWT (Bearer). Mobile endpoints never use it. */
@Injectable()
export class AdminAuthGuard extends AuthGuard('jwt') {
  override handleRequest<TUser>(error: unknown, user: TUser | false): TUser {
    if (error || !user) {
      throw unauthorized('Admin authentication required');
    }
    return user;
  }
}

/** Guard plus Swagger metadata for an admin-only controller or route. */
export function AdminOnly(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    UseGuards(AdminAuthGuard),
    ApiBearerAuth('admin-jwt'),
    ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Missing, invalid or expired admin JWT (UNAUTHORIZED).' }),
  );
}
