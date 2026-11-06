import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RECEIPT_MAX_BYTES } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import {
  AdjustmentDto,
  ClaimDto,
  ClaimQueryDto,
  ComponentDto,
  CreateRunDto,
  FinancialYearQueryDto,
  PayRunDto,
  PayrollSettingsDto,
  RejectRunDto,
  ReviewClaimDto,
  ReviewRunDto,
  RunPayslipQueryDto,
  RunQueryDto,
  SalaryDto,
  SalaryListQueryDto,
  SalaryPreviewDto,
  StructureDto,
  TaxDeclarationDto,
  UpdateComponentDto,
  UpdatePayslipDto,
  UpdateStructureDto,
} from './dto/payroll.dto';
import { PayrollConfigService } from './payroll-config.service';
import { PayrollRunsService } from './payroll-runs.service';
import { ReimbursementsService, type UploadedReceipt } from './reimbursements.service';
import { SalariesService } from './salaries.service';

const UUID = new ParseUUIDPipe();
const RECEIPT_UPLOAD = FileInterceptor('file', { limits: { fileSize: RECEIPT_MAX_BYTES + 512 * 1024, files: 1, fields: 20 } });
const attachment = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
const csvFile = (f: { fileName: string; content: string }) => new StreamableFile(Buffer.from(`\uFEFF${f.content}`, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: attachment(f.fileName) });

/** Payroll module entitlement plus any of the permissions (for endpoints shared by several roles). */
function requireAny(auth: AuthContext, ...permissions: string[]) {
  if (!auth.features.has('payroll')) throw AppError.forbidden('Payroll is not enabled for your organization');
  if (permissions.length && !permissions.some((p) => auth.permissions.has(p))) throw AppError.forbidden();
}

@ApiTags('Payroll')
@ApiBearerAuth()
@Controller({ path: 'payroll', version: '1' })
export class PayrollController {
  constructor(
    private readonly config: PayrollConfigService,
    private readonly salaries: SalariesService,
    private readonly runs: PayrollRunsService,
    private readonly claims: ReimbursementsService,
  ) {}

  // ---- Settings, components & structures ---------------------------------------------------------

  @Get('settings')
  @RequireTenant()
  settings(@CurrentAuth() auth: AuthContext) {
    requireAny(auth, 'payroll.configure', 'payroll.view');
    return this.config.settingsView(auth);
  }

  @Put('settings')
  @RequirePermissions('payroll.configure')
  updateSettings(@CurrentAuth() auth: AuthContext, @Body() dto: PayrollSettingsDto) {
    return this.config.updateSettings(auth, dto);
  }

  @Get('components')
  @RequireTenant()
  components(@CurrentAuth() auth: AuthContext) {
    requireAny(auth, 'payroll.configure', 'payroll.view', 'employee.salary.revise');
    return this.config.components();
  }

  @Post('components')
  @RequirePermissions('payroll.configure')
  createComponent(@CurrentAuth() auth: AuthContext, @Body() dto: ComponentDto) {
    return this.config.createComponent(auth, dto);
  }

  @Patch('components/:id')
  @RequirePermissions('payroll.configure')
  updateComponent(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateComponentDto) {
    return this.config.updateComponent(auth, id, dto);
  }

  @Delete('components/:id')
  @RequirePermissions('payroll.configure')
  async removeComponent(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.config.removeComponent(auth, id);
    return { deleted: true };
  }

  @Get('structures')
  @RequireTenant()
  structures(@CurrentAuth() auth: AuthContext) {
    requireAny(auth, 'payroll.configure', 'payroll.view', 'employee.salary.revise');
    return this.config.structures();
  }

  @Post('structures')
  @RequirePermissions('payroll.configure')
  createStructure(@CurrentAuth() auth: AuthContext, @Body() dto: StructureDto) {
    return this.config.createStructure(auth, dto);
  }

  @Post('structures/recommended')
  @RequirePermissions('payroll.configure')
  @ApiOperation({ summary: 'Add the standard components (Basic, HRA, special allowance) and structure' })
  recommended(@CurrentAuth() auth: AuthContext) {
    return this.config.recommended(auth);
  }

  @Patch('structures/:id')
  @RequirePermissions('payroll.configure')
  updateStructure(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateStructureDto) {
    return this.config.updateStructure(auth, id, dto);
  }

  @Delete('structures/:id')
  @RequirePermissions('payroll.configure')
  async removeStructure(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.config.removeStructure(auth, id);
    return { deleted: true };
  }

  // ---- Salaries --------------------------------------------------------------------------------

  @Post('salaries/preview')
  @RequireTenant()
  @ApiOperation({ summary: 'Monthly breakdown of an annual CTC on a structure (nothing is saved)' })
  preview(@CurrentAuth() auth: AuthContext, @Body() dto: SalaryPreviewDto) {
    requireAny(auth, 'employee.salary.revise', 'payroll.configure');
    return this.salaries.preview(auth, dto);
  }

  @Get('salaries')
  @RequirePermissions('employee.salary.view')
  listSalaries(@CurrentAuth() auth: AuthContext, @Query() query: SalaryListQueryDto) {
    requireAny(auth);
    return this.salaries.list(auth, query);
  }

  @Get('employees/:id/salaries')
  @RequireTenant()
  salaryHistory(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth);
    return this.salaries.history(auth, id);
  }

  @Post('employees/:id/salaries')
  @RequirePermissions('employee.salary.revise')
  @ApiOperation({ summary: 'Set or revise the salary from a date (history is kept)' })
  setSalary(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: SalaryDto) {
    requireAny(auth);
    return this.salaries.create(auth, id, dto);
  }

  @Delete('salaries/:id')
  @RequirePermissions('employee.salary.revise')
  async removeSalary(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth);
    await this.salaries.remove(auth, id);
    return { deleted: true };
  }

  @Get('me/salary')
  @RequireTenant()
  mySalary(@CurrentAuth() auth: AuthContext) {
    requireAny(auth);
    return this.salaries.mine(auth);
  }

  // ---- Tax declarations ------------------------------------------------------------------------

  @Get('me/tax-declaration')
  @RequirePermissions('payroll.payslip.view')
  myDeclaration(@CurrentAuth() auth: AuthContext, @Query() query: FinancialYearQueryDto) {
    return this.salaries.getDeclaration(auth, null, query.fy);
  }

  @Put('me/tax-declaration')
  @RequirePermissions('payroll.payslip.view')
  saveMyDeclaration(@CurrentAuth() auth: AuthContext, @Query() query: FinancialYearQueryDto, @Body() dto: TaxDeclarationDto) {
    return this.salaries.saveDeclaration(auth, null, query.fy, dto);
  }

  @Get('employees/:id/tax-declaration')
  @RequirePermissions('payroll.process')
  declaration(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Query() query: FinancialYearQueryDto) {
    return this.salaries.getDeclaration(auth, id, query.fy);
  }

  @Put('employees/:id/tax-declaration')
  @RequirePermissions('payroll.process')
  saveDeclaration(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Query() query: FinancialYearQueryDto, @Body() dto: TaxDeclarationDto) {
    return this.salaries.saveDeclaration(auth, id, query.fy, dto);
  }

  // ---- Runs ------------------------------------------------------------------------------------

  @Get('runs')
  @RequirePermissions('payroll.view')
  listRuns(@Query() query: RunQueryDto) {
    return this.runs.list(query);
  }

  @Post('runs')
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'Start (and calculate) the payroll for a month' })
  createRun(@CurrentAuth() auth: AuthContext, @Body() dto: CreateRunDto) {
    return this.runs.create(auth, dto);
  }

  @Get('runs/:id')
  @RequirePermissions('payroll.view')
  run(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.runs.get(auth, id);
  }

  @Post('runs/:id/calculate')
  @RequirePermissions('payroll.process')
  calculate(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.runs.calculate(auth, id);
  }

  @Post('runs/:id/submit')
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'Recalculate and send for approval' })
  submit(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.runs.submit(auth, id);
  }

  @Post('runs/:id/approve')
  @RequirePermissions('payroll.approve')
  @ApiOperation({ summary: 'Approve (not by whoever processed it); publishes the payslips' })
  approve(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReviewRunDto) {
    return this.runs.approve(auth, id, dto);
  }

  @Post('runs/:id/reject')
  @RequirePermissions('payroll.approve')
  reject(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: RejectRunDto) {
    return this.runs.reject(auth, id, dto);
  }

  @Post('runs/:id/pay')
  @RequirePermissions('payroll.disburse')
  @ApiOperation({ summary: 'Mark the approved payroll as paid' })
  pay(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: PayRunDto) {
    return this.runs.markPaid(auth, id, dto);
  }

  @Post('runs/:id/cancel')
  @RequirePermissions('payroll.process')
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.runs.cancel(auth, id);
  }

  @Get('runs/:id/payslips')
  @RequirePermissions('payroll.view')
  runPayslips(@Param('id', UUID) id: string, @Query() query: RunPayslipQueryDto) {
    return this.runs.payslips(id, query);
  }

  @Patch('runs/:id/payslips/:payslipId')
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'Override loss of pay, or hold / release the salary (draft runs)' })
  updatePayslip(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('payslipId', UUID) payslipId: string, @Body() dto: UpdatePayslipDto) {
    return this.runs.updatePayslip(auth, id, payslipId, dto);
  }

  @Post('runs/:id/adjustments')
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'One-time earning (bonus, arrears) or deduction (recovery) for this run' })
  addAdjustment(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: AdjustmentDto) {
    return this.runs.addAdjustment(auth, id, dto);
  }

  @Delete('runs/:id/adjustments/:adjustmentId')
  @RequirePermissions('payroll.process')
  removeAdjustment(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Param('adjustmentId', UUID) adjustmentId: string) {
    return this.runs.removeAdjustment(auth, id, adjustmentId);
  }

  @Get('runs/:id/register')
  @RequirePermissions('payroll.view')
  async register(@Param('id', UUID) id: string) {
    return csvFile(await this.runs.registerCsv(id));
  }

  @Get('runs/:id/bank-file')
  @RequirePermissions('payroll.disburse')
  @ApiOperation({ summary: 'Salary transfer file (CSV) with account numbers – audited' })
  async bankFile(@Param('id', UUID) id: string) {
    return csvFile(await this.runs.bankFileCsv(id));
  }

  @Get('runs/:id/pf-ecr')
  @RequirePermissions('payroll.view')
  @ApiOperation({ summary: 'EPFO ECR text file for the month' })
  async pfEcr(@Param('id', UUID) id: string) {
    const f = await this.runs.pfEcr(id);
    return new StreamableFile(Buffer.from(f.content, 'utf8'), { type: 'text/plain; charset=utf-8', disposition: attachment(f.fileName) });
  }

  // ---- Payslips --------------------------------------------------------------------------------

  @Get('me/payslips')
  @RequirePermissions('payroll.payslip.view')
  myPayslips(@CurrentAuth() auth: AuthContext) {
    return this.runs.myPayslips(auth);
  }

  @Get('payslips/:id')
  @RequireTenant()
  payslip(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth, 'payroll.view', 'payroll.payslip.view');
    return this.runs.payslip(auth, id);
  }

  // ---- Reimbursements --------------------------------------------------------------------------

  @Post('reimbursements')
  @RequirePermissions('payroll.reimbursement.apply')
  @UseInterceptors(RECEIPT_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Claim an expense, optionally with a receipt (PDF / image up to 5 MB)' })
  createClaim(@CurrentAuth() auth: AuthContext, @Body() dto: ClaimDto, @UploadedFile() file?: UploadedReceipt) {
    return this.claims.create(auth, dto, file);
  }

  @Get('reimbursements')
  @RequireTenant()
  listClaims(@CurrentAuth() auth: AuthContext, @Query() query: ClaimQueryDto) {
    requireAny(auth, 'payroll.reimbursement.apply', 'payroll.reimbursement.approve', 'payroll.view');
    return this.claims.list(auth, query);
  }

  @Get('reimbursements/:id')
  @RequireTenant()
  claim(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth);
    return this.claims.get(auth, id);
  }

  @Get('reimbursements/:id/receipt')
  @RequireTenant()
  async receipt(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    requireAny(auth);
    const r = await this.claims.receipt(auth, id);
    return new StreamableFile(r.stream, { type: r.contentType, length: r.size, disposition: attachment(r.fileName) });
  }

  @Post('reimbursements/:id/approve')
  @RequirePermissions('payroll.reimbursement.approve')
  approveClaim(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReviewClaimDto) {
    return this.claims.approve(auth, id, dto);
  }

  @Post('reimbursements/:id/reject')
  @RequirePermissions('payroll.reimbursement.approve')
  rejectClaim(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReviewClaimDto) {
    return this.claims.reject(auth, id, dto);
  }

  @Post('reimbursements/:id/cancel')
  @RequirePermissions('payroll.reimbursement.apply')
  cancelClaim(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.claims.cancel(auth, id);
  }
}
