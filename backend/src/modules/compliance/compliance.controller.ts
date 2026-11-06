import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FILING_FILE_MAX_BYTES, POLICY_FILE_MAX_BYTES } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { ComplianceCalendarService, type UploadedFilingFile } from './compliance-calendar.service';
import { AcknowledgeDto, CalendarQueryDto, FilingDto, ObligationDto, PolicyDraftDto, PolicyDto, PolicyQueryDto, TrackingQueryDto, UpdateObligationDto, UpdatePolicyDto } from './dto/compliance.dto';
import { PoliciesService, type UploadedPolicyFile } from './policies.service';

const UUID = new ParseUUIDPipe();
const POLICY_UPLOAD = FileInterceptor('file', { limits: { fileSize: POLICY_FILE_MAX_BYTES + 512 * 1024, files: 1, fields: 5 } });
const FILING_UPLOAD = FileInterceptor('file', { limits: { fileSize: FILING_FILE_MAX_BYTES + 512 * 1024, files: 1, fields: 10 } });
const attachment = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** HR views (policy lists, acknowledgement tracking, the statutory calendar): `compliance.manage`. */
function requireHr(auth: AuthContext) {
  if (!auth.features.has('compliance')) throw AppError.forbidden('Compliance is not enabled for your organization');
  if (!auth.permissions.has('compliance.manage')) throw AppError.forbidden();
}

@ApiTags('Compliance')
@ApiBearerAuth()
@Controller({ path: 'compliance', version: '1' })
export class ComplianceController {
  constructor(
    private readonly policies: PoliciesService,
    private readonly calendar: ComplianceCalendarService,
  ) {}

  // ---- Policies: employees ----------------------------------------------------------------------

  @Get('policies/mine')
  @RequirePermissions('compliance.view')
  @ApiOperation({ summary: 'Published policies that apply to me, with what I still have to acknowledge' })
  mine(@CurrentAuth() auth: AuthContext) {
    return this.policies.mine(auth);
  }

  @Get('policies/:id/read')
  @RequirePermissions('compliance.view')
  read(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.policies.read(auth, id);
  }

  @Post('policies/:id/acknowledge')
  @RequirePermissions('compliance.policy.acknowledge')
  acknowledge(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: AcknowledgeDto) {
    return this.policies.acknowledge(auth, id, dto);
  }

  @Get('policies/:id/versions/:versionId/file')
  @RequirePermissions('compliance.view')
  async policyFile(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('versionId', UUID) versionId: string) {
    const f = await this.policies.download(auth, id, versionId);
    return new StreamableFile(f.stream, { type: 'application/pdf', length: f.size, disposition: attachment(f.fileName) });
  }

  // ---- Policies: HR -----------------------------------------------------------------------------

  @Get('policies')
  @RequireTenant()
  listPolicies(@CurrentAuth() auth: AuthContext, @Query() query: PolicyQueryDto) {
    requireHr(auth);
    return this.policies.list(auth, query);
  }

  @Post('policies')
  @RequirePermissions('compliance.manage')
  createPolicy(@CurrentAuth() auth: AuthContext, @Body() dto: PolicyDto) {
    return this.policies.create(auth, dto);
  }

  @Get('policies/:id')
  @RequireTenant()
  policy(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireHr(auth);
    return this.policies.get(auth, id);
  }

  @Patch('policies/:id')
  @RequirePermissions('compliance.manage')
  updatePolicy(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdatePolicyDto) {
    return this.policies.update(auth, id, dto);
  }

  @Delete('policies/:id')
  @RequirePermissions('compliance.manage')
  async removePolicy(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.policies.remove(auth, id);
    return { deleted: true };
  }

  @Put('policies/:id/draft')
  @RequirePermissions('compliance.manage')
  @ApiOperation({ summary: 'Create or edit the draft of the next version' })
  saveDraft(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: PolicyDraftDto) {
    return this.policies.saveDraft(auth, id, dto);
  }

  @Delete('policies/:id/draft')
  @RequirePermissions('compliance.manage')
  discardDraft(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.policies.discardDraft(auth, id);
  }

  @Post('policies/:id/draft/file')
  @RequirePermissions('compliance.manage')
  @UseInterceptors(POLICY_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Attach the policy document (PDF up to 10 MB) to the draft' })
  uploadPolicyFile(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @UploadedFile() file?: UploadedPolicyFile) {
    return this.policies.uploadFile(auth, id, file);
  }

  @Delete('policies/:id/draft/file')
  @RequirePermissions('compliance.manage')
  removePolicyFile(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.policies.removeFile(auth, id);
  }

  @Post('policies/:id/publish')
  @RequirePermissions('compliance.manage')
  publish(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.policies.publish(auth, id);
  }

  @Post('policies/:id/retire')
  @RequirePermissions('compliance.manage')
  retire(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.policies.retire(auth, id);
  }

  @Post('policies/:id/reviewed')
  @RequirePermissions('compliance.manage')
  reviewed(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.policies.markReviewed(auth, id);
  }

  @Get('policies/:id/acknowledgements')
  @RequireTenant()
  tracking(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Query() query: TrackingQueryDto) {
    requireHr(auth);
    return this.policies.tracking(auth, id, query);
  }

  @Get('policies/:id/acknowledgements.csv')
  @RequireTenant()
  async trackingCsv(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireHr(auth);
    const f = await this.policies.trackingCsv(auth, id);
    return new StreamableFile(Buffer.from(`\uFEFF${f.content}`, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: attachment(f.fileName) });
  }

  @Post('policies/:id/remind')
  @RequirePermissions('compliance.manage')
  remind(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.policies.remind(auth, id);
  }

  // ---- Statutory calendar -----------------------------------------------------------------------

  @Get('calendar')
  @RequireTenant()
  @ApiOperation({ summary: 'Statutory due dates in a range, with filings and overdue items' })
  dueDates(@CurrentAuth() auth: AuthContext, @Query() query: CalendarQueryDto) {
    requireHr(auth);
    return this.calendar.calendar(auth, query);
  }

  @Get('obligations')
  @RequireTenant()
  obligations(@CurrentAuth() auth: AuthContext) {
    requireHr(auth);
    return this.calendar.obligations();
  }

  @Post('obligations')
  @RequirePermissions('compliance.manage')
  createObligation(@CurrentAuth() auth: AuthContext, @Body() dto: ObligationDto) {
    return this.calendar.create(auth, dto);
  }

  @Post('obligations/recommended')
  @RequirePermissions('compliance.manage')
  @ApiOperation({ summary: 'Add the recommended Indian statutory obligations (PF, ESI, TDS, Form 16, PT, POSH report)' })
  recommended(@CurrentAuth() auth: AuthContext) {
    return this.calendar.addRecommended(auth);
  }

  @Patch('obligations/:id')
  @RequirePermissions('compliance.manage')
  updateObligation(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateObligationDto) {
    return this.calendar.update(auth, id, dto);
  }

  @Delete('obligations/:id')
  @RequirePermissions('compliance.manage')
  async removeObligation(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.calendar.remove(auth, id);
    return { deleted: true };
  }

  @Post('obligations/:id/filings')
  @RequirePermissions('compliance.manage')
  @UseInterceptors(FILING_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Record a filing for a due date, optionally with the receipt (PDF / image up to 5 MB)' })
  file(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: FilingDto, @UploadedFile() file?: UploadedFilingFile) {
    return this.calendar.file(auth, id, dto, file);
  }

  @Delete('filings/:id')
  @RequirePermissions('compliance.manage')
  async unfile(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.calendar.unfile(auth, id);
    return { deleted: true };
  }

  @Get('filings/:id/file')
  @RequireTenant()
  async filingFile(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireHr(auth);
    const f = await this.calendar.download(id);
    return new StreamableFile(f.stream, { type: f.contentType, length: f.size, disposition: attachment(f.fileName) });
  }
}
