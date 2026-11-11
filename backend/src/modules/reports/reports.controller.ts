import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { REPORT_KEYS, REPORT_PERMISSIONS, type ReportKey } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { ReportExportQueryDto, ReportQueryDto } from './dto/reports.dto';
import { ReportsService } from './reports.service';
import { BuilderExportDto, BuilderQueryDto, ReportScheduleDto, SaveReportDto } from './builder/report-builder.dto';
import { ReportBuilderService } from './builder/report-builder.service';
import { ReportSchedulesService } from './schedules/report-schedules.service';

const attachment = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
const KEY = new ParseEnumPipe(Object.fromEntries(REPORT_KEYS.map((k) => [k, k])));

@ApiTags('Reports')
@ApiBearerAuth()
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly builder: ReportBuilderService,
    private readonly schedulesService: ReportSchedulesService,
  ) {}

  @Get('headcount')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Headcount on a day by department, location, type, gender and grade, with a 12-month trend' })
  headcount(@CurrentAuth() auth: AuthContext, @Query() query: ReportQueryDto) {
    return this.reports.headcount(auth, query);
  }

  @Get('attrition')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Joiners, leavers and attrition over a period, by department, type of exit, reason and service' })
  attrition(@CurrentAuth() auth: AuthContext, @Query() query: ReportQueryDto) {
    return this.reports.attrition(auth, query);
  }

  @Get('leave')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Leave starting in a period by type, department and person' })
  leave(@CurrentAuth() auth: AuthContext, @Query() query: ReportQueryDto) {
    return this.reports.leave(auth, query);
  }

  @Get('payroll-cost')
  @RequirePermissions('reports.payroll.view')
  @ApiOperation({ summary: 'Payroll cost by month (approved and paid runs) and by department' })
  payrollCost(@CurrentAuth() auth: AuthContext, @Query() query: ReportQueryDto) {
    return this.reports.payrollCost(auth, query);
  }

  @Get('recruitment')
  @RequirePermissions('reports.recruitment.view')
  @ApiOperation({ summary: 'Applications, hires, offers and time to hire over a period' })
  recruitment(@CurrentAuth() auth: AuthContext, @Query() query: ReportQueryDto) {
    return this.reports.recruitment(auth, query);
  }

  // ---- Report builder --------------------------------------------------------------------------

  @Get('builder/datasets')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Datasets you can build reports on, with their columns' })
  datasets(@CurrentAuth() auth: AuthContext) {
    return this.builder.catalog(auth);
  }

  @Post('builder/run')
  @RequirePermissions('reports.view')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run a report: the first 500 rows, and the total' })
  runBuilder(@CurrentAuth() auth: AuthContext, @Body() dto: BuilderQueryDto) {
    return this.builder.run(auth, dto);
  }

  @Post('builder/export')
  @RequirePermissions('reports.view', 'reports.export')
  @HttpCode(200)
  @ApiOperation({ summary: 'The whole report as CSV or Excel (up to 20,000 rows)' })
  async exportBuilder(@CurrentAuth() auth: AuthContext, @Body() dto: BuilderExportDto) {
    const { format, title, ...query } = dto;
    const f = await this.builder.export(auth, query, format ?? 'csv', title);
    return new StreamableFile(f.content, { type: f.contentType, length: f.content.length, disposition: attachment(f.fileName) });
  }

  @Get('saved')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Your saved reports and those shared with you' })
  saved(@CurrentAuth() auth: AuthContext) {
    return this.builder.saved(auth);
  }

  @Post('saved')
  @RequirePermissions('reports.view')
  saveReport(@CurrentAuth() auth: AuthContext, @Body() dto: SaveReportDto) {
    return this.builder.save(auth, dto);
  }

  @Put('saved/:id')
  @RequirePermissions('reports.view')
  updateReport(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SaveReportDto) {
    return this.builder.save(auth, dto, id);
  }

  @Delete('saved/:id')
  @RequirePermissions('reports.view')
  removeReport(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.builder.remove(auth, id);
  }

  // ---- Scheduled reports -----------------------------------------------------------------------

  @Get('schedules')
  @RequirePermissions('reports.view', 'reports.export')
  @ApiOperation({ summary: 'Your scheduled reports' })
  schedules(@CurrentAuth() auth: AuthContext) {
    return this.schedulesService.list(auth);
  }

  @Get('schedules/recipients')
  @RequirePermissions('reports.view', 'reports.export')
  @ApiOperation({ summary: 'Members to send a scheduled report to (each gets only what their own access allows)' })
  scheduleRecipients(@Query('q') q?: string) {
    return this.schedulesService.candidates((q ?? '').slice(0, 100));
  }

  @Post('schedules')
  @RequirePermissions('reports.view', 'reports.export')
  @ApiOperation({ summary: 'Email one of your saved reports daily, weekly or monthly' })
  createSchedule(@CurrentAuth() auth: AuthContext, @Body() dto: ReportScheduleDto) {
    return this.schedulesService.create(auth, dto);
  }

  @Put('schedules/:id')
  @RequirePermissions('reports.view', 'reports.export')
  updateSchedule(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ReportScheduleDto) {
    return this.schedulesService.update(auth, id, dto);
  }

  @Delete('schedules/:id')
  @RequirePermissions('reports.view', 'reports.export')
  @HttpCode(204)
  async removeSchedule(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.schedulesService.remove(auth, id);
  }

  @Post('schedules/:id/send')
  @RequirePermissions('reports.view', 'reports.export')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send it now to its recipients (the schedule is unchanged)' })
  sendSchedule(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.schedulesService.sendNow(auth, id);
  }

  @Get(':key/export')
  @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'A report as CSV, Excel (xlsx) or PDF (also needs the permission for that report)' })
  async export(@CurrentAuth() auth: AuthContext, @Param('key', KEY) key: ReportKey, @Query() query: ReportExportQueryDto) {
    if (!auth.permissions.has(REPORT_PERMISSIONS[key])) throw AppError.forbidden();
    const { format, ...filters } = query;
    const f = await this.reports.export(auth, key, filters, format);
    return new StreamableFile(f.content, { type: f.contentType, length: f.content.length, disposition: attachment(f.fileName) });
  }
}
