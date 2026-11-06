import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { MfaService } from './mfa.service';
import { SecurityPolicyService } from './security-policy.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Global()
@Module({
  imports: [JwtModule.register({}), RbacModule, OrganizationsModule],
  controllers: [AuthController],
  providers: [AuthService, TokenService, SessionService, SecurityPolicyService, MfaService, JwtAuthGuard, PermissionsGuard],
  exports: [TokenService, SessionService, SecurityPolicyService, JwtAuthGuard, PermissionsGuard],
})
export class AuthModule {}
