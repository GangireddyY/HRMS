import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppConfig } from '../../config/app-config.service';
import type { AuthContext } from '../../common/auth/auth-context';
import { AllowRestrictedSession, CurrentAuth, Public } from '../../common/auth/decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { AuthService, ClientMeta, IssuedRefresh } from './auth.service';
import {
  AcceptInvitationDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  InspectTokenDto,
  LoginDto,
  MfaCodeDto,
  MfaDisableDto,
  MfaVerifyDto,
  RegisterOrganizationDto,
  ResetPasswordDto,
  SwitchOrganizationDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { MfaService } from './mfa.service';

export const REFRESH_COOKIE = 'hrms_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

const STRICT = { default: { limit: 10, ttl: 60_000 } };
const VERY_STRICT = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly config: AppConfig,
  ) {}

  private meta(req: Request): ClientMeta {
    return { ipAddress: req.ip, userAgent: req.get('user-agent') ?? undefined };
  }

  private setRefreshCookie(res: Response, refresh?: IssuedRefresh): void {
    if (!refresh) return;
    res.cookie(REFRESH_COOKIE, refresh.token, {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE'),
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      expires: refresh.expiresAt,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: this.config.get('COOKIE_SECURE'), sameSite: 'strict', path: REFRESH_COOKIE_PATH });
  }

  // ── Public ───────────────────────────────────────────────────────────────

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { result, refresh } = await this.auth.login(dto, this.meta(req));
    this.setRefreshCookie(res, refresh);
    return result;
  }

  @Public()
  @Throttle(STRICT)
  @Post('mfa/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete sign-in with a TOTP or recovery code' })
  async verifyMfa(@Body() dto: MfaVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { result, refresh } = await this.auth.verifyMfa(dto, this.meta(req));
    this.setRefreshCookie(res, refresh);
    return result;
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token (HttpOnly cookie) and issue a new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { result, refresh } = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]);
      this.setRefreshCookie(res, refresh);
      return result;
    } catch (e) {
      this.clearRefreshCookie(res);
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    this.clearRefreshCookie(res);
    return { loggedOut: true };
  }

  @Public()
  @Throttle(VERY_STRICT)
  @Post('forgot-password')
  @HttpCode(202)
  @ApiOperation({ summary: 'Request a password reset email (always succeeds to prevent account enumeration)' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return { message: 'If an account exists for this email, a reset link has been sent.' };
  }

  @Public()
  @Throttle(STRICT)
  @Post('tokens/inspect')
  @HttpCode(200)
  @ApiOperation({ summary: 'Validate a password-reset or invitation token and return the applicable password policy' })
  inspectToken(@Body() dto: InspectTokenDto) {
    return this.auth.inspectToken(dto.token, dto.purpose);
  }

  @Public()
  @Throttle(VERY_STRICT)
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
    return { message: 'Password updated. Please sign in.' };
  }

  @Public()
  @Throttle(STRICT)
  @Post('accept-invitation')
  @HttpCode(200)
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.auth.acceptInvitation(dto);
  }

  @Public()
  @Throttle(VERY_STRICT)
  @Post('register-organization')
  @ApiOperation({ summary: 'Self-service organization registration (if enabled)' })
  async registerOrganization(@Body() dto: RegisterOrganizationDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { result, refresh } = await this.auth.registerOrganization(dto, this.meta(req));
    this.setRefreshCookie(res, refresh);
    return result;
  }

  // ── Authenticated ────────────────────────────────────────────────────────

  @ApiBearerAuth()
  @AllowRestrictedSession()
  @Get('me')
  @ApiOperation({ summary: 'Current user, active organization, roles, permissions and entitlements' })
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.context(auth);
  }

  @ApiBearerAuth()
  @Patch('me')
  updateProfile(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(auth, dto);
  }

  @ApiBearerAuth()
  @AllowRestrictedSession()
  @Get('password-policy')
  passwordPolicy(@CurrentAuth() auth: AuthContext) {
    return this.auth.passwordPolicyFor(auth.userId);
  }

  @ApiBearerAuth()
  @AllowRestrictedSession()
  @Throttle(STRICT)
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentAuth() auth: AuthContext, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(auth, dto);
    return { message: 'Password changed' };
  }

  @ApiBearerAuth()
  @Post('switch-organization')
  @HttpCode(200)
  switchOrganization(@CurrentAuth() auth: AuthContext, @Body() dto: SwitchOrganizationDto) {
    return this.auth.switchOrganization(auth, dto.organizationId);
  }

  @ApiBearerAuth()
  @AllowRestrictedSession()
  @Get('mfa')
  mfaStatus(@CurrentAuth() auth: AuthContext) {
    return this.mfa.status(auth.userId);
  }

  @ApiBearerAuth()
  @AllowRestrictedSession()
  @Post('mfa/setup')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start TOTP enrollment (returns secret and QR code)' })
  mfaSetup(@CurrentAuth() auth: AuthContext) {
    return this.mfa.beginSetup(auth.userId);
  }

  @ApiBearerAuth()
  @AllowRestrictedSession()
  @Throttle(STRICT)
  @Post('mfa/enable')
  @HttpCode(200)
  mfaEnable(@CurrentAuth() auth: AuthContext, @Body() dto: MfaCodeDto) {
    return this.mfa.enable(auth.userId, dto.code);
  }

  @ApiBearerAuth()
  @Throttle(STRICT)
  @Post('mfa/disable')
  @HttpCode(200)
  async mfaDisable(@CurrentAuth() auth: AuthContext, @Body() dto: MfaDisableDto) {
    await this.mfa.disable(auth.userId, dto.password, dto.code);
    return { enabled: false };
  }

  @ApiBearerAuth()
  @Throttle(STRICT)
  @Post('mfa/recovery-codes')
  @HttpCode(200)
  regenerateRecoveryCodes(@CurrentAuth() auth: AuthContext, @Body() dto: MfaCodeDto) {
    return this.mfa.regenerateRecoveryCodes(auth.userId, dto.code);
  }

  @ApiBearerAuth()
  @AllowRestrictedSession()
  @Get('sessions')
  sessions(@CurrentAuth() auth: AuthContext) {
    return this.auth.listSessions(auth);
  }

  @ApiBearerAuth()
  @AllowRestrictedSession()
  @Delete('sessions/:id')
  async revokeSession(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(auth, id);
    return { revoked: true };
  }

  @ApiBearerAuth()
  @AllowRestrictedSession()
  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOthers(@CurrentAuth() auth: AuthContext) {
    return { revoked: await this.auth.revokeOtherSessions(auth) };
  }

  @ApiBearerAuth()
  @AllowRestrictedSession()
  @Get('login-history')
  loginHistory(@CurrentAuth() auth: AuthContext, @Query() query: PaginationQueryDto) {
    return this.auth.loginHistory(auth.userId, query);
  }
}
