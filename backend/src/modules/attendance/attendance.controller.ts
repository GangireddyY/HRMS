import { Body, Controller, Delete, Get, Headers, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { DEVICE_BATCH_MAX } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, Public, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { AttendanceConfigService } from './attendance-config.service';
import { AttendancePeriodsService } from './attendance-periods.service';
import { AttendanceService } from './attendance.service';
import { DevicesService } from './devices.service';
import {
  ApplyRotationDto,
  AssignRosterDto,
  BiometricCodeDto,
  CalendarQueryDto,
  ClearRosterDto,
  CreateHolidayDto,
  CreateRegularizationDto,
  CreateShiftDto,
  CreateWorkFromHomeDto,
  DailyQueryDto,
  DeviceDto,
  DevicePunchesDto,
  HolidayQueryDto,
  ImportHolidaysDto,
  OfficialHolidaysQueryDto,
  OvertimeQueryDto,
  PeriodQueryDto,
  PunchDto,
  RegularizationQueryDto,
  ReviewDto,
  ReviewOvertimeDto,
  RosterQueryDto,
  RotationDto,
  UpdateDeviceDto,
  UpdateHolidayDto,
  UpdateRotationDto,
  UpdateShiftDto,
  UpsertRecordDto,
  WorkFromHomeQueryDto,
} from './dto/attendance.dto';
import { OfficialHolidaysService } from './official-holidays.service';
import { OvertimeService } from './overtime.service';
import { RegularizationService } from './regularization.service';
import { RosterService } from './roster.service';
import { WorkFromHomeService } from './work-from-home.service';

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
    private readonly overtime: OvertimeService,
    private readonly wfh: WorkFromHomeService,
    private readonly roster: RosterService,
    private readonly devices: DevicesService,
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

  // ---- Overtime ----

  @Get('overtime')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Own overtime (view=mine) or overtime to approve (view=team)' })
  listOvertime(@CurrentAuth() auth: AuthContext, @Query() query: OvertimeQueryDto) {
    return this.overtime.list(auth, query);
  }

  @Post('overtime/:id/approve')
  @RequirePermissions('attendance.regularize.approve')
  approveOvertime(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewOvertimeDto) {
    return this.overtime.approve(auth, id, dto);
  }

  @Post('overtime/:id/reject')
  @RequirePermissions('attendance.regularize.approve')
  rejectOvertime(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewOvertimeDto) {
    return this.overtime.reject(auth, id, dto);
  }

  // ---- Work from home ----

  @Get('work-from-home')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Own requests (view=mine) or requests to review (view=team)' })
  listWorkFromHome(@CurrentAuth() auth: AuthContext, @Query() query: WorkFromHomeQueryDto) {
    return this.wfh.list(auth, query);
  }

  @Post('work-from-home')
  @RequirePermissions('attendance.wfh.apply')
  requestWorkFromHome(@CurrentAuth() auth: AuthContext, @Body() dto: CreateWorkFromHomeDto) {
    return this.wfh.create(auth, dto);
  }

  @Post('work-from-home/:id/approve')
  @RequirePermissions('attendance.regularize.approve')
  approveWorkFromHome(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.wfh.approve(auth, id, dto);
  }

  @Post('work-from-home/:id/reject')
  @RequirePermissions('attendance.regularize.approve')
  rejectWorkFromHome(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.wfh.reject(auth, id, dto);
  }

  @Post('work-from-home/:id/cancel')
  @RequirePermissions('attendance.wfh.apply')
  cancelWorkFromHome(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.wfh.cancel(auth, id);
  }

  // ---- Rosters & rotations ----

  @Get('rotations')
  @RequirePermissions('attendance.configure')
  listRotations() {
    return this.roster.listRotations();
  }

  @Post('rotations')
  @RequirePermissions('attendance.configure')
  createRotation(@CurrentAuth() auth: AuthContext, @Body() dto: RotationDto) {
    return this.roster.createRotation(auth, dto);
  }

  @Patch('rotations/:id')
  @RequirePermissions('attendance.configure')
  updateRotation(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRotationDto) {
    return this.roster.updateRotation(auth, id, dto);
  }

  @Delete('rotations/:id')
  @RequirePermissions('attendance.configure')
  async removeRotation(@Param('id', ParseUUIDPipe) id: string) {
    await this.roster.removeRotation(id);
    return { deleted: true };
  }

  @Get('roster')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Who works which shift on each day of a range (people in scope)' })
  rosterView(@CurrentAuth() auth: AuthContext, @Query() query: RosterQueryDto) {
    return this.roster.roster(auth, query);
  }

  @Post('roster/assign')
  @RequirePermissions('attendance.configure')
  @ApiOperation({ summary: 'Roster a shift (or a day off) for people over a range, from today onwards' })
  assignRoster(@CurrentAuth() auth: AuthContext, @Body() dto: AssignRosterDto) {
    return this.roster.assign(auth, dto);
  }

  @Post('roster/apply-rotation')
  @RequirePermissions('attendance.configure')
  applyRotation(@CurrentAuth() auth: AuthContext, @Body() dto: ApplyRotationDto) {
    return this.roster.applyRotation(auth, dto);
  }

  @Post('roster/clear')
  @RequirePermissions('attendance.configure')
  @ApiOperation({ summary: 'Back to the usual shift for a range' })
  clearRoster(@CurrentAuth() auth: AuthContext, @Body() dto: ClearRosterDto) {
    return this.roster.clear(auth, dto);
  }

  // ---- Devices ----

  @Get('devices')
  @RequirePermissions('attendance.configure')
  listDevices() {
    return this.devices.list();
  }

  @Post('devices')
  @RequirePermissions('attendance.configure')
  @ApiOperation({ summary: 'Add a device; the API key is returned once' })
  createDevice(@CurrentAuth() auth: AuthContext, @Body() dto: DeviceDto) {
    return this.devices.create(auth, dto);
  }

  @Patch('devices/:id')
  @RequirePermissions('attendance.configure')
  updateDevice(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeviceDto) {
    return this.devices.update(auth, id, dto);
  }

  @Post('devices/:id/rotate-key')
  @RequirePermissions('attendance.configure')
  @ApiOperation({ summary: 'Issue a new API key (the old one stops working); returned once' })
  rotateDeviceKey(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.rotateKey(id);
  }

  @Delete('devices/:id')
  @RequirePermissions('attendance.configure')
  async removeDevice(@Param('id', ParseUUIDPipe) id: string) {
    await this.devices.remove(id);
    return { deleted: true };
  }

  @Put('employees/:id/biometric-code')
  @RequirePermissions('attendance.configure')
  @ApiOperation({ summary: "Set the employee's user number on the devices" })
  setBiometricCode(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BiometricCodeDto) {
    return this.devices.setBiometricCode(auth, id, dto.biometricCode ?? null);
  }
}

/** Devices push punches with their API key (no user session). */
@ApiTags('Attendance devices')
@Controller({ path: 'attendance/device', version: '1' })
export class DevicePunchesController {
  constructor(private readonly devices: DevicesService) {}

  @Post('punches')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiHeader({ name: 'X-Device-Key', required: true, description: 'The API key shown when the device was added' })
  @ApiOperation({ summary: `Push up to ${DEVICE_BATCH_MAX} punches; duplicates are ignored` })
  punches(@Headers('x-device-key') key: string | undefined, @Body() dto: DevicePunchesDto) {
    return this.devices.ingest(key, dto);
  }
}

@ApiTags('Holidays')
@ApiBearerAuth()
@Controller({ path: 'holidays', version: '1' })
export class HolidaysController {
  constructor(
    private readonly config: AttendanceConfigService,
    private readonly official: OfficialHolidaysService,
  ) {}

  @Get()
  @RequireTenant()
  list(@Query() query: HolidayQueryDto) {
    return this.config.listHolidays(query.year ?? new Date().getUTCFullYear());
  }

  @Get('official')
  @RequirePermissions('organization.calendar.manage')
  @ApiOperation({ summary: "A country's official public holidays for a year, to choose which ones the organization gives" })
  officialHolidays(@CurrentAuth() auth: AuthContext, @Query() query: OfficialHolidaysQueryDto) {
    return this.official.list(auth, query.year, query.country);
  }

  @Post('import')
  @RequirePermissions('organization.calendar.manage')
  @ApiOperation({ summary: 'Add several holidays at once; dates that already have a holiday are skipped' })
  importHolidays(@CurrentAuth() auth: AuthContext, @Body() dto: ImportHolidaysDto) {
    return this.official.import(auth, dto);
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
