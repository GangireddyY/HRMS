import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import {
  AssignDto,
  AttemptDto,
  AttendanceDto,
  CancelEnrollmentDto,
  CertificationQueryDto,
  CourseDto,
  CourseFeedbackDto,
  CourseQueryDto,
  EnrollDto,
  EnrollmentQueryDto,
  QuestionsDto,
  SessionDto,
  UpdateCourseDto,
  UpdateSessionDto,
} from './dto/training.dto';
import { TrainingCoursesService } from './training-courses.service';
import { TrainingEnrollmentsService } from './training-enrollments.service';

const UUID = new ParseUUIDPipe();

/** Training module entitlement plus any of the permissions (endpoints whose access is decided per record). */
function requireAny(auth: AuthContext, ...permissions: string[]) {
  if (!auth.features.has('training')) throw AppError.forbidden('Training is not enabled for your organization');
  if (permissions.length && !permissions.some((p) => auth.permissions.has(p))) throw AppError.forbidden();
}

@ApiTags('Training')
@ApiBearerAuth()
@Controller({ path: 'training', version: '1' })
export class TrainingController {
  constructor(
    private readonly courses: TrainingCoursesService,
    private readonly enrollments: TrainingEnrollmentsService,
  ) {}

  // ---- Courses ---------------------------------------------------------------------------------

  @Get('courses')
  @RequireTenant()
  listCourses(@CurrentAuth() auth: AuthContext, @Query() query: CourseQueryDto) {
    requireAny(auth, 'training.view', 'training.manage', 'training.assign');
    return this.courses.list(auth, query);
  }

  @Post('courses')
  @RequirePermissions('training.manage')
  createCourse(@CurrentAuth() auth: AuthContext, @Body() dto: CourseDto) {
    return this.courses.create(auth, dto);
  }

  @Get('courses/:id')
  @RequireTenant()
  course(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, 'training.view', 'training.manage', 'training.assign');
    return this.courses.get(auth, id);
  }

  @Patch('courses/:id')
  @RequirePermissions('training.manage')
  updateCourse(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateCourseDto) {
    return this.courses.update(auth, id, dto);
  }

  @Delete('courses/:id')
  @RequirePermissions('training.manage')
  async removeCourse(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.courses.remove(auth, id);
    return { deleted: true };
  }

  @Post('courses/:id/publish')
  @RequirePermissions('training.manage')
  publish(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.courses.setStatus(auth, id, 'PUBLISHED');
  }

  @Post('courses/:id/archive')
  @RequirePermissions('training.manage')
  archive(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.courses.setStatus(auth, id, 'ARCHIVED');
  }

  @Put('courses/:id/questions')
  @RequirePermissions('training.manage')
  @ApiOperation({ summary: 'Replace the assessment questions (multiple choice, one correct option)' })
  questions(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: QuestionsDto) {
    return this.courses.setQuestions(auth, id, dto);
  }

  @Get('courses/:id/roster')
  @RequirePermissions('training.manage')
  roster(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Query('sessionId') sessionId?: string) {
    return this.courses.roster(auth, id, sessionId && /^[0-9a-f-]{36}$/i.test(sessionId) ? sessionId : undefined);
  }

  @Post('courses/:id/sessions')
  @RequirePermissions('training.manage')
  createSession(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: SessionDto) {
    return this.courses.createSession(auth, id, dto);
  }

  @Patch('sessions/:id')
  @RequirePermissions('training.manage')
  updateSession(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateSessionDto) {
    return this.courses.updateSession(auth, id, dto);
  }

  @Post('sessions/:id/cancel')
  @RequirePermissions('training.manage')
  cancelSession(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.courses.cancelSession(auth, id);
  }

  @Put('sessions/:id/attendance')
  @RequirePermissions('training.manage')
  @ApiOperation({ summary: 'Record attendance; attending completes the enrolment when nothing else is required' })
  attendance(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: AttendanceDto) {
    return this.courses.attendance(auth, id, dto);
  }

  // ---- Enrolments ------------------------------------------------------------------------------

  @Post('courses/:id/enroll')
  @RequirePermissions('training.enroll')
  enroll(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: EnrollDto) {
    return this.enrollments.enroll(auth, id, dto);
  }

  @Post('assignments')
  @RequirePermissions('training.assign')
  @ApiOperation({ summary: 'Assign a course to employees or departments within your scope' })
  assign(@CurrentAuth() auth: AuthContext, @Body() dto: AssignDto) {
    return this.enrollments.assign(auth, dto);
  }

  @Get('enrollments')
  @RequireTenant()
  listEnrollments(@CurrentAuth() auth: AuthContext, @Query() query: EnrollmentQueryDto) {
    requireAny(auth);
    return this.enrollments.list(auth, query);
  }

  @Get('certifications')
  @RequireTenant()
  @ApiOperation({ summary: 'Certifications expiring soon or expired (not yet renewed), within scope' })
  certifications(@CurrentAuth() auth: AuthContext, @Query() query: CertificationQueryDto) {
    requireAny(auth, 'training.manage', 'training.assign');
    return this.enrollments.certifications(auth, query);
  }

  @Get('enrollments/:id')
  @RequireTenant()
  enrollment(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth);
    return this.enrollments.get(auth, id);
  }

  @Post('enrollments/:id/cancel')
  @RequireTenant()
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: CancelEnrollmentDto) {
    requireAny(auth);
    return this.enrollments.cancel(auth, id, dto);
  }

  @Post('enrollments/:id/session')
  @RequireTenant()
  changeSession(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: EnrollDto) {
    requireAny(auth);
    if (!dto.sessionId) throw AppError.validation([{ field: 'sessionId', message: 'Choose a session' }]);
    return this.enrollments.changeSession(auth, id, dto.sessionId);
  }

  @Post('enrollments/:id/start')
  @RequireTenant()
  start(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth);
    return this.enrollments.start(auth, id);
  }

  @Post('enrollments/:id/done')
  @RequireTenant()
  done(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth);
    return this.enrollments.markDone(auth, id);
  }

  @Get('enrollments/:id/assessment')
  @RequireTenant()
  assessment(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth);
    return this.enrollments.assessment(auth, id);
  }

  @Post('enrollments/:id/attempts')
  @RequireTenant()
  attempt(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: AttemptDto) {
    requireAny(auth);
    return this.enrollments.attempt(auth, id, dto);
  }

  @Post('enrollments/:id/feedback')
  @RequireTenant()
  feedback(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: CourseFeedbackDto) {
    requireAny(auth);
    return this.enrollments.feedback(auth, id, dto);
  }
}
