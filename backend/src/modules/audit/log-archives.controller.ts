import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireStepUp } from '../../common/auth/decorators';
import { CreateLogArchiveDto, LogArchiveListDto, PurgeLogArchiveDto } from './dto/log-archive.dto';
import { LogArchivesService } from './log-archives.service';

const attachment = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

@ApiTags('Audit')
@ApiBearerAuth()
@Controller({ path: 'log-archives', version: '1' })
export class LogArchivesController {
  constructor(private readonly archives: LogArchivesService) {}

  @Get()
  @RequirePermissions('audit.purge')
  list(@CurrentAuth() auth: AuthContext, @Query() query: LogArchiveListDto) {
    return this.archives.list(auth, query.kind);
  }

  @Get('preview')
  @RequirePermissions('audit.purge')
  @ApiOperation({ summary: 'How many records an archive up to a date would hold' })
  preview(@CurrentAuth() auth: AuthContext, @Query() query: CreateLogArchiveDto) {
    return this.archives.preview(auth, query.kind, query.before);
  }

  @Post()
  @RequirePermissions('audit.purge')
  @ApiOperation({ summary: 'Save the records created before a date to a CSV archive file (nothing is deleted)' })
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateLogArchiveDto) {
    return this.archives.create(auth, dto.kind, dto.before);
  }

  @Get(':id/file')
  @RequirePermissions('audit.purge')
  @RequireStepUp()
  async file(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const { archive, stream } = await this.archives.download(auth, id);
    return new StreamableFile(stream, { type: 'text/csv; charset=utf-8', length: archive.sizeBytes, disposition: attachment(archive.fileName) });
  }

  @Post(':id/purge')
  @RequirePermissions('audit.purge')
  @RequireStepUp()
  @ApiOperation({ summary: 'Delete the archived records (the archive file must have been downloaded)' })
  purge(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PurgeLogArchiveDto) {
    return this.archives.purge(auth, id, dto.recordCount);
  }
}
