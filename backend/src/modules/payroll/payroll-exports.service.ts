import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { csvCell } from '../../common/utils/csv';
import { fullName } from '../../common/utils/names';
import {
BANK_FILE_FORMAT_LABELS,
type BankFileFormat
} from '../../contracts';
import { DatabaseService } from '../../database/database.service';
import {
Employee,
PayrollRun,
Payslip,
type PayslipLine
} from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { ctx as fields } from '../../infrastructure/crypto/encrypted-fields';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { bankCsv,type BankPayment } from './bank-layouts';
import { MONTHS,periodLabel } from './payroll-period';
import { SalariesService } from './salaries.service';

/** Files from an approved payroll run: the register, the bank transfer file and the PF return (ECR). */
@Injectable()
export class PayrollExportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly crypto: EncryptionService,
    private readonly salaries: SalariesService,
  ) {}

  /** Payroll register: one row per paid employee with every earning, deduction and employer contribution. */
  async registerCsv(id: string): Promise<{ fileName: string; content: string }> {
    const run = await this.find(id);
    const rows = await Payslip.findAll({ where: { runId: id, excluded: false }, order: [[this.db.sequelize.literal(`"Payslip"."employee"->>'name'`), 'ASC']] });
    const cols = (pick: (p: Payslip) => PayslipLine[]) => {
      const m = new Map<string, string>();
      for (const p of rows) for (const l of pick(p)) m.set(l.code, l.name);
      return [...m.entries()];
    };
    const earnings = cols((p) => p.earnings);
    const deductions = cols((p) => p.deductions);
    const employer = cols((p) => p.employerContributions);
    const amount = (lines: PayslipLine[], code: string) => lines.find((l) => l.code === code)?.amount ?? 0;
    const header = [
      'Employee code',
      'Name',
      'Department',
      'Designation',
      'Days in month',
      'Loss of pay days',
      'Payable days',
      ...earnings.map(([, n]) => n),
      'Gross',
      ...deductions.map(([, n]) => n),
      'Total deductions',
      'Net pay',
      ...employer.map(([, n]) => `Employer ${n}`),
    ];
    const lines = rows.map((p) =>
      [
        p.employee.employeeCode,
        p.employee.name,
        p.employee.department,
        p.employee.designation,
        p.daysInMonth,
        Number(p.lopOverride ?? p.lopDays),
        Number(p.payableDays),
        ...earnings.map(([c]) => amount(p.earnings, c)),
        Number(p.gross),
        ...deductions.map(([c]) => amount(p.deductions, c)),
        Number(p.totalDeductions),
        Number(p.netPay),
        ...employer.map(([c]) => amount(p.employerContributions, c)),
      ]
        .map(csvCell)
        .join(','),
    );
    return { fileName: `payroll-register-${run.year}-${String(run.month).padStart(2, '0')}.csv`, content: [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n' };
  }

  /**
   * Salary transfer file for the bank (approved runs), in a generic layout or a bank's bulk-upload layout. Account
   * numbers are decrypted, so every export is audited. Banks revise their templates: check the current one with the
   * bank before the first upload.
   */
  async bankFileCsv(id: string, format: BankFileFormat = 'GENERIC'): Promise<{ fileName: string; content: string; skipped: number }> {
    const run = await this.find(id);
    if (run.status !== 'APPROVED' && run.status !== 'PAID') throw AppError.conflict('The bank file is available once the payroll is approved');
    const payslips = await Payslip.findAll({ where: { runId: id, excluded: false } });
    const employees = new Map(
      (await Employee.findAll({ where: { id: payslips.map((p) => p.employeeId) }, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'bankAccountEncrypted', 'bankIfsc', 'bankName'] })).map(
        (e) => [e.id, e],
      ),
    );
    const narration = `SALARY ${MONTHS[run.month - 1]!.slice(0, 3).toUpperCase()} ${run.year}`;
    const payDate = run.paidAt ? run.paidAt.toISOString().slice(0, 10) : await this.salaries.today(run.organizationId);
    let skipped = 0;
    const payments: BankPayment[] = [];
    for (const p of payslips) {
      const e = employees.get(p.employeeId);
      if (!e?.bankAccountEncrypted || !e.bankIfsc || Number(p.netPay) <= 0) {
        skipped++;
        continue;
      }
      payments.push({
        name: fullName(e),
        code: e.employeeCode,
        account: this.crypto.decrypt(e.bankAccountEncrypted, fields.employee('bank_account', e.id)),
        ifsc: e.bankIfsc.toUpperCase(),
        bank: e.bankName ?? '',
        amount: Number(p.netPay).toFixed(2),
      });
    }
    await this.audit.record({
      action: 'payroll.bank_file_exported',
      entityType: 'PayrollRun',
      entityId: id,
      summary: `Bank transfer file (${BANK_FILE_FORMAT_LABELS[format]}) for ${periodLabel(run.year, run.month)} exported (${payments.length} payments)`,
      metadata: { payments: payments.length, skipped, format },
    });
    const suffix = format === 'GENERIC' ? '' : `-${format.toLowerCase()}`;
    return { fileName: `bank-transfer-${run.year}-${String(run.month).padStart(2, '0')}${suffix}.csv`, content: bankCsv(payments, format, narration, payDate), skipped };
  }

  /** EPFO electronic challan-cum-return (ECR) text file, one member per line, fields separated by #~#. */
  async pfEcr(id: string): Promise<{ fileName: string; content: string; skipped: number }> {
    const run = await this.find(id);
    if (run.status !== 'APPROVED' && run.status !== 'PAID') throw AppError.conflict('The PF return is available once the payroll is approved');
    const payslips = (await Payslip.findAll({ where: { runId: id, excluded: false } })).filter((p) => p.deductions.some((d) => d.code === 'PF'));
    const employees = new Map((await Employee.findAll({ where: { id: payslips.map((p) => p.employeeId) }, attributes: ['id', 'firstName', 'lastName', 'uanEncrypted'] })).map((e) => [e.id, e]));
    let skipped = 0;
    const lines: string[] = [];
    for (const p of payslips) {
      const e = employees.get(p.employeeId);
      if (!e?.uanEncrypted) {
        skipped++;
        continue;
      }
      const s = p.statutory as { pfWage: number; epsWage: number; edliWage: number; salaryGross: number };
      const amount = (code: string, lines: PayslipLine[]) => lines.find((l) => l.code === code)?.amount ?? 0;
      lines.push(
        [
          this.crypto.decrypt(e.uanEncrypted, fields.employee('uan', e.id)),
          fullName(e).toUpperCase().replace(/#~#/g, ' '),
          Math.round(s.salaryGross),
          Math.round(s.pfWage),
          Math.round(s.epsWage),
          Math.round(s.edliWage),
          amount('PF', p.deductions),
          amount('EPS', p.employerContributions),
          amount('EPF', p.employerContributions),
          Math.round(Number(p.lopOverride ?? p.lopDays)),
          0,
        ].join('#~#'),
      );
    }
    await this.audit.record({
      action: 'payroll.pf_ecr_exported',
      entityType: 'PayrollRun',
      entityId: id,
      summary: `PF ECR for ${periodLabel(run.year, run.month)} exported (${lines.length} members)`,
      metadata: { members: lines.length, skipped },
    });
    return { fileName: `pf-ecr-${run.year}-${String(run.month).padStart(2, '0')}.txt`, content: lines.join('\n') + (lines.length ? '\n' : ''), skipped };
  }

  private async find(id: string): Promise<PayrollRun> {
    const run = await PayrollRun.findByPk(id);
    if (!run) throw AppError.notFound('Payroll run');
    return run;
  }
}
