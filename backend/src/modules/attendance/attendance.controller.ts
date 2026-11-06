import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { AttendanceConfigService } from './attendance-config.service';
import { AttendancePeriodsService } from './attendance-periods.service';
import { AttendanceService } from './attendance.service';
import {
  CalendarQueryDto,
  CreateHolidayDto,
  CreateRegularizationDto,
  CreateShiftDto,
  DailyQueryDto,
  HolidayQueryDto,
  PeriodQueryDto,
  PunchDto,
  RegularizationQueryDto,
  ReviewDto,
  UpdateHolidayDto,
  UpdateShiftDto,
  UpsertRecordDto,
} from './dto/attendance.dto';
import { RegularizationService } from './regularization.service';

function monthParam(month: number): number {
  if (month < 1 || month > 12) throw AppError.validation([{ field: 'month', message: 'month must be between 1 and 12' }]);
  return month;
}

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller({ path: 'attendance', version: '1' })
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly regularizations: RegularizationService,
    private readonly periods: AttendancePeriodsService,
    private readonly config: AttendanceConfigService,
  ) {}

  @Get('today')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: "Today's punches, shift and day type for the signed-in employee" })
  today(@CurrentAuth() auth: AuthContext) {
    return this.attendance.today(auth);
  }

  @Post('punch-in')
  @RequirePermissions('attendance.mark')
  punchIn(@CurrentAuth() auth: AuthContext, @Body() dto: PunchDto, @Req() req: Request) {
    return this.attendance.punchIn(auth, dto, req.ip);
  }

  @Post('punch-out')
  @RequirePermissions('attendance.mark')
  punchOut(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    return this.attendance.punchOut(auth, req.ip);
  }

  @Get('calendar')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Month calendar for the caller or an employee in scope' })
  calendar(@CurrentAuth() auth: AuthContext, @Query() query: CalendarQueryDto) {
    return this.attendance.calendar(auth, query);
  }

  @Get('daily')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Attendance register for a date across employees in scope' })
  daily(@CurrentAuth() auth: AuthContext, @Query() query: DailyQueryDto) {
    return this.attendance.daily(auth, query);
  }

  @Put('records')
  @RequirePermissions('attendance.view', 'attendance.manage')
  @ApiOperation({ summary: 'Create or correct an attendance record (audited)' })
  upsertRecord(@CurrentAuth() auth: AuthContext, @Body() dto: UpsertRecordDto) {
    return this.attendance.upsertRecord(auth, dto);
  }

  // ---- Regularization ----

  @Get('regularizations')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Own requests (view=mine) or requests to review (view=team)' })
  listRegularizations(@CurrentAuth() auth: AuthContext, @Query() query: RegularizationQueryDto) {
    return this.regularizations.list(auth, query);
  }

  @Post('regularizations')
  @RequirePermissions('attendance.regularize.apply')
  requestRegularization(@CurrentAuth() auth: AuthContext, @Body() dto: CreateRegularizationDto) {
    return this.regularizations.create(auth, dto);
  }

  @Post('regularizations/:id/approve')
  @RequirePermissions('attendance.regularize.approve')
  approve(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.regularizations.approve(auth, id, dto);
  }

  @Post('regularizations/:id/reject')
  @RequirePermissions('attendance.regularize.approve')
  reject(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.regularizations.reject(auth, id, dto);
  }

  @Post('regularizations/:id/cancel')
  @RequirePermissions('attendance.regularize.apply')
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.regularizations.cancel(auth, id);
  }

  // ---- Monthly closing ----

  @Get('periods')
  @RequirePermissions('attendance.close')
  listPeriods(@CurrentAuth() auth: AuthContext, @Query() query: PeriodQueryDto) {
    return this.periods.list(auth, query.year ?? new Date().getUTCFullYear());
  }

  @Post('periods/:year/:month/close')
  @RequirePermissions('attendance.close')
  close(@CurrentAuth() auth: AuthContext, @Param('year', ParseIntPipe) year: number, @Param('month', ParseIntPipe) month: number) {
    return this.periods.close(auth, year, monthParam(month));
  }

  @Post('periods/:year/:month/reopen')
  @RequirePermissions('attendance.close')
  reopen(@CurrentAuth() auth: AuthContext, @Param('year', ParseIntPipe) year: number, @Param('month', ParseIntPipe) month: number) {
    return this.periods.reopen(auth, year, monthParam(month));
  }

  // ---- Shifts ----

  @Get('shifts')
  @RequireTenant()
  listShifts() {
    return this.config.listShifts();
  }

  @Post('shifts')
  @RequirePermissions('attendance.configure')
  createShift(@CurrentAuth() auth: AuthContext, @Body() dto: CreateShiftDto) {
    return this.config.createShift(auth, dto);
  }

  @Patch('shifts/:id')
  @RequirePermissions('attendance.configure')
  updateShift(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateShiftDto) {
    return this.config.updateShift(auth, id, dto);
  }

  @Delete('shifts/:id')
  @RequirePermissions('attendance.configure')
  async removeShift(@Param('id', ParseUUIDPipe) id: string) {
    await this.config.removeShift(id);
    return { deleted: true };
  }
}

@ApiTags('Holidays')
@ApiBearerAuth()
@Controller({ path: 'holidays', version: '1' })
export class HolidaysController {
  constructor(private readonly config: AttendanceConfigService) {}

  @Get()
  @RequireTenant()
  list(@Query() query: HolidayQueryDto) {
    return this.config.listHolidays(query.year ?? new Date().getUTCFullYear());
  }

  @Post()
  @RequirePermissions('organization.calendar.manage')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateHolidayDto) {
    return this.config.createHoliday(auth, dto);
  }

  @Patch(':id')
  @RequirePermissions('organization.calendar.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHolidayDto) {
    return this.config.updateHoliday(auth, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('organization.calendar.manage')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.config.removeHoliday(id);
    return { deleted: true };
  }
}
