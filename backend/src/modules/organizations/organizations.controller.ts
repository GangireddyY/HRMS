import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, CurrentOrg, Public, RequirePermissions } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { OrganizationProfileDto, UpdateSecurityPolicyDto } from './dto/organization.dto';
import { LOGO_UPLOAD_LIMIT_BYTES, OrganizationLogoService, type UploadedImage } from './organization-logo.service';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organization')
@ApiBearerAuth()
@Controller({ path: 'organizations/current', version: '1' })
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly logos: OrganizationLogoService,
  ) {}

  @Post('logo')
  @RequirePermissions('organization.update')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_UPLOAD_LIMIT_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload or replace the organization logo (PNG, JPEG or WebP, up to 5 MB; trimmed, resized and stored as WebP)' })
  uploadLogo(@CurrentAuth() auth: AuthContext, @UploadedFile() file?: UploadedImage) {
    return this.logos.upload(auth, file);
  }

  @Delete('logo')
  @RequirePermissions('organization.update')
  @ApiOperation({ summary: 'Remove the organization logo' })
  async removeLogo(@CurrentAuth() auth: AuthContext) {
    await this.logos.remove(auth);
    return { removed: true };
  }

  @Get()
  @RequirePermissions('organization.view')
  @ApiOperation({ summary: 'Active organization profile and settings' })
  get(@CurrentOrg() organizationId: string) {
    return this.organizations.getCurrent(organizationId);
  }

  @Patch()
  @RequirePermissions('organization.update')
  update(@CurrentAuth() auth: AuthContext, @Body() dto: OrganizationProfileDto) {
    return this.organizations.updateCurrent(auth, dto);
  }

  @Get('security-policy')
  @RequirePermissions('organization.view')
  securityPolicy() {
    return this.organizations.getSecurityPolicy();
  }

  @Put('security-policy')
  @RequirePermissions('organization.security.manage')
  updateSecurityPolicy(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateSecurityPolicyDto) {
    return this.organizations.updateSecurityPolicy(auth, dto);
  }

  @Get('subscription')
  @RequirePermissions('organization.view')
  @ApiOperation({ summary: 'Plan, user usage and module entitlements' })
  subscription(@CurrentAuth() auth: AuthContext) {
    return this.organizations.subscription(auth);
  }

  @Get('overview')
  @RequirePermissions('organization.view')
  @ApiOperation({ summary: 'Administration dashboard metrics' })
  overview(@CurrentAuth() auth: AuthContext) {
    return this.organizations.overview(auth);
  }
}

/** Serves logo images to <img> tags, which cannot send the bearer token. */
@ApiTags('Organization')
@Controller({ path: 'organizations', version: '1' })
export class OrganizationLogoController {
  constructor(private readonly logos: OrganizationLogoService) {}

  @Get(':id/logo')
  @Public()
  @ApiOperation({ summary: 'Organization logo image' })
  async logo(@Param('id', ParseUUIDPipe) id: string, @Query('v') version: string | undefined, @Req() req: Request, @Res() res: Response) {
    const logo = await this.logos.find(id);
    if (!logo) throw AppError.notFound('Logo');
    const etag = `"${logo.checksum}"`;
    res.set({
      ETag: etag,
      // Versioned URLs change with the content, so they can be cached forever.
      'Cache-Control': version ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.type(logo.contentType).send(logo.data);
  }
}
