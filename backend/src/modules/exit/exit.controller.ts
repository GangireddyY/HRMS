import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireStepUp, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { AlumniService } from './alumni.service';
import {
  AlumniProfileDto,
  AlumniQueryDto,
  ApproveExitDto,
  BulkPaySettlementsDto,
  CalculateSettlementDto,
  ClearanceItemDto,
  CloseExitDto,
  ExitQueryDto,
  FeedbackDto,
  InitiateExitDto,
  IssueLetterDto,
  LetterDraftQueryDto,
  PaySettlementDto,
  ResignDto,
  ReturnSettlementDto,
  RevokeLetterDto,
  SettlementBankFileQueryDto,
  SettlementPayoutQueryDto,
  UpdateClearanceDto,
  UpdateExitDto,
} from './dto/exit.dto';
import { ExitLettersService } from './exit-letters.service';
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
    private readonly letterService: ExitLettersService,
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

  @Get('settlements/payouts')
  @RequirePermissions('payroll.settlement.manage')
  @ApiOperation({ summary: 'Approved settlements waiting to be paid (or paid ones), with whether each has bank details' })
  payouts(@CurrentAuth() auth: AuthContext, @Query() query: SettlementPayoutQueryDto) {
    requireAny(auth, ['payroll.settlement.manage']);
    return this.settlements.payouts(auth, query.status);
  }

  @Get('settlements/bank-file')
  @RequirePermissions('payroll.settlement.manage', 'payroll.disburse')
  @RequireStepUp()
  @ApiOperation({ summary: "Transfer file for approved settlements (CSV, generic or a bank's bulk layout) with account numbers – audited; needs a fresh step-up" })
  async settlementBankFile(@CurrentAuth() auth: AuthContext, @Query() query: SettlementBankFileQueryDto) {
    requireAny(auth, ['payroll.settlement.manage']);
    const f = await this.settlements.bankFile(auth, query.ids, query.format);
    return new StreamableFile(Buffer.from(`\uFEFF${f.content}`, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${f.fileName}"` });
  }

  @Post('settlements/pay')
  @RequirePermissions('payroll.settlement.manage')
  @ApiOperation({ summary: 'Mark several approved settlements paid with one transfer reference' })
  payMany(@CurrentAuth() auth: AuthContext, @Body() dto: BulkPaySettlementsDto) {
    requireAny(auth, ['payroll.settlement.manage']);
    return this.settlements.payMany(auth, dto);
  }

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

  // ---- Letters ----------------------------------------------------------------------------------

  @Get(':id/letters')
  @RequireTenant()
  @ApiOperation({ summary: 'Letters issued for the exit (HR sees revoked ones too)' })
  letters(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, ['exit.manage', 'exit.resign']);
    return this.letterService.list(auth, id);
  }

  @Get(':id/letters/draft')
  @RequirePermissions('exit.manage')
  @ApiOperation({ summary: 'Suggested text for a relieving letter or experience certificate' })
  letterDraft(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Query() query: LetterDraftQueryDto) {
    return this.letterService.draft(auth, id, query.type);
  }

  @Post(':id/letters')
  @RequirePermissions('exit.manage')
  @ApiOperation({ summary: 'Issue a letter once the exit is completed' })
  issueLetter(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: IssueLetterDto) {
    return this.letterService.issue(auth, id, dto);
  }

  @Get(':id/letters/:letterId')
  @RequireTenant()
  letter(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('letterId', UUID) letterId: string) {
    requireAny(auth, ['exit.manage', 'exit.resign']);
    return this.letterService.get(auth, id, letterId);
  }

  @Post(':id/letters/:letterId/revoke')
  @RequirePermissions('exit.manage')
  revokeLetter(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('letterId', UUID) letterId: string, @Body() dto: RevokeLetterDto) {
    return this.letterService.revoke(auth, id, letterId, dto);
  }
}

@ApiTags('Exits')
@ApiBearerAuth()
@Controller({ path: 'alumni', version: '1' })
export class AlumniController {
  constructor(private readonly alumni: AlumniService) {}

  @Get()
  @RequireTenant()
  @ApiOperation({ summary: 'Former employees, with contact details of those in the alumni network' })
  list(@CurrentAuth() auth: AuthContext, @Query() query: AlumniQueryDto) {
    requireAny(auth, ['exit.manage', 'exit.view']);
    return this.alumni.list(auth, query);
  }

  @Get('me')
  @RequirePermissions('exit.resign')
  mine(@CurrentAuth() auth: AuthContext) {
    return this.alumni.mine(auth);
  }

  @Put('me')
  @RequirePermissions('exit.resign')
  @ApiOperation({ summary: 'Join or leave the alumni network and keep the details up to date (former employees)' })
  updateMine(@CurrentAuth() auth: AuthContext, @Body() dto: AlumniProfileDto) {
    return this.alumni.updateMine(auth, dto);
  }
}
