import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthContext } from '../../../common/auth/auth-context';
import { CurrentAuth, Public, RequirePermissions } from '../../../common/auth/decorators';
import { AppConfig } from '../../../config/app-config.service';
import { REFRESH_COOKIE } from '../auth.controller';
import { SsoConfigDto, SsoDiscoverDto } from './sso.dto';
import { SsoService, SsoSignInError } from './sso.service';

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Single sign-on: the public browser flow (discover → start → callback) and the organization's configuration. */
@ApiTags('Auth')
@Controller({ version: '1' })
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('auth/sso/discover')
  @HttpCode(200)
  @ApiOperation({ summary: 'Whether a work email signs in with single sign-on (and through which organization)' })
  discover(@Body() dto: SsoDiscoverDto) {
    return this.sso.discover(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('auth/sso/start/:slug')
  @ApiOperation({ summary: "Redirects the browser to the organization's identity provider" })
  async start(@Param('slug') slug: string, @Query('returnTo') returnTo: string | undefined, @Query('email') email: string | undefined, @Res() res: Response) {
    try {
      if (!SLUG.test(slug)) throw new SsoSignInError('not_configured', 'Unknown organization');
      res.redirect(302, await this.sso.start(slug, { returnTo, loginHint: typeof email === 'string' ? email.slice(0, 254) : undefined }));
    } catch (e) {
      this.fail(res, e);
    }
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('auth/sso/callback')
  @ApiOperation({ summary: 'Where the identity provider sends the browser back; signs in and redirects to the app' })
  async callback(@Query() query: Record<string, string | undefined>, @Req() req: Request, @Res() res: Response) {
    try {
      const outcome = await this.sso.callback(
        { code: query.code, state: query.state, error: query.error, errorDescription: query.error_description },
        { ipAddress: req.ip, userAgent: req.get('user-agent') ?? undefined },
      );
      if (outcome.refresh) {
        res.cookie(REFRESH_COOKIE, outcome.refresh.token, { httpOnly: true, secure: this.config.get('COOKIE_SECURE'), sameSite: 'lax', path: '/api/v1/auth', expires: outcome.refresh.expiresAt });
      }
      res.redirect(302, this.sso.appUrl(outcome.returnTo));
    } catch (e) {
      this.fail(res, e);
    }
  }

  @Get('organizations/current/sso')
  @ApiBearerAuth()
  @RequirePermissions('organization.security.manage')
  @ApiOperation({ summary: 'Single sign-on settings (the client secret is never returned)' })
  view(@CurrentAuth() auth: AuthContext) {
    return this.sso.view(auth);
  }

  @Put('organizations/current/sso')
  @ApiBearerAuth()
  @RequirePermissions('organization.security.manage')
  @ApiOperation({ summary: 'Configure single sign-on; turning it on checks that the provider can be reached' })
  update(@CurrentAuth() auth: AuthContext, @Body() dto: SsoConfigDto) {
    return this.sso.update(auth, dto);
  }

  private fail(res: Response, e: unknown) {
    const reason = e instanceof SsoSignInError ? e.reason : 'provider_error';
    res.redirect(302, this.sso.appUrl(`/login?sso_error=${reason}`));
  }
}
