import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { CyclesService } from './cycles.service';
import {
  AcknowledgeDto,
  AddParticipantsDto,
  AssessmentDto,
  CalibrateDto,
  CheckInDto,
  ClosePipDto,
  CycleDto,
  CycleQueryDto,
  FeedbackRequestDto,
  GiveFeedbackDto,
  GoalDto,
  GoalProgressDto,
  ManagerAssessmentDto,
  PipDto,
  PipQueryDto,
  PotentialDto,
  ReassignReviewerDto,
  ReturnGoalsDto,
  ReviewQueryDto,
  UpdateCycleDto,
  UpdateGoalDto,
  UpdatePipDto,
} from './dto/performance.dto';
import { PipsService } from './pips.service';
import { ReviewsService } from './reviews.service';

const UUID = new ParseUUIDPipe();

/** Performance module entitlement plus any of the permissions (endpoints whose access is decided per record). */
function requireAny(auth: AuthContext, ...permissions: string[]) {
  if (!auth.features.has('performance')) throw AppError.forbidden('Performance is not enabled for your organization');
  if (permissions.length && !permissions.some((p) => auth.permissions.has(p))) throw AppError.forbidden();
}
const ANY_PERFORMANCE = ['performance.view', 'performance.configure', 'performance.review', 'performance.self_assess', 'performance.feedback.give', 'performance.pip.manage'];

@ApiTags('Performance')
@ApiBearerAuth()
@Controller({ path: 'performance', version: '1' })
export class PerformanceController {
  constructor(
    private readonly cycles: CyclesService,
    private readonly reviews: ReviewsService,
    private readonly pips: PipsService,
  ) {}

  // ---- Cycles ----------------------------------------------------------------------------------

  @Get('cycles')
  @RequireTenant()
  listCycles(@CurrentAuth() auth: AuthContext, @Query() query: CycleQueryDto) {
    requireAny(auth, 'performance.configure', 'performance.view');
    return this.cycles.list(query);
  }

  @Post('cycles')
  @RequirePermissions('performance.configure')
  createCycle(@CurrentAuth() auth: AuthContext, @Body() dto: CycleDto) {
    return this.cycles.create(auth, dto);
  }

  @Get('cycles/:id')
  @RequireTenant()
  cycle(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, 'performance.configure', 'performance.view');
    return this.cycles.get(id);
  }

  @Patch('cycles/:id')
  @RequirePermissions('performance.configure')
  updateCycle(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateCycleDto) {
    return this.cycles.update(auth, id, dto);
  }

  @Delete('cycles/:id')
  @RequirePermissions('performance.configure')
  async removeCycle(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.cycles.remove(auth, id);
    return { deleted: true };
  }

  @Post('cycles/:id/launch')
  @RequirePermissions('performance.configure')
  @ApiOperation({ summary: 'Start the cycle: a review for every eligible employee, reviewed by their manager' })
  launch(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.cycles.launch(auth, id);
  }

  @Post('cycles/:id/participants')
  @RequirePermissions('performance.configure')
  addParticipants(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: AddParticipantsDto) {
    return this.cycles.addParticipants(auth, id, dto);
  }

  @Post('cycles/:id/release')
  @RequirePermissions('performance.configure')
  @ApiOperation({ summary: 'Show completed reviews (ratings, manager comments, anonymous feedback) to employees' })
  release(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.cycles.release(auth, id);
  }

  @Get('cycles/:id/calibration')
  @RequirePermissions('performance.configure')
  @ApiOperation({ summary: 'Rating spread of completed reviews against the target curve, and the 9-box' })
  calibration(@Param('id', UUID) id: string, @Query('departmentId') departmentId?: string) {
    if (departmentId !== undefined && !/^[0-9a-f-]{36}$/i.test(departmentId)) throw AppError.validation([{ field: 'departmentId', message: 'Invalid department' }]);
    return this.cycles.calibration(id, departmentId);
  }

  @Post('cycles/:id/close')
  @RequirePermissions('performance.configure')
  close(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.cycles.close(auth, id);
  }

  // ---- Reviews ---------------------------------------------------------------------------------

  @Get('reviews')
  @RequireTenant()
  listReviews(@CurrentAuth() auth: AuthContext, @Query() query: ReviewQueryDto) {
    requireAny(auth, ...ANY_PERFORMANCE);
    return this.reviews.list(auth, query);
  }

  @Get('reviews/:id')
  @RequireTenant()
  review(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, ...ANY_PERFORMANCE);
    return this.reviews.get(auth, id);
  }

  @Post('reviews/:id/goals')
  @RequireTenant()
  addGoal(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: GoalDto) {
    requireAny(auth, 'performance.self_assess', 'performance.review');
    return this.reviews.addGoal(auth, id, dto);
  }

  @Patch('reviews/:id/goals/:goalId')
  @RequireTenant()
  updateGoal(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('goalId', UUID) goalId: string, @Body() dto: UpdateGoalDto) {
    requireAny(auth, 'performance.self_assess', 'performance.review');
    return this.reviews.updateGoal(auth, id, goalId, dto);
  }

  @Delete('reviews/:id/goals/:goalId')
  @RequireTenant()
  removeGoal(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('goalId', UUID) goalId: string) {
    requireAny(auth, 'performance.self_assess', 'performance.review');
    return this.reviews.removeGoal(auth, id, goalId);
  }

  @Put('reviews/:id/goals/:goalId/progress')
  @RequireTenant()
  progress(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('goalId', UUID) goalId: string, @Body() dto: GoalProgressDto) {
    requireAny(auth, 'performance.self_assess', 'performance.review');
    return this.reviews.updateProgress(auth, id, goalId, dto);
  }

  @Post('reviews/:id/goals/submit')
  @RequirePermissions('performance.self_assess')
  submitGoals(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.reviews.submitGoals(auth, id);
  }

  @Post('reviews/:id/goals/approve')
  @RequirePermissions('performance.review')
  approveGoals(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.reviews.approveGoals(auth, id);
  }

  @Post('reviews/:id/goals/return')
  @RequirePermissions('performance.review')
  returnGoals(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReturnGoalsDto) {
    return this.reviews.returnGoals(auth, id, dto);
  }

  @Put('reviews/:id/self-assessment')
  @RequirePermissions('performance.self_assess')
  @ApiOperation({ summary: 'Save (or submit) your self-assessment' })
  selfAssessment(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: AssessmentDto) {
    return this.reviews.selfAssessment(auth, id, dto);
  }

  @Put('reviews/:id/manager-review')
  @RequirePermissions('performance.review')
  @ApiOperation({ summary: 'Save (or submit) the manager review; submitting computes the scores' })
  managerReview(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ManagerAssessmentDto) {
    return this.reviews.managerAssessment(auth, id, dto);
  }

  @Post('reviews/:id/calibrate')
  @RequirePermissions('performance.configure')
  calibrate(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: CalibrateDto) {
    return this.reviews.calibrate(auth, id, dto);
  }

  @Put('reviews/:id/potential')
  @RequireTenant()
  @ApiOperation({ summary: 'Set potential (1 low, 2 medium, 3 high) for the 9-box; HR or the reviewer' })
  potential(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: PotentialDto) {
    requireAny(auth, 'performance.configure', 'performance.review');
    return this.reviews.setPotential(auth, id, dto);
  }

  @Post('reviews/:id/acknowledge')
  @RequireTenant()
  acknowledge(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: AcknowledgeDto) {
    requireAny(auth);
    return this.reviews.acknowledge(auth, id, dto);
  }

  @Post('reviews/:id/reviewer')
  @RequirePermissions('performance.configure')
  reassign(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReassignReviewerDto) {
    return this.reviews.reassign(auth, id, dto);
  }

  @Post('reviews/:id/feedback-requests')
  @RequireTenant()
  requestFeedback(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: FeedbackRequestDto) {
    requireAny(auth, 'performance.self_assess', 'performance.review');
    return this.reviews.requestFeedback(auth, id, dto);
  }

  @Get('colleagues')
  @RequireTenant()
  @ApiOperation({ summary: 'Active colleagues (name, code, department, designation) to request feedback from or assign as reviewer' })
  colleagues(@CurrentAuth() auth: AuthContext, @Query('search') search?: string) {
    requireAny(auth, 'performance.self_assess', 'performance.review', 'performance.configure', 'performance.pip.manage');
    return this.reviews.colleagues(auth, typeof search === 'string' ? search.slice(0, 100) : undefined);
  }

  // ---- Feedback --------------------------------------------------------------------------------

  @Get('feedback')
  @RequirePermissions('performance.feedback.give')
  @ApiOperation({ summary: 'Feedback requests addressed to you' })
  myFeedback(@CurrentAuth() auth: AuthContext) {
    return this.reviews.myFeedbackRequests(auth);
  }

  @Post('feedback/:id')
  @RequirePermissions('performance.feedback.give')
  giveFeedback(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: GiveFeedbackDto) {
    return this.reviews.giveFeedback(auth, id, dto);
  }

  @Post('feedback/:id/decline')
  @RequirePermissions('performance.feedback.give')
  declineFeedback(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.reviews.giveFeedback(auth, id, null);
  }

  // ---- Improvement plans -----------------------------------------------------------------------

  @Get('pips')
  @RequireTenant()
  listPips(@CurrentAuth() auth: AuthContext, @Query() query: PipQueryDto) {
    requireAny(auth);
    return this.pips.list(auth, query);
  }

  @Post('pips')
  @RequirePermissions('performance.pip.manage')
  createPip(@CurrentAuth() auth: AuthContext, @Body() dto: PipDto) {
    return this.pips.create(auth, dto);
  }

  @Get('pips/:id')
  @RequireTenant()
  pip(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth);
    return this.pips.get(auth, id);
  }

  @Patch('pips/:id')
  @RequirePermissions('performance.pip.manage')
  updatePip(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdatePipDto) {
    return this.pips.update(auth, id, dto);
  }

  @Post('pips/:id/check-ins')
  @RequirePermissions('performance.pip.manage')
  checkIn(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: CheckInDto) {
    return this.pips.checkIn(auth, id, dto);
  }

  @Post('pips/:id/close')
  @RequirePermissions('performance.pip.manage')
  closePip(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ClosePipDto) {
    return this.pips.close(auth, id, dto);
  }

  @Post('pips/:id/acknowledge')
  @RequireTenant()
  acknowledgePip(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: AcknowledgeDto) {
    requireAny(auth);
    return this.pips.acknowledge(auth, id, dto);
  }
}
