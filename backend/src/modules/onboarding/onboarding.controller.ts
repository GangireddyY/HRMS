import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { DOCUMENT_UPLOAD_LIMIT_BYTES, type UploadedDocumentFile } from '../employees/employee-documents.service';
import {
  CancelCaseDto,
  CaseQueryDto,
  CaseTaskDto,
  DecideReviewDto,
  ProbationQueryDto,
  ProbationReviewDto,
  ProbationReviewQueryDto,
  StartCaseDto,
  TaskActionDto,
  TemplateDto,
  UpdateCaseDto,
  UpdateCaseTaskDto,
  UpdateTemplateDto,
  VerifyTaskDocumentDto,
} from './dto/onboarding.dto';
import { OnboardingCasesService } from './onboarding-cases.service';
import { OnboardingTemplatesService } from './onboarding-templates.service';
import { ProbationService } from './probation.service';

const UUID = new ParseUUIDPipe();
const attachment = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/**
 * Routes used by joiners and their managers check access in the service (self-service / direct manager) and require the
 * onboarding module entitlement; HR routes require onboarding permissions.
 */
@ApiTags('Onboarding')
@ApiBearerAuth()
@Controller({ path: 'onboarding', version: '1' })
export class OnboardingController {
  constructor(
    private readonly templates: OnboardingTemplatesService,
    private readonly cases: OnboardingCasesService,
    private readonly probation: ProbationService,
  ) {}

  // ---- Checklist templates ---------------------------------------------------------------------

  @Get('templates')
  @RequirePermissions('onboarding.view')
  listTemplates() {
    return this.templates.list();
  }

  @Post('templates')
  @RequirePermissions('onboarding.manage')
  createTemplate(@CurrentAuth() auth: AuthContext, @Body() dto: TemplateDto) {
    return this.templates.create(auth, dto);
  }

  @Post('templates/recommended')
  @RequirePermissions('onboarding.manage')
  @ApiOperation({ summary: 'Create the recommended standard checklist (if it does not exist yet)' })
  addRecommended(@CurrentAuth() auth: AuthContext) {
    return this.templates.addRecommended(auth);
  }

  @Get('templates/:id')
  @RequirePermissions('onboarding.view')
  template(@Param('id', UUID) id: string) {
    return this.templates.get(id);
  }

  @Put('templates/:id')
  @RequirePermissions('onboarding.manage')
  updateTemplate(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateTemplateDto) {
    return this.templates.update(auth, id, dto);
  }

  @Delete('templates/:id')
  @RequirePermissions('onboarding.manage')
  async removeTemplate(@Param('id', UUID) id: string) {
    await this.templates.remove(id);
    return { deleted: true };
  }

  // ---- Self-service & managers -----------------------------------------------------------------

  @Get('me')
  @RequireTenant()
  @ApiOperation({ summary: "The signed-in employee's own onboarding (null when there is none)" })
  mine(@CurrentAuth() auth: AuthContext) {
    return this.cases.mine(auth);
  }

  @Get('team-tasks')
  @RequireTenant()
  @ApiOperation({ summary: 'Manager tasks in the onboarding of your direct reports' })
  teamTasks(@CurrentAuth() auth: AuthContext) {
    return this.cases.managerTasks(auth);
  }

  // ---- Cases -----------------------------------------------------------------------------------

  @Get('cases')
  @RequirePermissions('onboarding.view')
  list(@CurrentAuth() auth: AuthContext, @Query() query: CaseQueryDto) {
    return this.cases.list(auth, query);
  }

  @Get('joiners')
  @RequirePermissions('onboarding.view', 'onboarding.manage')
  @ApiOperation({ summary: 'Recent and upcoming joiners without an onboarding case' })
  joiners(@CurrentAuth() auth: AuthContext) {
    return this.cases.joiners(auth);
  }

  @Post('cases')
  @RequirePermissions('onboarding.view', 'onboarding.manage')
  start(@CurrentAuth() auth: AuthContext, @Body() dto: StartCaseDto) {
    return this.cases.start(auth, dto);
  }

  @Get('cases/:id')
  @RequireTenant()
  get(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.cases.get(auth, id);
  }

  @Patch('cases/:id')
  @RequirePermissions('onboarding.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateCaseDto) {
    return this.cases.update(auth, id, dto);
  }

  @Post('cases/:id/complete')
  @RequirePermissions('onboarding.manage')
  complete(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.cases.complete(auth, id);
  }

  @Post('cases/:id/cancel')
  @RequirePermissions('onboarding.manage')
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: CancelCaseDto) {
    return this.cases.cancel(auth, id, dto);
  }

  @Post('cases/:id/tasks')
  @RequirePermissions('onboarding.manage')
  addTask(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: CaseTaskDto) {
    return this.cases.addTask(auth, id, dto);
  }

  @Patch('tasks/:taskId')
  @RequirePermissions('onboarding.manage')
  updateTask(@CurrentAuth() auth: AuthContext, @Param('taskId', UUID) taskId: string, @Body() dto: UpdateCaseTaskDto) {
    return this.cases.updateTask(auth, taskId, dto);
  }

  @Delete('tasks/:taskId')
  @RequirePermissions('onboarding.manage')
  removeTask(@CurrentAuth() auth: AuthContext, @Param('taskId', UUID) taskId: string) {
    return this.cases.removeTask(auth, taskId);
  }

  @Post('tasks/:taskId/complete')
  @RequireTenant()
  @ApiOperation({ summary: 'Complete a task (its assignee: the employee, their manager or HR)' })
  completeTask(@CurrentAuth() auth: AuthContext, @Param('taskId', UUID) taskId: string, @Body() dto: TaskActionDto) {
    return this.cases.completeTask(auth, taskId, dto);
  }

  @Post('tasks/:taskId/reopen')
  @RequireTenant()
  reopenTask(@CurrentAuth() auth: AuthContext, @Param('taskId', UUID) taskId: string) {
    return this.cases.reopenTask(auth, taskId);
  }

  @Post('tasks/:taskId/skip')
  @RequirePermissions('onboarding.manage')
  skipTask(@CurrentAuth() auth: AuthContext, @Param('taskId', UUID) taskId: string, @Body() dto: TaskActionDto) {
    return this.cases.skipTask(auth, taskId, dto);
  }

  @Post('tasks/:taskId/document')
  @RequireTenant()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DOCUMENT_UPLOAD_LIMIT_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload the document a task asks for (PDF, PNG, JPG or WebP, up to 10 MB)' })
  uploadTaskDocument(@CurrentAuth() auth: AuthContext, @Param('taskId', UUID) taskId: string, @UploadedFile() file?: UploadedDocumentFile) {
    return this.cases.uploadTaskDocument(auth, taskId, file);
  }

  @Get('tasks/:taskId/document')
  @RequireTenant()
  async downloadTaskDocument(@CurrentAuth() auth: AuthContext, @Param('taskId', UUID) taskId: string) {
    const { doc, stream } = await this.cases.downloadTaskDocument(auth, taskId);
    return new StreamableFile(stream, { type: doc.contentType, length: doc.byteSize, disposition: attachment(doc.fileName) });
  }

  @Post('tasks/:taskId/verify')
  @RequirePermissions('onboarding.document.verify')
  @ApiOperation({ summary: 'Verify or reject the document submitted for a task (the employee is notified)' })
  verifyTaskDocument(@CurrentAuth() auth: AuthContext, @Param('taskId', UUID) taskId: string, @Body() dto: VerifyTaskDocumentDto) {
    return this.cases.verifyTaskDocument(auth, taskId, dto);
  }

  // ---- Probation -------------------------------------------------------------------------------

  @Get('probation')
  @RequireTenant()
  @ApiOperation({ summary: 'Unconfirmed employees whose probation ends soon (in scope, or your direct reports)' })
  probationDue(@CurrentAuth() auth: AuthContext, @Query() query: ProbationQueryDto) {
    return this.probation.due(auth, query.days ?? 60);
  }

  @Post('probation/reviews')
  @RequireTenant()
  @ApiOperation({ summary: "Recommend confirming or extending probation (the employee's manager or HR)" })
  submitReview(@CurrentAuth() auth: AuthContext, @Body() dto: ProbationReviewDto) {
    return this.probation.submit(auth, dto);
  }

  @Get('probation/reviews')
  @RequireTenant()
  reviews(@CurrentAuth() auth: AuthContext, @Query() query: ProbationReviewQueryDto) {
    return this.probation.list(auth, query);
  }

  @Post('probation/reviews/:id/approve')
  @RequirePermissions('onboarding.confirmation.approve')
  approveReview(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: DecideReviewDto) {
    return this.probation.approve(auth, id, dto);
  }

  @Post('probation/reviews/:id/reject')
  @RequirePermissions('onboarding.confirmation.approve')
  rejectReview(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: DecideReviewDto) {
    return this.probation.reject(auth, id, dto);
  }

  @Post('probation/reviews/:id/cancel')
  @RequireTenant()
  cancelReview(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.probation.cancel(auth, id);
  }
}
