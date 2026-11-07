import { Controller, Get, Param, ParseEnumPipe, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { REPORT_KEYS, REPORT_PERMISSIONS, type ReportKey } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { ReportExportQueryDto, ReportQueryDto } from './dto/reports.dto';
import { ReportsService } from './reports.service';

const attachment = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
const KEY = new ParseEnumPipe(Object.fromEntries(REPORT_KEYS.map((k) => [k, k])));

@ApiTags('Reports')
@ApiBearerAuth()
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

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
