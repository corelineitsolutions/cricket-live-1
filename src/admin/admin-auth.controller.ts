import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentAdmin, AdminPrincipal } from '../common/decorators/current-admin.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AdminOnly } from '../common/guards/admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminProfileEnvelopeDto, LoginEnvelopeDto } from './dto/auth.response.dto';
import { LoginDto } from './dto/login.dto';
import { ADMIN_LOGIN_LOCK_WINDOW_MS, ADMIN_LOGIN_MAX_FAILURES } from './login-attempts.service';

@ApiTags('Admin auth')
@Controller({ path: 'admin/auth', version: '1' })
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 }, burst: { limit: 3, ttl: 1_000 } })
  @ApiOperation({
    summary: 'Issue an admin JWT',
    description: [
      'Returns a signed HS256 JWT. Send it as `Authorization: Bearer <accessToken>` to every /api/v1/admin endpoint.',
      `Brute-force protection: ${ADMIN_LOGIN_MAX_FAILURES} failed attempts for one email lock that email for ${ADMIN_LOGIN_LOCK_WINDOW_MS / 60_000} minutes, and each IP may try 10 times per minute. Both answer 429 with Retry-After.`,
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: LoginEnvelopeDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Malformed email or password (VALIDATION_ERROR).' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid email or password (UNAUTHORIZED).' })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Too many attempts (TOO_MANY_REQUESTS).' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  @AdminOnly()
  @ApiOperation({ summary: 'Return the authenticated admin' })
  @ApiOkResponse({ type: AdminProfileEnvelopeDto })
  me(@CurrentAdmin() admin: AdminPrincipal) {
    return this.auth.me(admin);
  }
}
