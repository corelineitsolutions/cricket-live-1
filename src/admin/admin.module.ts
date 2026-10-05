import { Module } from '@nestjs/common';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfigService } from '../config/app-config.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { ADMIN_JWT } from './admin-jwt.constants';
import { AdminsRepository } from './admins.repository';
import { JwtStrategy } from './jwt.strategy';
import { LoginAttemptsService } from './login-attempts.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwtSecret,
        signOptions: {
          algorithm: ADMIN_JWT.algorithm,
          issuer: ADMIN_JWT.issuer,
          audience: ADMIN_JWT.audience,
          expiresIn: config.jwtExpiresIn as JwtSignOptions['expiresIn'],
        },
        verifyOptions: {
          algorithms: [ADMIN_JWT.algorithm],
          issuer: ADMIN_JWT.issuer,
          audience: ADMIN_JWT.audience,
        },
      }),
    }),
  ],
  controllers: [AdminAuthController],
  providers: [AdminsRepository, AdminAuthService, JwtStrategy, LoginAttemptsService],
})
export class AdminModule {}
