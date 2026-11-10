import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OKR_LEVELS, type OkrLevel } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import {
  CompleteOneOnOneDto,
  KeyResultDto,
  ObjectiveDto,
  OkrCheckInDto,
  OkrQueryDto,
  OneOnOneDto,
  OneOnOneItemDto,
  OneOnOneQueryDto,
  UpdateKeyResultDto,
  UpdateObjectiveDto,
  UpdateOneOnOneDto,
  UpdateOneOnOneItemDto,
} from './dto/performance.dto';
import { OkrsService } from './okrs.service';
import { OneOnOnesService } from './one-on-ones.service';

const UUID = new ParseUUIDPipe();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Performance module entitlement (who may act on a record is decided by the services). */
function requirePerformance(auth: AuthContext) {
  if (!auth.features.has('performance')) throw AppError.forbidden('Performance is not enabled for your organization');
}

@ApiTags('Performance')
@ApiBearerAuth()
@Controller({ path: 'performance', version: '1' })
export class OkrsController {
  constructor(
    private readonly okrs: OkrsService,
    private readonly oneOnOnes: OneOnOnesService,
  ) {}

  // ---- OKRs ------------------------------------------------------------------------------------

  @Get('okrs')
  @RequireTenant()
  @ApiOperation({ summary: 'Objectives whose period covers the date, with key results, progress and health' })
  listOkrs(@CurrentAuth() auth: AuthContext, @Query() query: OkrQueryDto) {
    requirePerformance(auth);
    return this.okrs.list(auth, query);
  }

  @Get('okrs/parents')
  @RequireTenant()
  @ApiOperation({ summary: 'Objectives a new one can support (same or higher level, overlapping period)' })
  okrParents(@CurrentAuth() auth: AuthContext, @Query('level') level: string, @Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    requirePerformance(auth);
    if (!OKR_LEVELS.includes(level as OkrLevel) || !DATE.test(periodStart ?? '') || !DATE.test(periodEnd ?? '')) throw AppError.validation([{ field: 'level', message: 'Give a level and the period' }]);
    return this.okrs.parents(auth, level as OkrLevel, periodStart, periodEnd);
  }

  @Post('okrs')
  @RequireTenant()
  createOkr(@CurrentAuth() auth: AuthContext, @Body() dto: ObjectiveDto) {
    requirePerformance(auth);
    return this.okrs.create(auth, dto);
  }

  @Get('okrs/:id')
  @RequireTenant()
  okr(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requirePerformance(auth);
    return this.okrs.get(auth, id);
  }

  @Patch('okrs/:id')
  @RequireTenant()
  updateOkr(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateObjectiveDto) {
    requirePerformance(auth);
    return this.okrs.update(auth, id, dto);
  }

  @Delete('okrs/:id')
  @RequireTenant()
  removeOkr(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requirePerformance(auth);
    return this.okrs.remove(auth, id);
  }

  @Post('okrs/:id/key-results')
  @RequireTenant()
  addKeyResult(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: KeyResultDto) {
    requirePerformance(auth);
    return this.okrs.addKeyResult(auth, id, dto);
  }

  @Patch('okrs/key-results/:krId')
  @RequireTenant()
  updateKeyResult(@CurrentAuth() auth: AuthContext, @Param('krId', UUID) krId: string, @Body() dto: UpdateKeyResultDto) {
    requirePerformance(auth);
    return this.okrs.updateKeyResult(auth, krId, dto);
  }

  @Delete('okrs/key-results/:krId')
  @RequireTenant()
  removeKeyResult(@CurrentAuth() auth: AuthContext, @Param('krId', UUID) krId: string) {
    requirePerformance(auth);
    return this.okrs.removeKeyResult(auth, krId);
  }

  @Post('okrs/key-results/:krId/check-ins')
  @RequireTenant()
  @ApiOperation({ summary: 'Record the current value and health of a key result' })
  okrCheckIn(@CurrentAuth() auth: AuthContext, @Param('krId', UUID) krId: string, @Body() dto: OkrCheckInDto) {
    requirePerformance(auth);
    return this.okrs.checkIn(auth, krId, dto);
  }

  // ---- 1:1s ------------------------------------------------------------------------------------

  @Get('one-on-ones')
  @RequireTenant()
  listOneOnOnes(@CurrentAuth() auth: AuthContext, @Query() query: OneOnOneQueryDto) {
    requirePerformance(auth);
    return this.oneOnOnes.list(auth, query);
  }

  @Get('one-on-ones/team')
  @RequirePermissions('performance.review')
  @ApiOperation({ summary: 'Your direct reports with their last and next 1:1' })
  oneOnOneTeam(@CurrentAuth() auth: AuthContext) {
    requirePerformance(auth);
    return this.oneOnOnes.team(auth);
  }

  @Post('one-on-ones')
  @RequirePermissions('performance.review')
  createOneOnOne(@CurrentAuth() auth: AuthContext, @Body() dto: OneOnOneDto) {
    requirePerformance(auth);
    return this.oneOnOnes.create(auth, dto);
  }

  @Get('one-on-ones/:id')
  @RequireTenant()
  oneOnOne(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requirePerformance(auth);
    return this.oneOnOnes.get(auth, id);
  }

  @Patch('one-on-ones/:id')
  @RequireTenant()
  updateOneOnOne(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateOneOnOneDto) {
    requirePerformance(auth);
    return this.oneOnOnes.update(auth, id, dto);
  }

  @Post('one-on-ones/:id/items')
  @RequireTenant()
  addOneOnOneItem(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: OneOnOneItemDto) {
    requirePerformance(auth);
    return this.oneOnOnes.addItem(auth, id, dto);
  }

  @Patch('one-on-ones/items/:itemId')
  @RequireTenant()
  updateOneOnOneItem(@CurrentAuth() auth: AuthContext, @Param('itemId', UUID) itemId: string, @Body() dto: UpdateOneOnOneItemDto) {
    requirePerformance(auth);
    return this.oneOnOnes.updateItem(auth, itemId, dto);
  }

  @Delete('one-on-ones/items/:itemId')
  @RequireTenant()
  removeOneOnOneItem(@CurrentAuth() auth: AuthContext, @Param('itemId', UUID) itemId: string) {
    requirePerformance(auth);
    return this.oneOnOnes.removeItem(auth, itemId);
  }

  @Post('one-on-ones/:id/complete')
  @RequireTenant()
  @ApiOperation({ summary: 'Mark the 1:1 held; optionally schedule the next one (open topics and actions carry over)' })
  completeOneOnOne(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: CompleteOneOnOneDto) {
    requirePerformance(auth);
    return this.oneOnOnes.complete(auth, id, dto);
  }

  @Post('one-on-ones/:id/cancel')
  @RequireTenant()
  cancelOneOnOne(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requirePerformance(auth);
    return this.oneOnOnes.cancel(auth, id);
  }
}
