import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TAX_PROOF_MAX_BYTES } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireStepUp, RequireTenant } from '../../common/auth/decorators';
import { AcceptProofDto, FinancialYearQueryDto, ProofQueryDto, RejectProofDto, Tds24qQueryDto, UploadProofDto } from './dto/payroll.dto';
import type { UploadedReceipt } from './reimbursements.service';
import { SalariesService } from './salaries.service';
import { StatutoryService } from './statutory.service';
import { TaxProofsService } from './tax-proofs.service';

const UUID = new ParseUUIDPipe();
const PROOF_UPLOAD = FileInterceptor('file', { limits: { fileSize: TAX_PROOF_MAX_BYTES + 512 * 1024, files: 1, fields: 10 } });
const attachment = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
const htmlFile = (f: { fileName: string; html: string }) => new StreamableFile(Buffer.from(f.html, 'utf8'), { type: 'text/html; charset=utf-8', disposition: attachment(f.fileName) });
const csvFile = (f: { fileName: string; content: string }) => new StreamableFile(Buffer.from(`\uFEFF${f.content}`, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: attachment(f.fileName) });

@ApiTags('Payroll – statutory')
@ApiBearerAuth()
@Controller({ path: 'payroll', version: '1' })
export class StatutoryController {
  constructor(
    private readonly proofs: TaxProofsService,
    private readonly statutory: StatutoryService,
    private readonly salaries: SalariesService,
  ) {}

  private async fy(auth: AuthContext, fy?: number) {
    return fy ?? (await this.salaries.currentFinancialYear(auth.organizationId!));
  }

  // ---- Self-service ----------------------------------------------------------------------------

  @Get('me/tax-proofs')
  @RequirePermissions('payroll.payslip.view')
  @ApiOperation({ summary: 'Your investment / rent proofs for a financial year, with declared vs. accepted per section' })
  myProofs(@CurrentAuth() auth: AuthContext, @Query() query: FinancialYearQueryDto) {
    return this.proofs.forEmployee(auth, null, query.fy);
  }

  @Post('me/tax-proofs')
  @RequirePermissions('payroll.payslip.view')
  @UseInterceptors(PROOF_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Submit a proof (PDF / image up to 5 MB) for a declared deduction' })
  uploadProof(@CurrentAuth() auth: AuthContext, @Body() dto: UploadProofDto, @UploadedFile() file?: UploadedReceipt) {
    return this.proofs.upload(auth, dto, file);
  }

  @Delete('me/tax-proofs/:id')
  @RequirePermissions('payroll.payslip.view')
  async removeProof(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.proofs.remove(auth, id);
    return { deleted: true };
  }

  @Get('me/form12bb')
  @RequirePermissions('payroll.payslip.view')
  @ApiOperation({ summary: 'Your Form 12BB (printable HTML) from the declaration and proofs' })
  async myForm12bb(@CurrentAuth() auth: AuthContext, @Query() query: FinancialYearQueryDto) {
    return htmlFile(await this.statutory.form12bb(auth, null, await this.fy(auth, query.fy)));
  }

  @Get('me/form16')
  @RequirePermissions('payroll.payslip.view')
  @ApiOperation({ summary: 'Your Form 16 Part B figures for a financial year (null before any approved payroll)' })
  async myForm16(@CurrentAuth() auth: AuthContext, @Query() query: FinancialYearQueryDto) {
    const data = await this.statutory.form16(auth, null, await this.fy(auth, query.fy));
    return data ? { ...data, employee: { ...data.employee, pan: data.employee.pan ? `••••••${data.employee.pan.slice(-4)}` : null } } : null;
  }

  @Get('me/form16/document')
  @RequirePermissions('payroll.payslip.view')
  @ApiOperation({ summary: 'Your Form 16 Part B (printable HTML)' })
  async myForm16Document(@CurrentAuth() auth: AuthContext, @Query() query: FinancialYearQueryDto) {
    return htmlFile(await this.statutory.form16Document(auth, null, await this.fy(auth, query.fy)));
  }

  @Get('tax-proofs/:id/file')
  @RequireTenant()
  @ApiOperation({ summary: 'A proof file (your own, or anyone’s with payroll.process)' })
  async proofFile(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    const f = await this.proofs.file(auth, id);
    return new StreamableFile(f.stream, { type: f.contentType, length: f.size, disposition: attachment(f.fileName) });
  }

  // ---- Payroll team ----------------------------------------------------------------------------

  @Get('tax-proofs')
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'Proofs to review (submitted first)' })
  listProofs(@CurrentAuth() auth: AuthContext, @Query() query: ProofQueryDto) {
    return this.proofs.list(auth, query);
  }

  @Get('employees/:id/tax-proofs')
  @RequirePermissions('payroll.process')
  employeeProofs(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Query() query: FinancialYearQueryDto) {
    return this.proofs.forEmployee(auth, id, query.fy);
  }

  @Post('tax-proofs/:id/accept')
  @HttpCode(200)
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'Accept a proof, fully or for part of the amount' })
  acceptProof(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: AcceptProofDto) {
    return this.proofs.accept(auth, id, dto);
  }

  @Post('tax-proofs/:id/reject')
  @HttpCode(200)
  @RequirePermissions('payroll.process')
  rejectProof(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Body() dto: RejectProofDto) {
    return this.proofs.reject(auth, id, dto);
  }

  @Get('employees/:id/form12bb')
  @RequirePermissions('payroll.process')
  @RequireStepUp()
  async employeeForm12bb(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Query() query: FinancialYearQueryDto) {
    return htmlFile(await this.statutory.form12bb(auth, id, await this.fy(auth, query.fy)));
  }

  @Get('employees/:id/form16/document')
  @RequirePermissions('payroll.process')
  @RequireStepUp()
  @ApiOperation({ summary: 'An employee’s Form 16 Part B (printable HTML with PAN; audited, needs a fresh step-up)' })
  async employeeForm16(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string, @Query() query: FinancialYearQueryDto) {
    return htmlFile(await this.statutory.form16Document(auth, id, await this.fy(auth, query.fy)));
  }

  @Get('statutory/24q')
  @RequirePermissions('payroll.process')
  @RequireStepUp()
  @ApiOperation({ summary: 'Quarterly TDS return on salary (24Q) – deductee details as CSV (PANs; audited, needs a fresh step-up)' })
  async tds24q(@Query() query: Tds24qQueryDto) {
    return csvFile(await this.statutory.tds24q(query.fy, query.quarter));
  }

  @Get('runs/:id/esi-return')
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'ESIC monthly contribution file (CSV) for an approved run' })
  async esiReturn(@Param('id', UUID) id: string) {
    return csvFile(await this.statutory.esiReturn(id));
  }

  @Get('runs/:id/state-levies')
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'Professional tax and labour welfare fund per employee and state (CSV) for an approved run' })
  async stateLevies(@Param('id', UUID) id: string) {
    return csvFile(await this.statutory.stateLevies(id));
  }

  @Get('runs/:id/statutory-summary')
  @RequirePermissions('payroll.view')
  @ApiOperation({ summary: 'PF, ESI, professional tax, labour welfare fund and TDS totals of a run' })
  statutorySummary(@Param('id', UUID) id: string) {
    return this.statutory.summary(id);
  }
}
