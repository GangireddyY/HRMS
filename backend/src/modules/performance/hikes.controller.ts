import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { CompensationDto, DecideHikeDto, HikeDto, HikeQueryDto } from './dto/performance.dto';
import { HikesService } from './hikes.service';

const UUID = new ParseUUIDPipe();

function requireAny(auth: AuthContext, ...permissions: string[]) {
  if (!auth.features.has('performance')) throw AppError.forbidden('Performance is not enabled for your organization');
  if (!permissions.some((p) => auth.permissions.has(p))) throw AppError.forbidden();
}

@ApiTags('Performance')
@ApiBearerAuth()
@Controller({ path: 'performance', version: '1' })
export class HikesController {
  constructor(private readonly hikes: HikesService) {}

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
}
