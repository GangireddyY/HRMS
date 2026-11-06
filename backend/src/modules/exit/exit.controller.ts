import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import {
  ApproveExitDto,
  CalculateSettlementDto,
  ClearanceItemDto,
  CloseExitDto,
  ExitQueryDto,
  FeedbackDto,
  InitiateExitDto,
  PaySettlementDto,
  ResignDto,
  ReturnSettlementDto,
  UpdateClearanceDto,
  UpdateExitDto,
} from './dto/exit.dto';
import { ExitsService } from './exits.service';
import { SettlementsService } from './settlements.service';

const UUID = new ParseUUIDPipe();
const HANDLERS = ['exit.view', 'exit.approve', 'exit.manage', 'exit.clearance.manage', 'payroll.settlement.manage'];

/** Exit module entitlement plus any of the permissions (case-level access is decided by the service). */
function requireAny(auth: AuthContext, permissions: string[]) {
  if (!auth.features.has('exit')) throw AppError.forbidden('Exit management is not enabled for your organization');
  if (!permissions.some((p) => auth.permissions.has(p))) throw AppError.forbidden();
}

@ApiTags('Exits')
@ApiBearerAuth()
@Controller({ path: 'exits', version: '1' })
export class ExitController {
  constructor(
    private readonly exits: ExitsService,
    private readonly settlements: SettlementsService,
  ) {}

  // ---- Employees --------------------------------------------------------------------------------

  @Post('resign')
  @RequirePermissions('exit.resign')
  resign(@CurrentAuth() auth: AuthContext, @Body() dto: ResignDto) {
    return this.exits.resign(auth, dto);
  }

  @Get('mine')
  @RequirePermissions('exit.resign')
  mine(@CurrentAuth() auth: AuthContext) {
    return this.exits.mine(auth);
  }

  @Post(':id/withdraw')
  @RequirePermissions('exit.resign')
  withdraw(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.exits.withdraw(auth, id);
  }

  @Post(':id/feedback')
  @RequirePermissions('exit.resign')
  @ApiOperation({ summary: 'Exit survey (seen only by exit.manage)' })
  feedback(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: FeedbackDto) {
    return this.exits.feedback(auth, id, dto);
  }

  // ---- HR & managers ----------------------------------------------------------------------------

  @Post()
  @RequirePermissions('exit.manage')
  @ApiOperation({ summary: 'Record an employer-initiated exit (termination, retirement, end of contract, death…)' })
  initiate(@CurrentAuth() auth: AuthContext, @Body() dto: InitiateExitDto) {
    return this.exits.initiate(auth, dto);
  }

  @Get()
  @RequireTenant()
  list(@CurrentAuth() auth: AuthContext, @Query() query: ExitQueryDto) {
    requireAny(auth, HANDLERS);
    return this.exits.list(auth, query);
  }

  @Get(':id')
  @RequireTenant()
  get(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, [...HANDLERS, 'exit.resign']);
    return this.exits.get(auth, id);
  }

  @Post(':id/approve')
  @RequireTenant()
  @ApiOperation({ summary: 'Accept a resignation and set the last working day' })
  approve(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ApproveExitDto) {
    requireAny(auth, ['exit.approve', 'exit.manage']);
    return this.exits.approve(auth, id, dto);
  }

  @Patch(':id')
  @RequirePermissions('exit.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateExitDto) {
    return this.exits.update(auth, id, dto);
  }

  @Post(':id/clearance')
  @RequireTenant()
  addClearance(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ClearanceItemDto) {
    requireAny(auth, ['exit.manage', 'exit.clearance.manage']);
    return this.exits.addClearance(auth, id, dto);
  }

  @Patch(':id/clearance/:itemId')
  @RequireTenant()
  updateClearance(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('itemId', UUID) itemId: string, @Body() dto: UpdateClearanceDto) {
    requireAny(auth, ['exit.manage', 'exit.clearance.manage', 'exit.approve']);
    return this.exits.updateClearance(auth, id, itemId, dto);
  }

  @Post(':id/complete')
  @RequirePermissions('exit.manage')
  complete(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.exits.complete(auth, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('exit.manage')
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: CloseExitDto) {
    return this.exits.cancel(auth, id, dto);
  }

  // ---- Full & final settlement ------------------------------------------------------------------

  @Get(':id/settlement')
  @RequireTenant()
  settlement(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, ['payroll.settlement.manage', 'exit.resign']);
    return this.settlements.get(auth, id);
  }

  @Post(':id/settlement')
  @RequirePermissions('payroll.settlement.manage')
  @ApiOperation({ summary: 'Work out (or recalculate) the full & final settlement' })
  calculate(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: CalculateSettlementDto) {
    requireAny(auth, ['payroll.settlement.manage']);
    return this.settlements.calculate(auth, id, dto);
  }

  @Post(':id/settlement/submit')
  @RequirePermissions('payroll.settlement.manage')
  submit(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, ['payroll.settlement.manage']);
    return this.settlements.submit(auth, id);
  }

  @Post(':id/settlement/return')
  @RequirePermissions('payroll.settlement.manage')
  returnSettlement(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReturnSettlementDto) {
    requireAny(auth, ['payroll.settlement.manage']);
    return this.settlements.returnToDraft(auth, id, dto);
  }

  @Post(':id/settlement/approve')
  @RequirePermissions('payroll.settlement.manage')
  approveSettlement(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, ['payroll.settlement.manage']);
    return this.settlements.approve(auth, id);
  }

  @Post(':id/settlement/pay')
  @RequirePermissions('payroll.settlement.manage')
  pay(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: PaySettlementDto) {
    requireAny(auth, ['payroll.settlement.manage']);
    return this.settlements.pay(auth, id, dto);
  }
}
