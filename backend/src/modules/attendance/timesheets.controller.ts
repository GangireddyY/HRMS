import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions } from '../../common/auth/decorators';
import { ReviewDto, SaveTimesheetDto, TimesheetBoardQueryDto, TimesheetQueryDto, TimesheetRemindDto, TimesheetWeekQueryDto } from './dto/attendance.dto';
import { TimesheetsService } from './timesheets.service';

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller({ path: 'attendance/timesheets', version: '1' })
export class TimesheetsController {
  constructor(private readonly timesheets: TimesheetsService) {}

  @Get('week')
  @RequirePermissions('attendance.timesheet.submit')
  @ApiOperation({ summary: 'My timesheet for a week, with what each day is and the hours punched' })
  week(@CurrentAuth() auth: AuthContext, @Query() query: TimesheetWeekQueryDto) {
    return this.timesheets.week(auth, query);
  }

  @Put('week')
  @RequirePermissions('attendance.timesheet.submit')
  @ApiOperation({ summary: 'Save my timesheet for a week as a draft' })
  save(@CurrentAuth() auth: AuthContext, @Body() dto: SaveTimesheetDto) {
    return this.timesheets.save(auth, dto, false);
  }

  @Post('week/submit')
  @RequirePermissions('attendance.timesheet.submit')
  @ApiOperation({ summary: 'Save and submit my timesheet for review' })
  submit(@CurrentAuth() auth: AuthContext, @Body() dto: SaveTimesheetDto) {
    return this.timesheets.save(auth, dto, true);
  }

  @Get('board')
  @RequirePermissions('attendance.timesheet.approve')
  @ApiOperation({ summary: 'Everyone in scope and the status of their timesheet for a week (missing included)' })
  board(@CurrentAuth() auth: AuthContext, @Query() query: TimesheetBoardQueryDto) {
    return this.timesheets.board(auth, query);
  }

  @Post('remind')
  @RequirePermissions('attendance.timesheet.approve')
  @ApiOperation({ summary: 'Remind everyone whose timesheet for a week is missing, a draft or sent back' })
  remind(@CurrentAuth() auth: AuthContext, @Body() dto: TimesheetRemindDto) {
    return this.timesheets.remind(auth, dto);
  }

  @Get()
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'My timesheets (view=mine) or the ones I review (view=team)' })
  list(@CurrentAuth() auth: AuthContext, @Query() query: TimesheetQueryDto) {
    return this.timesheets.list(auth, query);
  }

  @Get(':id')
  @RequirePermissions('attendance.view')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.timesheets.get(auth, id);
  }

  @Post(':id/withdraw')
  @RequirePermissions('attendance.timesheet.submit')
  withdraw(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.timesheets.withdraw(auth, id);
  }

  @Post(':id/approve')
  @RequirePermissions('attendance.timesheet.approve')
  approve(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.timesheets.approve(auth, id, dto);
  }

  @Post(':id/reject')
  @RequirePermissions('attendance.timesheet.approve')
  reject(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.timesheets.reject(auth, id, dto);
  }
}
