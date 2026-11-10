import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RbacModule } from '../rbac/rbac.module';
import { ApiKeyAuthenticator } from './api-key-authenticator';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MyAvatarController, UserAvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { MfaService } from './mfa.service';
import { SecurityPolicyService } from './security-policy.service';
import { SessionService } from './session.service';
import { SsoController } from './sso/sso.controller';
import { SsoService } from './sso/sso.service';
import { TokenService } from './token.service';

@Global()
@Module({
  imports: [JwtModule.register({}), RbacModule, OrganizationsModule],
  controllers: [AuthController, MyAvatarController, UserAvatarController, SsoController],
  providers: [AuthService, AvatarService, TokenService, SessionService, SecurityPolicyService, MfaService, SsoService, ApiKeyAuthenticator, JwtAuthGuard, PermissionsGuard],
  exports: [TokenService, SessionService, SecurityPolicyService, ApiKeyAuthenticator, JwtAuthGuard, PermissionsGuard],
})
export class AuthModule {}
