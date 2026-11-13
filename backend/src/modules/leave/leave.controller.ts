import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import {
  AdjustmentDto,
  ApplyLeaveDto,
  BalanceOverviewQueryDto,
  BalanceQueryDto,
  CancelLeaveDto,
  CompOffQueryDto,
  CreateCompOffDto,
  EncashmentQueryDto,
  EncashmentRequestDto,
  LeaveCalendarQueryDto,
  LeaveQuoteDto,
  LeaveRequestQueryDto,
  LeaveSettingsDto,
  LeaveTypeDto,
  LedgerQueryDto,
  RejectLeaveDto,
  ReviewLeaveDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto';
import { CompOffService } from './comp-off.service';
import { EncashmentsService } from './encashments.service';
import { LeaveBalanceService } from './leave-balance.service';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveTypesService } from './leave-types.service';

const UUID = new ParseUUIDPipe();

@ApiTags('Leave')
@ApiBearerAuth()
@Controller({ path: 'leave', version: '1' })
export class LeaveController {
  constructor(
    private readonly types: LeaveTypesService,
    private readonly balances: LeaveBalanceService,
    private readonly requests: LeaveRequestsService,
    private readonly compOffs: CompOffService,
    private readonly encashments: EncashmentsService,
  ) {}

  // ---- Configuration ---------------------------------------------------------------------------

  @Get('types')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Leave types and their policies' })
  listTypes() {
    return this.types.list();
  }

  @Post('types')
  @RequirePermissions('leave.configure')
  createType(@CurrentAuth() auth: AuthContext, @Body() dto: LeaveTypeDto) {
    return this.types.create(auth, dto);
  }

  @Post('types/recommended')
  @RequirePermissions('leave.configure')
  @ApiOperation({ summary: 'Add the recommended starter types (CL, SL, EL, LOP) that do not exist yet' })
  addRecommended(@CurrentAuth() auth: AuthContext) {
    return this.types.addRecommended(auth);
  }

  @Patch('types/:id')
  @RequirePermissions('leave.configure')
  updateType(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateLeaveTypeDto) {
    return this.types.update(auth, id, dto);
  }

  @Delete('types/:id')
  @RequirePermissions('leave.configure')
  async removeType(@Param('id', UUID) id: string) {
    await this.types.remove(id);
    return { deleted: true };
  }

  @Get('settings')
  @RequirePermissions('leave.view')
  settings(@CurrentAuth() auth: AuthContext) {
    return this.types.settings(auth.organizationId!);
  }

  @Put('settings')
  @RequirePermissions('leave.configure')
  updateSettings(@CurrentAuth() auth: AuthContext, @Body() dto: LeaveSettingsDto) {
    return this.types.updateSettings(auth, dto);
  }

  // ---- Balances --------------------------------------------------------------------------------

  @Get('balances')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Balances per leave type for an employee (default: yourself) in a leave year' })
  balancesOf(@CurrentAuth() auth: AuthContext, @Query() query: BalanceQueryDto) {
    return this.balances.balances(auth, query.employeeId, query.year);
  }

  @Get('balances/overview')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Available balances of employees in your scope' })
  overview(@CurrentAuth() auth: AuthContext, @Query() query: BalanceOverviewQueryDto) {
    return this.balances.overview(auth, query);
  }

  @Get('ledger')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Balance history (accruals, carry-forward, leave taken, adjustments)' })
  ledger(@CurrentAuth() auth: AuthContext, @Query() query: LedgerQueryDto) {
    return this.balances.ledger(auth, query);
  }

  @Post('adjustments')
  @RequirePermissions('leave.view', 'leave.allocate')
  @ApiOperation({ summary: 'Grant, correct or encash leave (current leave year; audited; the employee is notified)' })
  adjust(@CurrentAuth() auth: AuthContext, @Body() dto: AdjustmentDto) {
    return this.balances.adjust(auth, dto);
  }

  @Post('accruals/run')
  @RequirePermissions('leave.allocate')
  @ApiOperation({ summary: 'Bring accruals and year-end carry-forward up to date for everyone (safe to repeat)' })
  runAccruals(@CurrentAuth() auth: AuthContext) {
    return this.balances.runAccruals(auth);
  }

  // ---- Requests --------------------------------------------------------------------------------

  @Post('requests/quote')
  @RequirePermissions('leave.apply')
  @ApiOperation({ summary: 'Days and balance impact of a prospective request, with any rule it breaks (nothing is saved)' })
  quote(@CurrentAuth() auth: AuthContext, @Body() dto: LeaveQuoteDto) {
    return this.requests.quote(auth, dto);
  }

  @Post('requests')
  @RequirePermissions('leave.apply')
  apply(@CurrentAuth() auth: AuthContext, @Body() dto: ApplyLeaveDto) {
    return this.requests.apply(auth, dto);
  }

  @Get('requests')
  @RequirePermissions('leave.view')
  list(@CurrentAuth() auth: AuthContext, @Query() query: LeaveRequestQueryDto) {
    return this.requests.list(auth, query);
  }

  @Post('requests/:id/approve')
  @RequirePermissions('leave.approve')
  approve(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReviewLeaveDto) {
    return this.requests.approve(auth, id, dto);
  }

  @Post('requests/:id/reject')
  @RequirePermissions('leave.approve')
  reject(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: RejectLeaveDto) {
    return this.requests.reject(auth, id, dto);
  }

  @Post('requests/:id/cancel')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Cancel your own pending (or not yet started) leave, or, as an approver, any approved leave' })
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: CancelLeaveDto) {
    return this.requests.cancel(auth, id, dto);
  }

  @Get('calendar')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Approved and pending leave in a month within your scope, with holidays' })
  calendar(@CurrentAuth() auth: AuthContext, @Query() query: LeaveCalendarQueryDto) {
    return this.requests.calendar(auth, query);
  }

  // ---- Compensatory off ------------------------------------------------------------------------

  @Get('comp-offs/eligible')
  @RequirePermissions('leave.apply')
  @ApiOperation({ summary: 'Holidays and weekly offs you worked recently, with the comp-off each can earn' })
  compOffEligible(@CurrentAuth() auth: AuthContext) {
    return this.compOffs.eligible(auth);
  }

  @Post('comp-offs')
  @RequirePermissions('leave.apply')
  requestCompOff(@CurrentAuth() auth: AuthContext, @Body() dto: CreateCompOffDto) {
    return this.compOffs.create(auth, dto);
  }

  @Get('comp-offs')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Your comp-off requests, or (view=team) the ones you can approve' })
  listCompOffs(@CurrentAuth() auth: AuthContext, @Query() query: CompOffQueryDto) {
    return this.compOffs.list(auth, query);
  }

  @Post('comp-offs/:id/approve')
  @RequirePermissions('leave.approve')
  approveCompOff(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReviewLeaveDto) {
    return this.compOffs.approve(auth, id, dto);
  }

  @Post('comp-offs/:id/reject')
  @RequirePermissions('leave.approve')
  rejectCompOff(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: RejectLeaveDto) {
    return this.compOffs.reject(auth, id, dto);
  }

  @Post('comp-offs/:id/cancel')
  @RequirePermissions('leave.apply')
  cancelCompOff(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.compOffs.cancel(auth, id);
  }

  // ---- Encashment ------------------------------------------------------------------------------

  @Get('encashments/options')
  @RequirePermissions('leave.apply')
  @ApiOperation({ summary: 'How many days of each encashable type you can encash now' })
  encashmentOptions(@CurrentAuth() auth: AuthContext) {
    return this.encashments.options(auth);
  }

  @Post('encashments')
  @RequirePermissions('leave.apply')
  @ApiOperation({ summary: 'Ask to be paid for unused leave (paid with the next payroll once approved)' })
  requestEncashment(@CurrentAuth() auth: AuthContext, @Body() dto: EncashmentRequestDto) {
    return this.encashments.request(auth, dto);
  }

  @Get('encashments')
  @RequireTenant()
  @ApiOperation({ summary: 'Your encashment requests, or everyone’s (view=all, leave.allocate)' })
  listEncashments(@CurrentAuth() auth: AuthContext, @Query() query: EncashmentQueryDto) {
    if (!auth.features.has('leave') || (!auth.permissions.has('leave.apply') && !auth.permissions.has('leave.allocate'))) throw AppError.forbidden();
    return this.encashments.list(auth, query);
  }

  @Post('encashments/:id/approve')
  @RequirePermissions('leave.allocate')
  approveEncashment(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReviewLeaveDto) {
    return this.encashments.approve(auth, id, dto);
  }

  @Post('encashments/:id/reject')
  @RequirePermissions('leave.allocate')
  rejectEncashment(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: RejectLeaveDto) {
    return this.encashments.reject(auth, id, dto);
  }

  @Post('encashments/:id/cancel')
  @RequirePermissions('leave.apply')
  cancelEncashment(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.encashments.cancel(auth, id);
  }
}
