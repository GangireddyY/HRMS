import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { CompensationBudgetsService } from './compensation-budgets.service';
import { CompensationDto, CompensationPoolsDto, DecideHikeDto, HikeDto, HikeQueryDto, SuccessionPlanDto, SuccessorDto, UpdateSuccessorDto } from './dto/performance.dto';
import { HikesService } from './hikes.service';
import { SuccessionService } from './succession.service';

const UUID = new ParseUUIDPipe();

function requireAny(auth: AuthContext, ...permissions: string[]) {
  if (!auth.features.has('performance')) throw AppError.forbidden('Performance is not enabled for your organization');
  if (!permissions.some((p) => auth.permissions.has(p))) throw AppError.forbidden();
}

@ApiTags('Performance')
@ApiBearerAuth()
@Controller({ path: 'performance', version: '1' })
export class HikesController {
  constructor(
    private readonly hikes: HikesService,
    private readonly budgets: CompensationBudgetsService,
    private readonly successionService: SuccessionService,
  ) {}

  @Get('cycles/:id/compensation')
  @RequireTenant()
  @ApiOperation({ summary: 'Merit guidelines, budget and progress of increase recommendations for a cycle' })
  compensation(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, 'performance.configure', 'employee.salary.revise');
    return this.hikes.compensation(auth, id);
  }

  @Put('cycles/:id/compensation')
  @RequirePermissions('performance.configure')
  setCompensation(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: CompensationDto) {
    return this.hikes.setCompensation(auth, id, dto);
  }

  @Get('cycles/:id/hikes')
  @RequireTenant()
  @ApiOperation({ summary: 'Completed reviews of the cycle with their increase recommendations' })
  list(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Query() query: HikeQueryDto) {
    requireAny(auth, 'performance.review', 'performance.configure', 'employee.salary.revise');
    return this.hikes.list(auth, id, query);
  }

  @Post('cycles/:id/hikes/apply')
  @RequirePermissions('employee.salary.revise')
  @ApiOperation({ summary: 'Turn approved recommendations into salary revisions from the effective date' })
  apply(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.hikes.apply(auth, id);
  }

  @Put('reviews/:reviewId/hike')
  @RequireTenant()
  @ApiOperation({ summary: 'Recommend an increase for a completed review (reviewer or HR)' })
  upsert(@CurrentAuth() auth: AuthContext, @Param('reviewId', UUID) reviewId: string, @Body() dto: HikeDto) {
    requireAny(auth, 'performance.review', 'performance.configure');
    return this.hikes.upsert(auth, reviewId, dto);
  }

  @Post('hikes/:id/submit')
  @RequireTenant()
  submit(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, 'performance.review', 'performance.configure');
    return this.hikes.submit(auth, id);
  }

  @Post('hikes/:id/approve')
  @RequirePermissions('employee.salary.revise')
  approve(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: DecideHikeDto) {
    return this.hikes.decide(auth, id, true, dto);
  }

  @Post('hikes/:id/reject')
  @RequirePermissions('employee.salary.revise')
  reject(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: DecideHikeDto) {
    return this.hikes.decide(auth, id, false, dto);
  }

  // ---- Compensation budgets ----------------------------------------------------------------------

  @Get('cycles/:id/budgets')
  @RequireTenant()
  @ApiOperation({ summary: 'Increase pools per department for the cycle, with planned and committed amounts' })
  budgetPools(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, 'performance.configure', 'employee.salary.revise');
    return this.budgets.pools(auth, id);
  }

  @Put('cycles/:id/budgets')
  @RequirePermissions('performance.configure')
  @ApiOperation({ summary: 'Set the increase pool per department (replaces all pools of the cycle)' })
  setBudgetPools(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: CompensationPoolsDto) {
    return this.budgets.setPools(auth, id, dto.pools);
  }

  // ---- Succession planning -----------------------------------------------------------------------

  @Get('succession')
  @RequireTenant()
  @ApiOperation({ summary: 'Succession plans you can see, with bench strength' })
  succession(@CurrentAuth() auth: AuthContext) {
    requireAny(auth, 'performance.succession.view', 'performance.succession.manage');
    return this.successionService.list(auth);
  }

  @Get('succession/:id')
  @RequireTenant()
  successionPlan(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, 'performance.succession.view', 'performance.succession.manage');
    return this.successionService.get(auth, id);
  }

  @Post('succession')
  @RequirePermissions('performance.succession.manage')
  createSuccessionPlan(@CurrentAuth() auth: AuthContext, @Body() dto: SuccessionPlanDto) {
    return this.successionService.create(auth, dto);
  }

  @Put('succession/:id')
  @RequirePermissions('performance.succession.manage')
  updateSuccessionPlan(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: SuccessionPlanDto) {
    return this.successionService.update(auth, id, dto);
  }

  @Delete('succession/:id')
  @RequirePermissions('performance.succession.manage')
  @HttpCode(204)
  async removeSuccessionPlan(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.successionService.remove(auth, id);
  }

  @Post('succession/:id/successors')
  @RequirePermissions('performance.succession.manage')
  addSuccessor(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: SuccessorDto) {
    return this.successionService.addSuccessor(auth, id, dto);
  }

  @Patch('succession/:id/successors/:candidateId')
  @RequirePermissions('performance.succession.manage')
  updateSuccessor(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('candidateId', UUID) candidateId: string, @Body() dto: UpdateSuccessorDto) {
    return this.successionService.updateSuccessor(auth, id, candidateId, dto);
  }

  @Delete('succession/:id/successors/:candidateId')
  @RequirePermissions('performance.succession.manage')
  removeSuccessor(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('candidateId', UUID) candidateId: string) {
    return this.successionService.removeSuccessor(auth, id, candidateId);
  }
}
