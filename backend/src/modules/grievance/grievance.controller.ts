import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GRIEVANCE_ATTACHMENT_MAX_BYTES } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { AssignDto, AttachmentDto, ColleagueQueryDto, GrievanceDto, GrievanceQueryDto, NoteDto, PoshReportQueryDto, ReasonDto, ReopenDto, ResolveDto, UpdateGrievanceDto } from './dto/grievance.dto';
import { GrievancesService, type UploadedEvidence } from './grievances.service';

const UUID = new ParseUUIDPipe();
const EVIDENCE_UPLOAD = FileInterceptor('file', { limits: { fileSize: GRIEVANCE_ATTACHMENT_MAX_BYTES + 512 * 1024, files: 1, fields: 5 } });
const attachment = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
const ANY = ['grievance.submit', 'grievance.view', 'grievance.manage', 'grievance.posh.access'];
const HANDLERS = ['grievance.view', 'grievance.manage', 'grievance.posh.access'];

/** Grievance module entitlement plus any of the permissions (case-level access is decided by the service). */
function requireAny(auth: AuthContext, permissions: string[]) {
  if (!auth.features.has('grievance')) throw AppError.forbidden('Grievance management is not enabled for your organization');
  if (!permissions.some((p) => auth.permissions.has(p))) throw AppError.forbidden();
}

@ApiTags('Grievances')
@ApiBearerAuth()
@Controller({ path: 'grievances', version: '1' })
export class GrievanceController {
  constructor(private readonly grievances: GrievancesService) {}

  // ---- Employees --------------------------------------------------------------------------------

  @Post()
  @RequirePermissions('grievance.submit')
  @ApiOperation({ summary: 'Raise a grievance or a POSH complaint (POSH goes only to the Internal Committee)' })
  create(@CurrentAuth() auth: AuthContext, @Body() dto: GrievanceDto) {
    return this.grievances.create(auth, dto);
  }

  @Get('mine')
  @RequirePermissions('grievance.submit')
  mine(@CurrentAuth() auth: AuthContext, @Query() query: PaginationQueryDto) {
    return this.grievances.mine(auth, query);
  }

  @Get('colleagues')
  @RequirePermissions('grievance.submit')
  @ApiOperation({ summary: 'Colleagues a complaint can be about (names and roles only)' })
  colleagues(@CurrentAuth() auth: AuthContext, @Query() query: ColleagueQueryDto) {
    return this.grievances.colleagues(auth, query.search);
  }

  @Get('committee')
  @RequireTenant()
  @ApiOperation({ summary: 'Internal Committee members (names only)' })
  committee(@CurrentAuth() auth: AuthContext) {
    requireAny(auth, ANY);
    return this.grievances.committee();
  }

  // ---- Handlers ---------------------------------------------------------------------------------

  @Get()
  @RequireTenant()
  list(@CurrentAuth() auth: AuthContext, @Query() query: GrievanceQueryDto) {
    requireAny(auth, HANDLERS);
    return this.grievances.list(auth, query);
  }

  @Get('stats')
  @RequireTenant()
  stats(@CurrentAuth() auth: AuthContext) {
    requireAny(auth, HANDLERS);
    return this.grievances.stats(auth);
  }

  @Get('posh-report')
  @RequirePermissions('grievance.posh.access')
  @ApiOperation({ summary: 'POSH annual report figures for a calendar year (section 21)' })
  poshReport(@CurrentAuth() auth: AuthContext, @Query() query: PoshReportQueryDto) {
    return this.grievances.poshReport(auth, query.year);
  }

  @Get(':id')
  @RequireTenant()
  get(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, ANY);
    return this.grievances.get(auth, id);
  }

  @Get(':id/handlers')
  @RequireTenant()
  handlers(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, HANDLERS);
    return this.grievances.handlers(auth, id);
  }

  @Post(':id/assign')
  @RequireTenant()
  assign(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: AssignDto) {
    requireAny(auth, HANDLERS);
    return this.grievances.assign(auth, id, dto);
  }

  @Patch(':id')
  @RequireTenant()
  update(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateGrievanceDto) {
    requireAny(auth, HANDLERS);
    return this.grievances.update(auth, id, dto);
  }

  @Post(':id/acknowledge')
  @RequireTenant()
  acknowledge(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, HANDLERS);
    return this.grievances.acknowledge(auth, id);
  }

  @Post(':id/investigate')
  @RequireTenant()
  investigate(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, HANDLERS);
    return this.grievances.investigate(auth, id);
  }

  @Post(':id/resolve')
  @RequireTenant()
  resolve(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ResolveDto) {
    requireAny(auth, HANDLERS);
    return this.grievances.resolve(auth, id, dto);
  }

  @Post(':id/close')
  @RequireTenant()
  close(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, HANDLERS);
    return this.grievances.close(auth, id);
  }

  // ---- Complainant actions ----------------------------------------------------------------------

  @Post(':id/withdraw')
  @RequirePermissions('grievance.submit')
  withdraw(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReasonDto) {
    return this.grievances.withdraw(auth, id, dto);
  }

  @Post(':id/accept')
  @RequirePermissions('grievance.submit')
  accept(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.grievances.accept(auth, id);
  }

  @Post(':id/reopen')
  @RequirePermissions('grievance.submit')
  reopen(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReopenDto) {
    return this.grievances.reopen(auth, id, dto);
  }

  // ---- Notes & evidence -------------------------------------------------------------------------

  @Post(':id/notes')
  @RequireTenant()
  addNote(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: NoteDto) {
    requireAny(auth, ANY);
    return this.grievances.addNote(auth, id, dto);
  }

  @Post(':id/attachments')
  @RequireTenant()
  @UseInterceptors(EVIDENCE_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Add evidence (PDF / image up to 5 MB)' })
  upload(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: AttachmentDto, @UploadedFile() file?: UploadedEvidence) {
    requireAny(auth, ANY);
    return this.grievances.upload(auth, id, dto, file);
  }

  @Get(':id/attachments/:attachmentId')
  @RequireTenant()
  async download(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('attachmentId', UUID) attachmentId: string) {
    requireAny(auth, ANY);
    const f = await this.grievances.download(auth, id, attachmentId);
    return new StreamableFile(f.stream, { type: f.contentType, length: f.size, disposition: attachment(f.fileName) });
  }
}
