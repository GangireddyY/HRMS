import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { Organization } from '../../database/models';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RESUME_MAX_BYTES } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, Public, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { CandidatesService, type UploadedResume } from './candidates.service';
import { CareersService } from './careers.service';
import {
  AddApplicationDto,
  ApplicationQueryDto,
  CandidateDto,
  CandidateQueryDto,
  DuplicateQueryDto,
  FeedbackDto,
  HireDto,
  InterviewDto,
  JobDto,
  JobQueryDto,
  JobStatusDto,
  MoveStageDto,
  LetterTemplateDto,
  OfferApprovalNoteDto,
  OfferDto,
  OfferResponseDto,
  PortalAcceptDto,
  PortalDeclineDto,
  PortalDocumentDto,
  PrejoiningDetailsDto,
  PublicApplicationDto,
  RecruitmentSettingsDto,
  RejectOfferApprovalDto,
  RequisitionDto,
  RequisitionQueryDto,
  ReviewRequisitionDto,
  UpdateCandidateDto,
  UpdateInterviewDto,
  UpdateJobDto,
  UpdateOfferDto,
  UpdateRequisitionDto,
} from './dto/recruitment.dto';
import { JobsService } from './jobs.service';
import { OfferPortalService } from './offer-portal.service';
import { OffersService } from './offers.service';
import { PipelineService } from './pipeline.service';
import { RequisitionsService } from './requisitions.service';

const UUID = new ParseUUIDPipe();
const RESUME_UPLOAD = FileInterceptor('file', { limits: { fileSize: RESUME_MAX_BYTES + 512 * 1024, files: 1, fields: 20 } });
const attachment = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

@ApiTags('Recruitment')
@ApiBearerAuth()
@Controller({ path: 'recruitment', version: '1' })
export class RecruitmentController {
  constructor(
    private readonly requisitions: RequisitionsService,
    private readonly jobs: JobsService,
    private readonly candidates: CandidatesService,
    private readonly pipeline: PipelineService,
    private readonly offers: OffersService,
  ) {}

  // ---- Requisitions (requesters, approvers and recruiters; visibility is decided per row) --------

  @Get('requisitions')
  @RequireTenant()
  listRequisitions(@CurrentAuth() auth: AuthContext, @Query() query: RequisitionQueryDto) {
    return this.requisitions.list(auth, query);
  }

  @Post('requisitions')
  @RequirePermissions('recruitment.requisition.create')
  createRequisition(@CurrentAuth() auth: AuthContext, @Body() dto: RequisitionDto) {
    return this.requisitions.create(auth, dto);
  }

  @Get('requisitions/:id')
  @RequireTenant()
  requisition(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.requisitions.get(auth, id);
  }

  @Patch('requisitions/:id')
  @RequirePermissions('recruitment.requisition.create')
  updateRequisition(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateRequisitionDto) {
    return this.requisitions.update(auth, id, dto);
  }

  @Post('requisitions/:id/approve')
  @RequirePermissions('recruitment.requisition.approve')
  approveRequisition(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReviewRequisitionDto) {
    return this.requisitions.approve(auth, id, dto);
  }

  @Post('requisitions/:id/reject')
  @RequirePermissions('recruitment.requisition.approve')
  rejectRequisition(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReviewRequisitionDto) {
    return this.requisitions.reject(auth, id, dto);
  }

  @Post('requisitions/:id/cancel')
  @RequireTenant()
  cancelRequisition(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.requisitions.cancel(auth, id);
  }

  // ---- Jobs ------------------------------------------------------------------------------------

  @Get('jobs')
  @RequirePermissions('recruitment.view')
  listJobs(@Query() query: JobQueryDto) {
    return this.jobs.list(query);
  }

  @Post('jobs')
  @RequirePermissions('recruitment.manage')
  createJob(@CurrentAuth() auth: AuthContext, @Body() dto: JobDto) {
    return this.jobs.create(auth, dto);
  }

  @Get('jobs/:id')
  @RequirePermissions('recruitment.view')
  job(@Param('id', UUID) id: string) {
    return this.jobs.get(id);
  }

  @Patch('jobs/:id')
  @RequirePermissions('recruitment.manage')
  updateJob(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateJobDto) {
    return this.jobs.update(auth, id, dto);
  }

  @Post('jobs/:id/status')
  @RequirePermissions('recruitment.manage')
  @ApiOperation({ summary: 'Open, put on hold, close or reopen a job' })
  jobStatus(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: JobStatusDto) {
    return this.jobs.setStatus(auth, id, dto.status);
  }

  @Post('jobs/:id/applications')
  @RequirePermissions('recruitment.manage')
  addApplication(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: AddApplicationDto) {
    return this.pipeline.add(auth, id, dto);
  }

  // ---- Candidates ------------------------------------------------------------------------------

  @Get('candidates')
  @RequirePermissions('recruitment.view')
  listCandidates(@Query() query: CandidateQueryDto) {
    return this.candidates.list(query);
  }

  @Get('candidates/duplicates')
  @RequirePermissions('recruitment.view')
  @ApiOperation({ summary: 'Existing candidates with the same email or phone' })
  duplicates(@Query() query: DuplicateQueryDto) {
    return this.candidates.duplicates(query.email, query.phone);
  }

  @Post('resumes/parse')
  @RequirePermissions('recruitment.manage')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(RESUME_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Read candidate details from a resume (PDF or .docx) to prefill the candidate form; the file is not kept' })
  parseResume(@UploadedFile() file?: UploadedResume) {
    return this.candidates.parseResume(file);
  }

  @Post('candidates')
  @RequirePermissions('recruitment.manage')
  createCandidate(@CurrentAuth() auth: AuthContext, @Body() dto: CandidateDto) {
    return this.candidates.create(auth, dto);
  }

  @Get('candidates/:id')
  @RequirePermissions('recruitment.view')
  candidate(@Param('id', UUID) id: string) {
    return this.candidates.get(id);
  }

  @Patch('candidates/:id')
  @RequirePermissions('recruitment.manage')
  updateCandidate(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateCandidateDto) {
    return this.candidates.update(auth, id, dto);
  }

  @Delete('candidates/:id')
  @RequirePermissions('recruitment.manage')
  @ApiOperation({ summary: 'Delete a candidate with their applications and resume (not hired candidates)' })
  async removeCandidate(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.candidates.remove(auth, id);
    return { deleted: true };
  }

  @Post('candidates/:id/resume')
  @RequirePermissions('recruitment.manage')
  @UseInterceptors(RESUME_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  uploadResume(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @UploadedFile() file?: UploadedResume) {
    return this.candidates.replaceResume(auth, id, file);
  }

  @Get('candidates/:id/resume')
  @RequirePermissions('recruitment.view')
  async resume(@Param('id', UUID) id: string) {
    const r = await this.candidates.resume(id);
    return new StreamableFile(r.stream, { type: r.contentType, length: r.size, disposition: attachment(r.fileName) });
  }

  // ---- Applications & interviews ---------------------------------------------------------------

  @Get('applications')
  @RequirePermissions('recruitment.view')
  applications(@Query() query: ApplicationQueryDto) {
    return this.pipeline.list(query);
  }

  @Get('applications/:id')
  @RequirePermissions('recruitment.view')
  application(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.pipeline.get(auth, id);
  }

  @Post('applications/:id/stage')
  @RequirePermissions('recruitment.manage')
  move(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: MoveStageDto) {
    return this.pipeline.move(auth, id, dto);
  }

  @Post('applications/:id/interviews')
  @RequirePermissions('recruitment.manage')
  schedule(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: InterviewDto) {
    return this.pipeline.schedule(auth, id, dto);
  }

  @Patch('interviews/:id')
  @RequirePermissions('recruitment.manage')
  updateInterview(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateInterviewDto) {
    return this.pipeline.updateInterview(auth, id, dto);
  }

  @Post('interviews/:id/cancel')
  @RequirePermissions('recruitment.manage')
  cancelInterview(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.pipeline.setInterviewStatus(auth, id, 'CANCELLED');
  }

  @Post('interviews/:id/complete')
  @RequirePermissions('recruitment.manage')
  completeInterview(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.pipeline.setInterviewStatus(auth, id, 'COMPLETED');
  }

  @Get('my-interviews')
  @RequirePermissions('recruitment.interview.feedback')
  @ApiOperation({ summary: 'Interviews where you are on the panel' })
  myInterviews(@CurrentAuth() auth: AuthContext) {
    return this.pipeline.mine(auth);
  }

  @Post('interviews/:id/feedback')
  @RequirePermissions('recruitment.interview.feedback')
  @ApiOperation({ summary: 'Submit your feedback as a panelist (once)' })
  feedback(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: FeedbackDto) {
    return this.pipeline.submitFeedback(auth, id, dto);
  }

  @Get('interviews/:id/resume')
  @RequirePermissions('recruitment.interview.feedback')
  async interviewResume(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    const r = await this.pipeline.interviewResume(auth, id);
    return new StreamableFile(r.stream, { type: r.contentType, length: r.size, disposition: attachment(r.fileName) });
  }

  // ---- Offers ----------------------------------------------------------------------------------

  @Post('applications/:id/offers')
  @RequirePermissions('recruitment.offer.manage')
  createOffer(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: OfferDto) {
    return this.offers.create(auth, id, dto);
  }

  @Get('offers/awaiting-approval')
  @RequireTenant()
  @ApiOperation({ summary: 'Offers waiting for your approval (your approval-chain step, or any pending offer you may approve)' })
  offersAwaiting(@CurrentAuth() auth: AuthContext) {
    return this.offers.awaitingMe(auth);
  }

  @Get('offers/:id')
  @RequireTenant()
  async offer(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.offers.readable(auth, id);
    return this.offers.get(id, auth);
  }

  @Patch('offers/:id')
  @RequirePermissions('recruitment.offer.manage')
  updateOffer(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateOfferDto) {
    return this.offers.update(auth, id, dto);
  }

  @Post('offers/:id/release')
  @RequirePermissions('recruitment.offer.manage')
  releaseOffer(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.offers.release(auth, id);
  }

  @Post('offers/:id/response')
  @RequirePermissions('recruitment.offer.manage')
  @ApiOperation({ summary: "Record the candidate's answer (accepted / declined)" })
  respondOffer(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: OfferResponseDto) {
    return this.offers.respond(auth, id, dto);
  }

  @Post('offers/:id/withdraw')
  @RequirePermissions('recruitment.offer.manage')
  withdrawOffer(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.offers.withdraw(auth, id);
  }

  @Post('offers/:id/hire')
  @RequirePermissions('recruitment.offer.manage', 'employee.create')
  @ApiOperation({ summary: 'Convert an accepted offer into an employee (optionally starting onboarding)' })
  hire(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: HireDto) {
    return this.offers.hire(auth, id, dto);
  }

  @Post('offers/:id/submit-approval')
  @RequirePermissions('recruitment.offer.manage')
  @ApiOperation({ summary: 'Send a draft offer for approval (required by the organization setting or above the requisition budget)' })
  submitOfferApproval(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.offers.submitForApproval(auth, id);
  }

  @Post('offers/:id/approve')
  @RequireTenant()
  approveOffer(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: OfferApprovalNoteDto) {
    return this.offers.approve(auth, id, dto);
  }

  @Post('offers/:id/reject-approval')
  @RequireTenant()
  rejectOfferApproval(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: RejectOfferApprovalDto) {
    return this.offers.rejectApproval(auth, id, dto);
  }

  @Post('offers/:id/resend-link')
  @RequirePermissions('recruitment.offer.manage')
  @ApiOperation({ summary: 'Issue the candidate a new private offer link (the old one stops working)' })
  resendOfferLink(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.offers.resendLink(auth, id);
  }

  @Get('offers/:id/letter')
  @RequirePermissions('recruitment.offer.manage')
  @ApiOperation({ summary: 'The offer letter (HTML): as released, or a preview for drafts' })
  async offerLetter(@Param('id', UUID) id: string) {
    const f = await this.offers.letter(id);
    return new StreamableFile(Buffer.from(f.html, 'utf8'), { type: 'text/html; charset=utf-8', disposition: attachment(f.fileName) });
  }

  @Get('offers/:id/prejoining')
  @RequirePermissions('recruitment.offer.manage')
  @ApiOperation({ summary: 'Details and documents the candidate shared before joining (audited)' })
  prejoining(@Param('id', UUID) id: string) {
    return this.offers.prejoining(id);
  }

  @Get('offers/:id/prejoining/documents/:documentId')
  @RequirePermissions('recruitment.offer.manage')
  async prejoiningDocument(@Param('id', UUID) id: string, @Param('documentId', UUID) documentId: string) {
    const f = await this.offers.prejoiningDocument(id, documentId);
    return new StreamableFile(f.stream, { type: f.contentType, length: f.size, disposition: attachment(f.fileName) });
  }

  @Get('offer-letter-template')
  @RequirePermissions('recruitment.offer.manage')
  letterTemplate() {
    return this.offers.letterTemplate();
  }

  @Put('offer-letter-template')
  @RequirePermissions('recruitment.offer.manage')
  saveLetterTemplate(@CurrentAuth() auth: AuthContext, @Body() dto: LetterTemplateDto) {
    return this.offers.saveLetterTemplate(auth, dto);
  }

  @Get('settings')
  @RequirePermissions('recruitment.offer.manage')
  async settings(@CurrentAuth() auth: AuthContext) {
    const org = await Organization.findByPk(auth.organizationId!, { attributes: ['offerApprovalRequired'] });
    return { offerApprovalRequired: org?.offerApprovalRequired ?? false };
  }

  @Put('settings')
  @RequirePermissions('recruitment.offer.approve')
  @ApiOperation({ summary: 'Whether every offer needs approval before release (approvers decide)' })
  async saveSettings(@CurrentAuth() auth: AuthContext, @Body() dto: RecruitmentSettingsDto) {
    await this.offers.saveSettings(auth, dto.offerApprovalRequired);
    return { offerApprovalRequired: dto.offerApprovalRequired };
  }
}

/** The candidate's private offer page: sign or decline, then share details and documents before joining (no sign-in). */
@ApiTags('Offer portal')
@Controller({ path: 'offer-portal', version: '1' })
export class OfferPortalController {
  constructor(private readonly portal: OfferPortalService) {}

  @Get(':token')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  view(@Param('token') token: string) {
    return this.portal.view(token);
  }

  @Post(':token/accept')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Accept and sign the offer by typing your full name' })
  accept(@Param('token') token: string, @Body() dto: PortalAcceptDto, @Req() req: Request) {
    return this.portal.accept(token, dto, req.ip, req.headers['user-agent']);
  }

  @Post(':token/decline')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  decline(@Param('token') token: string, @Body() dto: PortalDeclineDto) {
    return this.portal.decline(token, dto);
  }

  @Put(':token/details')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Personal details for joining (after accepting)' })
  details(@Param('token') token: string, @Body() dto: PrejoiningDetailsDto) {
    return this.portal.saveDetails(token, dto);
  }

  @Post(':token/documents')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(RESUME_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document for joining (PDF or image up to 5 MB)' })
  upload(@Param('token') token: string, @Body() dto: PortalDocumentDto, @UploadedFile() file?: UploadedResume) {
    return this.portal.uploadDocument(token, dto, file);
  }

  @Delete(':token/documents/:documentId')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  removeDocument(@Param('token') token: string, @Param('documentId', UUID) documentId: string) {
    return this.portal.removeDocument(token, documentId);
  }
}

/** Public careers pages (no sign-in). */
@ApiTags('Careers')
@Controller({ path: 'careers', version: '1' })
export class CareersController {
  constructor(private readonly careers: CareersService) {}

  @Get(':slug')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  page(@Param('slug') slug: string) {
    return this.careers.page(slug);
  }

  @Get(':slug/jobs/:jobId')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  job(@Param('slug') slug: string, @Param('jobId', UUID) jobId: string) {
    return this.careers.job(slug, jobId);
  }

  @Post(':slug/jobs/:jobId/apply')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(RESUME_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Apply for a public job with a resume (PDF or .docx, up to 5 MB)' })
  apply(@Param('slug') slug: string, @Param('jobId', UUID) jobId: string, @Body() dto: PublicApplicationDto, @UploadedFile() file?: UploadedResume) {
    return this.careers.apply(slug, jobId, dto, file);
  }
}
