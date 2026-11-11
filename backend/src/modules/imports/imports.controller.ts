import { Controller, Get, HttpCode, Param, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequireTenant } from '../../common/auth/decorators';
import { IMPORT_FILE_MAX_BYTES } from '../employees/employee-import.service';
import { ImportsService } from './imports.service';

const KEY = /^[a-z-]{2,40}$/;
const UPLOAD = FileInterceptor('file', { limits: { fileSize: IMPORT_FILE_MAX_BYTES, files: 1 } });

@ApiTags('Imports')
@ApiBearerAuth()
@Controller({ path: 'imports', version: '1' })
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get()
  @RequireTenant()
  @ApiOperation({ summary: 'Imports you can run (each checks its own permissions)' })
  list(@CurrentAuth() auth: AuthContext) {
    return this.imports.available(auth);
  }

  @Get(':key/template')
  @RequireTenant()
  async template(@CurrentAuth() auth: AuthContext, @Param('key') key: string) {
    const t = await this.imports.template(auth, KEY.test(key) ? key : 'unknown');
    return new StreamableFile(Buffer.from(`\uFEFF${t.content}`, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${t.fileName}"` });
  }

  @Post(':key')
  @RequireTenant()
  @HttpCode(200)
  @UseInterceptors(UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Check (dryRun=true) or import a CSV; nothing is applied if any row has a problem' })
  run(@CurrentAuth() auth: AuthContext, @Param('key') key: string, @UploadedFile() file: { buffer: Buffer; size: number } | undefined, @Query('dryRun') dryRun?: string) {
    return this.imports.import(auth, KEY.test(key) ? key : 'unknown', file, dryRun === 'true');
  }
}
