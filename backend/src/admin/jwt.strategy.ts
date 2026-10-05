import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../config/app-config.service';
import { AdminPrincipal } from '../common/decorators/current-admin.decorator';
import { ADMIN_JWT } from './admin-jwt.constants';
import { AdminsRepository } from './admins.repository';

interface JwtPayload {
  sub?: string;
  email?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: AppConfigService,
    private readonly admins: AdminsRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
      algorithms: [ADMIN_JWT.algorithm],
      issuer: ADMIN_JWT.issuer,
      audience: ADMIN_JWT.audience,
    });
  }

  async validate(payload: JwtPayload): Promise<AdminPrincipal> {
    if (!payload.sub) {
      throw new UnauthorizedException();
    }

    const admin = await this.admins.findById(payload.sub);
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException();
    }

    return { id: admin.id, email: admin.email };
  }
}
