import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { BenefitEnrollmentsService } from './benefit-enrollments.service';
import { BenefitPlansService } from './benefit-plans.service';
import { DecisionDto, EndEnrollmentDto, EnrollDto, EnrollmentQueryDto, PlanDto, PlanQueryDto, RejectDto, UpdatePlanDto, WaiveDto } from './dto/benefits.dto';

const UUID = new ParseUUIDPipe();
const attachment = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** Benefits module entitlement plus any of the permissions. */
function requireAny(auth: AuthContext, ...permissions: string[]) {
  if (!auth.features.has('benefits')) throw AppError.forbidden('Benefits are not enabled for your organization');
  if (!permissions.some((p) => auth.permissions.has(p))) throw AppError.forbidden();
}

@ApiTags('Benefits')
@ApiBearerAuth()
@Controller({ path: 'benefits', version: '1' })
export class BenefitsController {
  constructor(
    private readonly plans: BenefitPlansService,
    private readonly enrollments: BenefitEnrollmentsService,
  ) {}

  // ---- Employees --------------------------------------------------------------------------------

  @Get('me')
  @RequirePermissions('benefits.view')
  @ApiOperation({ summary: 'Plans offered to me, my current choices and the family members I can cover' })
  mine(@CurrentAuth() auth: AuthContext) {
    return this.enrollments.mine(auth);
  }

  @Post('plans/:id/enroll')
  @RequirePermissions('benefits.enroll')
  enroll(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: EnrollDto) {
    return this.enrollments.enroll(auth, id, dto);
  }

  @Post('plans/:id/waive')
  @RequirePermissions('benefits.enroll')
  waive(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: WaiveDto) {
    return this.enrollments.waive(auth, id, dto);
  }

  @Post('enrollments/:id/cancel')
  @RequirePermissions('benefits.enroll')
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.enrollments.cancel(auth, id);
  }

  // ---- Plans ------------------------------------------------------------------------------------

  @Get('plans')
  @RequireTenant()
  listPlans(@CurrentAuth() auth: AuthContext, @Query() query: PlanQueryDto) {
    requireAny(auth, 'benefits.view', 'benefits.manage');
    return this.plans.list(auth, query);
  }

  @Post('plans')
  @RequirePermissions('benefits.manage')
  createPlan(@CurrentAuth() auth: AuthContext, @Body() dto: PlanDto) {
    return this.plans.create(auth, dto);
  }

  @Get('plans/:id')
  @RequireTenant()
  plan(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, 'benefits.view', 'benefits.manage');
    return this.plans.get(auth, id);
  }

  @Patch('plans/:id')
  @RequirePermissions('benefits.manage')
  updatePlan(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdatePlanDto) {
    return this.plans.update(auth, id, dto);
  }

  @Delete('plans/:id')
  @RequirePermissions('benefits.manage')
  async removePlan(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.plans.remove(auth, id);
    return { deleted: true };
  }

  @Post('plans/:id/activate')
  @RequirePermissions('benefits.manage')
  activate(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.plans.activate(auth, id);
  }

  @Post('plans/:id/archive')
  @RequirePermissions('benefits.manage')
  archive(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.plans.archive(auth, id);
  }

  @Post('plans/:id/enroll-eligible')
  @RequirePermissions('benefits.manage')
  @ApiOperation({ summary: 'Mandatory plans: enrol every eligible employee not yet covered in the default option' })
  enrollEligible(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.plans.enrollEligible(auth, id);
  }

  @Get('plans/:id/census')
  @RequirePermissions('benefits.manage')
  @ApiOperation({ summary: 'Insurer census (CSV): covered employees and dependants' })
  async census(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    const f = await this.plans.census(auth, id);
    return new StreamableFile(Buffer.from(`\uFEFF${f.content}`, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: attachment(f.fileName) });
  }

  // ---- Enrolments (HR) --------------------------------------------------------------------------

  @Get('enrollments')
  @RequireTenant()
  listEnrollments(@CurrentAuth() auth: AuthContext, @Query() query: EnrollmentQueryDto) {
    requireAny(auth, 'benefits.view', 'benefits.manage');
    return this.enrollments.list(auth, query);
  }

  @Post('enrollments/:id/approve')
  @RequirePermissions('benefits.manage')
  approve(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: DecisionDto) {
    return this.enrollments.approve(auth, id, dto);
  }

  @Post('enrollments/:id/reject')
  @RequirePermissions('benefits.manage')
  reject(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: RejectDto) {
    return this.enrollments.reject(auth, id, dto);
  }

  @Post('enrollments/:id/end')
  @RequirePermissions('benefits.manage')
  end(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: EndEnrollmentDto) {
    return this.enrollments.end(auth, id, dto);
  }
}
