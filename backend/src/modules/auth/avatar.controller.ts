import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthContext } from '../../common/auth/auth-context';
import { Authenticated, CurrentAuth, Public } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import type { UploadedImage } from '../organizations/organization-logo.service';
import { AVATAR_UPLOAD_LIMIT_BYTES, AvatarService } from './avatar.service';

@ApiTags('Auth')
@ApiBearerAuth()
@Authenticated()
@Controller({ path: 'auth/me/avatar', version: '1' })
export class MyAvatarController {
  constructor(private readonly avatars: AvatarService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: AVATAR_UPLOAD_LIMIT_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload or replace your profile photo (PNG, JPEG or WebP, up to 5 MB; cropped square and stored as WebP)' })
  upload(@CurrentAuth() auth: AuthContext, @UploadedFile() file?: UploadedImage) {
    return this.avatars.upload(auth, file);
  }

  @Delete()
  @ApiOperation({ summary: 'Remove your profile photo' })
  async remove(@CurrentAuth() auth: AuthContext) {
    await this.avatars.remove(auth);
    return { removed: true };
  }
}

/** Serves profile photos to <img> tags, which can't send the bearer token; the URL's version is required. */
@ApiTags('Auth')
@Controller({ path: 'users', version: '1' })
export class UserAvatarController {
  constructor(private readonly avatars: AvatarService) {}

  @Get(':id/avatar')
  @Public()
  @ApiOperation({ summary: 'Profile photo image (needs the `v` from the photo URL)' })
  async avatar(@Param('id', ParseUUIDPipe) id: string, @Query('v') version: string | undefined, @Req() req: Request, @Res() res: Response) {
    const avatar = await this.avatars.find(id, version);
    if (!avatar) throw AppError.notFound('Photo');
    const etag = `"${avatar.checksum}"`;
    res.set({
      ETag: etag,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      // The web app may be served from another origin than the API.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.type(avatar.contentType).send(avatar.data);
  }
}
