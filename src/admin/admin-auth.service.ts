import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../config/app-config.service';
import { AdminPrincipal } from '../common/decorators/current-admin.decorator';
import { unauthorized } from '../common/utils/http-errors';
import { hashPassword, verifyPassword } from '../common/utils/password';
import { logEvent } from '../common/utils/structured-log';
import { LoginDto } from './dto/login.dto';
import { AdminProfileDto, LoginResponseDto } from './dto/auth.response.dto';
import { AdminsRepository } from './admins.repository';
import { LoginAttemptsService } from './login-attempts.service';

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private dummyHash?: Promise<string>;

  constructor(
    private readonly admins: AdminsRepository,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly attempts: LoginAttemptsService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    await this.attempts.assertNotLocked(dto.email);

    const admin = await this.admins.findByEmail(dto.email);
    // Always run bcrypt so unknown emails take as long as wrong passwords.
    const passwordHash = admin?.passwordHash ?? (await this.getDummyHash());
    const matches = await verifyPassword(dto.password, passwordHash);

    if (!admin || !admin.isActive || !matches) {
      const failures = await this.attempts.recordFailure(dto.email);
      logEvent(this.logger, 'warn', 'admin-login-failed', {
        subject: LoginAttemptsService.subject(dto.email),
        reason: 'invalid_credentials',
        failures,
      });
      throw unauthorized('Invalid email or password');
    }

    await this.attempts.clear(dto.email);
    const accessToken = await this.jwt.signAsync({ sub: admin.id, email: admin.email });
    logEvent(this.logger, 'log', 'admin-login-success', { adminId: admin.id });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.jwtExpiresIn,
    };
  }

  async me(principal: AdminPrincipal): Promise<AdminProfileDto> {
    const admin = await this.admins.findById(principal.id);
    if (!admin || !admin.isActive) {
      throw unauthorized('Admin authentication required');
    }

    return {
      id: admin.id,
      email: admin.email,
      isActive: admin.isActive,
    };
  }

  private getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = hashPassword('not-a-real-admin-password');
    }
    return this.dummyHash;
  }
}
