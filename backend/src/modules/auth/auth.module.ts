import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MyAvatarController, UserAvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { MfaService } from './mfa.service';
import { SecurityPolicyService } from './security-policy.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Global()
@Module({
  imports: [JwtModule.register({}), RbacModule, OrganizationsModule],
  controllers: [AuthController, MyAvatarController, UserAvatarController],
  providers: [AuthService, AvatarService, TokenService, SessionService, SecurityPolicyService, MfaService, JwtAuthGuard, PermissionsGuard],
  exports: [TokenService, SessionService, SecurityPolicyService, JwtAuthGuard, PermissionsGuard],
})
export class AuthModule {}
